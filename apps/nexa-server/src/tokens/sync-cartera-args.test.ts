import { describe, expect, test } from "bun:test";
import { parseSyncCarteraArgs } from "./sync-cartera-args";

describe("parseSyncCarteraArgs", () => {
  test("sin --creditos ni --todos se niega", () => {
    expect(parseSyncCarteraArgs([])).toMatchObject({ ok: false });
    expect(parseSyncCarteraArgs(["--dry-run"])).toMatchObject({ ok: false });
  });

  test("--creditos con lista blanca, en ambas formas, sin repetidos", () => {
    expect(parseSyncCarteraArgs(["--creditos", "249,299, 973,249"])).toEqual({ ok: true, scope: { creditoIds: [249, 299, 973] }, dryRun: false });
    expect(parseSyncCarteraArgs(["--creditos=8846", "--dry-run"])).toEqual({ ok: true, scope: { creditoIds: [8846] }, dryRun: true });
  });

  test("--todos explícito", () => {
    expect(parseSyncCarteraArgs(["--todos"])).toEqual({ ok: true, scope: { todos: true }, dryRun: false });
  });

  test("rechaza lista inválida, excluyentes, desconocidos y typos", () => {
    expect(parseSyncCarteraArgs(["--creditos"])).toMatchObject({ ok: false });
    expect(parseSyncCarteraArgs(["--creditos", "--dry-run"])).toMatchObject({ ok: false });
    expect(parseSyncCarteraArgs(["--creditos", "1,,2"])).toMatchObject({ ok: false });
    expect(parseSyncCarteraArgs(["--creditos", "0"])).toMatchObject({ ok: false });
    expect(parseSyncCarteraArgs(["--creditos", "12abc"])).toMatchObject({ ok: false });
    expect(parseSyncCarteraArgs(["--creditos", "1", "--todos"])).toMatchObject({ ok: false });
    // un typo de --dry-run no puede convertirse en una corrida real
    expect(parseSyncCarteraArgs(["--todos", "--dry-ru"])).toMatchObject({ ok: false });
  });
});
