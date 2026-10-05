/**
 * COBROS-02 — motor de buckets: el paso del cron `procesarMoras` que registra
 * las transiciones de bucket en `buckets_historial` y reasigna el asesor por
 * bucket (FASE 3). Es ADITIVO: no toca el cálculo de mora, y si falla no rompe
 * el proceso de mora. Antes vivía inline en latefee.ts; se movió en el merge
 * con develop (latefee.ts solo emite eventos estructurados).
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import type { PoolClient } from "pg";
import { db } from "../../database";
import {
  asesor_bucket,
  buckets_historial,
  CARTERA_SCHEMA,
  credito_asesor_historial,
  creditos,
  pagos_credito,
} from "../../database/db/schema";
import { bucketDeCredito, type BucketCatalogo } from "../../lib/buckets-classification";
import { elegirAsesorParaBucket, getBucketsCatalogoConEstado } from "./catalogoBuckets";

export type ResumenBuckets = {
  iniciales: number;
  subidas: number;
  bajadas: number;
  reasignados: number;
  sinPoolDestino: number;
  omitidoPorFallback: boolean;
};

export async function registrarTransicionesDeBuckets(params: {
  /** Las cuotas que cargó el cron (una fila por cuota, con estado y asesor del crédito). */
  cuotas: ReadonlyArray<{ credito_id: number; statusCredit: string; asesor_id: number | null }>;
  /** Cuotas vencidas por crédito, con el MISMO criterio con el que el cron cobró. */
  moraPorCredito: Record<number, number>;
  /** La conexión del advisory lock del cron (lee el último bucket por crédito). */
  lockConn: PoolClient;
}): Promise<ResumenBuckets> {
  const { cuotas, moraPorCredito, lockConn } = params;
  // ============================================================
  // 🪣 MOTOR DE BUCKETS (COBROS-02) — registrar transiciones de bucket
  // ============================================================
  // Paso ADITIVO: no toca el cálculo de mora. Detecta cambios de bucket
  // (derivado de estado + cuotas) y los registra en `buckets_historial`.
  // Si algo falla aquí, NO debe romper el proceso de mora (operación crítica).
  // Se devuelve en el resultado del job (útil para pruebas vía POST /moras/procesar).
  const bucketsResumen: {
    iniciales: number;
    subidas: number;
    bajadas: number;
    reasignados: number;
    sinPoolDestino: number;
    omitidoPorFallback: boolean;
  } = {
    iniciales: 0,
    subidas: 0,
    bajadas: 0,
    reasignados: 0,
    sinPoolDestino: 0,
    omitidoPorFallback: false,
  };
  try {
    // Catálogo de buckets (config dinámica: nombres/rangos/estados). ~6 filas.
    // Comparte getBucketsCatalogoConEstado() con el endpoint de presentación
    // en vez de una query propia: así el motor que ESCRIBE buckets_historial
    // queda cubierto por validarCatalogoBuckets() — pero a diferencia de los
    // consumidores de solo-lectura (credits.ts, router), que aceptan degradar
    // en silencio a FALLBACK_BUCKETS_CATALOGO, este motor NO debe persistir
    // transiciones calculadas con rangos hardcoded del seed cuando la config
    // real difiere (rangos custom, migración a medias): eso dejaría historial
    // de negocio contaminado con datos derivados de una config que nunca
    // aplicó, sin más rastro que un console.error efímero. Se omite el paso
    // completo y se reporta en bucketsResumen.omitidoPorFallback.
    const { catalogo: catalogoBuckets, esFallback }: { catalogo: BucketCatalogo[]; esFallback: boolean } =
      await getBucketsCatalogoConEstado();

    if (esFallback) {
      bucketsResumen.omitidoPorFallback = true;
      console.warn(
        `[BUCKETS] ⚠️ Catálogo \`${CARTERA_SCHEMA}.buckets\` inconsistente o inaccesible — se omite el registro de transiciones este ciclo (no se persiste historial con rangos de fallback).`,
      );
    } else if (catalogoBuckets.length === 0) {
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
    const ultimosRes = await lockConn!.query(
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
  return bucketsResumen;
}
