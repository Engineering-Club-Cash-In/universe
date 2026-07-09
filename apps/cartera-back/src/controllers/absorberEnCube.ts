import Big from "big.js";
import { and, eq } from "drizzle-orm";
import { creditos, creditos_inversionistas, creditos_inversionistas_espejo } from "../database/db";

export const CUBE_INVESTMENT_ID = 86;

// Deriva cuota + montos + IVAs para un row CUBE-puro (cash_in=100, part=0)
// a partir del monto_aportado final y la tasa del crédito. Idéntica a la
// fórmula que usaba exitInvestor (consistente con processAndReplaceCreditInvestors).
export function calcDerivadosCubePuro(montoAportado: Big, porcentajeInteres: string | number) {
  const cuota = montoAportado.times(porcentajeInteres).div(100).round(2);
  const montoInversionista = new Big(0);        // participacion = 0
  const montoCashIn = cuota;                     // cash_in = 100
  const ivaInversionista = new Big(0);
  const ivaCashIn = montoCashIn.gt(0) ? montoCashIn.times(0.12).round(2) : new Big(0);
  return {
    cuota_inversionista: cuota.toFixed(2),
    monto_inversionista: montoInversionista.toFixed(2),
    monto_cash_in: montoCashIn.toFixed(2),
    iva_inversionista: ivaInversionista.toFixed(2),
    iva_cash_in: ivaCashIn.toFixed(2),
  };
}

// ============================================================================
// HELPER: absorberInversionistaEnCube
// ============================================================================
//
// PROPÓSITO
// Transfiere la participación de UN inversionista en UN crédito hacia CUBE
// (SWAP si CUBE aún no está en el crédito, MERGE si ya está), tanto en la
// tabla PADRE (`creditos_inversionistas`) como en su ESPEJO
// (`creditos_inversionistas_espejo`), y recalcula las cuotas del pool
// resultante. Extraído del cuerpo per-crédito de `exitInvestor` para poder
// reutilizarlo desde otros flujos (p.ej. devolución/cancelación) que
// necesiten el mismo movimiento de capital hacia CUBE dentro de su propia
// transacción.
//
// Esta función NO abre transacción propia — recibe `tx` y asume que el
// caller ya está dentro de una. Tampoco toca `inversionistas.status` ni
// `creditos.bandera_reinversion` fuera de lo que el bloque original hacía
// (bandera_reinversion SÍ se apaga acá, igual que en el `exitInvestor`
// original); el `status='inactivo'` del inversionista queda a cargo del
// caller, porque depende de la corrida completa (todos los créditos), no de
// un solo crédito.
//
// CONTRATO DE RETORNO (discriminado por `ok`)
// - `{ ok: true, ... }`: crédito procesado — swap o merge aplicado en padre
//   y espejo (si aplica), pool recalculado, bandera_reinversion=false.
// - `{ ok: false, credito_id, razon }`: no se pudo procesar (crédito
//   inexistente, o el inversionista no tiene row en el padre de ese
//   crédito). No lanza — el caller decide si lo reporta como error parcial
//   o aborta.
// ============================================================================
export type AbsorberResultado =
  | {
      ok: true;
      credito_id: number;
      numero_credito_sifco: string | null;
      monto_transferido: string;
      monto_transferido_raw: string;
      cube_preexistente: boolean;
      accion: "swap" | "merge";
    }
  | { ok: false; credito_id: number; razon: string };

export async function absorberInversionistaEnCube(
  tx: any,
  credito_id: number,
  inversionista_id: number,
  logger?: { log?: (...a: any[]) => void; warn?: (...a: any[]) => void },
): Promise<AbsorberResultado> {
  const log = logger?.log ?? (() => {});
  const warn = logger?.warn ?? (() => {});

  // ────────────────────────────────────────────────────────────────────
  // 1 — Verificar que el crédito exista.
  // Trae SIFCO (log + correo), porcentaje_interes (cuota inicial del
  // row CUBE en SWAP/MERGE) y los campos para el recálculo del pool
  // estilo `calculateInvestorQuotas` (cuota total + cargos del mayor).
  // ────────────────────────────────────────────────────────────────────
  const [creditoData] = await tx
    .select({
      credito_id: creditos.credito_id,
      numero_credito_sifco: creditos.numero_credito_sifco,
      porcentaje_interes: creditos.porcentaje_interes,
      cuota: creditos.cuota,
      seguro_10_cuotas: creditos.seguro_10_cuotas,
      gps: creditos.gps,
      membresias_pago: creditos.membresias_pago,
    })
    .from(creditos)
    .where(eq(creditos.credito_id, credito_id))
    .limit(1);

  if (!creditoData) {
    warn(`   ⚠️  Crédito ${credito_id} no existe`);
    return { ok: false, credito_id, razon: "Crédito no existe" };
  }
  log(`   ✅ Crédito existe — SIFCO=${creditoData.numero_credito_sifco ?? "(null)"}`);

  // ────────────────────────────────────────────────────────────────────
  // 2 — Leer row del inversionista en PADRE (creditos_inversionistas).
  // Este row es el que vamos a "swappear" o "mergear" con CUBE.
  // Si el inversionista no está aquí, no hay nada que mover en este
  // crédito → se reporta como error.
  // ────────────────────────────────────────────────────────────────────
  const [invEnPadre] = await tx
    .select()
    .from(creditos_inversionistas)
    .where(
      and(
        eq(creditos_inversionistas.credito_id, credito_id),
        eq(creditos_inversionistas.inversionista_id, inversionista_id),
      ),
    )
    .limit(1);

  if (!invEnPadre) {
    warn(`   ⚠️  Inversionista ${inversionista_id} NO está en creditos_inversionistas de este crédito`);
    return { ok: false, credito_id, razon: `Inversionista ${inversionista_id} no está en este crédito` };
  }
  log(`   💰 Row padre del inversionista: monto_aportado=${invEnPadre.monto_aportado}, cuota=${invEnPadre.cuota_inversionista}, %participacion=${invEnPadre.porcentaje_participacion_inversionista}`);

  // ────────────────────────────────────────────────────────────────────
  // 3 — Ver si CUBE ya tiene row en este crédito.
  // La presencia/ausencia de CUBE define el camino:
  //   - Sin CUBE → SWAP (cambiar el inversionista_id del row).
  //   - Con CUBE → MERGE (sumar campos + borrar row del inversionista).
  // ────────────────────────────────────────────────────────────────────
  const [cubeEnPadre] = await tx
    .select()
    .from(creditos_inversionistas)
    .where(
      and(
        eq(creditos_inversionistas.credito_id, credito_id),
        eq(creditos_inversionistas.inversionista_id, CUBE_INVESTMENT_ID),
      ),
    )
    .limit(1);

  // Monto que va a quedar "a nombre de" CUBE en este crédito.
  // Usamos Big.js para no perder precisión al sumar montos monetarios.
  const montoTransferido = new Big(invEnPadre.monto_aportado);
  const cubePreexistente = !!cubeEnPadre;

  // Monto final que va a tener CUBE en PADRE tras la operación.
  // - SWAP: lo que aportaba el inversionista (el row es el mismo).
  // - MERGE: suma del que ya tenía CUBE + el del inversionista.
  // Este mismo valor se fuerza en el espejo para que espejo = padre
  // (Opción 1: sincronización total de capital).
  const nuevoMontoCubePadre: Big = cubeEnPadre
    ? new Big(cubeEnPadre.monto_aportado).plus(new Big(invEnPadre.monto_aportado))
    : new Big(invEnPadre.monto_aportado);

  if (cubePreexistente && cubeEnPadre) {
    log(`   🟡 CUBE YA existe en el crédito (padre): monto_aportado=${cubeEnPadre.monto_aportado}`);
  } else {
    log(`   🟢 CUBE NO existe en el crédito (padre)`);
  }

  if (!cubeEnPadre) {
    // ──────────────────────────────────────────────────────────────────
    // 4A — CASO A: SWAP en PADRE
    // CUBE no está en el crédito → el row pasa a ser de CUBE conservando
    // monto_aportado del saliente. CUBE-puro: participacion=0,
    // cash_in=100 (todo el rendimiento es Cash-In). Cuota e IVAs se
    // recalculan con la fórmula canónica desde la tasa del crédito.
    // ──────────────────────────────────────────────────────────────────
    const derivadosSwapPadre = calcDerivadosCubePuro(new Big(invEnPadre.monto_aportado), creditoData.porcentaje_interes);
    log(`   🔄 [PADRE] Caso A (SWAP): inversionista_id ${inversionista_id} → ${CUBE_INVESTMENT_ID}, CUBE puro 0/100 →`, derivadosSwapPadre);
    const resA = await tx
      .update(creditos_inversionistas)
      .set({
        inversionista_id: CUBE_INVESTMENT_ID,
        porcentaje_cash_in: "100",
        porcentaje_participacion_inversionista: "0",
        ...derivadosSwapPadre,
      })
      .where(
        and(
          eq(creditos_inversionistas.credito_id, credito_id),
          eq(creditos_inversionistas.inversionista_id, inversionista_id),
        ),
      )
      .returning({ id: creditos_inversionistas.id });
    log(`   ✅ [PADRE] SWAP aplicado en ${resA.length} row(s)`);
  } else {
    // ──────────────────────────────────────────────────────────────────
    // 4B — CASO B: MERGE en PADRE
    // CUBE ya está en el crédito → no podemos tener dos rows de CUBE
    // (uniqueIndex ux_credito_inversionista). Entonces:
    //   1. Sumar el monto_aportado del saliente al row de CUBE.
    //   2. Forzar porcentajes a CUBE-puro: cash_in=100, participacion=0.
    //   3. Recalcular cuota + 4 derivados con la fórmula canónica
    //      desde la tasa del crédito (NO sumar los del saliente).
    //   4. Borrar el row del inversionista.
    // No se tocan otros inversionistas del pool.
    // ──────────────────────────────────────────────────────────────────
    const derivadosMergePadre = calcDerivadosCubePuro(nuevoMontoCubePadre, creditoData.porcentaje_interes);
    const payload = {
      monto_aportado: nuevoMontoCubePadre.toFixed(8),
      porcentaje_participacion_inversionista: "0",
      porcentaje_cash_in: "100",
      ...derivadosMergePadre,
    };
    log(`   🔀 [PADRE] Caso B (MERGE): suma monto_aportado, CUBE puro 0/100 →`, payload);

    const resB1 = await tx
      .update(creditos_inversionistas)
      .set(payload)
      .where(
        and(
          eq(creditos_inversionistas.credito_id, credito_id),
          eq(creditos_inversionistas.inversionista_id, CUBE_INVESTMENT_ID),
        ),
      )
      .returning({ id: creditos_inversionistas.id });
    log(`   ✅ [PADRE] MERGE aplicado en row CUBE (${resB1.length})`);

    const resB2 = await tx
      .delete(creditos_inversionistas)
      .where(
        and(
          eq(creditos_inversionistas.credito_id, credito_id),
          eq(creditos_inversionistas.inversionista_id, inversionista_id),
        ),
      )
      .returning({ id: creditos_inversionistas.id });
    log(`   ✅ [PADRE] DELETE row del inversionista (${resB2.length})`);
  }

  // ────────────────────────────────────────────────────────────────────
  // 5 — Mismo tratamiento en la tabla ESPEJO (creditos_inversionistas_espejo)
  // El espejo refleja el estado "operativo" que usa el proceso de
  // liquidación. La lógica es idéntica al padre (SWAP vs MERGE), pero
  // además forzamos `status = "completado"` en el row resultante para
  // cerrar cualquier pendiente que tuviera el inversionista.
  //
  // Si el inversionista no tiene row en espejo para este crédito
  // (escenario posible por desincronizaciones históricas), se salta
  // esta sección sin error.
  // ────────────────────────────────────────────────────────────────────
  const [invEnEspejo] = await tx
    .select()
    .from(creditos_inversionistas_espejo)
    .where(
      and(
        eq(creditos_inversionistas_espejo.credito_id, credito_id),
        eq(creditos_inversionistas_espejo.inversionista_id, inversionista_id),
      ),
    )
    .limit(1);

  if (!invEnEspejo) {
    log(`   ℹ️  [ESPEJO] Inversionista NO tiene row en espejo de este crédito — se salta el espejo`);
  } else {
    log(`   💰 [ESPEJO] Row del inversionista: monto_aportado=${invEnEspejo.monto_aportado}, status=${invEnEspejo.status}`);

    // Mismo check de "¿existe CUBE en espejo?" para definir SWAP vs MERGE
    const [cubeEnEspejo] = await tx
      .select()
      .from(creditos_inversionistas_espejo)
      .where(
        and(
          eq(creditos_inversionistas_espejo.credito_id, credito_id),
          eq(creditos_inversionistas_espejo.inversionista_id, CUBE_INVESTMENT_ID),
        ),
      )
      .limit(1);

    if (!cubeEnEspejo) {
      // 5A — ESPEJO SWAP: cambia id, fuerza status=completado,
      // CUBE-puro: cash_in=100, participacion=0. Sincroniza
      // monto_aportado con el valor del PADRE (capital original, sin
      // descuentos por pagos previos). Cuota + 4 derivados se recalculan
      // con la fórmula canónica desde ese mismo monto_aportado.
      const derivadosSwapEspejo = calcDerivadosCubePuro(nuevoMontoCubePadre, creditoData.porcentaje_interes);
      log(`   🔄 [ESPEJO] Caso A (SWAP): inversionista_id ${inversionista_id} → ${CUBE_INVESTMENT_ID}, status→completado, CUBE puro 0/100, monto_aportado=${nuevoMontoCubePadre.toFixed(2)} (sincronizado con padre) →`, derivadosSwapEspejo);
      const resEA = await tx
        .update(creditos_inversionistas_espejo)
        .set({
          inversionista_id: CUBE_INVESTMENT_ID,
          porcentaje_cash_in: "100",
          porcentaje_participacion_inversionista: "0",
          monto_aportado: nuevoMontoCubePadre.toFixed(8),
          ...derivadosSwapEspejo,
          status: "completado",
          updated_at: new Date(),
        })
        .where(
          and(
            eq(creditos_inversionistas_espejo.credito_id, credito_id),
            eq(creditos_inversionistas_espejo.inversionista_id, inversionista_id),
          ),
        )
        .returning({ id: creditos_inversionistas_espejo.id });
      log(`   ✅ [ESPEJO] SWAP aplicado (${resEA.length})`);
    } else {
      // 5B — ESPEJO MERGE: forzar CUBE-puro (cash_in=100,
      // participacion=0) en el row CUBE de espejo, fijar
      // monto_aportado al valor del PADRE (sincroniza capital) y
      // recalcular cuota + 4 derivados con la fórmula canónica.
      log(`   🟡 [ESPEJO] CUBE YA existe en espejo: monto_aportado=${cubeEnEspejo.monto_aportado}, status=${cubeEnEspejo.status}`);
      const derivadosMergeEspejo = calcDerivadosCubePuro(nuevoMontoCubePadre, creditoData.porcentaje_interes);

      const payloadE = {
        monto_aportado: nuevoMontoCubePadre.toFixed(8),
        porcentaje_participacion_inversionista: "0",
        porcentaje_cash_in: "100",
        ...derivadosMergeEspejo,
        status: "completado" as const,
        updated_at: new Date(),
      };
      log(`   🔀 [ESPEJO] Caso B (MERGE): CUBE puro 0/100, monto_aportado=${nuevoMontoCubePadre.toFixed(2)} (sincronizado con padre) →`, payloadE);

      const resEB1 = await tx
        .update(creditos_inversionistas_espejo)
        .set(payloadE)
        .where(
          and(
            eq(creditos_inversionistas_espejo.credito_id, credito_id),
            eq(creditos_inversionistas_espejo.inversionista_id, CUBE_INVESTMENT_ID),
          ),
        )
        .returning({ id: creditos_inversionistas_espejo.id });
      log(`   ✅ [ESPEJO] MERGE aplicado en row CUBE (${resEB1.length})`);

      const resEB2 = await tx
        .delete(creditos_inversionistas_espejo)
        .where(
          and(
            eq(creditos_inversionistas_espejo.credito_id, credito_id),
            eq(creditos_inversionistas_espejo.inversionista_id, inversionista_id),
          ),
        )
        .returning({ id: creditos_inversionistas_espejo.id });
      log(`   ✅ [ESPEJO] DELETE row del inversionista (${resEB2.length})`);
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // 6 — Recalcular cuota_inversionista de TODOS los rows del crédito.
  //
  // Después del SWAP/MERGE el capital del pool quedó reasignado, así
  // que las cuotas guardadas pueden no sumar la `cuota` real del
  // crédito (sobre todo si el saliente era el mayor y cargaba
  // seguro/GPS/membresía).
  //
  // Replicamos la fórmula de `calculateInvestorQuotas`:
  //   capital_total = Σ monto_aportado del pool (en esa tabla)
  //   %_part        = monto_aportado / capital_total
  //   cuota_base    = (cuota_credito − seguro − gps − membresia) × %_part
  //   cuota_final   = cuota_base   + cargos completos si es el MAYOR
  //
  // Y de paso recalculamos los 4 derivados de cada row a partir de
  // la nueva cuota y los porcentajes ACTUALES del row (CUBE-puro
  // tras exit: 0/100; otros inversionistas: lo que tengan).
  //
  // Padre y espejo se recalculan INDEPENDIENTEMENTE: el espejo puede
  // tener montos amortizados distintos al padre, así que el "mayor"
  // y el reparto pueden diferir — cada tabla refleja su propio
  // estado operativo.
  // ────────────────────────────────────────────────────────────────────
  const recalcularCuotasPool = async (
    tabla: typeof creditos_inversionistas | typeof creditos_inversionistas_espejo,
    etiqueta: "PADRE" | "ESPEJO",
  ) => {
    const rows = await tx
      .select()
      .from(tabla)
      .where(eq(tabla.credito_id, credito_id));

    if (rows.length === 0) {
      log(`   ℹ️  [${etiqueta}] Pool vacío tras exit — nada que recalcular`);
      return;
    }

    const capitalTotal = rows.reduce(
      (acc: Big, r: any) => acc.plus(new Big(r.monto_aportado)),
      new Big(0),
    );

    if (capitalTotal.lte(0)) {
      warn(`   ⚠️  [${etiqueta}] capital_total=0 tras exit — se omite recálculo de cuotas`);
      return;
    }

    // Mayor = row con mayor monto_aportado (desempate: el primero).
    const mayor = rows.reduce((m: any, r: any) =>
      new Big(r.monto_aportado).gt(new Big(m.monto_aportado)) ? r : m,
    );

    const cuotaCredito = new Big(creditoData.cuota);
    const seguroBig = new Big(creditoData.seguro_10_cuotas ?? 0);
    const gpsBig = new Big(creditoData.gps ?? 0);
    const membresiaBig = new Big(creditoData.membresias_pago ?? 0);
    const cargosBig = seguroBig.plus(gpsBig).plus(membresiaBig);
    const cuotaSinCargos = cuotaCredito.minus(cargosBig);

    log(`   📐 [${etiqueta}] Recalc pool: rows=${rows.length}, capital_total=${capitalTotal.toFixed(2)}, cuota=${cuotaCredito.toFixed(2)}, cargos=${cargosBig.toFixed(2)}, mayor_id=${mayor.id} (inv=${mayor.inversionista_id}, monto=${mayor.monto_aportado})`);

    for (const row of rows) {
      const monto = new Big(row.monto_aportado);
      const porcParticipacion = capitalTotal.gt(0) ? monto.div(capitalTotal) : new Big(0);
      const cuotaBase = cuotaSinCargos.times(porcParticipacion);
      const cuotaFinal = row.id === mayor.id ? cuotaBase.plus(cargosBig) : cuotaBase;
      const cuotaFinalRound = cuotaFinal.round(2);

      // Derivados con los porcentajes actuales del row (CUBE-puro
      // tras exit: 0/100; otros inversionistas: lo que tengan).
      const pCashIn = new Big(row.porcentaje_cash_in);
      const pInv = new Big(row.porcentaje_participacion_inversionista);
      const montoInv = cuotaFinalRound.times(pInv).div(100).round(2);
      const montoCash = cuotaFinalRound.times(pCashIn).div(100).round(2);
      const ivaInv = montoInv.gt(0) ? montoInv.times(0.12).round(2) : new Big(0);
      const ivaCash = montoCash.gt(0) ? montoCash.times(0.12).round(2) : new Big(0);

      await tx
        .update(tabla)
        .set({
          cuota_inversionista: cuotaFinalRound.toFixed(2),
          monto_inversionista: montoInv.toFixed(2),
          monto_cash_in: montoCash.toFixed(2),
          iva_inversionista: ivaInv.toFixed(2),
          iva_cash_in: ivaCash.toFixed(2),
          ...(etiqueta === "ESPEJO" ? { updated_at: new Date() } : {}),
        })
        .where(eq(tabla.id, row.id));
    }
    log(`   ✅ [${etiqueta}] Pool recalculado (${rows.length} row(s))`);
  };

  await recalcularCuotasPool(creditos_inversionistas, "PADRE");
  await recalcularCuotasPool(creditos_inversionistas_espejo, "ESPEJO");

  // ────────────────────────────────────────────────────────────────────
  // 7 — Apagar bandera_reinversion del crédito.
  // Esta bandera, cuando está en true, redirige los intereses del
  // inversionista "pendiente" hacia CUBE. Como ya no hay ningún
  // inversionista en ese estado (lo acabamos de sacar o fusionar con
  // CUBE), la bandera pierde sentido y se apaga.
  // ────────────────────────────────────────────────────────────────────
  const resBandera = await tx
    .update(creditos)
    .set({ bandera_reinversion: false })
    .where(eq(creditos.credito_id, credito_id))
    .returning({ credito_id: creditos.credito_id });
  log(`   🏁 bandera_reinversion=false aplicada en crédito ${credito_id} (${resBandera.length})`);

  // ────────────────────────────────────────────────────────────────────
  // 8 — Resultado del crédito.
  // ────────────────────────────────────────────────────────────────────
  log(`   ✅ Crédito ${credito_id} procesado — monto_transferido=Q${montoTransferido.toFixed(2)}, acción=${cubePreexistente ? "merge" : "swap"}`);
  return {
    ok: true,
    credito_id,
    numero_credito_sifco: creditoData.numero_credito_sifco ?? null,
    monto_transferido: montoTransferido.toFixed(2),
    monto_transferido_raw: montoTransferido.toFixed(8),
    cube_preexistente: cubePreexistente,
    accion: cubePreexistente ? "merge" : "swap",
  };
}
