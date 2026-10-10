import { describe, expect, test } from "bun:test";
import { BUCKET_JURIDICO, motivoBucketNoJuridico } from "./buckets-juridico";

describe("motivoBucketNoJuridico", () => {
  test("B3 y B4 se pueden escalar", () => {
    expect(motivoBucketNoJuridico(3)).toBeNull();
    expect(motivoBucketNoJuridico(4)).toBeNull();
  });

  test("B0 a B2 no: el crédito todavía no se gestionó lo suficiente", () => {
    for (const b of [0, 1, 2]) {
      expect(motivoBucketNoJuridico(b)).toContain("desde B3");
    }
  });

  test("B5 ya está en Jurídico: no hay nada que escalar", () => {
    expect(BUCKET_JURIDICO).toBe(5);
    expect(motivoBucketNoJuridico(5)).toContain("no hay nada que escalar");
  });
});
