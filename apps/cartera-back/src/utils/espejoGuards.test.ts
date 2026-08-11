import { describe, expect, it } from "bun:test";
import {
  construirStatusActualPorInv,
  operacionEnCursoEnEspejo,
  resolverStatusEspejoRebuild as resolverStatus,
  type FilaEspejoGuard,
} from "./espejoGuards";

describe("operacionEnCursoEnEspejo", () => {
  it("detecta pendiente_reinversion", () => {
    const filas: FilaEspejoGuard[] = [
      { inversionista_id: 86, status: "completado" },
      { inversionista_id: 57, status: "pendiente_reinversion" },
    ];
    expect(operacionEnCursoEnEspejo(filas)?.inversionista_id).toBe(57);
  });

  it("detecta pendiente_compra_cartera y pendiente_revision", () => {
    expect(
      operacionEnCursoEnEspejo([{ inversionista_id: 1, status: "pendiente_compra_cartera" }]),
    ).toBeDefined();
    expect(
      operacionEnCursoEnEspejo([{ inversionista_id: 1, status: "pendiente_revision" }]),
    ).toBeDefined();
  });

  it("devuelve undefined si todas están completadas", () => {
    const filas: FilaEspejoGuard[] = [
      { inversionista_id: 86, status: "completado" },
      { inversionista_id: 57, status: "completado" },
    ];
    expect(operacionEnCursoEnEspejo(filas)).toBeUndefined();
  });

  it("tolera array vacío, null y undefined (crédito sin ciclo previo)", () => {
    expect(operacionEnCursoEnEspejo([])).toBeUndefined();
    expect(operacionEnCursoEnEspejo(null)).toBeUndefined();
    expect(operacionEnCursoEnEspejo(undefined)).toBeUndefined();
  });

  it("una fila con status null no cuenta como pendiente", () => {
    expect(operacionEnCursoEnEspejo([{ inversionista_id: 1, status: null }])).toBeUndefined();
  });

  it("devuelve la PRIMERA pendiente cuando hay varias", () => {
    const filas: FilaEspejoGuard[] = [
      { inversionista_id: 57, status: "pendiente_reinversion" },
      { inversionista_id: 138, status: "pendiente_reinversion" },
    ];
    expect(operacionEnCursoEnEspejo(filas)?.inversionista_id).toBe(57);
  });
});

describe("construirStatusActualPorInv", () => {
  it("mapea inversionista_id → status", () => {
    const mapa = construirStatusActualPorInv([
      { inversionista_id: 57, status: "pendiente_reinversion" },
      { inversionista_id: 86, status: "completado" },
    ]);
    expect(mapa.get(57)).toBe("pendiente_reinversion");
    expect(mapa.get(86)).toBe("completado");
    expect(mapa.size).toBe(2);
  });

  it("omite filas con status null y tolera entrada vacía", () => {
    expect(construirStatusActualPorInv([{ inversionista_id: 1, status: null }]).size).toBe(0);
    expect(construirStatusActualPorInv(null).size).toBe(0);
    expect(construirStatusActualPorInv(undefined).size).toBe(0);
  });
});

describe("status del rebuild del espejo", () => {
  // Escenario real: crédito 9035, 10-jul-2026. Luis Pedro (57) reinvierte y
  // queda pendiente_reinversion; 2 s después entra Marco (138) al MISMO
  // crédito. El rebuild hardcodeaba "completado" para Luis Pedro.
  const espejoActual: FilaEspejoGuard[] = [
    { inversionista_id: 57, status: "pendiente_reinversion" },
    { inversionista_id: 86, status: "completado" },
  ];
  const mapa = construirStatusActualPorInv(espejoActual);

  it("preserva la operación en vuelo de un tercero", () => {
    expect(resolverStatus(57, 138, "pendiente_reinversion", mapa)).toBe("pendiente_reinversion");
  });

  it("el inversionista de la operación recibe el status nuevo", () => {
    expect(resolverStatus(138, 138, "pendiente_reinversion", mapa)).toBe("pendiente_reinversion");
  });

  it("un tercero completado se mantiene completado", () => {
    expect(resolverStatus(86, 138, "pendiente_reinversion", mapa)).toBe("completado");
  });

  it("un inversionista ausente del mapa cae a completado", () => {
    expect(resolverStatus(999, 138, "pendiente_reinversion", mapa)).toBe("completado");
  });

  it("compra_cartera preserva igual el pendiente ajeno", () => {
    expect(resolverStatus(57, 138, "pendiente_compra_cartera", mapa)).toBe("pendiente_reinversion");
  });

  it("preserva pendiente_revision (4º valor del enum, el que el cast omitía)", () => {
    const conRevision = construirStatusActualPorInv([
      { inversionista_id: 16, status: "pendiente_revision" },
    ]);
    expect(resolverStatus(16, 138, "pendiente_reinversion", conRevision)).toBe(
      "pendiente_revision",
    );
  });
});
