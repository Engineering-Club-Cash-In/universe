import { describe, expect, it, mock } from "bun:test";

// La regla vive junto al catálogo (que importa la base); el plan es puro, así
// que la base se reemplaza para que la prueba no abra ninguna conexión.
mock.module("../database", () => ({ db: {}, client: {}, lockPool: {} }));

const { planificarConciliacion } = await import("./buckets-conciliacion-pool");

// Pool del sandbox al 2026-10-15: B0 Wilson(3)/Caren(4), B3 Jorge(5)/Samuel(10), B5 Gerencia(2).
const POOL = new Map<number, number[]>([
  [0, [3, 4]],
  [3, [5, 10]],
  [5, [2]],
]);

describe("planificarConciliacion", () => {
  it("casos 286 y 8845: de Caren (pool B0) al pool de su bucket real", () => {
    const plan = planificarConciliacion({
      candidatos: [
        { credito_id: 8845, bucket: 3, asesor_id: 4 },
        { credito_id: 286, bucket: 5, asesor_id: 4 },
      ],
      poolPorBucket: POOL,
      cargaPorBucket: new Map([[3, new Map([[5, 31], [10, 30]])]]),
      ausentes: new Set(),
    });

    expect(plan.aReasignar).toEqual([
      { credito_id: 286, bucket: 5, asesor_anterior: 4, asesor_nuevo: 2 },
      { credito_id: 8845, bucket: 3, asesor_anterior: 4, asesor_nuevo: 10 }, // Samuel lleva menos en B3
    ]);
    expect(plan.sinElegible).toEqual([]);
  });

  it("la carga es viva: varios al mismo bucket se reparten parejo", () => {
    const plan = planificarConciliacion({
      candidatos: [1, 2, 3, 4].map((credito_id) => ({ credito_id, bucket: 3, asesor_id: 4 })),
      poolPorBucket: POOL,
      cargaPorBucket: new Map([[3, new Map([[5, 10], [10, 9]])]]),
      ausentes: new Set(),
    });

    // Arranca 5:10 / 10:9. El 1 va al 10 (queda 10/10); empate → menor id: el 2
    // va al 5 (11/10); el 3 al 10 (11/11); empate otra vez: el 4 al 5.
    expect(plan.aReasignar.map((a) => a.asesor_nuevo)).toEqual([10, 5, 10, 5]);
  });

  it("sin nadie elegible en el bucket: no se reasigna y queda en la lista", () => {
    const plan = planificarConciliacion({
      candidatos: [{ credito_id: 7, bucket: 4, asesor_id: 3 }],
      poolPorBucket: POOL, // B4 sin pool
      cargaPorBucket: new Map(),
      ausentes: new Set(),
    });

    expect(plan.aReasignar).toEqual([]);
    expect(plan.sinElegible).toEqual([{ credito_id: 7, bucket: 4, asesor_id: 3 }]);
  });

  it("crédito sin asesor: recibe uno del pool", () => {
    const plan = planificarConciliacion({
      candidatos: [{ credito_id: 9, bucket: 5, asesor_id: null }],
      poolPorBucket: POOL,
      cargaPorBucket: new Map(),
      ausentes: new Set(),
    });

    expect(plan.aReasignar).toEqual([{ credito_id: 9, bucket: 5, asesor_anterior: null, asesor_nuevo: 2 }]);
  });

  it("asesor con ausencia abierta: se omite (lo resuelve la devolución)", () => {
    const plan = planificarConciliacion({
      candidatos: [{ credito_id: 286, bucket: 5, asesor_id: 4 }],
      poolPorBucket: POOL,
      cargaPorBucket: new Map(),
      ausentes: new Set([4]),
    });

    expect(plan.aReasignar).toEqual([]);
    expect(plan.omitidosPorAusencia).toEqual([{ credito_id: 286, bucket: 5, asesor_id: 4 }]);
  });

  it("idempotente: un crédito cuyo asesor ya es elegible no entra al plan", () => {
    const plan = planificarConciliacion({
      candidatos: [{ credito_id: 286, bucket: 5, asesor_id: 2 }],
      poolPorBucket: POOL,
      cargaPorBucket: new Map(),
      ausentes: new Set(),
    });

    expect(plan).toEqual({ aReasignar: [], sinElegible: [], omitidosPorAusencia: [] });
  });

  it("no muta la carga que recibe", () => {
    const cargaB3 = new Map([[5, 1], [10, 1]]);
    planificarConciliacion({
      candidatos: [{ credito_id: 1, bucket: 3, asesor_id: 4 }],
      poolPorBucket: POOL,
      cargaPorBucket: new Map([[3, cargaB3]]),
      ausentes: new Set(),
    });

    expect([...cargaB3]).toEqual([[5, 1], [10, 1]]);
  });
});
