// ─────────────────────────────────────────────────────────────────────────────
// COBROS-02 · Conciliación de dueños con el pool (2026-10-15).
//
// Plan puro (sin base) para los créditos cuyo asesor no está en el pool de su
// bucket actual: a quién pasa cada uno con la MISMA regla del motor
// (`elegirAsesorParaBucket`: el de menor carga del bucket, empate → menor id) y
// con la carga viva, para que N créditos al mismo bucket se repartan parejo. Lo
// usa el script de saneamiento; el motor aplica la misma regla dentro de su loop.
// ─────────────────────────────────────────────────────────────────────────────
import { elegirAsesorParaBucket } from "../controllers/buckets/catalogoBuckets";

export type CandidatoConciliacion = {
  credito_id: number;
  bucket: number;
  asesor_id: number | null;
};

export type ReasignacionPlaneada = {
  credito_id: number;
  bucket: number;
  asesor_anterior: number | null;
  asesor_nuevo: number;
};

export type PlanConciliacion = {
  aReasignar: ReasignacionPlaneada[];
  /** El bucket no tiene a nadie elegible: el crédito se queda como está y hay que configurar el pool. */
  sinElegible: CandidatoConciliacion[];
  /** Su asesor tiene una ausencia abierta: lo resuelve la devolución, no esto. */
  omitidosPorAusencia: CandidatoConciliacion[];
};

export function planificarConciliacion(params: {
  candidatos: readonly CandidatoConciliacion[];
  /** bucket → ids de asesores elegibles (pool activo y asesor activo). */
  poolPorBucket: ReadonlyMap<number, readonly number[]>;
  /** bucket → (asesor → cuentas que lleva hoy en ese bucket). */
  cargaPorBucket: ReadonlyMap<number, ReadonlyMap<number, number>>;
  ausentes: ReadonlySet<number>;
}): PlanConciliacion {
  const plan: PlanConciliacion = { aReasignar: [], sinElegible: [], omitidosPorAusencia: [] };
  const carga = new Map<number, Map<number, number>>();
  for (const [bucket, porAsesor] of params.cargaPorBucket) carga.set(bucket, new Map(porAsesor));

  // Orden fijo: el mismo plan para los mismos datos.
  const candidatos = [...params.candidatos].sort((a, b) => a.credito_id - b.credito_id);
  for (const c of candidatos) {
    const pool = [...(params.poolPorBucket.get(c.bucket) ?? [])];
    if (c.asesor_id !== null && pool.includes(c.asesor_id)) continue; // ya es elegible
    if (c.asesor_id !== null && params.ausentes.has(c.asesor_id)) {
      plan.omitidosPorAusencia.push(c);
      continue;
    }
    const elegido = elegirAsesorParaBucket(pool, carga.get(c.bucket), c.asesor_id);
    if (elegido === null) {
      plan.sinElegible.push(c);
      continue;
    }
    plan.aReasignar.push({
      credito_id: c.credito_id,
      bucket: c.bucket,
      asesor_anterior: c.asesor_id,
      asesor_nuevo: elegido,
    });
    const porAsesor = carga.get(c.bucket) ?? new Map<number, number>();
    porAsesor.set(elegido, (porAsesor.get(elegido) ?? 0) + 1);
    carga.set(c.bucket, porAsesor);
  }
  return plan;
}
