import { describe, expect, it, mock } from "bun:test";
import type { CreditCandidate } from "./assignCapital";

/**
 * Filtro por plazos restantes de getCreditCandidates.
 *
 * Se testean las dos funciones puras que sostienen la regla de negocio: el
 * cálculo de plazos restantes y el filtro por plazo exacto. Ninguna toca la DB.
 *
 * El módulo `../database` se fakea ANTES de importar el controller (mismo patrón
 * que latefee.test.ts): importarlo de verdad ejecuta `database/index.ts`, que
 * tira `Error: DATABASE_URL environment variable not set` si falta la env var y
 * abre un pool de conexiones que estos tests no necesitan.
 */
mock.module("../database", () => ({ db: {}, client: {} }));

const { calcPlazosRestantes, seleccionarPorPlazo, CUBE_ID } = await import(
  "./assignCapital"
);

// ── Helper: candidato mínimo ────────────────────────────────────────────────
// Solo importan plazos_restantes, capital_evaluado y score; el resto es relleno
// para satisfacer el tipo.
let seq = 0;
function mkCandidate(opts: {
  plazos_restantes: number;
  capital_evaluado?: number; // lo que Cube tiene en el crédito (lo vendible)
  capital_activo?: number;
  score?: number;
  sifco?: string;
}): CreditCandidate {
  const capitalCube = opts.capital_evaluado ?? 10000;
  const id = ++seq;
  return {
    credito_id: id,
    numero_credito_sifco: opts.sifco ?? `C-${id}`,
    capital: opts.capital_activo ?? capitalCube,
    capital_activo: opts.capital_activo ?? capitalCube,
    formato_credito: "Individual",
    cuotas_pagadas: 1,
    total_cuotas: 24,
    plazos_restantes: opts.plazos_restantes,
    inversionistas: [
      {
        inversionista_id: CUBE_ID,
        nombre: "Cube Investments",
        monto_aportado: capitalCube,
        es_cube: true,
      },
    ],
    score: opts.score ?? 1000,
    score_breakdown: {
      crm_bonus: 0,
      formato: 0,
      cuotas: 0,
      proximidad: 0,
      reinversion: 0,
      vencimiento_dia_30: 0,
      total: opts.score ?? 1000,
    },
    capital_evaluado: capitalCube,
  };
}

const plazosDe = (cs: CreditCandidate[]) => cs.map((c) => c.plazos_restantes);

// ============================================================================
describe("calcPlazosRestantes", () => {
  it("crédito nuevo (ninguna cuota pagada) → restantes = total", () => {
    expect(calcPlazosRestantes(24, 0)).toBe(24);
  });

  it("a mitad de pago (última pagada 12 de 24) → 12", () => {
    expect(calcPlazosRestantes(24, 12)).toBe(12);
  });

  it("con hueco: cuenta desde la MAYOR pagada, ignora las impagas de abajo", () => {
    // Total 24. Pagadas 1, 2, 4 y 5 — la 3 quedó impaga. La mayor pagada es la 5.
    // Restantes = 24 - 5 = 19. NO 20 (que sería total - cantidad_pagadas).
    expect(calcPlazosRestantes(24, 5)).toBe(19);
  });

  it("última cuota pagada → 0 restantes", () => {
    expect(calcPlazosRestantes(24, 24)).toBe(0);
  });

  it("crédito sin cuotas → 0 (nunca negativo)", () => {
    expect(calcPlazosRestantes(0, 0)).toBe(0);
  });
});

// ============================================================================
describe("seleccionarPorPlazo — filtro estricto", () => {
  it("devuelve solo los del plazo exacto, descarta los vecinos", () => {
    const candidatos = [
      mkCandidate({ plazos_restantes: 12 }),
      mkCandidate({ plazos_restantes: 13 }),
      mkCandidate({ plazos_restantes: 12 }),
      mkCandidate({ plazos_restantes: 14 }),
    ];

    const result = seleccionarPorPlazo(candidatos, 12);

    expect(plazosDe(result)).toEqual([12, 12]);
  });

  it("NO escala hacia arriba: sin créditos de 12, no toma los de 13 ni 14", () => {
    const candidatos = [
      mkCandidate({ plazos_restantes: 13 }),
      mkCandidate({ plazos_restantes: 14 }),
      mkCandidate({ plazos_restantes: 16 }),
    ];

    expect(seleccionarPorPlazo(candidatos, 12)).toEqual([]);
  });

  it("NO escala hacia abajo: un crédito de plazo 11 no entra con objetivo 12", () => {
    const candidatos = [
      mkCandidate({ plazos_restantes: 11 }),
      mkCandidate({ plazos_restantes: 9 }),
    ];

    expect(seleccionarPorPlazo(candidatos, 12)).toEqual([]);
  });

  it("no alcanza a cubrir el monto → devuelve igual los que haya (no escala)", () => {
    // Monto pedido Q300k. Los créditos de plazo 12 solo suman Q30k de Cube.
    // Aun así se devuelven esos dos; el faltante queda sin asignar.
    const candidatos = [
      mkCandidate({ plazos_restantes: 12, capital_evaluado: 20_000 }),
      mkCandidate({ plazos_restantes: 12, capital_evaluado: 10_000 }),
      mkCandidate({ plazos_restantes: 13, capital_evaluado: 999_000 }),
    ];

    const result = seleccionarPorPlazo(candidatos, 12);

    expect(plazosDe(result)).toEqual([12, 12]);
    const capitalCube = result.reduce((acc, c) => acc + c.capital_evaluado, 0);
    expect(capitalCube).toBe(30_000); // muy por debajo de los Q300k, y está bien
  });

  it("sin candidatos del plazo pedido → lista vacía", () => {
    const candidatos = [
      mkCandidate({ plazos_restantes: 20 }),
      mkCandidate({ plazos_restantes: 30 }),
    ];

    expect(seleccionarPorPlazo(candidatos, 12)).toEqual([]);
  });

  it("conserva el orden de score de la lista de entrada", () => {
    const candidatos = [
      mkCandidate({ plazos_restantes: 12, score: 5_000, sifco: "A" }),
      mkCandidate({ plazos_restantes: 13, score: 4_500, sifco: "DESCARTADO" }),
      mkCandidate({ plazos_restantes: 12, score: 3_000, sifco: "B" }),
      mkCandidate({ plazos_restantes: 12, score: 2_000, sifco: "C" }),
    ];

    const result = seleccionarPorPlazo(candidatos, 12);

    expect(result.map((c) => c.numero_credito_sifco)).toEqual(["A", "B", "C"]);
  });
});
