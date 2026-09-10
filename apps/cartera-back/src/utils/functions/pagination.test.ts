import { describe, expect, it } from "bun:test";
import { clampPagination, contienePatron, escaparLike } from "./pagination";

describe("clampPagination", () => {
  it("deja pasar valores enteros normales", () => {
    expect(clampPagination(3, 50)).toEqual({ page: 3, pageSize: 50, offset: 100 });
  });

  it("usa los defaults cuando no llega nada", () => {
    expect(clampPagination()).toEqual({ page: 1, pageSize: 20, offset: 0 });
  });

  it("topa pageSize a 500", () => {
    expect(clampPagination(1, 10_000).pageSize).toBe(500);
  });

  it("no acepta page/pageSize no finitos", () => {
    expect(clampPagination(NaN, Infinity)).toEqual({ page: 1, pageSize: 20, offset: 0 });
  });

  it("no acepta page/pageSize <= 0", () => {
    expect(clampPagination(0, -5)).toEqual({ page: 1, pageSize: 20, offset: 0 });
  });

  // Los tres de abajo son el hallazgo: se validaba ANTES de redondear, así que
  // un fraccionario pasaba el `> 0` y `Math.floor` lo hundía a cero después.
  it("un page fraccionario menor a 1 no produce page 0 ni offset negativo", () => {
    expect(clampPagination(0.5, 20)).toEqual({ page: 1, pageSize: 20, offset: 0 });
  });

  it("un pageSize fraccionario menor a 1 no produce pageSize 0", () => {
    expect(clampPagination(1, 0.5)).toEqual({ page: 1, pageSize: 20, offset: 0 });
  });

  it("un fraccionario >= 1 se trunca hacia abajo", () => {
    expect(clampPagination(2.9, 30.7)).toEqual({ page: 2, pageSize: 30, offset: 30 });
  });
});

describe("escaparLike", () => {
  it("neutraliza los comodines y la contrabarra", () => {
    expect(escaparLike("50%_a\\b")).toBe("50\\%\\_a\\\\b");
  });

  it("contienePatron envuelve el término ya escapado", () => {
    expect(contienePatron("a_b")).toBe("%a\\_b%");
  });
});
