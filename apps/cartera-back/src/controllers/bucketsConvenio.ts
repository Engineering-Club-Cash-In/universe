import { and, eq, inArray, sql } from "drizzle-orm";
import { toZonedTime } from "date-fns-tz";
import { client, db } from "../database";
import {
  asesor_bucket,
  buckets_historial,
  CARTERA_SCHEMA,
  convenio_cuotas,
  convenios_pago,
  credito_asesor_historial,
  creditos,
  cuotas_credito,
  SQL_CARTERA_SCHEMA,
} from "../database/db/schema";
import {
  type BucketCatalogo,
  elegirAsesorParaBucket,
  getBucketsCatalogoConEstado,
} from "./latefee";

// ============================================================
// 🪣 MOTOR DE BUCKETS PARA CONVENIOS (COBROS-02)
// ============================================================
// El motor de mora (`procesarMoras`/`latefee.ts`) EXCLUYE EN_CONVENIO
// (STATUS_EXCLUIDOS_MORA / STATUS_BUCKET_FUERA): no les genera mora, no cambia
// estado y NO les escribe transición de bucket. Y las cargas iniciales SQL
// (drizzle/cobros-02/asignacion/02 y 03) también los EXCLUYEN → hoy los
// EN_CONVENIO quedaron fuera de bucket Y sin asesor por bucket.
//
// En COBROS-02 todo crédito debe estar en un bucket (salvo completado/caído),
// porque a los EN_CONVENIO también alguien les da seguimiento. Este job es el
// DUEÑO de las transiciones de bucket de esos créditos — corre APARTE de
// procesarMoras (otro horario, otro advisory lock) y nunca lo pisa: procesarMoras
// escribe TODOS los demás estados, este SOLO EN_CONVENIO. No se solapan.
//
// Modelo (decidido con negocio, verificado contra la pantalla de pago):
//   - En convenio el cliente debe pagar AMBAS cosas cada mes: la cuota NORMAL del
//     crédito (cuotas_credito) Y la cuota del CONVENIO (convenio_cuotas). El pago
//     del convenio marca `convenio_cuotas.fecha_pago` pero NO toca cuotas_credito,
//     así que hay que mirar las DOS fuentes o se sobre/sub-cuenta el atraso.
//   - El bucket = MESES ATRASADOS = cantidad de fechas de vencimiento distintas,
//     pasadas, con algo impago, uniendo:
//       (A) cuotas_credito vencidas e impagas que NO entraron al convenio
//           (se EXCLUYEN las de `convenios_pago.cuotas_convenio` — esas "born-overdue"
//            ya viven como cuotas del convenio, contarlas de nuevo sería doble), y
//       (B) convenio_cuotas vencidas e impagas (fecha_pago IS NULL).
//     Se unen por fecha (el convenio le presta las fechas a las cuotas → normal y
//     convenio del mismo mes vencen el mismo día): un mes atrasado = 1, aunque deba
//     ambas ("una cuota atrasada, no por 3"). Nivel por RANGO del catálogo (B1=1…).
//   - Sin días de gracia (igual que el job de mora).
//   - SÍ reasigna asesor al pool del bucket que le toca (mismo criterio que el
//     motor de mora), INCLUYENDO en la siembra INICIAL: estos créditos nunca
//     pasaron por la carga SQL de asesores, así que al entrar al funnel se asignan
//     al asesor del bucket con un UPDATE al crédito. NO genera mora, NO rompe el
//     convenio.

// Clave del advisory lock — adyacente a la de procesarMoras (728193), distinta
// para que ambos jobs puedan correr sin bloquearse entre sí.
const BUCKETS_CONVENIO_LOCK_KEY = 728194;

/**
 * ¿La fecha de vencimiento ya pasó HOY (hora Guatemala)? Mismo criterio de fecha
 * que `isOverdueInstallmentForMora` (latefee.ts). Se usa para las cuotas normales
 * (cuotas_credito) y para las del convenio (convenio_cuotas). El "impago" se
 * chequea afuera (cada fuente tiene su propia señal: pagado / fecha_pago).
 */
function estaVencidaGT(fecha_vencimiento: Date | string, hoy: Date): boolean {
  const zona = "America/Guatemala";
  const fechaVenc = toZonedTime(fecha_vencimiento, zona);
  fechaVenc.setHours(0, 0, 0, 0);

  const fechaHoy = toZonedTime(hoy, zona);
  fechaHoy.setHours(0, 0, 0, 0);

  return fechaVenc < fechaHoy;
}

/** Clave de mes para unir vencimientos: el mismo día → el mismo mes atrasado. */
function claveFecha(fecha_vencimiento: Date | string): string {
  const zona = "America/Guatemala";
  const d = toZonedTime(fecha_vencimiento, zona);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * Nivel de bucket por cantidad de cuotas atrasadas (SOLO la rama de rango del
 * catálogo). No se usa `bucketDeCredito` porque para EN_CONVENIO devuelve null
 * (está en STATUS_BUCKET_FUERA) — acá lo tratamos como dentro del funnel.
 */
function nivelPorCuotas(
  cuotasAtrasadas: number,
  catalogo: BucketCatalogo[],
): number | null {
  const n = Math.max(cuotasAtrasadas, 0);
  const fila = catalogo.find(
    (b) => n >= b.cuotas_min && (b.cuotas_max == null || n <= b.cuotas_max),
  );
  return fila ? fila.numero : null;
}

export type BucketsConvenioResultado = {
  skipped?: boolean;
  creditos: number;
  iniciales: number;
  subidas: number;
  bajadas: number;
  reasignados: number;
  sinPoolDestino: number;
  omitidoPorFallback?: boolean;
};

/**
 * Recorre los créditos EN_CONVENIO y registra su transición de bucket en
 * `buckets_historial` (INICIAL la 1ª vez — así se auto-siembra la carga inicial
 * de estos créditos que el motor de mora nunca sembró; SUBIDA/BAJADA después),
 * reasignando el asesor al pool del bucket que le toca (UPDATE a creditos.asesor_id
 * + bitácora en credito_asesor_historial), igual que el motor de mora.
 */
export async function procesarBucketsConvenio(): Promise<BucketsConvenioResultado> {
  const zona = "America/Guatemala";

  const lockConn = await client.connect();
  let lockHeld = false;
  try {
    const _lk = await lockConn.query(
      "SELECT pg_try_advisory_lock($1) AS ok",
      [BUCKETS_CONVENIO_LOCK_KEY],
    );
    lockHeld = _lk.rows[0]?.ok === true;
    if (!lockHeld) {
      console.log(
        "[BUCKETS-CONV] ⏭️ Otra instancia ya está procesando buckets de convenio; se omite.",
      );
      return {
        skipped: true,
        creditos: 0,
        iniciales: 0,
        subidas: 0,
        bajadas: 0,
        reasignados: 0,
        sinPoolDestino: 0,
      };
    }

    const hoy = toZonedTime(new Date(), zona);
    hoy.setHours(0, 0, 0, 0);

    // Catálogo dinámico. Si degrada a fallback (config inconsistente), NO se
    // persisten transiciones con rangos hardcoded — misma política que el motor
    // de mora (no contaminar la bitácora de negocio).
    const { catalogo, esFallback } = await getBucketsCatalogoConEstado();
    if (esFallback) {
      console.warn(
        `[BUCKETS-CONV] ⚠️ Catálogo \`${CARTERA_SCHEMA}.buckets\` inconsistente/inaccesible — se omite el registro de transiciones este ciclo.`,
      );
      return {
        creditos: 0,
        iniciales: 0,
        subidas: 0,
        bajadas: 0,
        reasignados: 0,
        sinPoolDestino: 0,
        omitidoPorFallback: true,
      };
    }
    if (catalogo.length === 0) {
      console.warn(
        `[BUCKETS-CONV] ⚠️ Catálogo \`${CARTERA_SCHEMA}.buckets\` vacío — se omite el registro de transiciones.`,
      );
      return {
        creditos: 0,
        iniciales: 0,
        subidas: 0,
        bajadas: 0,
        reasignados: 0,
        sinPoolDestino: 0,
      };
    }

    // 1. Cuotas de créditos EN_CONVENIO (mismo shape que procesarMoras: incluye
    //    hasPaidPayment para no contar como atrasada una cuota que ya tiene un
    //    pago real aplicado, y asesor_id para la reasignación). El atraso se
    //    resuelve en JS, idéntico al motor de mora.
    const cuotas = await db
      .select({
        cuota_id: cuotas_credito.cuota_id,
        credito_id: cuotas_credito.credito_id,
        fecha_vencimiento: cuotas_credito.fecha_vencimiento,
        pagado: cuotas_credito.pagado,
        asesor_id: creditos.asesor_id,
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

    if (cuotas.length === 0) {
      console.log("[BUCKETS-CONV] No hay créditos EN_CONVENIO — nada que hacer.");
      return {
        creditos: 0,
        iniciales: 0,
        subidas: 0,
        bajadas: 0,
        reasignados: 0,
        sinPoolDestino: 0,
      };
    }

    const creditoIds = [...new Set(cuotas.map((c) => c.credito_id))];
    const asesorPorCredito = new Map<number, number | null>();
    for (const c of cuotas) {
      if (!asesorPorCredito.has(c.credito_id)) {
        asesorPorCredito.set(c.credito_id, c.asesor_id);
      }
    }

    // 2. Cuotas EXCLUIDAS por crédito = union de `cuotas_convenio` de sus convenios
    //    NO completados (snapshot al crear). NULL/viejos sin backfill → sin exclusión.
    const convenios = await db
      .select({
        credito_id: convenios_pago.credito_id,
        cuotas_convenio: convenios_pago.cuotas_convenio,
      })
      .from(convenios_pago)
      .where(
        and(
          inArray(convenios_pago.credito_id, creditoIds),
          eq(convenios_pago.completado, false),
        ),
      );

    const excluidasPorCredito = new Map<number, Set<number>>();
    for (const cv of convenios) {
      if (!cv.cuotas_convenio || cv.cuotas_convenio.length === 0) continue;
      const set = excluidasPorCredito.get(cv.credito_id) ?? new Set<number>();
      for (const cid of cv.cuotas_convenio) set.add(cid);
      excluidasPorCredito.set(cv.credito_id, set);
    }

    // 3. MESES ATRASADOS por crédito = fechas de vencimiento distintas, pasadas,
    //    con algo impago, uniendo (A) cuota normal no-convenio + (B) cuota del convenio.
    const fechasAtrasadasPorCredito = new Map<number, Set<string>>();
    for (const id of creditoIds) fechasAtrasadasPorCredito.set(id, new Set<string>());

    // (A) cuota normal en curso: vencida, impaga y NO reestructurada por el convenio
    //     (las de cuotas_convenio ya viven como cuotas del convenio → serían doble).
    for (const cuota of cuotas) {
      const excluidas = excluidasPorCredito.get(cuota.credito_id);
      if (excluidas?.has(cuota.cuota_id)) continue;
      const impaga = cuota.pagado === false && cuota.hasPaidPayment !== true;
      if (impaga && estaVencidaGT(cuota.fecha_vencimiento, hoy)) {
        fechasAtrasadasPorCredito
          .get(cuota.credito_id)
          ?.add(claveFecha(cuota.fecha_vencimiento));
      }
    }

    // (B) cuota del convenio: vencida e impaga (fecha_pago IS NULL). El pago del
    //     convenio vive acá, no en cuotas_credito — por eso hay que mirar esta fuente.
    const cuotasDeConvenio = await db
      .select({
        credito_id: convenios_pago.credito_id,
        fecha_vencimiento: convenio_cuotas.fecha_vencimiento,
        fecha_pago: convenio_cuotas.fecha_pago,
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
        ),
      );
    for (const cc of cuotasDeConvenio) {
      if (cc.fecha_pago === null && estaVencidaGT(cc.fecha_vencimiento, hoy)) {
        fechasAtrasadasPorCredito
          .get(cc.credito_id)
          ?.add(claveFecha(cc.fecha_vencimiento));
      }
    }

    // Meses atrasados = tamaño de la unión de fechas (un día = un mes, no se duplica
    // aunque deba la normal y la del convenio ese mes).
    const mesesAtrasadosPorCredito = new Map<number, number>();
    for (const id of creditoIds) {
      mesesAtrasadosPorCredito.set(id, fechasAtrasadasPorCredito.get(id)?.size ?? 0);
    }

    // 4. Último bucket registrado por crédito (para detectar el cambio). Solo los
    //    de este lote (EN_CONVENIO); igual que el DISTINCT ON del motor de mora.
    const ultimoBucket = new Map<number, number>();
    const ultimosRes = await lockConn.query(
      `SELECT DISTINCT ON (credito_id) credito_id, bucket_nuevo
         FROM ${CARTERA_SCHEMA}.buckets_historial
        WHERE credito_id = ANY($1::int[])
        ORDER BY credito_id, fecha DESC, historial_id DESC`,
      [creditoIds],
    );
    for (const row of ultimosRes.rows) {
      ultimoBucket.set(Number(row.credito_id), Number(row.bucket_nuevo));
    }

    // 5. Pool de asesores elegibles por bucket (asesor_bucket). Si un bucket no
    //    tiene pool, el crédito conserva su asesor (se cuenta en sinPoolDestino,
    //    NO se revienta — a diferencia del guard del script SQL de carga).
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

    // Carga viva por bucket→asesor (se mantiene durante el loop para repartir
    // parejo varias asignaciones al mismo bucket). Solo cuenta asesores del pool.
    const cargaPorBucket = new Map<number, Map<number, number>>();
    const ajustarCarga = (
      bucket: number | undefined,
      asesor: number | null | undefined,
      delta: number,
    ) => {
      if (bucket === undefined || asesor == null) return;
      if (!poolPorBucket.get(bucket)?.includes(asesor)) return;
      let porAsesor = cargaPorBucket.get(bucket);
      if (!porAsesor) {
        porAsesor = new Map();
        cargaPorBucket.set(bucket, porAsesor);
      }
      porAsesor.set(asesor, Math.max(0, (porAsesor.get(asesor) ?? 0) + delta));
    };
    // Semilla de carga: los créditos que YA tienen bucket (re-corridas) cuentan
    // en su bucket actual con su asesor actual.
    for (const creditoId of creditoIds) {
      ajustarCarga(ultimoBucket.get(creditoId), asesorPorCredito.get(creditoId), 1);
    }

    let iniciales = 0;
    let subidas = 0;
    let bajadas = 0;
    let reasignados = 0;
    let sinPoolDestino = 0;
    // Las líneas base se insertan en LOTE (la 1ª corrida siembra todos los
    // EN_CONVENIO). onConflictDoNothing se apoya en buckets_historial_uq_inicial.
    const filasIniciales: (typeof buckets_historial.$inferInsert)[] = [];

    // Reasigna el crédito al pool del bucket destino (o lo deja si su asesor ya es
    // elegible / no hay pool). bucketAnterior=null en la línea base.
    const reasignar = async (
      creditoId: number,
      bucketNuevo: number,
      bucketAnterior: number | null,
    ) => {
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
            motivo:
              bucketAnterior === null
                ? `Asignación inicial por bucket B${bucketNuevo} — convenio entra al funnel (COBROS-02)`
                : `Reasignación automática por cambio de bucket B${bucketAnterior}→B${bucketNuevo} (convenio)`,
            usuario_id: null,
          });
          await tx
            .update(creditos)
            .set({ asesor_id: asesorElegido })
            .where(eq(creditos.credito_id, creditoId));
        });
        asesorPorCredito.set(creditoId, asesorElegido);
        reasignados++;
      } else if (asesorElegido === null) {
        sinPoolDestino++;
      }
      // Carga: sale del bucket anterior (si tenía) y entra al nuevo con su asesor final.
      if (bucketAnterior !== null) ajustarCarga(bucketAnterior, asesorActual, -1);
      ajustarCarga(bucketNuevo, asesorPorCredito.get(creditoId), 1);
    };

    for (const creditoId of creditoIds) {
      const cuotasAtrasadas = mesesAtrasadosPorCredito.get(creditoId) ?? 0;
      const bucketNuevo = nivelPorCuotas(cuotasAtrasadas, catalogo);
      if (bucketNuevo === null) continue; // sin nivel resoluble (no debería pasar)

      // Primera vez que vemos el crédito → LÍNEA BASE (incluye B0) + asignación.
      if (!ultimoBucket.has(creditoId)) {
        filasIniciales.push({
          credito_id: creditoId,
          bucket_anterior: null,
          bucket_nuevo: bucketNuevo,
          tipo_evento: "INICIAL",
          origen: "PROCESO_AUTO",
          cuotas_atrasadas_nuevas: cuotasAtrasadas,
          status_credito: "EN_CONVENIO",
          asesor_id: null,
          pago_id: null,
          motivo: "Línea base — motor de buckets de convenio (COBROS-02)",
        });
        ultimoBucket.set(creditoId, bucketNuevo);
        await reasignar(creditoId, bucketNuevo, null);
        continue;
      }

      const bucketAnterior = ultimoBucket.get(creditoId) ?? 0;
      if (bucketNuevo === bucketAnterior) continue; // sin cambio

      const esSubida = bucketNuevo > bucketAnterior;
      await db.insert(buckets_historial).values({
        credito_id: creditoId,
        bucket_anterior: bucketAnterior,
        bucket_nuevo: bucketNuevo,
        tipo_evento: esSubida ? "SUBIDA" : "BAJADA",
        origen: "PROCESO_AUTO",
        cuotas_atrasadas_nuevas: cuotasAtrasadas,
        status_credito: "EN_CONVENIO",
        asesor_id: null,
        pago_id: null,
        motivo: `Convenio: cuota(s) fuera del convenio atrasada(s) → B${bucketAnterior}→B${bucketNuevo}`,
      });
      ultimoBucket.set(creditoId, bucketNuevo);
      await reasignar(creditoId, bucketNuevo, bucketAnterior);
      if (esSubida) subidas++;
      else bajadas++;
    }

    const CHUNK_INICIALES = 500;
    for (let i = 0; i < filasIniciales.length; i += CHUNK_INICIALES) {
      await db
        .insert(buckets_historial)
        .values(filasIniciales.slice(i, i + CHUNK_INICIALES))
        .onConflictDoNothing();
    }
    iniciales = filasIniciales.length;

    console.log(
      `[BUCKETS-CONV] Créditos EN_CONVENIO: ${creditoIds.length} — iniciales: ${iniciales}, subidas: ${subidas}, bajadas: ${bajadas}, reasignados: ${reasignados}${sinPoolDestino > 0 ? ` ⚠️ sin pool destino: ${sinPoolDestino}` : ""}`,
    );

    return {
      creditos: creditoIds.length,
      iniciales,
      subidas,
      bajadas,
      reasignados,
      sinPoolDestino,
    };
  } catch (err) {
    console.error("[BUCKETS-CONV] ⚠️ Error procesando buckets de convenio:", err);
    throw err;
  } finally {
    if (lockHeld) {
      try {
        await lockConn.query("SELECT pg_advisory_unlock($1)", [
          BUCKETS_CONVENIO_LOCK_KEY,
        ]);
      } catch (unlockErr) {
        console.error("[BUCKETS-CONV] ⚠️ Error liberando advisory lock:", unlockErr);
      }
    }
    lockConn.release();
  }
}
