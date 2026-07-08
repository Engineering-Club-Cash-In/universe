import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { client, db } from "../database";
import { asesor_bucket, asesores, buckets, buckets_historial, CARTERA_SCHEMA, credito_asesor_historial, creditos, cuotas_credito, moras_condonaciones, moras_credito, moras_historial, pagos_credito, platform_users, SQL_CARTERA_SCHEMA, usuarios } from "../database/db/schema";
import Big from "big.js";
import { toZonedTime } from "date-fns-tz";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import ExcelJS from "exceljs";
import { stat } from "fs";

type MoraEventoTipo =
  | "CREACION"
  | "RECALCULO"
  | "INCREMENTO"
  | "DECREMENTO"
  | "CONDONACION"
  | "DESACTIVACION";

type MoraEventoOrigen =
  | "PROCESO_AUTO"
  | "API_MANUAL"
  | "CONDONACION_INDIVIDUAL"
  | "CONDONACION_MASIVA";

export const STATUS_EXCLUIDOS_MORA = ["EN_CONVENIO", "INCOBRABLE", "CANCELADO", "PENDIENTE_CANCELACION", "CAIDO"];

export function isOverdueInstallmentForMora(
  cuota: {
    fecha_vencimiento: Date | string;
    pagado: boolean | null;
    hasPaidPayment?: boolean | null;
    statusCredit?: string | null;
  },
  hoy: Date,
) {
  const zona = "America/Guatemala";
  const fechaVenc = toZonedTime(cuota.fecha_vencimiento, zona);
  fechaVenc.setHours(0, 0, 0, 0);

  const fechaHoy = toZonedTime(hoy, zona);
  fechaHoy.setHours(0, 0, 0, 0);

  const isOverdue = fechaVenc < fechaHoy;
  const isUnpaid = cuota.pagado === false && cuota.hasPaidPayment !== true;
  const isEligible = !STATUS_EXCLUIDOS_MORA.includes(cuota.statusCredit ?? "");

  return isOverdue && isUnpaid && isEligible;
}

// ============================================================
// 🪣 MOTOR DE BUCKETS (COBROS-02) — bucket derivado por estado + cuotas
// ============================================================
// El bucket se DERIVA del catálogo dinámico `cartera.buckets` (nombres, rangos y
// estados configurables → filtros full dinámicos). Lo único que queda en código
// es la lista de estados FUERA del funnel operativo (Opción A): esos créditos ya
// no llevan mora ni se trackean como bucket.
export const STATUS_BUCKET_FUERA = [
  "CANCELADO",
  "PENDIENTE_CANCELACION",
  "EN_CONVENIO",
  "CAIDO",
];

// Fila del catálogo de buckets relevante para la derivación.
export type BucketCatalogo = {
  numero: number;
  cuotas_min: number;
  cuotas_max: number | null; // null = abierto (B5 = 5..∞)
  estados_incluidos: string[];
};

/**
 * Fila completa del catálogo `cartera.buckets` expuesta a consumidores
 * externos (CRM vía API) — incluye el puente `estado_mora` (numero↔estadoMora).
 */
export type BucketCatalogoCompleto = {
  numero: number;
  prefijo: string;
  nombre: string;
  descripcion: string | null;
  cuotas_min: number;
  cuotas_max: number | null;
  estados_incluidos: string[];
  es_operativo: boolean;
  orden: number;
  color: string | null;
  estado_mora: string | null;
};

// Fallback B0-B5 — mismo seed seed que 0001_buckets_catalogo.sql +
// 0003_buckets_estado_mora.sql. Usado SOLO si la query falla (ej. columna
// `estado_mora` aún no existe porque la migración 0003 está pendiente en ese
// ambiente): sin esto, GET /config/buckets devolvía 500 en vez de degradar,
// a diferencia de los demás consumidores de getBucketsCatalogo() en credits.ts.
const FALLBACK_BUCKETS_CATALOGO: BucketCatalogoCompleto[] = [
  { numero: 0, prefijo: "B0", nombre: "Cartera Sana", descripcion: null, cuotas_min: 0, cuotas_max: 0, estados_incluidos: [], es_operativo: true, orden: 0, color: null, estado_mora: "al_dia" },
  { numero: 1, prefijo: "B1", nombre: "Alerta Temprana", descripcion: null, cuotas_min: 1, cuotas_max: 1, estados_incluidos: [], es_operativo: true, orden: 1, color: null, estado_mora: "mora_30" },
  { numero: 2, prefijo: "B2", nombre: "Gestión Activa", descripcion: null, cuotas_min: 2, cuotas_max: 2, estados_incluidos: [], es_operativo: true, orden: 2, color: null, estado_mora: "mora_60" },
  { numero: 3, prefijo: "B3", nombre: "Rescate", descripcion: null, cuotas_min: 3, cuotas_max: 3, estados_incluidos: [], es_operativo: true, orden: 3, color: null, estado_mora: "mora_90" },
  { numero: 4, prefijo: "B4", nombre: "Última Instancia / Pre Jurídico", descripcion: null, cuotas_min: 4, cuotas_max: 4, estados_incluidos: [], es_operativo: true, orden: 4, color: null, estado_mora: "mora_120" },
  { numero: 5, prefijo: "B5", nombre: "Jurídico", descripcion: null, cuotas_min: 5, cuotas_max: null, estados_incluidos: ["INCOBRABLE"], es_operativo: false, orden: 5, color: null, estado_mora: "mora_120_plus" },
];

/** Catálogo dinámico de buckets (activos, ordenados) — fuente única para cartera-back y CRM. */
export async function getBucketsCatalogo(): Promise<BucketCatalogoCompleto[]> {
  try {
    return await db
      .select({
        numero: buckets.numero,
        prefijo: buckets.prefijo,
        nombre: buckets.nombre,
        descripcion: buckets.descripcion,
        cuotas_min: buckets.cuotas_min,
        cuotas_max: buckets.cuotas_max,
        estados_incluidos: buckets.estados_incluidos,
        es_operativo: buckets.es_operativo,
        orden: buckets.orden,
        color: buckets.color,
        estado_mora: buckets.estado_mora,
      })
      .from(buckets)
      .where(eq(buckets.activo, true))
      .orderBy(buckets.orden);
  } catch (err) {
    console.error("❌ Error consultando catálogo de buckets, usando fallback:", err);
    return FALLBACK_BUCKETS_CATALOGO;
  }
}

/**
 * Bucket de un crédito (0-5) resuelto contra el catálogo dinámico `catalogo`.
 * Orden: (1) estado fuera del funnel → null; (2) estado que fuerza un bucket
 * (p.ej. INCOBRABLE → B5 vía `estados_incluidos`); (3) rango de cuotas atrasadas.
 * Devuelve `null` si el crédito está fuera del funnel operativo (no se trackea).
 */
export function bucketDeCredito(
  status: string | null | undefined,
  cuotasAtrasadas: number,
  catalogo: BucketCatalogo[],
): number | null {
  // (1) Fuera del funnel operativo (lista en código, Opción A).
  if (status && STATUS_BUCKET_FUERA.includes(status)) return null;
  // (2) Estado que fuerza un bucket (p.ej. INCOBRABLE → B5).
  if (status) {
    const porEstado = catalogo.find((b) => b.estados_incluidos.includes(status));
    if (porEstado) return porEstado.numero;
  }
  // (3) Por rango de cuotas atrasadas (max null = abierto).
  const cuotas = Math.max(cuotasAtrasadas, 0);
  const porRango = catalogo.find(
    (b) => cuotas >= b.cuotas_min && (b.cuotas_max == null || cuotas <= b.cuotas_max),
  );
  return porRango ? porRango.numero : null;
}

/**
 * FASE 3 — elige el asesor para un crédito que ENTRA a un bucket:
 *  · pool vacío → null (no hay elegibles; el crédito conserva su asesor)
 *  · el asesor actual ya es elegible en el bucket destino → se queda (sin churn)
 *  · si no → el elegible con MENOR carga en ese bucket (asignación equitativa
 *    cuando hay N asesores; con 1 solo, queda directa); empate → menor asesor_id.
 * Pura a propósito (sin DB) para poder testearla aislada.
 */
export function elegirAsesorParaBucket(
  pool: number[],
  cargaBucket: Map<number, number> | undefined,
  asesorActual: number | null,
): number | null {
  if (pool.length === 0) return null;
  if (asesorActual !== null && pool.includes(asesorActual)) return asesorActual;
  let elegido: number | null = null;
  let menorCarga = Infinity;
  for (const asesorId of pool) {
    const carga = cargaBucket?.get(asesorId) ?? 0;
    if (carga < menorCarga || (carga === menorCarga && elegido !== null && asesorId < elegido)) {
      menorCarga = carga;
      elegido = asesorId;
    }
  }
  return elegido;
}

/**
 * Inserta un evento en moras_historial. No lanza si falla — el historial
 * no debe romper la operación principal, solo loguea.
 */
async function registrarHistorialMora(params: {
  credito_id: number;
  mora_id: number | null;
  tipo_evento: MoraEventoTipo;
  origen: MoraEventoOrigen;
  monto_anterior: string | number;
  monto_nuevo: string | number;
  cuotas_atrasadas_anterior?: number;
  cuotas_atrasadas_nuevas?: number;
  capital_credito?: string | number | null;
  porcentaje_mora?: string | number | null;
  usuario_id?: number | null;
  motivo?: string | null;
}) {
  try {
    await db.insert(moras_historial).values({
      credito_id: params.credito_id,
      mora_id: params.mora_id,
      tipo_evento: params.tipo_evento,
      origen: params.origen,
      monto_anterior: params.monto_anterior.toString(),
      monto_nuevo: params.monto_nuevo.toString(),
      cuotas_atrasadas_anterior: params.cuotas_atrasadas_anterior ?? 0,
      cuotas_atrasadas_nuevas: params.cuotas_atrasadas_nuevas ?? 0,
      capital_credito:
        params.capital_credito !== undefined && params.capital_credito !== null
          ? params.capital_credito.toString()
          : null,
      porcentaje_mora:
        params.porcentaje_mora !== undefined && params.porcentaje_mora !== null
          ? params.porcentaje_mora.toString()
          : null,
      usuario_id: params.usuario_id ?? null,
      motivo: params.motivo ?? null,
    });
  } catch (err) {
    console.error("[HISTORIAL] ⚠️  No se pudo registrar evento de mora:", err);
  }
}
/**
 * Create a new mora (penalty) for a credit.
 *
 * Rules:
 * 1. A mora is always created as active by default.
 * 2. If the mora amount > 0, the credit status changes to "MOROSO".
 * 3. If the mora amount = 0, the credit remains "ACTIVO".
 */

export async function createMora({
  credito_id,
  monto_mora,
  cuotas_atrasadas,
  origen = "API_MANUAL",
  motivo,
  usuario_id,
  usuario_email,
  override = false,
}: {
  credito_id: number;
  monto_mora?: number;
  cuotas_atrasadas?: number;
  origen?: MoraEventoOrigen;
  motivo?: string;
  usuario_id?: number;
  usuario_email?: string;
  override?: boolean;
}) {
  const requestId = `${credito_id}-${Date.now()}`;

  console.log(`
╔════════════════════════════════════════════════════════════
║ [CREATE MORA ENTRY] Request ID: ${requestId}
║ Crédito ID: ${credito_id}
║ Monto Mora: ${monto_mora}
║ Cuotas Atrasadas: ${cuotas_atrasadas}
║ Timestamp: ${new Date().toISOString()}
╚════════════════════════════════════════════════════════════
  `);

  try {
    // 🔥 VALIDACIÓN 1: Monto debe ser mayor a 0
    if (!monto_mora || monto_mora <= 0) {
      console.log(`[${requestId}] ❌ RECHAZADO: Monto debe ser mayor a 0`);
      return {
        success: false,
        message: "[ERROR] Monto de mora debe ser mayor a 0",
      };
    }

    // 🔥 VALIDACIÓN 2: cuotas_atrasadas es obligatorio y >= 1. Una mora con monto>0 y
    // cuotas=0 no cae en ningún bucket (30/60/90/120) de Mora Histórica y rompería el
    // invariante mora_total = Σbuckets. Antes se default-eaba a 0 silenciosamente.
    if (cuotas_atrasadas === undefined || cuotas_atrasadas === null || cuotas_atrasadas < 1) {
      console.log(`[${requestId}] ❌ RECHAZADO: cuotas_atrasadas requerido (>=1)`);
      return {
        success: false,
        message: "[ERROR] cuotas_atrasadas es requerido y debe ser >= 1",
      };
    }

    // Traer el crédito una sola vez: capital (para validar + fotografiar) y status (para no des-castigar).
    const [credito] = await db
      .select({ capital: creditos.capital, statusCredit: creditos.statusCredit })
      .from(creditos)
      .where(eq(creditos.credito_id, credito_id));
    if (!credito) {
      return { success: false, message: `[ERROR] No se encontró crédito con credito_id=${credito_id}` };
    }

    const estadoExcluido = STATUS_EXCLUIDOS_MORA.includes(credito.statusCredit ?? "");
    const capitalBig = new Big(credito.capital || 0);

    // 🔥 Conteo REAL de cuotas vencidas (derivado de cuotas_credito), NO el cuotas_atrasadas
    // del request. Confiar en el valor enviado permitía inflarlo para esquivar el guard de
    // cordura: p.ej. Q27,953.44 pasaba con cuotas_atrasadas: 7 porque el umbral se volvía
    // 10× la fórmula de 7 cuotas. Misma lógica que procesarMoras (isOverdueInstallmentForMora).
    const ovRes = await db.execute<any>(sql`
      SELECT COUNT(*)::int AS n
      FROM ${SQL_CARTERA_SCHEMA}.cuotas_credito cu
      WHERE cu.credito_id = ${credito_id}
        AND cu.fecha_vencimiento::date < (now() AT TIME ZONE 'America/Guatemala')::date
        AND cu.pagado = false
        AND NOT EXISTS (
          SELECT 1 FROM ${SQL_CARTERA_SCHEMA}.pagos_credito pc
          WHERE pc.cuota_id = cu.cuota_id AND pc."paymentFalse" = false AND pc.pagado = true
            AND pc.validation_status IN ('validated', 'no_required'))`);
    const cuotasReales = Number(ovRes.rows?.[0]?.n ?? 0);

    // Si el cuotas_atrasadas enviado NO coincide con las cuotas vencidas reales, exigir override
    // (el caller no puede inflar el conteo para disparar el umbral del guard).
    if (cuotas_atrasadas !== cuotasReales && !override) {
      console.log(`[${requestId}] ❌ RECHAZADO: cuotas_atrasadas=${cuotas_atrasadas} ≠ vencidas reales=${cuotasReales}`);
      return {
        success: false,
        message: `[ERROR] cuotas_atrasadas=${cuotas_atrasadas} no coincide con las cuotas vencidas reales (${cuotasReales}). Envía override:true + motivo si es intencional.`,
      };
    }

    // La fórmula y el guard usan SIEMPRE las cuotas reales (no el valor no confiable del request).
    const esperado = capitalBig.times(0.0112).times(cuotasReales); // capital × 1.12% × cuotas reales

    // 🔥 VALIDACIÓN 3: NUNCA escribir mora sobre créditos en estado excluido (EN_CONVENIO/
    // INCOBRABLE/CANCELADO/PENDIENTE_CANCELACION/CAIDO) — ni con override. Castigados/cancelados
    // no llevan mora; además el cron procesarMoras desactivaría esa mora en su corrida (la fila
    // quedaría huérfana), así que el override sobre un excluido era transitorio e inútil. Para
    // morar uno de estos hay que sacarlo del estado excluido primero (como hace el teardown de
    // convenio, que lo pone MOROSO antes de llamar a createMora).
    if (estadoExcluido) {
      console.log(`[${requestId}] ❌ RECHAZADO: status '${credito.statusCredit}' excluido de mora`);
      return {
        success: false,
        message: `[ERROR] El crédito está en estado '${credito.statusCredit}' (excluido de mora): no se le puede registrar mora. Saca el crédito de ese estado primero si corresponde.`,
      };
    }

    // 🔥 VALIDACIÓN 4: guard de cordura del monto. "Absurdo" = mayor al capital total o
    // más de 10× la fórmula (atrapa errores tipo Q27,953.44 sobre un capital de Q40k/1 cuota).
    const montoBig = new Big(monto_mora);
    // Absurdo = más de 10× la fórmula (atrapa errores tipo Q27,953.44 sobre Q453.55 esperado).
    // No se compara contra el capital directo: la fórmula correcta de un crédito con 90+ cuotas
    // vencidas ya supera el capital y sería un falso positivo. Si la fórmula da 0 (capital 0),
    // cualquier monto exige override.
    const esAbsurdo = esperado.gt(0) ? montoBig.gt(esperado.times(10)) : true;
    if (esAbsurdo && !override) {
      console.log(`[${requestId}] ❌ RECHAZADO: monto ${monto_mora} fuera de rango (fórmula ${esperado.toFixed(2)})`);
      return {
        success: false,
        message: `[ERROR] Monto Q${monto_mora} fuera de rango: la fórmula da Q${esperado.toFixed(2)} (capital Q${capitalBig.toFixed(2)} × 1.12% × ${cuotasReales} cuotas reales). Envía override:true + motivo si es intencional.`,
      };
    }

    // Cualquier override debe justificarse (rastro de auditoría).
    if (override && (!motivo || !motivo.trim())) {
      return { success: false, message: "[ERROR] override:true requiere 'motivo' (justificación)." };
    }

    // Identidad del que ejecuta: directo del token (usuario_id). Si el token no trae id,
    // se resuelve por email. Best-effort: la atribución no debe bloquear la operación.
    let usuarioId: number | undefined = usuario_id ?? undefined;
    if (!usuarioId && usuario_email) {
      const [u] = await db
        .select({ id: platform_users.id })
        .from(platform_users)
        .where(eq(platform_users.email, usuario_email));
      usuarioId = u?.id;
    }

    // 🔥 VERIFICAR SI YA EXISTE MORA ACTIVA (UPSERT)
    console.log(`[${requestId}] 🔍 Verificando mora activa existente...`);

    const [moraExistente] = await db
      .select({
        mora_id: moras_credito.mora_id,
        monto_mora: moras_credito.monto_mora,
        cuotas_atrasadas: moras_credito.cuotas_atrasadas,
      })
      .from(moras_credito)
      .where(
        and(
          eq(moras_credito.credito_id, credito_id),
          eq(moras_credito.activa, true)
        )
      );

    let newMora;
    let tipo_evento: MoraEventoTipo;
    let monto_anterior = "0";
    let cuotas_anteriores = 0;

    if (moraExistente) {
      // 🔄 ACTUALIZAR MORA EXISTENTE
      console.log(`[${requestId}] 🔄 Mora activa existente (ID: ${moraExistente.mora_id}), actualizando...`);

      monto_anterior = moraExistente.monto_mora;
      cuotas_anteriores = moraExistente.cuotas_atrasadas;
      tipo_evento = "RECALCULO";

      [newMora] = await db
        .update(moras_credito)
        .set({
          monto_mora: monto_mora.toString(),
          cuotas_atrasadas,
          updated_at: new Date(),
        })
        .where(eq(moras_credito.mora_id, moraExistente.mora_id))
        .returning();

      console.log(`[${requestId}] ✅ Mora actualizada: ID=${newMora.mora_id}`);
    } else {
      // 🔥 INSERTAR NUEVA MORA
      console.log(`[${requestId}] 💰 Insertando nueva mora con monto ${monto_mora}...`);

      tipo_evento = "CREACION";

      [newMora] = await db
        .insert(moras_credito)
        .values({
          credito_id,
          monto_mora: monto_mora.toString(),
          cuotas_atrasadas,
          activa: true,
          porcentaje_mora: "1.12",
        })
        .returning();

      console.log(`[${requestId}] ✅ Mora creada: ID=${newMora.mora_id}`);
    }

    // Actualizar status a MOROSO. Llegar aquí implica que el crédito NO está en estado
    // excluido (V3 ya los rechaza), así que es seguro marcarlo MOROSO.
    console.log(`[${requestId}] 🔄 Actualizando status a MOROSO...`);
    await db
      .update(creditos)
      .set({ statusCredit: "MOROSO" })
      .where(eq(creditos.credito_id, credito_id));
    console.log(`[${requestId}] ✅ Status actualizado a MOROSO`);

    await registrarHistorialMora({
      credito_id,
      mora_id: newMora.mora_id,
      tipo_evento,
      origen,
      monto_anterior,
      monto_nuevo: monto_mora,
      cuotas_atrasadas_anterior: cuotas_anteriores,
      cuotas_atrasadas_nuevas: cuotas_atrasadas,
      capital_credito: credito.capital,
      porcentaje_mora: newMora.porcentaje_mora,
      usuario_id: usuarioId,
      motivo,
    });

    console.log(`
╔════════════════════════════════════════════════════════════
║ [CREATE MORA SUCCESS] Request ID: ${requestId}
║ Mora ID: ${newMora.mora_id}
║ Status: MOROSO
║ Timestamp: ${new Date().toISOString()}
╚════════════════════════════════════════════════════════════
    `);

    return {
      success: true,
      mora: newMora,
      status: "MOROSO",
    };

  } catch (error) {
    console.error(`
╔════════════════════════════════════════════════════════════
║ [CREATE MORA ERROR] Request ID: ${requestId}
║ Crédito ID: ${credito_id}
║ Error: ${String(error)}
║ Timestamp: ${new Date().toISOString()}
╚════════════════════════════════════════════════════════════
    `);
    
    return {
      success: false,
      message: "[ERROR] Could not create mora",
      error: String(error),
    };
  }
}

 
/**
 * Update mora (penalty) for a credit using increments or decrements.
 *
 * Rules:
 * 1. If type = "INCREMENTO", add monto_cambio to the existing mora.
 * 2. If type = "DECREMENTO", subtract monto_cambio from the existing mora (never below 0).
 * 3. If final monto_mora > 0 and mora is active -> credit = MOROSO.
 * 4. If final monto_mora = 0 or mora inactive -> credit = ACTIVO.
 */
/**
 * Update mora (penalty) for a credit using increments or decrements.
 *
 * Rules:
 * 1. If type = "INCREMENTO", add monto_cambio to the existing mora.
 * 2. If type = "DECREMENTO", subtract monto_cambio from the existing mora (never below 0).
 * 3. If final monto_mora > 0 and mora is active -> credit = MOROSO.
 * 4. If final monto_mora = 0 or mora inactive -> credit = ACTIVO.
 */
export async function updateMora({
  credito_id,
  numero_credito_sifco,
  monto_cambio,
  tipo,
  cuotas_atrasadas,
  activa,
  usuario_email,
}: {
  credito_id?: number;
  numero_credito_sifco?: string;
  monto_cambio: number;
  tipo: "INCREMENTO" | "DECREMENTO";
  cuotas_atrasadas?: number;
  activa?: boolean;
  usuario_email?: string;
}) {
  if (monto_cambio < 0) {
    return { success: false, message: "[ERROR] monto_cambio debe ser >= 0 (usa el campo 'tipo' para indicar dirección)" };
  }

  // Resolver credito_id desde numero_credito_sifco si solo vino ese
  let targetCreditoId = credito_id;
  if (!targetCreditoId && numero_credito_sifco) {
    const [credito] = await db
      .select({ credito_id: creditos.credito_id })
      .from(creditos)
      .where(eq(creditos.numero_credito_sifco, numero_credito_sifco));
    if (!credito) {
      return { success: false, message: `[ERROR] No se encontró crédito con numero_credito_sifco=${numero_credito_sifco}` };
    }
    targetCreditoId = credito.credito_id;
  }
  if (!targetCreditoId) {
    return { success: false, message: "[ERROR] credito_id o numero_credito_sifco es requerido" };
  }

  const requestId = `${targetCreditoId}-${Date.now()}`;

  console.log(`
╔════════════════════════════════════════════════════════════
║ [UPDATE MORA] Request ID: ${requestId}
║ Crédito ID: ${credito_id}
║ Tipo: ${tipo}
║ Monto Cambio: ${monto_cambio}
║ Timestamp: ${new Date().toISOString()}
╚════════════════════════════════════════════════════════════
  `);

  try {
    // Resolver usuario que ejecuta la acción (si vino email)
    let usuarioId: number | undefined;
    if (usuario_email) {
      const [user] = await db
        .select({ id: platform_users.id })
        .from(platform_users)
        .where(eq(platform_users.email, usuario_email));
      if (!user) {
        return { success: false, message: "[ERROR] Usuario no encontrado" };
      }
      usuarioId = user.id;
    }

    // Toda la operación dentro de una transacción con row lock para evitar races
    const result = await db.transaction(async (tx) => {
      const shouldReactivateMora = tipo === "INCREMENTO" && activa === true;
      const moraWhere = shouldReactivateMora
        ? eq(moras_credito.credito_id, targetCreditoId)
        : and(
          eq(moras_credito.credito_id, targetCreditoId),
          eq(moras_credito.activa, true),
        );

      const [moraActual] = await tx
        .select({
          id: moras_credito.mora_id,
          monto: moras_credito.monto_mora,
          activa: moras_credito.activa,
          porcentaje_mora: moras_credito.porcentaje_mora,
          cuotas_atrasadas: moras_credito.cuotas_atrasadas,
        })
        .from(moras_credito)
        .where(moraWhere)
        .orderBy(desc(moras_credito.activa), desc(moras_credito.created_at))
        .limit(1)
        .for("update");

      if (!moraActual) {
        return { kind: "not_found" as const };
      }

      let newMonto = new Big(moraActual.monto);
      if (tipo === "INCREMENTO") {
        newMonto = newMonto.plus(monto_cambio);
      } else {
        newMonto = newMonto.minus(monto_cambio);
        if (newMonto.lt(0)) newMonto = new Big(0);
      }

      // Estado activa: si llega 0 forzamos inactiva; si quedó >0 respetamos param o estado actual
      const newActiva = newMonto.eq(0)
        ? false
        : (activa !== undefined ? activa : moraActual.activa);

      const [updated] = await tx
        .update(moras_credito)
        .set({
          monto_mora: newMonto.toString(),
          ...(cuotas_atrasadas !== undefined ? { cuotas_atrasadas } : {}),
          activa: newActiva,
          updated_at: new Date(),
        })
        .where(eq(moras_credito.mora_id, moraActual.id))
        .returning();

      // statusCredit según la lógica documentada (rules 3 y 4 de la docstring),
      // PERO nunca pisar un estado de cierre/castigo: un ajuste de mora no debe
      // "des-castigar" un crédito (p.ej. reversar un pago con mora sobre un
      // INCOBRABLE lo flipeaba a MOROSO/ACTIVO). Solo se toca el status si el
      // crédito NO está en STATUS_EXCLUIDOS_MORA.
      const newStatus = (newMonto.gt(0) && newActiva) ? "MOROSO" : "ACTIVO";

      const [creditoActual] = await tx
        .select({ statusCredit: creditos.statusCredit })
        .from(creditos)
        .where(eq(creditos.credito_id, targetCreditoId))
        .limit(1);

      const estadoProtegido = STATUS_EXCLUIDOS_MORA.includes(
        creditoActual?.statusCredit ?? "",
      );

      if (!estadoProtegido) {
        await tx
          .update(creditos)
          .set({ statusCredit: newStatus })
          .where(eq(creditos.credito_id, targetCreditoId));
      } else {
        console.log(
          `[${requestId}] ⏭️ Status '${creditoActual?.statusCredit}' protegido (STATUS_EXCLUIDOS_MORA): no se cambia a ${newStatus}`,
        );
      }

      return {
        kind: "ok" as const,
        updated,
        newStatus,
        montoAnterior: moraActual.monto,
        montoNuevo: newMonto.toString(),
        cuotasAnteriores: moraActual.cuotas_atrasadas,
      };
    });

    if (result.kind === "not_found") {
      console.log(`[${requestId}] ❌ No se encontró mora activa para este crédito`);
      return { success: false, message: "[ERROR] Mora activa no encontrada para este crédito" };
    }

    await registrarHistorialMora({
      credito_id: targetCreditoId,
      mora_id: result.updated.mora_id,
      tipo_evento: tipo,
      origen: "API_MANUAL",
      monto_anterior: result.montoAnterior,
      monto_nuevo: result.montoNuevo,
      cuotas_atrasadas_anterior: result.cuotasAnteriores,
      cuotas_atrasadas_nuevas: cuotas_atrasadas,
      porcentaje_mora: result.updated.porcentaje_mora,
      usuario_id: usuarioId,
    });

    console.log(`
╔════════════════════════════════════════════════════════════
║ [UPDATE MORA SUCCESS] Request ID: ${requestId}
║ Mora ID: ${result.updated.mora_id}
║ Nuevo Monto: ${result.montoNuevo}
║ Status Crédito: ${result.newStatus}
║ Timestamp: ${new Date().toISOString()}
╚════════════════════════════════════════════════════════════
    `);

    return {
      success: true,
      mora: result.updated,
      newStatus: result.newStatus,
    };

  } catch (error) {
    console.error(`
╔════════════════════════════════════════════════════════════
║ [UPDATE MORA ERROR] Request ID: ${requestId}
║ Crédito ID: ${credito_id}
║ Error: ${String(error)}
║ Timestamp: ${new Date().toISOString()}
╚════════════════════════════════════════════════════════════
    `);
    
    return {
      success: false,
      message: "[ERROR] Could not update mora",
      error: String(error),
    };
  }
}

/**
 * Process overdue installments and update loan penalties (moras).
 *
 * Steps:
 * 1. Get all installments (cuotas) from the database.
 * 2. Filter those overdue (not paid and past due date) using Guatemala timezone.
 * 3. Group overdue installments by credit.
 * 4. For each credit:
 *    - Calculate the new penalty (mora) = capital × percentage × overdue installments.
 *      The mora is RECALCULATED from scratch each run (idempotent): the stored value is
 *      REPLACED, never accumulated, so re-running the job does not double the amount.
 *    - If an active mora record already exists, recalculate it; if not, insert a new one.
 *    - Update the credit status to "MOROSO".
 * 5. Log every step for debugging and monitoring.
 */
// Clave fija para el advisory lock de procesarMoras (cualquier int estable sirve).
const PROCESAR_MORAS_LOCK_KEY = 728193;

export async function procesarMoras() {
  const zona = "America/Guatemala";

  // 🔒 Lock entre instancias: con varias réplicas del back, todas agendan el cron
  // (23:59 GT) y corrían EN PARALELO leyendo el mismo estado viejo → duplicaban
  // eventos en moras_historial y, peor, filas activa=true en moras_credito.
  // Tomamos un advisory lock en una conexión dedicada; si otra corrida ya lo tiene,
  // se omite esta. (El índice único parcial moras_credito_uq_activa es el respaldo duro.)
  const lockConn = await client.connect();
  let lockHeld = false;
  try {
    const _lk = await lockConn.query("SELECT pg_try_advisory_lock($1) AS ok", [PROCESAR_MORAS_LOCK_KEY]);
    lockHeld = _lk.rows[0]?.ok === true;
    if (!lockHeld) {
      console.log("[MORA] ⏭️  Otra instancia ya está procesando moras; se omite esta corrida.");
      return { skipped: true, creadas: 0, recalculadas: 0, sinCambios: 0, desactivadas: 0, sinCapital: 0 };
    }

    const hoy = toZonedTime(new Date(), zona);
    hoy.setHours(0, 0, 0, 0);

    console.log("[INFO] Current Guatemala date (midnight):", hoy.toISOString());
    console.log("\n╔════════════════════════════════════════════════════════════");
    console.log("║ [JOB] 🚀 INICIANDO PROCESO DE MORAS (UPSERT)");
    console.log("╚════════════════════════════════════════════════════════════\n");

    // 1. Get all installments WITH PROPER JOIN
    const cuotas = await db
      .select({
        cuota_id: cuotas_credito.cuota_id,
        credito_id: cuotas_credito.credito_id,
        fecha_vencimiento: cuotas_credito.fecha_vencimiento,
        pagado: cuotas_credito.pagado,
        statusCredit: creditos.statusCredit,
        capital: creditos.capital,
        asesor_id: creditos.asesor_id, // FASE 3: dueño actual (para reasignar por bucket)
        hasPaidPayment: sql<boolean>`EXISTS (
          SELECT 1
          FROM ${SQL_CARTERA_SCHEMA}.pagos_credito pc
          WHERE pc.cuota_id = ${cuotas_credito.cuota_id}
            AND pc."paymentFalse" = false
            AND pc.pagado = true
            AND pc.validation_status IN ('validated', 'no_required')
        )`,
      })
      .from(cuotas_credito)
      .innerJoin(creditos, eq(cuotas_credito.credito_id, creditos.credito_id));

    console.log(`[DEBUG] Total installments fetched: ${cuotas.length}`);

    // 2. Filter overdue installments (excluyendo estados que no aplican)
    const cuotasVencidas = cuotas.filter((c) => isOverdueInstallmentForMora(c, hoy));

    console.log(`[DEBUG] Overdue installments found: ${cuotasVencidas.length}`);

    // 3. Group by credit (conteo de cuotas vencidas + capital del crédito,
    //    ya traído en el JOIN para evitar un SELECT por crédito dentro del loop).
    const moraPorCredito: Record<number, number> = {};
    const capitalPorCredito = new Map<number, string>();
    for (const cuota of cuotasVencidas) {
      moraPorCredito[cuota.credito_id] = (moraPorCredito[cuota.credito_id] ?? 0) + 1;
      capitalPorCredito.set(cuota.credito_id, cuota.capital);
    }

    console.log("[DEBUG] Grouping overdue installments by credit:", moraPorCredito);

    // 4. Cargar moras activas existentes para comparar (UPSERT real)
    const morasActivas = await db
      .select({
        mora_id: moras_credito.mora_id,
        credito_id: moras_credito.credito_id,
        monto_mora: moras_credito.monto_mora,
        cuotas_atrasadas: moras_credito.cuotas_atrasadas,
        porcentaje_mora: moras_credito.porcentaje_mora,
      })
      .from(moras_credito)
      .where(eq(moras_credito.activa, true));

    const morasActivasPorCredito = new Map<number, typeof morasActivas[number]>();
    for (const m of morasActivas) {
      morasActivasPorCredito.set(m.credito_id, m);
    }

    let creadas = 0;
    let recalculadas = 0;
    let sinCambios = 0;
    let desactivadas = 0;
    let sinCapital = 0;

    // 5. Procesar créditos CON cuotas vencidas → crear o recalcular
    for (const [creditoIdStr, cuotasAtrasadas] of Object.entries(moraPorCredito)) {
      const creditoId = Number(creditoIdStr);

      const capitalStr = capitalPorCredito.get(creditoId);
      if (capitalStr === undefined) {
        console.log(`[WARN] Credit ${creditoId} not found`);
        continue;
      }

      const capital = new Big(capitalStr);

      // Sin capital no aplica mora. Si tenía una mora activa, se le quita (desactiva).
      if (capital.lte(0)) {
        sinCapital++;
        const moraPrevia = morasActivasPorCredito.get(creditoId);
        if (moraPrevia) {
          await db
            .update(moras_credito)
            .set({ monto_mora: "0", cuotas_atrasadas: 0, activa: false, updated_at: new Date() })
            .where(eq(moras_credito.mora_id, moraPrevia.mora_id));

          // Solo bajar a ACTIVO si seguía MOROSO — preservar EN_CONVENIO, CAIDO, etc.
          await db
            .update(creditos)
            .set({ statusCredit: "ACTIVO" })
            .where(
              and(
                eq(creditos.credito_id, creditoId),
                eq(creditos.statusCredit, "MOROSO")
              )
            );

          await registrarHistorialMora({
            credito_id: creditoId,
            mora_id: moraPrevia.mora_id,
            tipo_evento: "DESACTIVACION",
            origen: "PROCESO_AUTO",
            monto_anterior: moraPrevia.monto_mora,
            monto_nuevo: "0",
            cuotas_atrasadas_anterior: moraPrevia.cuotas_atrasadas,
            cuotas_atrasadas_nuevas: 0,
            porcentaje_mora: moraPrevia.porcentaje_mora,
            motivo: "Crédito sin capital — no aplica mora",
          });
        }
        console.log(`[SKIP] Credit #${creditoId} sin capital (${capitalStr}) — mora quitada`);
        continue;
      }

      const porcentaje = new Big("0.0112");
      const moraNueva = capital.times(porcentaje).times(cuotasAtrasadas);
      const moraNuevaStr = moraNueva.toFixed(2);

      const moraActual = morasActivasPorCredito.get(creditoId);

      if (!moraActual) {
        // CREACION
        let insertada;
        try {
          [insertada] = await db
            .insert(moras_credito)
            .values({
              credito_id: creditoId,
              monto_mora: moraNuevaStr,
              cuotas_atrasadas: cuotasAtrasadas,
              activa: true,
              porcentaje_mora: "1.12",
            })
            .returning();
        } catch (e: any) {
          // Índice único parcial moras_credito_uq_activa: otra corrida concurrente
          // ya creó la mora activa de este crédito → omitir (no duplicar).
          if (e?.code === "23505") {
            console.log(`[SKIP] Credit #${creditoId} mora ya creada por otra instancia (índice único)`);
            continue;
          }
          throw e;
        }

        await db
          .update(creditos)
          .set({ statusCredit: "MOROSO" })
          .where(eq(creditos.credito_id, creditoId));

        await registrarHistorialMora({
          credito_id: creditoId,
          mora_id: insertada.mora_id,
          tipo_evento: "CREACION",
          origen: "PROCESO_AUTO",
          monto_anterior: "0",
          monto_nuevo: moraNuevaStr,
          cuotas_atrasadas_anterior: 0,
          cuotas_atrasadas_nuevas: cuotasAtrasadas,
          capital_credito: capitalStr,
          porcentaje_mora: insertada.porcentaje_mora,
        });

        creadas++;
        console.log(`[CREATE] Credit #${creditoId} → mora Q${moraNuevaStr} (${cuotasAtrasadas} cuotas)`);
      } else {
        const cambioMonto = new Big(moraActual.monto_mora).cmp(moraNuevaStr) !== 0;
        const cambioCuotas = moraActual.cuotas_atrasadas !== cuotasAtrasadas;

        if (!cambioMonto && !cambioCuotas) {
          sinCambios++;
          continue;
        }

        // RECALCULO
        await db
          .update(moras_credito)
          .set({
            monto_mora: moraNuevaStr,
            cuotas_atrasadas: cuotasAtrasadas,
            updated_at: new Date(),
          })
          .where(eq(moras_credito.mora_id, moraActual.mora_id));

        await db
          .update(creditos)
          .set({ statusCredit: "MOROSO" })
          .where(eq(creditos.credito_id, creditoId));

        await registrarHistorialMora({
          credito_id: creditoId,
          mora_id: moraActual.mora_id,
          tipo_evento: "RECALCULO",
          origen: "PROCESO_AUTO",
          monto_anterior: moraActual.monto_mora,
          monto_nuevo: moraNuevaStr,
          cuotas_atrasadas_anterior: moraActual.cuotas_atrasadas,
          cuotas_atrasadas_nuevas: cuotasAtrasadas,
          capital_credito: capitalStr,
          porcentaje_mora: moraActual.porcentaje_mora,
        });

        recalculadas++;
        console.log(`[UPDATE] Credit #${creditoId} → mora Q${moraActual.monto_mora} → Q${moraNuevaStr}`);
      }
    }

    // 6. Procesar créditos que tenían mora activa pero YA NO tienen cuotas vencidas
    //    → se pusieron al día: desactivar mora y bajar status a ACTIVO
    for (const mora of morasActivas) {
      if (moraPorCredito[mora.credito_id]) continue; // sigue moroso, ya procesado

      await db
        .update(moras_credito)
        .set({
          monto_mora: "0",
          cuotas_atrasadas: 0,
          activa: false,
          updated_at: new Date(),
        })
        .where(eq(moras_credito.mora_id, mora.mora_id));

      // Solo bajar a ACTIVO si seguía MOROSO — preservar EN_CONVENIO, CAIDO, etc.
      await db
        .update(creditos)
        .set({ statusCredit: "ACTIVO" })
        .where(
          and(
            eq(creditos.credito_id, mora.credito_id),
            eq(creditos.statusCredit, "MOROSO")
          )
        );

      await registrarHistorialMora({
        credito_id: mora.credito_id,
        mora_id: mora.mora_id,
        tipo_evento: "DESACTIVACION",
        origen: "PROCESO_AUTO",
        monto_anterior: mora.monto_mora,
        monto_nuevo: "0",
        cuotas_atrasadas_anterior: mora.cuotas_atrasadas,
        cuotas_atrasadas_nuevas: 0,
        porcentaje_mora: mora.porcentaje_mora,
        motivo: "Crédito se puso al día (sin cuotas vencidas)",
      });

      desactivadas++;
      console.log(`[DEACTIVATE] Credit #${mora.credito_id} se puso al día → mora desactivada`);
    }

    // ============================================================
    // 🪣 MOTOR DE BUCKETS (COBROS-02) — registrar transiciones de bucket
    // ============================================================
    // Paso ADITIVO: no toca el cálculo de mora. Detecta cambios de bucket
    // (derivado de estado + cuotas) y los registra en `buckets_historial`.
    // Si algo falla aquí, NO debe romper el proceso de mora (operación crítica).
    // Se devuelve en el resultado del job (útil para pruebas vía POST /moras/procesar).
    const bucketsResumen = {
      iniciales: 0,
      subidas: 0,
      bajadas: 0,
      reasignados: 0,
      sinPoolDestino: 0,
    };
    try {
      // Catálogo de buckets (config dinámica: nombres/rangos/estados). ~6 filas.
      const catalogoBuckets: BucketCatalogo[] = await db
        .select({
          numero: buckets.numero,
          cuotas_min: buckets.cuotas_min,
          cuotas_max: buckets.cuotas_max,
          estados_incluidos: buckets.estados_incluidos,
        })
        .from(buckets)
        .where(eq(buckets.activo, true))
        .orderBy(buckets.orden);

      if (catalogoBuckets.length === 0) {
        console.warn(
          `[BUCKETS] ⚠️ Catálogo \`${CARTERA_SCHEMA}.buckets\` vacío (¿migración/seed sin aplicar?) — se omite el registro de transiciones.`,
        );
      } else {
      // status y asesor por crédito — ya vienen en `cuotas` (el job los cargó con JOIN)
      const statusPorCredito = new Map<number, string>();
      const asesorPorCredito = new Map<number, number>();
      for (const c of cuotas) {
        if (!statusPorCredito.has(c.credito_id)) {
          statusPorCredito.set(c.credito_id, c.statusCredit);
          asesorPorCredito.set(c.credito_id, c.asesor_id);
        }
      }

      // Último bucket registrado por crédito (para detectar el cambio).
      const ultimoBucket = new Map<number, number>();
      const ultimosRes = await lockConn.query(
        `SELECT DISTINCT ON (credito_id) credito_id, bucket_nuevo
           FROM ${CARTERA_SCHEMA}.buckets_historial
          ORDER BY credito_id, fecha DESC, historial_id DESC`,
      );
      for (const row of ultimosRes.rows) {
        ultimoBucket.set(Number(row.credito_id), Number(row.bucket_nuevo));
      }

      // 🎯 FASE 3 — pool de elegibles por bucket (asesor_bucket). Si está vacío
      // (script 01 sin correr en este ambiente), el motor sigue registrando
      // transiciones pero NO reasigna: cada crédito conserva su asesor.
      const poolPorBucket = new Map<number, number[]>();
      const poolRows = await db
        .select({ asesor_id: asesor_bucket.asesor_id, bucket: asesor_bucket.bucket })
        .from(asesor_bucket)
        .where(eq(asesor_bucket.activo, true))
        .orderBy(asesor_bucket.bucket, asesor_bucket.asesor_id);
      for (const r of poolRows) {
        const lista = poolPorBucket.get(r.bucket) ?? [];
        lista.push(r.asesor_id);
        poolPorBucket.set(r.bucket, lista);
      }

      // Carga = créditos que cada asesor del pool lleva HOY en cada bucket
      // (según el último bucket registrado). Se mantiene VIVA durante el loop
      // para que varias transiciones al mismo bucket en una misma corrida se
      // repartan parejo entre N asesores (asignación equitativa).
      const cargaPorBucket = new Map<number, Map<number, number>>();
      const ajustarCarga = (
        bucket: number | undefined,
        asesor: number | null | undefined,
        delta: number,
      ) => {
        if (bucket === undefined || asesor == null) return;
        if (!poolPorBucket.get(bucket)?.includes(asesor)) return; // solo cuenta el pool
        let porAsesor = cargaPorBucket.get(bucket);
        if (!porAsesor) {
          porAsesor = new Map();
          cargaPorBucket.set(bucket, porAsesor);
        }
        porAsesor.set(asesor, Math.max(0, (porAsesor.get(asesor) ?? 0) + delta));
      };
      for (const [creditoId] of statusPorCredito) {
        ajustarCarga(ultimoBucket.get(creditoId), asesorPorCredito.get(creditoId), 1);
      }

      let bucketsSubidas = 0;
      let bucketsBajadas = 0;
      let bucketsReasignados = 0;
      let bucketsSinPoolDestino = 0;
      // Las líneas base se acumulan y se insertan en LOTE al final (la 1a
      // corrida siembra ~todos los créditos del funnel: fila por fila serían
      // miles de INSERTs secuenciales dentro del job).
      const filasIniciales: (typeof buckets_historial.$inferInsert)[] = [];

      for (const [creditoId, status] of statusPorCredito) {
        const cuotasAtrasadas = moraPorCredito[creditoId] ?? 0;
        const bucketNuevo = bucketDeCredito(status, cuotasAtrasadas, catalogoBuckets);
        if (bucketNuevo === null) continue; // fuera del funnel operativo

        // Primera vez que vemos el crédito → sembrar la LÍNEA BASE (incluye B0).
        // `INICIAL` marca el punto de partida real; la salud la dice bucket_nuevo.
        if (!ultimoBucket.has(creditoId)) {
          filasIniciales.push({
            credito_id: creditoId,
            bucket_anterior: null,
            bucket_nuevo: bucketNuevo,
            tipo_evento: "INICIAL",
            origen: "PROCESO_AUTO",
            cuotas_atrasadas_nuevas: cuotasAtrasadas,
            status_credito: status,
            asesor_id: null,
            pago_id: null,
            motivo: "Línea base — primer registro en el motor de buckets",
          });
          ultimoBucket.set(creditoId, bucketNuevo);
          // La línea base NO reasigna (eso lo hace la carga inicial SQL);
          // solo se registra la carga para que el reparto posterior sea justo.
          ajustarCarga(bucketNuevo, asesorPorCredito.get(creditoId), 1);
          continue;
        }

        const bucketAnterior = ultimoBucket.get(creditoId) ?? 0;
        if (bucketNuevo === bucketAnterior) continue; // sin cambio de bucket

        const esSubida = bucketNuevo > bucketAnterior;

        // Atribución (Opción B): en la BAJADA (cuenta curada) trazamos el pago
        // que la mejoró (best-effort: último pago validado del crédito). El
        // `asesor_id` se llenará cuando el NUEVO flujo de pago capture al asesor
        // de forma estructurada (hoy pagos_credito.registerBy es texto libre).
        let pagoId: number | null = null;
        if (!esSubida) {
          const [pago] = await db
            .select({ pago_id: pagos_credito.pago_id })
            .from(pagos_credito)
            .where(
              and(
                eq(pagos_credito.credito_id, creditoId),
                eq(pagos_credito.paymentFalse, false),
                inArray(pagos_credito.validationStatus, [
                  "validated",
                  "no_required",
                ]),
              ),
            )
            .orderBy(desc(pagos_credito.pago_id))
            .limit(1);
          pagoId = pago?.pago_id ?? null;
        }

        await db.insert(buckets_historial).values({
          credito_id: creditoId,
          bucket_anterior: bucketAnterior,
          bucket_nuevo: bucketNuevo,
          tipo_evento: esSubida ? "SUBIDA" : "BAJADA",
          origen: "PROCESO_AUTO",
          cuotas_atrasadas_nuevas: cuotasAtrasadas,
          status_credito: status,
          asesor_id: null, // Opción B: se llena con el nuevo flujo de pago
          pago_id: pagoId,
        });

        // 🎯 FASE 3 — reasignación automática: el crédito cambió de bucket →
        // si su asesor actual NO es elegible en el destino, pasa al elegible
        // con menor carga (1 asesor = directo; N = equitativo). El UPDATE toca
        // ÚNICAMENTE creditos.asesor_id (decisión de raíz) + bitácora
        // OBLIGATORIA en credito_asesor_historial, ambos en una transacción.
        const asesorActual = asesorPorCredito.get(creditoId) ?? null;
        const asesorElegido = elegirAsesorParaBucket(
          poolPorBucket.get(bucketNuevo) ?? [],
          cargaPorBucket.get(bucketNuevo),
          asesorActual,
        );
        if (asesorElegido !== null && asesorElegido !== asesorActual) {
          await db.transaction(async (tx) => {
            await tx.insert(credito_asesor_historial).values({
              credito_id: creditoId,
              asesor_anterior: asesorActual,
              asesor_nuevo: asesorElegido,
              bucket: bucketNuevo,
              origen: "PROCESO_AUTO",
              motivo: `Reasignación automática por cambio de bucket B${bucketAnterior}→B${bucketNuevo}`,
              usuario_id: null,
            });
            await tx
              .update(creditos)
              .set({ asesor_id: asesorElegido })
              .where(eq(creditos.credito_id, creditoId));
          });
          asesorPorCredito.set(creditoId, asesorElegido);
          bucketsReasignados++;
        } else if (asesorElegido === null) {
          bucketsSinPoolDestino++;
        }
        // Carga: el crédito sale del bucket anterior y entra al nuevo con su
        // asesor final (el elegido, o el actual si se quedó).
        ajustarCarga(bucketAnterior, asesorActual, -1);
        ajustarCarga(bucketNuevo, asesorPorCredito.get(creditoId), 1);

        ultimoBucket.set(creditoId, bucketNuevo);
        if (esSubida) bucketsSubidas++;
        else bucketsBajadas++;
      }

      // Siembra en LOTE (chunks). onConflictDoNothing se apoya en el unique
      // parcial buckets_historial_uq_inicial: si otra réplica sembró el mismo
      // crédito en paralelo, la fila duplicada se descarta sin reventar el lote.
      const CHUNK_INICIALES = 500;
      for (let i = 0; i < filasIniciales.length; i += CHUNK_INICIALES) {
        await db
          .insert(buckets_historial)
          .values(filasIniciales.slice(i, i + CHUNK_INICIALES))
          .onConflictDoNothing();
      }

      bucketsResumen.iniciales = filasIniciales.length;
      bucketsResumen.subidas = bucketsSubidas;
      bucketsResumen.bajadas = bucketsBajadas;
      bucketsResumen.reasignados = bucketsReasignados;
      bucketsResumen.sinPoolDestino = bucketsSinPoolDestino;

      console.log(
        `[BUCKETS] Registros — iniciales: ${filasIniciales.length}, subidas: ${bucketsSubidas}, bajadas: ${bucketsBajadas}, reasignados: ${bucketsReasignados}${bucketsSinPoolDestino > 0 ? ` ⚠️ sin pool destino: ${bucketsSinPoolDestino}` : ""}`,
      );
      } // fin else (catálogo no vacío)
    } catch (bucketErr) {
      console.error(
        "[BUCKETS] ⚠️ Error registrando transiciones de bucket (el proceso de mora no se ve afectado):",
        bucketErr,
      );
    }

    console.log("\n╔════════════════════════════════════════════════════════════");
    console.log(`║ [JOB] ✅ FINISHED MORA PROCESSING`);
    console.log(`║   Creadas: ${creadas}`);
    console.log(`║   Recalculadas: ${recalculadas}`);
    console.log(`║   Sin cambios: ${sinCambios}`);
    console.log(`║   Desactivadas: ${desactivadas}`);
    console.log(`║   Sin capital (omitidas): ${sinCapital}`);
    console.log("╚════════════════════════════════════════════════════════════\n");

    return { creadas, recalculadas, sinCambios, desactivadas, sinCapital, buckets: bucketsResumen };

  } catch (error: any) {
    console.error("\n╔════════════════════════════════════════════════════════════");
    console.error("║ [ERROR] ❌ FAILED TO PROCESS MORAS");
    console.error("╚════════════════════════════════════════════════════════════");
    console.error("[ERROR] Message:", error.message);
    console.error("[ERROR] Stack trace:", error.stack);
    throw error;
  } finally {
    if (lockHeld) {
      try {
        await lockConn.query("SELECT pg_advisory_unlock($1)", [PROCESAR_MORAS_LOCK_KEY]);
      } catch {
        /* el lock se libera solo al cerrar la sesión; no es crítico */
      }
    }
    lockConn.release();
  }
}


/**
 * Condonar mora de un crédito:
 * 1. Look up user_id by email.
 * 2. Set mora monto = 0, activa = false.
 * 3. Set credit status = ACTIVO.
 * 4. Insert record into moras_condonaciones for audit/history.
 */
export async function condonarMora({
  credito_id,
  motivo,
  usuario_email,
}: {
  credito_id: number;
  motivo: string;
  usuario_email: string;
}) {
  try {
    // 1. Buscar el usuario por email
    const [user] = await db
      .select({ id: platform_users.id })
      .from(platform_users)
      .where(eq(platform_users.email, usuario_email));

    if (!user) {
      return { success: false, message: "[ERROR] Usuario no encontrado" };
    }

    // 2-5. Toda la operación en una sola transacción con row lock para evitar
    //      condonaciones duplicadas si dos requests llegan en paralelo.
    const result = await db.transaction(async (tx) => {
      const [moraActual] = await tx
        .select({
          id: moras_credito.mora_id,
          monto: moras_credito.monto_mora,
        })
        .from(moras_credito)
        .where(and(
          eq(moras_credito.credito_id, credito_id),
          eq(moras_credito.activa, true),
        ))
        .orderBy(desc(moras_credito.created_at))
        .limit(1)
        .for("update");

      if (!moraActual) {
        return { kind: "not_found" as const };
      }

      const monto = moraActual.monto ?? "0";
      console.log(`[INFO] Current mora amount for credit #${credito_id}: ${monto}`);
      console.log(`[INFO] Condonation reason: ${motivo}`);

      // Re-check activa=true en el UPDATE como defensa extra: si dos tx
      // pasaran el SELECT FOR UPDATE en algún edge case raro, solo la primera
      // afectará filas y la segunda saldrá vacía.
      const [updatedMora] = await tx
        .update(moras_credito)
        .set({ monto_mora: "0", activa: false, updated_at: new Date() })
        .where(and(
          eq(moras_credito.mora_id, moraActual.id),
          eq(moras_credito.activa, true),
        ))
        .returning();

      if (!updatedMora) {
        return { kind: "not_found" as const };
      }

      await tx
        .update(creditos)
        .set({ statusCredit: "ACTIVO" })
        .where(eq(creditos.credito_id, credito_id));

      const [condonacion] = await tx
        .insert(moras_condonaciones)
        .values({
          credito_id,
          mora_id: moraActual.id,
          motivo,
          usuario_id: user.id,
          montoCondonacion: monto,
        })
        .returning();

      return { kind: "ok" as const, moraId: moraActual.id, monto, updatedMora, condonacion };
    });

    if (result.kind === "not_found") {
      return { success: false, message: "[ERROR] No hay mora activa para este crédito" };
    }

    await registrarHistorialMora({
      credito_id,
      mora_id: result.moraId,
      tipo_evento: "CONDONACION",
      origen: "CONDONACION_INDIVIDUAL",
      monto_anterior: result.monto,
      monto_nuevo: "0",
      usuario_id: user.id,
      motivo,
    });

    return {
      success: true,
      message: `[SUCCESS] Mora condonada para crédito #${credito_id}`,
      mora: result.updatedMora,
      condonacion: result.condonacion,
    };
  } catch (error) {
    return {
      success: false,
      message: "[ERROR] No se pudo condonar la mora",
      error: String(error),
    };
  }
}
 

/**
 * Obtener créditos con información de mora.
 * 
 * Filtros disponibles:
 * - numero_credito_sifco
 * - cuotas_atrasadas (ej: > 2)
 * - estado (ACTIVO, MOROSO, etc.)
 * 
 * Si excel=true, exporta a Excel y sube a R2.
 */
export async function getCreditosWithMoras({
  numero_credito_sifco,
  cuotas_atrasadas,
  estado,
  excel,
}: {
  numero_credito_sifco?: string;
  cuotas_atrasadas?: number;
  estado?: "ACTIVO" | "CANCELADO" | "INCOBRABLE" | "PENDIENTE_CANCELACION" | "MOROSO";
  excel?: boolean;
}) {
  // 1️⃣ Build query base
  let whereClauses: any[] = [];

  if (numero_credito_sifco) {
    whereClauses.push(eq(creditos.numero_credito_sifco, numero_credito_sifco));
  }
  if (estado) {
    whereClauses.push(eq(creditos.statusCredit, estado));
  }
  if (cuotas_atrasadas !== undefined) {
    whereClauses.push(gte(moras_credito.cuotas_atrasadas, cuotas_atrasadas));
  }
  whereClauses.push(eq(moras_credito.activa, true)); // Solo moras activas
  const query = db
    .select({
      credito_id: creditos.credito_id,
      numero_credito_sifco: creditos.numero_credito_sifco,
      capital: creditos.capital,
      cuota: creditos.cuota,
      plazo: creditos.plazo,
      estado: creditos.statusCredit,
      fecha_creacion: creditos.fecha_creacion,
      observaciones: creditos.observaciones,
      usuario: usuarios.nombre,
      usuario_nit: usuarios.nit,
      usuario_categoria: usuarios.categoria,
      asesor: asesores.nombre,
      monto_mora: moras_credito.monto_mora,
      cuotas_atrasadas: moras_credito.cuotas_atrasadas,
      mora_activa: moras_credito.activa, 
    })
    .from(creditos)
    .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
    .innerJoin(asesores, eq(creditos.asesor_id, asesores.asesor_id))
    .leftJoin(moras_credito, eq(moras_credito.credito_id, creditos.credito_id))
    .where(whereClauses.length > 0 ? and(...whereClauses) : undefined);

  const data = await query;

  if (!excel) {
    return {
      success: true,
      count: data.length,
      data,
    };
  }

  // 2️⃣ Generar Excel
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("CreditosMora");

  sheet.columns = [
    { header: "Crédito ID", key: "credito_id", width: 12 },
    { header: "Número SIFCO", key: "numero_credito_sifco", width: 20 },
    { header: "Estado", key: "estado", width: 15 },
    { header: "Capital", key: "capital", width: 15 },
    { header: "Cuota", key: "cuota", width: 15 },
    { header: "Plazo", key: "plazo", width: 10 },
    { header: "Usuario", key: "usuario", width: 25 },
    { header: "NIT", key: "usuario_nit", width: 20 },
    { header: "Categoría", key: "usuario_categoria", width: 15 },
    { header: "Asesor", key: "asesor", width: 20 },
    { header: "Fecha Creación", key: "fecha_creacion", width: 20 },
    { header: "Observaciones", key: "observaciones", width: 40 },
    { header: "Monto Mora", key: "monto_mora", width: 15 },
    { header: "Cuotas Atrasadas", key: "cuotas_atrasadas", width: 18 },
    { header: "Mora Activa", key: "mora_activa", width: 12 },
  ];

  data.forEach((row) => {
    sheet.addRow(row);
  });

  // 3️⃣ Subir a R2
  const filename = `reportes/creditos_moras_${Date.now()}.xlsx`;
  const s3 = new S3Client({
    endpoint: process.env.BUCKET_REPORTS_URL,
    region: "auto",
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
    },
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const uint8Array = new Uint8Array(buffer);

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.BUCKET_REPORTS,
      Key: filename,
      Body: uint8Array,
      ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
  );

  const url = `${process.env.URL_PUBLIC_R2_REPORTS}/${filename}`;

  return {
    success: true,
    excelUrl: url,
    count: data.length,
  };
}
/**
 * Get mora condonations (history of condonations).
 *
 * Filters:
 * - numero_credito_sifco (string)
 * - usuario_email (string)
 * - fecha_desde / fecha_hasta (rango de fechas)
 *
 * If excel=true, export to Excel and upload to R2.
 */
export async function getCondonacionesMora({
  numero_credito_sifco,
  usuario_email,
  fecha_desde,
  fecha_hasta,
  excel,
}: {
  numero_credito_sifco?: string;
  usuario_email?: string;
  fecha_desde?: Date;
  fecha_hasta?: Date;
  excel?: boolean;
}) {
  // 1️⃣ Build filters
  const whereClauses: any[] = [];

  if (numero_credito_sifco) {
    whereClauses.push(eq(creditos.numero_credito_sifco, numero_credito_sifco));
  }
  if (usuario_email) {
    whereClauses.push(eq(platform_users.email, usuario_email));
  }
    if (fecha_desde && fecha_hasta) {
    whereClauses.push(
      and(
        gte(moras_condonaciones.fecha, fecha_desde),
        lte(moras_condonaciones.fecha, fecha_hasta)
      )
    );
  }

  // 2️⃣ Query con joins
  const query = db
    .select({
      condonacion_id: moras_condonaciones.condonacion_id,
      credito_id: creditos.credito_id,
      numero_credito_sifco: creditos.numero_credito_sifco,
      estado_credito: creditos.statusCredit,
      capital: creditos.capital,
      usuario: usuarios.nombre,
      asesor: asesores.nombre,
      motivo: moras_condonaciones.motivo,
      fecha: moras_condonaciones.fecha,
      usuario_email: platform_users.email,
      montoCondonacion: moras_condonaciones.montoCondonacion,
    })
    .from(moras_condonaciones)
    .innerJoin(creditos, eq(moras_condonaciones.credito_id, creditos.credito_id))
    .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
    .innerJoin(asesores, eq(creditos.asesor_id, asesores.asesor_id))
    .innerJoin(platform_users, eq(moras_condonaciones.usuario_id, platform_users.id))
    .where(whereClauses.length > 0 ? and(...whereClauses) : undefined);
console.log(query)
  const data = await query;
    console.log("[DEBUG] Condonations found:", data);
  if (!excel) {
    return {
      success: true,
      count: data.length,
      data,
    };
  }

  // 3️⃣ Crear Excel
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Condonaciones");

  sheet.columns = [
    { header: "Condonación ID", key: "condonacion_id", width: 12 },
    { header: "Crédito ID", key: "credito_id", width: 12 },
    { header: "Número SIFCO", key: "numero_credito_sifco", width: 20 },
    { header: "Estado Crédito", key: "estado_credito", width: 18 },
    { header: "Capital", key: "capital", width: 15 },
    { header: "Usuario Cliente", key: "usuario", width: 25 },
    { header: "Asesor", key: "asesor", width: 25 },
    { header: "Motivo", key: "motivo", width: 40 },
    { header: "Fecha", key: "fecha", width: 20 },
    { header: "Usuario que condonó", key: "usuario_email", width: 30 },
  ];

  data.forEach((row) => {
    sheet.addRow(row);
  });

  // 4️⃣ Subir a R2
  const filename = `reportes/condonaciones_mora_${Date.now()}.xlsx`;
  const s3 = new S3Client({
    endpoint: process.env.BUCKET_REPORTS_URL,
    region: "auto",
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
    },
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const uint8Array = new Uint8Array(buffer);

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.BUCKET_REPORTS,
      Key: filename,
      Body: uint8Array,
      ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
  );

  const url = `${process.env.URL_PUBLIC_R2_REPORTS}/${filename}`;

  return {
    success: true,
    excelUrl: url,
    count: data.length,
  };
}


export async function condonarTodasLasMoras({
  motivo,
  usuario_email,
}: {
  motivo: string;
  usuario_email: string;
}) {
  try {
    // 1. Buscar el usuario por email
    const [user] = await db
      .select({ id: platform_users.id })
      .from(platform_users)
      .where(eq(platform_users.email, usuario_email));

    if (!user) {
      return { success: false, message: "[ERROR] Usuario no encontrado" };
    }

    // 2. Obtener todos los créditos MOROSOS con sus moras activas
    const creditosMorosos = await db
      .select({
        credito_id: creditos.credito_id,
        mora_id: moras_credito.mora_id,
        monto_mora: moras_credito.monto_mora,
      })
      .from(creditos)
      .leftJoin(
        moras_credito,
        and(
          eq(creditos.credito_id, moras_credito.credito_id),
          eq(moras_credito.activa, true)
        )
      )
      .where(eq(creditos.statusCredit, "MOROSO"));
      console.log(`[INFO] Found ${creditosMorosos.length} morose credits to condone`);

    if (creditosMorosos.length === 0) {
      return {
        success: true,
        message: "[INFO] No hay créditos morosos para condonar",
        condonados: 0,
      };
    }

    // 3. Actualizar todas las moras a 0 (mantener activas y estado MOROSO)
    const moraIds = creditosMorosos.map((c) => c.mora_id).filter((id): id is number => id !== null);
    await db
      .update(moras_credito)
      .set({
        monto_mora: "0",
        updated_at: new Date(),
      })
      .where(inArray(moras_credito.mora_id, moraIds));

    

    // 5. Insertar registros masivos en moras_condonaciones
    const condonacionesData = creditosMorosos
      .filter((credito) => credito.mora_id !== null)
      .map((credito) => ({
        credito_id: credito.credito_id,
        mora_id: credito.mora_id as number,
        motivo,
        usuario_id: user.id,
        montoCondonacion: credito.monto_mora ??"0",
      }));

    const condonaciones = await db
      .insert(moras_condonaciones)
      .values(condonacionesData)
      .returning();

    // Registrar histórico para cada condonación masiva
    await Promise.all(
      creditosMorosos
        .filter((c) => c.mora_id !== null)
        .map((c) =>
          registrarHistorialMora({
            credito_id: c.credito_id,
            mora_id: c.mora_id as number,
            tipo_evento: "CONDONACION",
            origen: "CONDONACION_MASIVA",
            monto_anterior: c.monto_mora ?? "0",
            monto_nuevo: "0",
            usuario_id: user.id,
            motivo,
          })
        )
    );

    return {
      success: true,
      message: `[SUCCESS] Se condonaron ${creditosMorosos.length} moras`,
      condonados: creditosMorosos.length,
      creditos_afectados: creditosMorosos.length,
      condonaciones,
    };
  } catch (error) {
    return {
      success: false,
      message: "[ERROR] No se pudieron condonar las moras masivamente",
      error: String(error),
    };
  }
}
