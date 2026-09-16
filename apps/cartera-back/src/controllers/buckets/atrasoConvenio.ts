import { and, eq, inArray, sql } from "drizzle-orm";
import { toZonedTime } from "date-fns-tz";
import { db } from "../../database";
import {
  convenio_cuotas,
  convenios_pago,
  creditos,
  cuotas_credito,
  SQL_CARTERA_SCHEMA,
} from "../../database/db/schema";

// ─────────────────────────────────────────────────────────────────────────────
// COBROS-02 · Atraso de un crédito EN CONVENIO — una sola implementación.
//
// El modelo (decidido con negocio, verificado contra la pantalla de pago):
//   · En convenio el cliente paga AMBAS cosas cada mes: la cuota NORMAL del
//     crédito (`cuotas_credito`) Y la del CONVENIO (`convenio_cuotas`). El pago
//     del convenio marca `convenio_cuotas.fecha_pago` pero NO toca
//     `cuotas_credito`, así que hay que mirar las DOS fuentes o se sobre/sub-
//     cuenta el atraso.
//   · MESES ATRASADOS = cantidad de fechas de vencimiento DISTINTAS, pasadas,
//     con algo impago, uniendo:
//       (A) cuotas del crédito vencidas e impagas que NO entraron al convenio
//           (las de `convenios_pago.cuotas_convenio` ya viven como cuotas del
//            convenio: contarlas otra vez sería doble), y
//       (B) cuotas del convenio que vencen DESPUÉS del acuerdo y no están
//           cubiertas. Las que NACIERON vencidas (heredan las fechas de las
//           cuotas viejas del crédito) son la deuda que el acuerdo regularizó:
//           no son incumplimiento DEL CONVENIO, que es lo que se mide acá.
//     Se unen por fecha: deber la normal y la del convenio del mismo mes es UN
//     mes atrasado, no dos.
//   · La cobertura de (B) se mide por MONTO, re-indexando: la j-ésima cuota de
//     adelante está cubierta si `monto_pagado >= j * cuota_mensual`. Los pagos
//     se acreditan de adelante hacia atrás y los parciales acumulativos
//     (Q60+Q40) no marcan `fecha_pago`.
//
// Vive acá y no dentro del job porque lo usan TRES lugares —el vigilante, la
// re-siembra y (en su versión SQL) `convenioAlertas.ts`— y tenerlo copiado ya
// costó un bug: ver la trampa de abajo.
//
// ⚠️ TRAMPA DE DRIZZLE, pagada en la re-siembra (2026-09-15).
// La subconsulta correlacionada de `hasPaidPayment` NECESITA que la columna
// externa venga CALIFICADA. Drizzle solo la califica cuando la query tiene más
// de una tabla: con un `select().from(cuotas_credito)` a secas emite
//
//     EXISTS (SELECT 1 FROM pagos_credito pc WHERE pc.cuota_id = "cuota_id" ...)
//
// y ese `"cuota_id"` sin calificar lo resuelve Postgres contra `pc` — o sea
// `pc.cuota_id = pc.cuota_id`, siempre verdadero. Resultado: TODA cuota se lee
// como pagada y el atraso da 0. Con el INNER JOIN a `creditos` (la forma de
// abajo) emite `"cartera"."cuotas_credito"."cuota_id"` y correlaciona bien.
// No es un detalle de estilo: es la diferencia entre medir y no medir.
// ─────────────────────────────────────────────────────────────────────────────

const ZONA = "America/Guatemala";

/** ¿La fecha de vencimiento ya pasó HOY (hora Guatemala)? */
export function estaVencidaGT(
  fecha_vencimiento: Date | string,
  hoy: Date,
): boolean {
  const fechaVenc = toZonedTime(fecha_vencimiento, ZONA);
  fechaVenc.setHours(0, 0, 0, 0);
  const fechaHoy = toZonedTime(hoy, ZONA);
  fechaHoy.setHours(0, 0, 0, 0);
  return fechaVenc < fechaHoy;
}

/** Clave de mes para unir vencimientos: el mismo día → el mismo mes atrasado. */
export function claveFecha(fecha_vencimiento: Date | string): string {
  const d = toZonedTime(fecha_vencimiento, ZONA);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * ¿La cuota del convenio NACIÓ vencida? = vence en o antes de la fecha del
 * acuerdo. Esa es la deuda vieja que el convenio regularizó. Comparación por
 * DÍA en hora Guatemala.
 */
export function nacioConElConvenio(
  fecha_vencimiento: Date | string,
  fecha_convenio: Date | string,
): boolean {
  const venc = toZonedTime(fecha_vencimiento, ZONA);
  venc.setHours(0, 0, 0, 0);
  const conv = toZonedTime(fecha_convenio, ZONA);
  conv.setHours(0, 0, 0, 0);
  return venc.getTime() <= conv.getTime();
}

/** "Hoy" en Guatemala, a medianoche — la referencia de todas las comparaciones. */
export function hoyGT(): Date {
  const hoy = toZonedTime(new Date(), ZONA);
  hoy.setHours(0, 0, 0, 0);
  return hoy;
}

/**
 * Qué se cuenta como atraso. Los dos criterios son legítimos y responden
 * preguntas DISTINTAS — mezclarlos fue lo que dejó el plan 08 ambiguo:
 *
 *  · `convenio`: solo (B). Responde "¿está cumpliendo EL ACUERDO que firmó?".
 *    Es el criterio del aviso de convenio incumplido y de la pantalla de
 *    alertas (`convenioAlertas.ts`), y el que la tabla de la decisión 19
 *    describe entre paréntesis ("debe alguna cuota del convenio").
 *
 *  · `union`: (A) + (B). Responde "¿debe algo, de lo que sea?". En convenio el
 *    cliente paga AMBAS cada mes, así que dejar de pagar la cuota normal
 *    también es incumplir — pero medido así, en el sandbox de dev 57 de 63
 *    convenios salen atrasados: casi todos pagan su cuota del convenio y no la
 *    normal. Es el criterio del párrafo "Cómo se mide al día" del mismo plan.
 *
 * El default es `convenio` porque es el que distingue: con `union` la
 * re-siembra manda el 90% de la cartera a B4 (pre-jurídico) y a un solo asesor,
 * que no es una clasificación sino un volcado. Queda anotado para el PM.
 */
export type CriterioAtrasoConvenio = "convenio" | "union";

/**
 * Meses atrasados por crédito para TODOS los créditos EN_CONVENIO.
 *
 * Devuelve el mapa completo (los que no deben nada vienen con 0), más la lista
 * de créditos considerados, para que el caller no tenga que volver a
 * preguntarla. `mesesUnion` trae SIEMPRE la medida ancha, para poder reportar
 * las dos sin correr la consulta dos veces.
 */
export async function medirAtrasoDeConvenios(
  opciones: { hoy?: Date; criterio?: CriterioAtrasoConvenio } = {},
): Promise<{
  creditoIds: number[];
  mesesAtrasados: Map<number, number>;
  mesesUnion: Map<number, number>;
  /**
   * Cuándo se creó el convenio VIGENTE de cada crédito. Lo usa el vigilante
   * para acotar el congelamiento a ese convenio y no a cualquiera que el
   * crédito haya tenido antes (review de Codex, P2).
   */
  convenioDesde: Map<number, Date | null>;
}> {
  const hoy = opciones.hoy ?? hoyGT();
  const criterio = opciones.criterio ?? "convenio";
  // 1. Cuotas del crédito. El INNER JOIN a `creditos` no es solo el filtro por
  //    estado: es lo que hace que la correlación del EXISTS funcione (ver la
  //    trampa de Drizzle en la cabecera).
  const cuotas = await db
    .select({
      cuota_id: cuotas_credito.cuota_id,
      credito_id: cuotas_credito.credito_id,
      fecha_vencimiento: cuotas_credito.fecha_vencimiento,
      pagado: cuotas_credito.pagado,
      hasPaidPayment: sql<boolean>`EXISTS (
        SELECT 1
        FROM ${SQL_CARTERA_SCHEMA}.pagos_credito pc
        WHERE pc.cuota_id = ${cuotas_credito.cuota_id}
          AND pc."paymentFalse" = false
          AND pc.pagado = true
          AND pc.validation_status IN ('validated', 'no_required')
          AND COALESCE(pc.monto_aplicado, 0) > 0
      )`,
    })
    .from(cuotas_credito)
    .innerJoin(creditos, eq(cuotas_credito.credito_id, creditos.credito_id))
    .where(eq(creditos.statusCredit, "EN_CONVENIO"));

  const creditoIds = [...new Set(cuotas.map((c) => c.credito_id))];
  const mesesAtrasados = new Map<number, number>();
  const mesesUnion = new Map<number, number>();
  const convenioDesde = new Map<number, Date | null>();
  if (creditoIds.length === 0)
    return { creditoIds, mesesAtrasados, mesesUnion, convenioDesde };

  // 2. Cuotas del crédito que el convenio absorbió (snapshot al crear).
  const convenios = await db
    .select({
      credito_id: convenios_pago.credito_id,
      cuotas_convenio: convenios_pago.cuotas_convenio,
      created_at: convenios_pago.created_at,
    })
    .from(convenios_pago)
    .where(
      and(
        inArray(convenios_pago.credito_id, creditoIds),
        eq(convenios_pago.completado, false),
        eq(convenios_pago.activo, true),
      ),
    );
  const excluidas = new Map<number, Set<number>>();
  for (const cv of convenios) {
    // El más reciente gana: si un crédito tuviera dos vigentes (no debería), el
    // congelamiento se acota al último, que es el que manda.
    const previo = convenioDesde.get(cv.credito_id) ?? null;
    const nacido = cv.created_at ? new Date(cv.created_at) : null;
    if (!previo || (nacido && nacido > previo)) {
      convenioDesde.set(cv.credito_id, nacido);
    }
    if (!cv.cuotas_convenio || cv.cuotas_convenio.length === 0) continue;
    const set = excluidas.get(cv.credito_id) ?? new Set<number>();
    for (const cid of cv.cuotas_convenio) set.add(cid);
    excluidas.set(cv.credito_id, set);
  }

  // Dos juegos de fechas: el del convenio solo y el de la unión. Se llenan en
  // la misma pasada para poder reportar las dos medidas sin repetir consultas.
  const fechasConvenio = new Map<number, Set<string>>();
  const fechasUnion = new Map<number, Set<string>>();
  for (const id of creditoIds) {
    fechasConvenio.set(id, new Set<string>());
    fechasUnion.set(id, new Set<string>());
  }

  // (A) cuota normal en curso: vencida, impaga y no reestructurada. Entra solo
  // en la unión — no es incumplimiento DEL ACUERDO.
  for (const cuota of cuotas) {
    if (excluidas.get(cuota.credito_id)?.has(cuota.cuota_id)) continue;
    const impaga = cuota.pagado === false && cuota.hasPaidPayment !== true;
    if (impaga && estaVencidaGT(cuota.fecha_vencimiento, hoy)) {
      fechasUnion.get(cuota.credito_id)?.add(claveFecha(cuota.fecha_vencimiento));
    }
  }

  // (B) cuota del convenio posterior al acuerdo, vencida y no cubierta.
  const cuotasDeConvenio = await db
    .select({
      credito_id: convenios_pago.credito_id,
      convenio_id: convenio_cuotas.convenio_id,
      fecha_convenio: convenios_pago.fecha_convenio,
      fecha_vencimiento: convenio_cuotas.fecha_vencimiento,
      numero_cuota: convenio_cuotas.numero_cuota,
      monto_pagado: convenios_pago.monto_pagado,
      cuota_mensual: convenios_pago.cuota_mensual,
    })
    .from(convenio_cuotas)
    .innerJoin(
      convenios_pago,
      eq(convenio_cuotas.convenio_id, convenios_pago.convenio_id),
    )
    .where(
      and(
        inArray(convenios_pago.credito_id, creditoIds),
        eq(convenios_pago.completado, false),
        eq(convenios_pago.activo, true),
      ),
    );

  const porConvenio = new Map<number, (typeof cuotasDeConvenio)[number][]>();
  for (const cc of cuotasDeConvenio) {
    const lista = porConvenio.get(cc.convenio_id) ?? [];
    lista.push(cc);
    porConvenio.set(cc.convenio_id, lista);
  }
  for (const [, lista] of porConvenio) {
    lista.sort((a, b) => a.numero_cuota - b.numero_cuota);
    let ordinalAdelante = 0;
    for (const cc of lista) {
      if (nacioConElConvenio(cc.fecha_vencimiento, cc.fecha_convenio)) continue;
      ordinalAdelante += 1;
      const cubierta =
        Number(cc.monto_pagado) >= ordinalAdelante * Number(cc.cuota_mensual);
      if (!cubierta && estaVencidaGT(cc.fecha_vencimiento, hoy)) {
        const clave = claveFecha(cc.fecha_vencimiento);
        fechasConvenio.get(cc.credito_id)?.add(clave);
        fechasUnion.get(cc.credito_id)?.add(clave);
      }
    }
  }

  for (const id of creditoIds) {
    mesesUnion.set(id, fechasUnion.get(id)?.size ?? 0);
    mesesAtrasados.set(
      id,
      criterio === "union"
        ? (fechasUnion.get(id)?.size ?? 0)
        : (fechasConvenio.get(id)?.size ?? 0),
    );
  }
  return { creditoIds, mesesAtrasados, mesesUnion, convenioDesde };
}
