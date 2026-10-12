import { describe, expect, test } from "bun:test";
import {
  evaluarLote,
  MAX_CREDITOS_LOTE,
  normalizarCreditoIds,
} from "./buckets-reasignacion-lote";

const pool = new Map<number, ReadonlySet<number>>([
  [1, new Set([10, 11])],
  [3, new Set([11, 12])],
]);

describe("evaluarLote", () => {
  test("reasigna los créditos válidos y registra el dueño anterior", () => {
    const r = evaluarLote({
      creditoIds: [1, 2],
      creditos: new Map([
        [1, { asesor_id: 10, bucket: 1 }],
        [2, { asesor_id: 12, bucket: 3 }],
      ]),
      poolPorBucket: pool,
      asesorNuevoId: 11,
    });
    expect(r.errores).toEqual([]);
    expect(r.aReasignar).toEqual([
      { credito_id: 1, asesor_anterior: 10, bucket: 1 },
      { credito_id: 2, asesor_anterior: 12, bucket: 3 },
    ]);
  });

  test("omite el que ya es del destino aunque el destino ya no esté en el pool de su bucket", () => {
    const r = evaluarLote({
      creditoIds: [1, 2],
      creditos: new Map([
        [1, { asesor_id: 99, bucket: 1 }],
        [2, { asesor_id: 10, bucket: 1 }],
      ]),
      poolPorBucket: pool,
      asesorNuevoId: 99,
    });
    // El 1 ya es del 99 (fuera del pool): omitido. El 2 sí exige elegibilidad.
    expect(r.omitidos).toEqual([{ credito_id: 1, motivo: "ya_asignado" }]);
    expect(r.errores.map((e) => e.credito_id)).toEqual([2]);
  });

  test("omite el que ya es del destino sin marcarlo como error", () => {
    const r = evaluarLote({
      creditoIds: [1],
      creditos: new Map([[1, { asesor_id: 11, bucket: 1 }]]),
      poolPorBucket: pool,
      asesorNuevoId: 11,
    });
    expect(r.omitidos).toEqual([{ credito_id: 1, motivo: "ya_asignado" }]);
    expect(r.aReasignar).toEqual([]);
    expect(r.errores).toEqual([]);
  });

  test("un asesor fuera del pool del bucket es error de todo el lote", () => {
    const r = evaluarLote({
      creditoIds: [1, 2],
      creditos: new Map([
        [1, { asesor_id: 10, bucket: 1 }],
        [2, { asesor_id: 12, bucket: 3 }],
      ]),
      poolPorBucket: pool,
      asesorNuevoId: 10, // está en B1 pero no en B3
    });
    expect(r.errores.map((e) => [e.credito_id, e.codigo])).toEqual([
      [2, "asesor_no_elegible"],
    ]);
  });

  test("crédito inexistente o fuera del funnel", () => {
    const r = evaluarLote({
      creditoIds: [7, 8],
      creditos: new Map([
        [7, null],
        [8, { asesor_id: 10, bucket: null }],
      ]),
      poolPorBucket: pool,
      asesorNuevoId: 11,
    });
    expect(r.errores.map((e) => e.codigo)).toEqual([
      "no_encontrado",
      "fuera_del_funnel",
    ]);
  });
});

describe("normalizarCreditoIds", () => {
  test("deduplica y convierte a número", () => {
    expect(normalizarCreditoIds(["1", 2, 2])).toEqual([1, 2]);
  });
  test("rechaza vacío, no enteros y más del tope", () => {
    expect(normalizarCreditoIds([])).toBeNull();
    expect(normalizarCreditoIds([1.5])).toBeNull();
    expect(normalizarCreditoIds([0])).toBeNull();
    expect(normalizarCreditoIds("1")).toBeNull();
    // Fuera del rango de un integer de PostgreSQL: error 500 de la base.
    expect(normalizarCreditoIds([2147483647])).toEqual([2147483647]);
    expect(normalizarCreditoIds([2147483648])).toBeNull();
    expect(
      normalizarCreditoIds(Array.from({ length: MAX_CREDITOS_LOTE + 1 }, (_, i) => i + 1)),
    ).toBeNull();
  });
});
