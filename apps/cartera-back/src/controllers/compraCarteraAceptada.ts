import Big from "big.js";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { db } from "../database";
import {
  admins,
  asesores,
  compras_credito_inversionista,
  creditos,
  cuotas_credito,
  creditos_inversionistas,
  creditos_inversionistas_espejo,
  inversionistas,
  platform_users,
  usuarios,
  pagos_credito,
} from "../database/db";
import z from "zod";
import { sendCompraCarteraAcceptedNotification } from "@cci/email";
import {
  abrirBateriaDeContratosEnCrm,
  getVehicleDetailsBySifco,
} from "../services/crm.service";
import {
  calcularExpiracionCompraCartera,
  formatFechaLargaGT,
  nowGT,
} from "../utils/functions/businessDays";
import { COMPRA_CARTERA_RECIPIENTS } from "../utils/functions/compraCarteraRecipients";

const JWT_SECRET = process.env.JWT_SECRET || "supersecreto";

// ID fijo de CUBE INVESTMENTS S.A. (siempre va primero en el pool)
const CUBE_INVESTMENT_ID = 86;

// Cómo se lee cada modalidad de reinversión. Lo usan el correo de aceptación y
// la batería de contratos que se le abre a jurídico.
const MODALIDAD_LABEL: Record<string, string> = {
  sin_reinversion: "Sin Reinversión",
  reinversion_capital: "Reinversión de Capital",
  reinversion_interes: "Reinversión de Interés",
  reinversion_total: "Reinversión Total",
  reinversion_variable: "Reinversión Variable",
  reinversion_excedente: "Reinversión Excedente",
  reinversion_combinada: "Reinversión Combinada",
};

// Destinatarios fijos (compartidos con el correo de expiración): ver
// src/utils/functions/compraCarteraRecipients.ts

const compraCarteraAceptadaSchema = z.object({
  creditos: z
    .array(z.number().int().positive())
    .min(1, "Debe enviar al menos un crédito"),
  notas_adicionales: z.string().optional(),
});

const extenderCompraCarteraSchema = z.object({
  creditos: z
    .array(z.number().int().positive())
    .min(1, "Debe enviar al menos un crédito"),
  inversionista_id: z.number().int().positive(),
});

/** Una fila del pool de un crédito, ya normalizada por el controlador. */
type FilaDePool = {
  inversionista_id: number;
  inversionista_nombre: string;
  monto: Big;
  porcentajeInversion: Big;
};

/**
 * Los pares `${credito}-${inversionista}` que se volvieron a meter a mano.
 *
 * Cuando el inversionista tarda en pagar, la compra se cae y inversiones la
 * vuelve a meter con el modo manual. Los contratos de esa compra jurídico ya
 * los hizo, así que al aceptarla no se le abre batería por esos créditos, ni se
 * le avisa, ni le queda como pendiente en el CRM.
 *
 * Sólo cuenta si TODAS las compras pendientes del par son manuales: si también
 * entró una normal, es trabajo nuevo y va. Un par sin fila de compra (las
 * operaciones de antes de esta tabla) tampoco se excluye.
 */
export function paresSoloManuales(
  compras: Array<{
    credito_id: number;
    inversionista_id: number;
    origen_manual: boolean;
  }>,
): Set<string> {
  const conNormal = new Set<string>();
  const conManual = new Set<string>();
  for (const compra of compras) {
    const par = `${compra.credito_id}-${compra.inversionista_id}`;
    (compra.origen_manual ? conManual : conNormal).add(par);
  }
  return new Set([...conManual].filter((par) => !conNormal.has(par)));
}

/**
 * Le abre al CRM una batería de contratos por cada inversionista de la compra.
 *
 * Una por inversionista y no una por compra: los contratos se firman con una
 * persona, y una aceptación puede traer a varios. CUBE no entra (`targetIds` ya
 * viene sin él): no firma contratos consigo misma.
 *
 * Nunca lanza. Cuando esto corre la compra ya está aceptada, así que un CRM
 * caído tiene que costar el aviso, no la operación.
 */
export async function abrirBateriasDeContratos(params: {
  targetIds: number[];
  creditosRows: Array<{
    credito_id: number;
    numero_credito_sifco: string;
    cliente_nombre: string;
  }>;
  rowsPorCredito: Map<number, FilaDePool[]>;
  montoNuevoPorPar: Map<string, Big>;
  /**
   * Lo que quedó estampado en el espejo para cada crédito de esta compra: cómo
   * factura y qué hace con el retorno. Los contratos lo piden como dato del
   * inversionista, pero en cartera vive por crédito, así que el CRM se queda
   * con el del primero de la compra.
   */
  tipoReinversionPorCredito: Map<number, string | null>;
  modalidadFacturacionPorCredito: Map<number, string | null>;
  /**
   * Lo mismo por crédito E inversionista (`${credito}-${inversionista}`).
   * Cuando dos inversionistas compran el mismo crédito en una aceptación, cada
   * uno tiene sus términos: por crédito solo, el último pisaba al resto y un
   * inversionista se llevaba a sus contratos los del otro.
   */
  terminosPorPar: Map<
    string,
    { tipoReinversion: string | null; modalidadFacturacion: string | null }
  >;
  aceptadaEn: Date;
  aceptadaPor?: string;
  /** El id de Resend del correo de aceptación: es el hilo de la compra. */
  correoId?: string;
}): Promise<
  Array<{ inversionista_id: number; success: boolean; batchId?: string; error?: string }>
> {
  const {
    targetIds,
    creditosRows,
    rowsPorCredito,
    montoNuevoPorPar,
    tipoReinversionPorCredito,
    modalidadFacturacionPorCredito,
    terminosPorPar,
  } = params;
  if (targetIds.length === 0) return [];

  try {
    const inversionistasDeLaCompra = await db
      .select({
        inversionista_id: inversionistas.inversionista_id,
        nombre: inversionistas.nombre,
        dpi: inversionistas.dpi,
        dpi_rep_legal: inversionistas.dpi_rep_legal,
        email: inversionistas.email,
        celular: inversionistas.celular,
        tipo_reinversion: inversionistas.tipo_reinversion,
        emite_factura: inversionistas.emite_factura,
      })
      .from(inversionistas)
      .where(inArray(inversionistas.inversionista_id, targetIds));

    const porId = new Map(
      inversionistasDeLaCompra.map((inv) => [inv.inversionista_id, inv]),
    );

    // Las fechas del crédito, que el contrato de cesión necesita: la cuota 0 es
    // cuando se formalizó y la última cuota es su vencimiento. Se traen todas
    // las cuotas de estos créditos y se toman los extremos.
    const cuotas = await db
      .select({
        credito_id: cuotas_credito.credito_id,
        numero_cuota: cuotas_credito.numero_cuota,
        fecha_vencimiento: cuotas_credito.fecha_vencimiento,
      })
      .from(cuotas_credito)
      .where(
        inArray(
          cuotas_credito.credito_id,
          creditosRows.map((c) => c.credito_id),
        ),
      );

    // Cuál es la primera y cuál la última de cada crédito. La primera suele ser
    // la cuota 0, pero hay créditos renumerados donde no: se toman los extremos
    // que existen en vez de asumir el número.
    const cuotasExtremas = new Map<
      number,
      { primera: number; ultima: number }
    >();
    for (const cuota of cuotas) {
      const actual = cuotasExtremas.get(cuota.credito_id);
      if (!actual) {
        cuotasExtremas.set(cuota.credito_id, {
          primera: cuota.numero_cuota,
          ultima: cuota.numero_cuota,
        });
        continue;
      }
      actual.primera = Math.min(actual.primera, cuota.numero_cuota);
      actual.ultima = Math.max(actual.ultima, cuota.numero_cuota);
    }

    const fechasPorCredito = new Map<
      number,
      { inicio?: string; vencimiento?: string }
    >();
    for (const cuota of cuotas) {
      const actual = fechasPorCredito.get(cuota.credito_id) ?? {};
      const extremos = cuotasExtremas.get(cuota.credito_id);
      if (!extremos) continue;
      if (cuota.numero_cuota === extremos.primera) {
        actual.inicio = cuota.fecha_vencimiento;
      }
      if (cuota.numero_cuota === extremos.ultima) {
        actual.vencimiento = cuota.fecha_vencimiento;
      }
      fechasPorCredito.set(cuota.credito_id, actual);
    }

    const resultados: Array<{
      inversionista_id: number;
      success: boolean;
      batchId?: string;
      error?: string;
    }> = [];

    for (const targetId of targetIds) {
      const inv = porId.get(targetId);
      if (!inv) continue;

      // Sólo los créditos que ESTE inversionista compró en esta aceptación, con
      // el monto de la operación (el delta), no el acumulado que ya tenía.
      //
      // Tener posición no alcanza: si en una aceptación uno compra el crédito A
      // y otro el B, y el primero ya tenía parte del B de antes, su batería se
      // llevaba también el B —con lo que ya tenía como monto— y sus contratos
      // cedían un crédito que no compró. Lo comprado es lo que pasó en el
      // espejo de `pendiente_compra_cartera` a revisión: `terminosPorPar` se
      // arma con esas filas.
      const creditos = creditosRows.flatMap((credito) => {
        const par = `${credito.credito_id}-${targetId}`;
        if (!terminosPorPar.has(par)) return [];

        const fila = (rowsPorCredito.get(credito.credito_id) ?? []).find(
          (r) => r.inversionista_id === targetId,
        );
        if (!fila) return [];

        const monto = montoNuevoPorPar.get(par) ?? fila.monto;

        const fechas = fechasPorCredito.get(credito.credito_id) ?? {};
        const terminos = terminosPorPar.get(par);

        return [
          {
            creditoId: credito.credito_id,
            numeroCreditoSifco: credito.numero_credito_sifco,
            clienteNombre: credito.cliente_nombre,
            monto: monto.toFixed(2),
            fechaInicio: fechas.inicio ?? null,
            fechaVencimiento: fechas.vencimiento ?? null,
            tipoReinversion: terminos
              ? terminos.tipoReinversion
              : (tipoReinversionPorCredito.get(credito.credito_id) ?? null),
            modalidadFacturacion: terminos
              ? terminos.modalidadFacturacion
              : (modalidadFacturacionPorCredito.get(credito.credito_id) ?? null),
          },
        ];
      });

      if (creditos.length === 0) continue;

      const montoTotal = creditos.reduce(
        (acc, credito) => acc.plus(new Big(credito.monto)),
        new Big(0),
      );

      const res = await abrirBateriaDeContratosEnCrm({
        inversionista: {
          id: targetId,
          nombre: inv.nombre,
          dpi: inv.dpi != null ? String(inv.dpi) : null,
          dpiRepLegal: inv.dpi_rep_legal,
          email: inv.email,
          celular: inv.celular,
        },
        compra: {
          creditos,
          montoTotal: montoTotal.toFixed(2),
          modalidad:
            MODALIDAD_LABEL[inv.tipo_reinversion] ?? inv.tipo_reinversion,
          facturacion: inv.emite_factura ? "Propia" : "No emite",
          aceptadaEn: params.aceptadaEn.toISOString(),
          aceptadaPor: params.aceptadaPor,
          correoId: params.correoId ?? null,
        },
      });

      resultados.push({ inversionista_id: targetId, ...res });
    }

    return resultados;
  } catch (error) {
    console.error(
      "[compraCarteraAceptada] No se pudieron abrir las baterías de contratos:",
      error,
    );
    return [];
  }
}

// ================================================================
// COMPRA DE CARTERA ACEPTADA
// Endpoint para notificar que la compra de cartera fue aceptada.
// Recibe uno o varios credito_id, arma el resumen (cliente, capital,
// observaciones y composición del pool) y manda el correo.
// NO modifica nada en la base de datos.
// ================================================================
export const compraCarteraAceptada = async ({ body, set, request }: any) => {
  try {
    // ── 1. Validar body ──
    const parseResult = compraCarteraAceptadaSchema.safeParse(body);
    if (!parseResult.success) {
      set.status = 400;
      return {
        success: false,
        message: "Validation failed",
        errors: parseResult.error.flatten().fieldErrors,
      };
    }
    const { creditos: creditoIds, notas_adicionales } = parseResult.data;

    // ── 2. Traer datos de los créditos + cliente ──
    const creditosRows = await db
      .select({
        credito_id: creditos.credito_id,
        numero_credito_sifco: creditos.numero_credito_sifco,
        capital: creditos.capital,
        observaciones: creditos.observaciones,
        cliente_nombre: usuarios.nombre,
      })
      .from(creditos)
      .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
      .where(inArray(creditos.credito_id, creditoIds));

    if (creditosRows.length === 0) {
      set.status = 404;
      return {
        success: false,
        message: "No se encontraron los créditos solicitados",
      };
    }

    // ── 3. Traer la composición del pool POR CRÉDITO ──
    const inversionistasRows = await db
      .select({
        credito_id: creditos_inversionistas.credito_id,
        inversionista_id: creditos_inversionistas.inversionista_id,
        inversionista_nombre: inversionistas.nombre,
        monto_aportado: creditos_inversionistas.monto_aportado,
        porcentaje_participacion_inversionista:
          creditos_inversionistas.porcentaje_participacion_inversionista,
      })
      .from(creditos_inversionistas)
      .innerJoin(
        inversionistas,
        eq(
          creditos_inversionistas.inversionista_id,
          inversionistas.inversionista_id,
        ),
      )
      .where(inArray(creditos_inversionistas.credito_id, creditoIds));

    // Index rápido para pool por crédito: Map<credito_id, rows[]>
    const rowsPorCredito = new Map<
      number,
      Array<{
        inversionista_id: number;
        inversionista_nombre: string;
        monto: Big;
        porcentajeInversion: Big;
      }>
    >();
    for (const row of inversionistasRows) {
      const list = rowsPorCredito.get(row.credito_id) ?? [];
      list.push({
        inversionista_id: row.inversionista_id,
        inversionista_nombre: row.inversionista_nombre,
        monto: new Big(row.monto_aportado),
        porcentajeInversion: new Big(
          row.porcentaje_participacion_inversionista,
        ),
      });
      rowsPorCredito.set(row.credito_id, list);
    }

    // ── 4. Resolver quién aceptó (JWT, opcional) ──
    let usuarioEmail: string | undefined;
    let usuarioNombre: string | undefined;

    try {
      const authHeader = request?.headers?.get?.("Authorization");
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.replace("Bearer ", "").trim();
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        usuarioEmail = decoded.email ?? decoded.correo ?? undefined;

        if (usuarioEmail) {
          const [pu] = await db
            .select({
              admin_id: platform_users.admin_id,
              asesor_id: platform_users.asesor_id,
            })
            .from(platform_users)
            .where(eq(platform_users.email, usuarioEmail));

          if (pu?.admin_id) {
            const [a] = await db
              .select({ nombre: admins.nombre, apellido: admins.apellido })
              .from(admins)
              .where(eq(admins.admin_id, pu.admin_id));
            if (a) usuarioNombre = `${a.nombre} ${a.apellido}`.trim();
          } else if (pu?.asesor_id) {
            const [s] = await db
              .select({ nombre: asesores.nombre })
              .from(asesores)
              .where(eq(asesores.asesor_id, pu.asesor_id));
            if (s) usuarioNombre = s.nombre;
          }
        }
      }
    } catch (jwtErr) {
      console.warn(
        "[compraCarteraAceptada] No se pudo resolver el usuario desde el JWT:",
        jwtErr,
      );
    }


    // ── 4.4. Leer los montos NUEVOS de la operación pendiente ──
    // compras_credito_inversionista guarda el delta de cada operación
    // (no la posición acumulada del inversionista en el crédito). Para
    // el correo necesitamos el monto que entró en ESTA compra, no la
    // suma con lo que el inversionista ya tenía antes.
    // Si el mismo (credito_id, inversionista_id) tiene varios registros
    // en pendiente (porque hubo varias operaciones sin aceptar todavía),
    // los sumamos: ese es el monto total que falta por aceptar.
    const comprasPendientes = await db
      .select({
        credito_id: compras_credito_inversionista.credito_id,
        inversionista_id: compras_credito_inversionista.inversionista_id,
        monto_aportado: compras_credito_inversionista.monto_aportado,
        origen_manual: compras_credito_inversionista.origen_manual,
      })
      .from(compras_credito_inversionista)
      .where(
        and(
          inArray(compras_credito_inversionista.credito_id, creditoIds),
          eq(
            compras_credito_inversionista.status,
            "pendiente_compra_cartera",
          ),
        ),
      );

    // Map (credito_id-inversionista_id) → monto nuevo (Big), sumado si
    // hay varios registros pendientes para el mismo par.
    const montoNuevoPorPar = new Map<string, Big>();
    for (const row of comprasPendientes) {
      const key = `${row.credito_id}-${row.inversionista_id}`;
      const prev = montoNuevoPorPar.get(key) ?? new Big(0);
      montoNuevoPorPar.set(key, prev.plus(new Big(row.monto_aportado)));
    }

    // ── 4.5. Marcar el espejo como aceptado ──
    // Pasamos a "pendiente_revision" todos los rows de los créditos que estén
    // actualmente en "pendiente_compra_cartera". Registramos cuándo y quién.
    const ahora = nowGT();
    const updateRes = await db
      .update(creditos_inversionistas_espejo)
      .set({
        status: "pendiente_revision",
        updated_at: ahora,
        aceptada_at: ahora,
        aceptada_por: usuarioEmail ?? null,
      })
      .where(
        and(
          inArray(creditos_inversionistas_espejo.credito_id, creditoIds),
          eq(creditos_inversionistas_espejo.status, "pendiente_compra_cartera"),
        ),
      )
      .returning({
        credito_id: creditos_inversionistas_espejo.credito_id,
        inversionista_id: creditos_inversionistas_espejo.inversionista_id,
        tipo_reinversion: creditos_inversionistas_espejo.tipo_reinversion,
        modalidad_facturacion:
          creditos_inversionistas_espejo.modalidad_facturacion,
      });

    // ── 4.5.bis. Marcar las compras pendientes como aceptadas ──
    // Mismo cambio que el espejo, sobre compras_credito_inversionista.
    // Así los próximos accept/queries ya no traen estos registros (el
    // correo ya se mandó con esos montos).
    await db
      .update(compras_credito_inversionista)
      .set({ status: "pendiente_revision", updated_at: ahora })
      .where(
        and(
          inArray(compras_credito_inversionista.credito_id, creditoIds),
          eq(
            compras_credito_inversionista.status,
            "pendiente_compra_cartera",
          ),
        ),
      );

    // ── Mapa credito_id → tipo_reinversion del target ──
    // El update filtró por status "pendiente_compra_cartera", y esa es la
    // fila del inversionista nuevo (el resto está en "completado"), así
    // que cada credito_id aquí apunta al tipo_reinversion que quedó
    // estampado para ese crédito en el espejo.
    const tipoReinvPorCredito = new Map<number, string | null>(
      updateRes.map((r) => [r.credito_id, r.tipo_reinversion ?? null]),
    );

    // Mapa credito_id → modalidad_facturacion del target (mismo criterio que
    // tipo_reinversion: la fila que quedó en "pendiente_compra_cartera").
    const modalidadFactPorCredito = new Map<number, string | null>(
      updateRes.map((r) => [r.credito_id, r.modalidad_facturacion ?? null]),
    );

    // Pool por crédito en el orden que vinieron los créditos en creditosRows.
    // Dentro de cada pool, CUBE va primero. Incluimos la modalidad
    // (tipo_reinversion del target en el espejo) para mostrarla en el
    // header de cada bloque del correo.
    const pool = creditosRows.map((c) => ({
      numero_credito_sifco: c.numero_credito_sifco,
      cliente_nombre: c.cliente_nombre,
      tipo_reinversion: (tipoReinvPorCredito.get(c.credito_id) ?? null) as
        | "sin_reinversion"
        | "reinversion_capital"
        | "reinversion_interes"
        | "reinversion_total"
        | "reinversion_variable"
        | "reinversion_excedente"
        | "reinversion_combinada"
        | null,
      modalidad_facturacion: (modalidadFactPorCredito.get(c.credito_id) ??
        null) as "p2p_directa" | "factura_cube" | "factura_cube_pequeno" | null,
      rows: (rowsPorCredito.get(c.credito_id) ?? [])
        .sort((a, b) => {
          if (a.inversionista_id === CUBE_INVESTMENT_ID) return -1;
          if (b.inversionista_id === CUBE_INVESTMENT_ID) return 1;
          return 0;
        })
        .map((r) => {
          // Para el inversionista nuevo de la cesión mostramos el delta
          // (monto que entró en ESTA operación, desde compras_credito_inversionista).
          // Para inversionistas que no participaron en la cesión (ej. CUBE que
          // ya estaba) caemos al acumulado del espejo/padre.
          const montoCesion =
            montoNuevoPorPar.get(`${c.credito_id}-${r.inversionista_id}`) ??
            r.monto;
          return {
            inversionista_nombre: r.inversionista_nombre,
            capital: montoCesion.toFixed(2),
          };
        }),
    }));

    // ── 4.5.1 Apagar bandera_reinversion de los créditos aceptados ──
    // Ya no hay que redirigir intereses a CUBE: el espejo pasó a
    // pendiente_revision y el nuevo inversionista empieza a cobrar.
    if (updateRes.length > 0) {
      const creditosAfectados = Array.from(
        new Set(updateRes.map((r) => r.credito_id)),
      );
      await db
        .update(creditos)
        .set({ bandera_reinversion: false })
        .where(inArray(creditos.credito_id, creditosAfectados));
    }

    // ── 4.6. Armar el header "VENTA DE CARTERA" a partir del inversionista
    //         que acaba de pasar de pendiente_revision → completado.
    //         Si hay exactamente 1 target, mostramos su Modalidad, Factura
    //         y Repartición. Si hay 0 o más de 1, omitimos el header. ──
    const targetIds = Array.from(
      new Set(
        updateRes
          .map((r) => r.inversionista_id)
          .filter((id) => id !== CUBE_INVESTMENT_ID),
      ),
    );

    let operacionInfo:
      | {
          inversionistaNombre: string;
          monto: string;
          modalidad: string;
          factura: string;
          porcentajeInversionista: string;
          porcentajeCube: string;
        }
      | undefined;

    if (targetIds.length === 1) {
      const targetId = targetIds[0];
      const [targetInv] = await db
        .select({
          nombre: inversionistas.nombre,
          tipo_reinversion: inversionistas.tipo_reinversion,
          emite_factura: inversionistas.emite_factura,
        })
        .from(inversionistas)
        .where(eq(inversionistas.inversionista_id, targetId));

      // Sumamos el monto total del target entre todos los créditos
      // y calculamos su % de inversión ponderado por monto.
      //
      // OJO: usamos el monto NUEVO (delta de la operación) que viene de
      // compras_credito_inversionista, NO el acumulado del espejo/padre.
      // El acumulado incluiría lo que el inversionista ya tenía antes en
      // el crédito, inflando el "Monto" del header del correo.
      // Fallback al monto acumulado solo si no hay registro de compra
      // (operaciones viejas previas a esta tabla).
      let targetMontoTotal = new Big(0);
      let targetInversionPonderada = new Big(0);
      for (const [creditoId, rows] of rowsPorCredito.entries()) {
        for (const r of rows) {
          if (r.inversionista_id === targetId) {
            const montoNuevo =
              montoNuevoPorPar.get(`${creditoId}-${targetId}`) ?? r.monto;
            targetMontoTotal = targetMontoTotal.plus(montoNuevo);
            targetInversionPonderada = targetInversionPonderada.plus(
              r.porcentajeInversion.times(montoNuevo),
            );
          }
        }
      }

      if (targetInv && targetMontoTotal.gt(0)) {
        const porcInv = targetInversionPonderada.div(targetMontoTotal);
        const porcCube = new Big(100).minus(porcInv);

        operacionInfo = {
          inversionistaNombre: targetInv.nombre,
          monto: targetMontoTotal.toFixed(2),
          modalidad:
            MODALIDAD_LABEL[targetInv.tipo_reinversion] ??
            targetInv.tipo_reinversion,
          factura: targetInv.emite_factura ? "Propia" : "No emite",
          porcentajeInversionista: porcInv.toFixed(2),
          porcentajeCube: porcCube.toFixed(2),
        };
      }
    }

    // ── 5. Mandar el correo (destinatarios fijos por negocio) ──
    const creditosParaEmail = await Promise.all(
      creditosRows.map(async (c) => {
        const vehicleRes = await getVehicleDetailsBySifco(c.numero_credito_sifco);
        console.log(vehicleRes.data);
        return {
          numero_credito_sifco: c.numero_credito_sifco,
          cliente_nombre: c.cliente_nombre,
          capital: new Big(c.capital).toFixed(2),
          observaciones: vehicleRes.data?.vehicle
            ? `${vehicleRes.data.vehicle.model}\n${vehicleRes.data.vehicle.year} | ${vehicleRes.data.vehicle.make} | ${vehicleRes.data.vehicle.licensePlate} `
            : c.observaciones,
        };
      }),
    );

    const { expira, diaBaja } = calcularExpiracionCompraCartera(ahora);

    const mailRes = await sendCompraCarteraAcceptedNotification({
      to: COMPRA_CARTERA_RECIPIENTS.to,
      cc: COMPRA_CARTERA_RECIPIENTS.cc,
      creditos: creditosParaEmail,
      pool,
      operacionInfo,
      notasAdicionales: notas_adicionales,
      usuarioNombre,
      usuarioEmail,
      expiracion: {
        fechaExpiraLabel: formatFechaLargaGT(expira),
        fechaBajaLabel: formatFechaLargaGT(diaBaja),
      },
    });

    // ── 6. Abrirle a jurídico la batería de contratos de cada inversionista ──
    // El correo avisa, pero no deja anotado en ningún lado qué contratos
    // faltan: jurídico lo lleva leyendo el hilo. La batería sí queda, y se
    // cierra cuando la papelería está hecha.
    //
    // Va al final y best-effort: a esta altura la compra ya se aceptó y el
    // espejo ya se movió. Si el CRM no contesta, se pierde el aviso, no la
    // aceptación. El endpoint del CRM es idempotente por inversionista y juego
    // de créditos, así que reintentarlo no abre dos baterías.
    const soloManuales = paresSoloManuales(comprasPendientes);
    if (soloManuales.size > 0) {
      console.log(
        `[compraCarteraAceptada] ${soloManuales.size} crédito(s) vueltos a meter a mano: no abren batería en el CRM`,
      );
    }
    const bateriasAbiertas = await abrirBateriasDeContratos({
      targetIds,
      creditosRows,
      rowsPorCredito,
      montoNuevoPorPar,
      tipoReinversionPorCredito: tipoReinvPorCredito,
      modalidadFacturacionPorCredito: modalidadFactPorCredito,
      // Sin los pares que se volvieron a meter a mano: esos contratos jurídico
      // ya los hizo (ver `paresSoloManuales`).
      terminosPorPar: new Map(
        updateRes
          .filter(
            (r) => !soloManuales.has(`${r.credito_id}-${r.inversionista_id}`),
          )
          .map((r) => [
            `${r.credito_id}-${r.inversionista_id}`,
            {
              tipoReinversion: r.tipo_reinversion ?? null,
              modalidadFacturacion: r.modalidad_facturacion ?? null,
            },
          ]),
      ),
      aceptadaEn: ahora,
      aceptadaPor: usuarioEmail,
      // El hilo donde jurídico va a contestar con los contratos. Por eso la
      // batería se abre DESPUÉS del correo.
      correoId: mailRes.success ? mailRes.data?.id : undefined,
    });

    set.status = 200;
    return {
      success: true,
      message: `Notificación enviada a ${COMPRA_CARTERA_RECIPIENTS.to.length} destinatario(s) + ${COMPRA_CARTERA_RECIPIENTS.cc.length} en CC`,
      baterias_contratos: bateriasAbiertas,
      creditos_notificados: creditosRows.length,
      pool_size: pool.length,
      espejo_actualizados: updateRes.length,
      email: mailRes,
    };
  } catch (error) {
    console.error("[compraCarteraAceptada] Error:", error);
    set.status = 500;
    return {
      success: false,
      message: "Error al notificar la aceptación de compra de cartera",
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export const extenderCompraCartera = async ({ body, set }: any) => {
  try {
    const parseResult = extenderCompraCarteraSchema.safeParse(body);
    if (!parseResult.success) {
      set.status = 400;
      return {
        success: false,
        message: "Validation failed",
        errors: parseResult.error.flatten().fieldErrors,
      };
    }

    const { creditos: creditoIds, inversionista_id } = parseResult.data;
    const ahora = nowGT();

    const updateRes = await db
      .update(creditos_inversionistas_espejo)
      .set({
        compra_cartera_extendida_at: ahora,
        updated_at: ahora,
      })
      .where(
        and(
          inArray(creditos_inversionistas_espejo.credito_id, creditoIds),
          eq(creditos_inversionistas_espejo.inversionista_id, inversionista_id),
          eq(creditos_inversionistas_espejo.status, "pendiente_revision"),
          isNotNull(creditos_inversionistas_espejo.aceptada_at),
          isNull(creditos_inversionistas_espejo.compra_cartera_extendida_at),
        ),
      )
      .returning({
        credito_id: creditos_inversionistas_espejo.credito_id,
        inversionista_id: creditos_inversionistas_espejo.inversionista_id,
        compra_cartera_extendida_at:
          creditos_inversionistas_espejo.compra_cartera_extendida_at,
      });

    if (updateRes.length === 0) {
      set.status = 409;
      return {
        success: false,
        message:
          "La compra no se pudo extender. Puede que ya haya sido extendida, no esté aceptada o ya no esté pendiente.",
      };
    }

    set.status = 200;
    return {
      success: true,
      message: "Compra de cartera extendida 24 horas correctamente.",
      creditos_extendidos: updateRes.length,
      compra_cartera_extendida_at: ahora,
    };
  } catch (error) {
    console.error("[extenderCompraCartera] Error:", error);
    set.status = 500;
    return {
      success: false,
      message: "Error al extender la compra de cartera",
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
