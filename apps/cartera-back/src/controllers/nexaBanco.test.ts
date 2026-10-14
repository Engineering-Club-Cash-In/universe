import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("../database", () => ({ db: {}, client: {} }));

const { bancoNexaId, reiniciarBancoNexa } = await import("./nexaBanco");

const silenciarWarn = async <T>(fn: (avisos: string[]) => Promise<T>) => {
  const avisos: string[] = [];
  const original = console.warn;
  console.warn = (msg: string) => { avisos.push(msg); };
  try {
    return await fn(avisos);
  } finally {
    console.warn = original;
  }
};

beforeEach(() => reiniciarBancoNexa());

describe("bancoNexaId", () => {
  test("devuelve el banco y lo recuerda: no vuelve a leer", async () => {
    let lecturas = 0;
    const leer = async () => { lecturas += 1; return 26; };
    expect(await bancoNexaId(leer)).toBe(26);
    expect(await bancoNexaId(leer)).toBe(26);
    expect(lecturas).toBe(1);
  });

  test("sin banco devuelve null, avisa una vez cada 30 minutos y lo vuelve a buscar", async () => {
    await silenciarWarn(async (avisos) => {
      let lecturas = 0;
      const leer = async () => { lecturas += 1; return null; };
      expect(await bancoNexaId(leer, 1_000)).toBeNull();
      expect(await bancoNexaId(leer, 2_000)).toBeNull();
      expect(avisos.length).toBe(1);
      expect(JSON.parse(avisos[0]!)).toMatchObject({ event: "nexa.banco.no_encontrado" });
      expect(await bancoNexaId(leer, 1_000 + 30 * 60_000)).toBeNull();
      expect(avisos.length).toBe(2);
      expect(lecturas).toBe(3);
      // Cuando aparece (la fila se crea después), se toma.
      expect(await bancoNexaId(async () => 26, 3_000)).toBe(26);
    });
  });

  test("si la lectura falla devuelve null sin lanzar", async () => {
    await silenciarWarn(async (avisos) => {
      expect(await bancoNexaId(async () => { throw new Error("db caída"); })).toBeNull();
      expect(JSON.parse(avisos[0]!)).toMatchObject({ event: "nexa.banco.no_encontrado", error: "db caída" });
    });
  });

  test("una lectura colgada no frena el pago: dentro del tope devuelve null y avisa", async () => {
    await silenciarWarn(async (avisos) => {
      const inicio = Date.now();
      expect(await bancoNexaId(() => new Promise(() => undefined), 1_000, 20)).toBeNull();
      expect(Date.now() - inicio).toBeLessThan(500);
      expect(JSON.parse(avisos[0]!)).toMatchObject({ event: "nexa.banco.no_encontrado", error: "sin respuesta en 20 ms" });
    });
  });
});
