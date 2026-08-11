import { and, desc, eq, gt, inArray, isNotNull, ne, not, or } from "drizzle-orm";
import { db } from "../database";
import { setCapitalSource } from "../utils/withAuditContext";
import { anularFacturaEnCofidi } from "./reversePayment";
import {
  abonos_capital,
  bad_debts,
  boletas,
  credit_reset_snapshots,
  creditos,
  creditos_inversionistas,
  cuotas_credito,
  facturacion_desglose,
  facturas_electronicas,
  moras_credito,
  pagos_credito,
  pagos_credito_inversionistas,
  pagos_credito_inversionistas_espejo,
} from "../database/db/schema";
import type {
  SnapshotArtefactos,
  SnapshotPayloadV1,
} from "./creditResetSnapshot";

type StatusCreditValue =
  | "ACTIVO"
  | "CANCELADO"
  | "INCOBRABLE"
  | "PENDIENTE_CANCELACION"
  | "EN_CONVENIO"
  | "MOROSO"
  | "CAIDO";

export interface ReverseGate {
  gate: string;
  ok: boolean;
  detalle: string;
}

export interface ReverseCancelationParams {
  creditId: number;
  dryRun?: boolean;
  motivo?: string;
  executedBy?: string;
  executedById?: number;
}

// Preserva NULL: restaurar "0" donde había NULL rompería la restauración exacta.
// Si un campo NOT NULL trajera null (imposible: la foto salió de la misma BD),
// que truene la constraint antes que restaurar un valor inventado.
const num = (v: unknown): string =>
  (v == null ? null : String(v)) as unknown as string;

/**
 * Reversa la cancelación hecha por resetCredit usando el snapshot vivo del
 * crédito (drizzle/0025): valida gates, borra por ID lo que el cierre creó y
 * restaura el estado previo desde el payload. Con dryRun (default) solo evalúa
 * y reporta, sin escribir nada.
 *
 * Fuera del alcance (decisión de negocio, no reversable por SQL): destino del
 * dinero de la boleta de cierre, liquidaciones ya pagadas a inversionistas,
 * documentos entregados al cliente, garantías y SIFCO.
 */
export async function reverseCancelation({
  creditId,
  dryRun = true,
  motivo,
  executedBy,
  executedById,
}: ReverseCancelationParams) {
  return await db.transaction(async (tx) => {
    const gates: ReverseGate[] = [];
    const addGate = (gate: string, ok: boolean, detalle: string) => {
      gates.push({ gate, ok, detalle });
      return ok;
    };

    // ── Cargar crédito + snapshot ────────────────────────────────────────
    const [credito] = await tx
      .select()
      .from(creditos)
      .where(eq(creditos.credito_id, creditId))
      .limit(1)
      .for("update");

    if (!credito) {
      return { ok: false, dryRun, gates, message: "Crédito no encontrado." };
    }

    const [snapshot] = await tx
      .select()
      .from(credit_reset_snapshots)
      .where(
        and(
          eq(credit_reset_snapshots.credito_id, creditId),
          eq(credit_reset_snapshots.estado, "VIVO")
        )
      )
      // El índice único garantiza un solo VIVO; el orderBy hace determinista
      // el caso degradado (datos manipulados a mano) tomando el más reciente.
      .orderBy(desc(credit_reset_snapshots.created_at))
      .limit(1);

    addGate(
      "SNAPSHOT",
      !!snapshot,
      snapshot
        ? `Snapshot #${snapshot.id} del ${snapshot.created_at?.toISOString?.() ?? snapshot.created_at}`
        : "No existe snapshot vivo para este crédito (cancelación previa a la fase 1 → vía forense)."
    );

    addGate(
      "STATUS",
      credito.statusCredit === "CANCELADO" ||
        credito.statusCredit === "INCOBRABLE",
      `Status actual: ${credito.statusCredit}`
    );

    const payload = snapshot?.payload as SnapshotPayloadV1 | undefined;
    const artefactos = snapshot?.artefactos_creados as
      | SnapshotArtefactos
      | undefined
      | null;

    addGate(
      "ARTEFACTOS",
      !!artefactos?.pago_cierre_id,
      artefactos?.pago_cierre_id
        ? `Pago de cierre #${artefactos.pago_cierre_id}`
        : "El snapshot no tiene artefactos registrados (cierre incompleto)."
    );

    if (!snapshot || !payload || !artefactos?.pago_cierre_id) {
      return {
        ok: false,
        dryRun,
        gates,
        message: "No se puede reversar: faltan snapshot o artefactos.",
      };
    }

    const pagoCierreId = artefactos.pago_cierre_id;
    const pagosDelCierre = [
      pagoCierreId,
      ...(artefactos.pago_incobrable_placeholder_id
        ? [artefactos.pago_incobrable_placeholder_id]
        : []),
    ];

    // ── Gate: el pago de cierre sigue existiendo y sigue siendo el cierre ─
    // Si ya lo tocaron por otra vía (reversePayment, manual), los DELETE serían
    // no-ops silenciosos y la restauración correría igual sobre un crédito a medias.
    const [pagoCierre] = await tx
      .select({
        pago_id: pagos_credito.pago_id,
        credito_id: pagos_credito.credito_id,
        registerBy: pagos_credito.registerBy,
      })
      .from(pagos_credito)
      .where(eq(pagos_credito.pago_id, pagoCierreId))
      .limit(1);

    addGate(
      "PAGO_CIERRE",
      !!pagoCierre &&
        pagoCierre.credito_id === creditId &&
        pagoCierre.registerBy === "system_reset",
      !pagoCierre
        ? `El pago de cierre #${pagoCierreId} ya no existe (¿reversado por otra vía?).`
        : pagoCierre.credito_id !== creditId
          ? `El pago #${pagoCierreId} pertenece al crédito ${pagoCierre.credito_id}, no al ${creditId}.`
          : pagoCierre.registerBy !== "system_reset"
            ? `El pago #${pagoCierreId} ya no es un cierre system_reset (registerBy: ${pagoCierre.registerBy}).`
            : `Pago de cierre #${pagoCierreId} íntegro.`
    );

    // ── Gate: liquidación a inversionistas no pagada ─────────────────────
    const pciLiquidados = await tx
      .select({ id: pagos_credito_inversionistas.id })
      .from(pagos_credito_inversionistas)
      .where(
        and(
          eq(pagos_credito_inversionistas.pago_id, pagoCierreId),
          ne(pagos_credito_inversionistas.estado_liquidacion, "NO_LIQUIDADO")
        )
      );

    const cuotasLiquidadas = artefactos.cuota_cierre_ids.length
      ? await tx
          .select({ cuota_id: cuotas_credito.cuota_id })
          .from(cuotas_credito)
          .where(
            and(
              inArray(cuotas_credito.cuota_id, artefactos.cuota_cierre_ids),
              eq(cuotas_credito.liquidado_inversionistas, true)
            )
          )
      : [];

    addGate(
      "LIQUIDACION_INVERSIONISTAS",
      pciLiquidados.length === 0 && cuotasLiquidadas.length === 0,
      pciLiquidados.length === 0 && cuotasLiquidadas.length === 0
        ? "La liquidación del cierre no se ha pagado."
        : `Ya hay liquidación pagada/en proceso (${pciLiquidados.length} pci, ${cuotasLiquidadas.length} cuotas). Revertir la BD no recupera ese dinero; resolver con finanzas.`
    );

    // ── Gate: fotos de liquidación (espejo) del cierre ───────────────────
    // La foto CONGELA el monto a pagar y su FK es ON DELETE SET NULL: borrar el
    // pago sin tratarla dejaría una fila huérfana que la liquidación pagaría igual.
    const espejoDelCierre = await tx
      .select({
        id: pagos_credito_inversionistas_espejo.id,
        estado_liquidacion:
          pagos_credito_inversionistas_espejo.estado_liquidacion,
      })
      .from(pagos_credito_inversionistas_espejo)
      .where(
        inArray(pagos_credito_inversionistas_espejo.pago_id, pagosDelCierre)
      );

    const espejoBloqueado = espejoDelCierre.filter(
      (e) => e.estado_liquidacion !== "NO_LIQUIDADO"
    );
    // Fotos del propio cierre aún no liquidadas: la ejecución las libera y borra,
    // así que los abonos que ellas consumieron NO deben bloquear la reversa.
    const espejoCierreLiberable = espejoDelCierre
      .filter((e) => e.estado_liquidacion === "NO_LIQUIDADO")
      .map((e) => e.id);

    addGate(
      "ESPEJO_LIQUIDACION",
      espejoBloqueado.length === 0,
      espejoDelCierre.length === 0
        ? "El cierre no tiene fotos de liquidación en espejo."
        : espejoBloqueado.length === 0
          ? `${espejoCierreLiberable.length} foto(s) NO_LIQUIDADO del cierre se borrarán al ejecutar.`
          : `${espejoBloqueado.length} foto(s) del cierre ya liquidadas o en proceso (ids: ${espejoBloqueado.map((e) => e.id).join(", ")}). Resolver con finanzas antes de reversar.`
    );

    // ── Gate: abonos de capital del cierre intactos ──────────────────────
    // Bloquea si el abono ya se liquidó o si lo consumió una foto que NO podemos
    // borrar (de otro pago, o ya liquidada). Los consumidos por la foto liberable
    // del propio cierre pasan: la ejecución los libera antes de borrarlos.
    const abonosBloqueados = artefactos.abonos_capital_ids.length
      ? await tx
          .select({ abono_id: abonos_capital.abono_id })
          .from(abonos_capital)
          .where(
            and(
              inArray(abonos_capital.abono_id, artefactos.abonos_capital_ids),
              or(
                eq(abonos_capital.liquidado, true),
                espejoCierreLiberable.length
                  ? and(
                      isNotNull(abonos_capital.pago_espejo_id),
                      not(
                        inArray(
                          abonos_capital.pago_espejo_id,
                          espejoCierreLiberable
                        )
                      )
                    )
                  : isNotNull(abonos_capital.pago_espejo_id)
              )
            )
          )
      : [];

    addGate(
      "ABONOS_CAPITAL",
      abonosBloqueados.length === 0,
      abonosBloqueados.length === 0
        ? "Abonos del cierre sin liquidar ni consumidos por fotos ajenas."
        : `${abonosBloqueados.length} abono(s) ya liquidados o consumidos por una foto que no es del cierre (ids: ${abonosBloqueados.map((a) => a.abono_id).join(", ")}).`
    );

    // ── Gate: sin pagos posteriores al cierre ────────────────────────────
    // Limitación conocida: pago_id > cierre es un proxy de tiempo que detecta
    // pagos NUEVOS, pero no mutaciones sobre filas existentes (revalidaciones)
    // ni convenios creados después del cierre — el flujo normal los bloquea
    // sobre créditos CANCELADOS, y detectarlos sin timestamps sería frágil.
    const pagosPosteriores = await tx
      .select({ pago_id: pagos_credito.pago_id })
      .from(pagos_credito)
      .where(
        and(
          eq(pagos_credito.credito_id, creditId),
          gt(pagos_credito.pago_id, pagoCierreId),
          not(inArray(pagos_credito.pago_id, pagosDelCierre))
        )
      );

    addGate(
      "PAGOS_POSTERIORES",
      pagosPosteriores.length === 0,
      pagosPosteriores.length === 0
        ? "No hay pagos posteriores al cierre."
        : `Hay ${pagosPosteriores.length} pago(s) posteriores (ids: ${pagosPosteriores.map((p) => p.pago_id).join(", ")}). Reversar encima los corrompería.`
    );

    // ── Facturas del cierre (informativo: se anulan al ejecutar) ─────────
    const facturasActivas = await tx
      .select({
        factura_id: facturas_electronicas.factura_id,
        uuid: facturas_electronicas.uuid,
        serie: facturas_electronicas.serie,
        numero: facturas_electronicas.numero,
        receptor_nit: facturas_electronicas.receptor_nit,
        fecha_certificacion: facturas_electronicas.fecha_certificacion,
        fecha_emision: facturas_electronicas.fecha_emision,
      })
      .from(facturas_electronicas)
      .where(
        and(
          inArray(facturas_electronicas.pago_id, pagosDelCierre),
          eq(facturas_electronicas.status, "ACTIVA")
        )
      );

    addGate(
      "FACTURAS",
      true,
      facturasActivas.length === 0
        ? "El cierre no tiene facturas activas."
        : `${facturasActivas.length} factura(s) activa(s) se intentarán anular en COFIDI; si la anulación falla, la reversa aborta.`
    );

    // Colateral en facturación: el desglose diario cae por CASCADE al borrar el
    // pago, y las facturas del cierre quedan con pago_id NULL. Si el mes ya se
    // reportó (cierre mensual / snapshot diario), los números publicados dejan
    // de cuadrar — visible en el plan para que conta lo sepa antes de ejecutar.
    const desgloseDelCierre = await tx
      .select({ id: facturacion_desglose.id })
      .from(facturacion_desglose)
      .where(inArray(facturacion_desglose.pago_id, pagosDelCierre));

    const gatesOk = gates.every((g) => g.ok);
    const plan = {
      restaurar_credito: true,
      status_destino: payload.status_previo,
      inversionistas_a_restaurar: payload.creditos_inversionistas.length,
      pagos_a_desanular: payload.pagos_a_anular.length,
      pagos_a_borrar: pagosDelCierre,
      cuotas_a_borrar: artefactos.cuota_cierre_ids,
      abonos_capital_a_borrar: artefactos.abonos_capital_ids.length,
      pci_a_borrar: artefactos.pagos_credito_inversionistas_ids.length,
      espejo_a_borrar: espejoCierreLiberable.length,
      boletas_a_borrar: artefactos.boleta_ids.length,
      bad_debt_a_borrar: artefactos.bad_debt_id,
      facturas_a_anular: facturasActivas.length,
      facturacion_desglose_borrado_por_cascade: desgloseDelCierre.length,
      facturas_quedan_sin_pago: facturasActivas.length > 0,
      mora_a_restaurar: !!payload.mora_activa,
    };

    if (dryRun || !gatesOk) {
      return {
        ok: gatesOk,
        dryRun,
        gates,
        plan,
        message: gatesOk
          ? "Dry-run: todos los gates pasan, la reversa puede ejecutarse."
          : "La reversa está bloqueada por uno o más gates.",
      };
    }

    // ── EJECUCIÓN ────────────────────────────────────────────────────────
    // 1) Anular facturas en COFIDI (externo, primero: si falla, nada se tocó)
    let facturasAnuladasAntes = 0;
    for (const factura of facturasActivas) {
      const resultado = await anularFacturaEnCofidi({
        uuid: factura.uuid,
        motivo: `Reversa de cancelación del crédito ID: ${creditId}`,
        factura: {
          receptor_nit: factura.receptor_nit,
          fecha_certificacion: factura.fecha_certificacion,
          fecha_emision: factura.fecha_emision,
        },
      });
      if (!resultado.success || !resultado.anulado) {
        throw new Error(
          `No se pudo anular la factura ${factura.serie}-${factura.numero} en COFIDI: ${resultado.mensaje}.` +
            (facturasAnuladasAntes > 0
              ? ` Atención conta: ${facturasAnuladasAntes} factura(s) del cierre ya quedaron ANULADAS en SAT y BD antes de abortar, y el crédito sigue CANCELADO. Reintentar la reversa (las ya anuladas se saltan solas).`
              : "")
        );
      }
      // Con `db` (no `tx`) a propósito: la anulación en SAT ya ocurrió y no se
      // deshace con un rollback. Persistirla fuera de la tx deja la BD alineada
      // con SAT aunque la reversa aborte después, y un reintento no re-anula
      // (solo se procesan facturas ACTIVA). Segunda conexión del pool: aceptable
      // solo porque esta es una operación manual y poco frecuente — no copiar
      // este patrón en rutas calientes.
      await db
        .update(facturas_electronicas)
        .set({
          status: "ANULADA",
          fecha_anulacion: new Date(),
          motivo_anulacion: `Reversa de cancelación del crédito ID: ${creditId}`,
          anulada_por: executedById ?? credito.usuario_id ?? null,
        })
        .where(eq(facturas_electronicas.factura_id, factura.factura_id));
      facturasAnuladasAntes++;
    }

    // 2) Borrar lo que el cierre creó (hijos antes que pagos, pagos antes que cuotas)
    await tx
      .delete(pagos_credito_inversionistas)
      .where(eq(pagos_credito_inversionistas.pago_id, pagoCierreId));

    // Fotos NO_LIQUIDADO del cierre: liberar los abonos que congelaron y borrarlas,
    // para que la liquidación no pague un cierre que deja de existir. Solo las
    // liberables: si hubiera bloqueadas el gate ya abortó, pero el invariante
    // queda escrito en el código.
    if (espejoCierreLiberable.length) {
      await tx
        .update(abonos_capital)
        .set({ pago_espejo_id: null })
        .where(inArray(abonos_capital.pago_espejo_id, espejoCierreLiberable));
      await tx
        .delete(pagos_credito_inversionistas_espejo)
        .where(
          inArray(pagos_credito_inversionistas_espejo.id, espejoCierreLiberable)
        );
    }

    if (artefactos.abonos_capital_ids.length) {
      await tx
        .delete(abonos_capital)
        .where(
          inArray(abonos_capital.abono_id, artefactos.abonos_capital_ids)
        );
    }

    await tx.delete(boletas).where(inArray(boletas.pago_id, pagosDelCierre));

    await tx
      .delete(pagos_credito)
      .where(inArray(pagos_credito.pago_id, pagosDelCierre));

    if (artefactos.cuota_cierre_ids.length) {
      await tx
        .delete(cuotas_credito)
        .where(inArray(cuotas_credito.cuota_id, artefactos.cuota_cierre_ids));
    }

    if (artefactos.bad_debt_id) {
      await tx.delete(bad_debts).where(eq(bad_debts.id, artefactos.bad_debt_id));
    }

    // 3) Restaurar el crédito desde el payload
    const c = payload.credito;
    await setCapitalSource(
      tx,
      "REVERSO",
      executedById ?? null,
      motivo ?? "Reversa de cancelación"
    );
    await tx
      .update(creditos)
      .set({
        capital: num(c.capital),
        deudatotal: num(c.deudatotal),
        cuota: num(c.cuota),
        cuota_interes: num(c.cuota_interes),
        iva_12: num(c.iva_12),
        seguro_10_cuotas: num(c.seguro_10_cuotas),
        gps: num(c.gps),
        membresias: num(c.membresias),
        membresias_pago: num(c.membresias_pago),
        plazo: (c.plazo == null ? null : Number(c.plazo)) as unknown as number,
        porcentaje_royalti: num(c.porcentaje_royalti),
        royalti: num(c.royalti),
        otros: num(c.otros),
        statusCredit: payload.status_previo as StatusCreditValue,
      })
      .where(eq(creditos.credito_id, creditId));

    // 4) Restaurar creditos_inversionistas
    for (const inv of payload.creditos_inversionistas) {
      await tx
        .update(creditos_inversionistas)
        .set({
          monto_aportado: num(inv.monto_aportado),
          cuota_inversionista: num(inv.cuota_inversionista),
          monto_inversionista: num(inv.monto_inversionista),
          monto_cash_in: num(inv.monto_cash_in),
          iva_inversionista: num(inv.iva_inversionista),
          iva_cash_in: num(inv.iva_cash_in),
        })
        .where(eq(creditos_inversionistas.id, Number(inv.id)));
    }

    // 5) Des-anular exactamente los pagos que el cierre anuló
    for (const pago of payload.pagos_a_anular) {
      await tx
        .update(pagos_credito)
        .set({
          paymentFalse: pago.paymentFalse as unknown as boolean,
          capital_restante: num(pago.capital_restante),
          interes_restante: num(pago.interes_restante),
          iva_12_restante: num(pago.iva_12_restante),
          seguro_restante: num(pago.seguro_restante),
          gps_restante: num(pago.gps_restante),
          total_restante: num(pago.total_restante),
          mora: num(pago.mora),
        })
        .where(eq(pagos_credito.pago_id, pago.pago_id));
    }

    // 6) Restaurar mora activa
    if (payload.mora_activa?.mora_id) {
      await tx
        .update(moras_credito)
        .set({
          activa: true,
          monto_mora: num(payload.mora_activa.monto_mora),
        })
        .where(eq(moras_credito.mora_id, Number(payload.mora_activa.mora_id)));
    }

    // 7) Cerrar el snapshot
    await tx
      .update(credit_reset_snapshots)
      .set({
        estado: "RESTAURADO",
        restaurado_at: new Date(),
        restaurado_por: executedBy ?? "SISTEMA-REVERSA",
      })
      .where(eq(credit_reset_snapshots.id, snapshot.id));

    return {
      ok: true,
      dryRun: false,
      gates,
      plan,
      message: `Cancelación reversada: crédito #${creditId} restaurado a ${payload.status_previo}. Pendiente decisión de negocio sobre el dinero de la boleta de cierre.`,
    };
  });
}
