import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  clasificarCompraCreditoInversionista,
  resolverModosEfectivosLiquidacion,
  resolverModosTrasReemplazo,
  tieneConflictoExcedenteVariable,
  snapshotModoLiquidacion,
} from "./purchaseClassification";

describe("clasificarCompraCreditoInversionista", () => {
  it("clasifica una posición ausente en el snapshot previo como nueva", () => {
    expect(clasificarCompraCreditoInversionista([1, 2], 9)).toBe("nueva_posicion");
  });

  it("clasifica una posición existente en el snapshot previo como ampliación", () => {
    expect(clasificarCompraCreditoInversionista([1, 9], 9)).toBe("ampliacion_posicion");
  });

  it("usa sin_clasificar para filas legacy sin snapshot previo", () => {
    expect(clasificarCompraCreditoInversionista(undefined, 9)).toBe("sin_clasificar");
  });
});

describe("resolverModosEfectivosLiquidacion", () => {
  const creditos = [10, 20];

  it("usa el modo global conocido aunque el espejo sea nulo o esté desactualizado", () => {
    expect(resolverModosEfectivosLiquidacion("reinversion_capital", creditos, [
      { credito_id: 10, tipo_reinversion: null },
      { credito_id: 20, tipo_reinversion: "reinversion_interes" },
    ])).toEqual({
      porCredito: new Map([[10, "reinversion_capital"], [20, "reinversion_capital"]]),
      agregado: "reinversion_capital",
    });
  });

  it("usa espejo por crédito para combinada y no agrega modos distintos", () => {
    expect(resolverModosEfectivosLiquidacion("reinversion_combinada", creditos, [
      { credito_id: 10, tipo_reinversion: "reinversion_capital" },
      { credito_id: 20, tipo_reinversion: "reinversion_interes" },
    ])).toEqual({
      porCredito: new Map([[10, "reinversion_capital"], [20, "reinversion_interes"]]),
      agregado: null,
    });
  });

  it("no etiqueta agregado si falta un crédito del snapshot", () => {
    expect(resolverModosEfectivosLiquidacion("reinversion_combinada", creditos, [
      { credito_id: 10, tipo_reinversion: "reinversion_capital" },
    ])).toEqual({
      porCredito: new Map([[10, "reinversion_capital"], [20, null]]),
      agregado: null,
    });
  });

  it("agrega solo cuando todos los créditos distintos tienen el mismo modo", () => {
    expect(resolverModosEfectivosLiquidacion("reinversion_combinada", [10, 10, 20], [
      { credito_id: 10, tipo_reinversion: "reinversion_capital" },
      { credito_id: 20, tipo_reinversion: "reinversion_capital" },
    ]).agregado).toBe("reinversion_capital");
  });

  it("conserva desconocido cuando no existe modo global ni espejo", () => {
    expect(resolverModosEfectivosLiquidacion(null, creditos, []).agregado).toBeNull();
  });
});

describe("snapshotModoLiquidacion", () => {
  it("preserva un modo efectivo conocido", () => {
    expect(snapshotModoLiquidacion("reinversion_capital")).toBe("reinversion_capital");
  });

  it("no inventa un modo cuando la fuente no lo conoce", () => {
    expect(snapshotModoLiquidacion(null)).toBeNull();
    expect(snapshotModoLiquidacion(undefined)).toBeNull();
  });
});

describe("resolverModosTrasReemplazo", () => {
  it("se usa tanto antes como después del lock transaccional", async () => {
    const source = await readFile(
      new URL("./addInvestorToCredit.ts", import.meta.url),
      "utf8",
    );
    expect(source.match(/resolverModosTrasReemplazo\(\{/g)).toHaveLength(2);
    expect(source).toMatch(
      /if \(!cubePadre\) \{\s*const razon = "CUBE no encontrado en el padre del crédito";\s*if \(esManual\) \{\s*throw new CreditoNoDisponibleError/,
    );
  });

  it("reemplaza el modo anterior del crédito objetivo antes de validar conflicto", () => {
    expect(
      resolverModosTrasReemplazo({
        espejos: [
          { credito_id: 10, tipo_reinversion: "reinversion_variable" },
        ],
        creditoIdsObjetivo: [10],
        modoSolicitado: "reinversion_excedente",
        modoParaNulos: "reinversion_variable",
      }),
    ).toEqual(["reinversion_excedente", "reinversion_excedente"]);
  });

  it("conserva el conflicto de un crédito no reemplazado", () => {
    const modos = resolverModosTrasReemplazo({
      espejos: [
        { credito_id: 10, tipo_reinversion: "reinversion_variable" },
        { credito_id: 11, tipo_reinversion: "reinversion_variable" },
      ],
      creditoIdsObjetivo: [10],
      modoSolicitado: "reinversion_excedente",
      modoParaNulos: "reinversion_variable",
    });
    expect(tieneConflictoExcedenteVariable(modos)).toBe(true);
  });
});

describe("tieneConflictoExcedenteVariable", () => {
  it("rechaza excedente seguido de variable", () => {
    expect(tieneConflictoExcedenteVariable([
      "reinversion_excedente",
      "reinversion_variable",
    ])).toBe(true);
  });

  it("rechaza variable seguido de excedente", () => {
    expect(tieneConflictoExcedenteVariable([
      "reinversion_variable",
      "reinversion_excedente",
    ])).toBe(true);
  });

  it("acepta modos no conflictivos y valores nulos", () => {
    expect(tieneConflictoExcedenteVariable([
      null,
      "reinversion_capital",
      "reinversion_excedente",
    ])).toBe(false);
  });
});
