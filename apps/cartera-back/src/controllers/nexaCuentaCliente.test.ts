import { describe, expect, mock, test } from "bun:test";

// El módulo importa la base y la config; las pruebas solo usan el servicio
// puro con dependencias falsas, así que basta con stubs vacíos.
mock.module("../database", () => ({ db: {}, client: {}, lockPool: {} }));

const { descripcionCuentaNexa, normalizarDpi, solicitarCuentaNexa } = await import("./nexaCuentaCliente");
type Deps = Parameters<typeof solicitarCuentaNexa>[1];

type Binding = {
  nexa_token: string | null;
  nexa_identifier: string | null;
  nexa_user_id: number | null;
  nexa_national_id: string | null;
  cuenta_notificada_at: Date | null;
};

function binding(extra: Partial<Binding> = {}): Binding {
  return {
    nexa_token: null,
    nexa_identifier: null,
    nexa_user_id: null,
    nexa_national_id: null,
    cuenta_notificada_at: null,
    ...extra,
  };
}

function deps(over: Partial<Deps> & { fila?: Binding } = {}) {
  const fila = over.fila ?? binding();
  const guardados: unknown[] = [];
  const errores: string[] = [];
  const llamadas: unknown[] = [];
  const d: Deps = {
    habilitada: true,
    buscarCredito: async (sifco) => (sifco === "01010214100000" ? { creditoId: 55, nombre: "Ana López" } : null),
    conTurnoDeCuenta: async (_creditoId, dpi, work) => {
      if (dpi) fila.nexa_national_id = dpi;
      return work(fila, {
        guardarToken: async (user) => {
          guardados.push(user);
        },
        anotarError: async (m) => {
          errores.push(m);
        },
      });
    },
    crearTokenUser: async (params) => {
      llamadas.push(params);
      return { creditoId: params.creditoId, identifier: "100000002", nexaUserId: 99, token: "32200100000002" };
    },
    ...over,
  };
  return { d, guardados, errores, llamadas };
}

describe("solicitarCuentaNexa", () => {
  test("apagada no toca nada", async () => {
    const { d, llamadas } = deps({ habilitada: false });
    expect(await solicitarCuentaNexa({ numeroSifco: "01010214100000", dpi: "1234567890123" }, d)).toEqual({ estado: "deshabilitada" });
    expect(llamadas).toHaveLength(0);
  });

  test("crea la cuenta y la guarda", async () => {
    const { d, guardados, llamadas } = deps();
    const r = await solicitarCuentaNexa({ numeroSifco: "01010214100000", dpi: "1234 56789 0123" }, d);
    expect(r).toEqual({
      estado: "lista",
      creditoId: 55,
      cuenta: { token: "32200100000002", identifier: "100000002", nexaUserId: 99 },
      nueva: true,
      notificada: false,
    });
    expect(llamadas).toEqual([{ creditoId: 55, description: "Crédito 01010214100000 · Ana López", nationalId: "1234567890123" }]);
    expect(guardados).toHaveLength(1);
  });

  test("si ya tiene token lo devuelve sin llamar a nexa-server", async () => {
    const { d, llamadas } = deps({
      fila: binding({ nexa_token: "32200100000002", nexa_identifier: "100000002", nexa_user_id: 99, cuenta_notificada_at: new Date() }),
    });
    const r = await solicitarCuentaNexa({ numeroSifco: "01010214100000" }, d);
    expect(r).toMatchObject({ estado: "lista", nueva: false, notificada: true });
    expect(llamadas).toHaveLength(0);
  });

  test("si nexa-server falla queda pendiente con el error anotado", async () => {
    const { d, errores } = deps({
      crearTokenUser: async () => {
        throw new Error("nexa-server no respondió: timeout");
      },
    });
    const r = await solicitarCuentaNexa({ numeroSifco: "01010214100000", dpi: "1234567890123" }, d);
    expect(r).toEqual({ estado: "pendiente", creditoId: 55, error: "nexa-server no respondió: timeout" });
    expect(errores).toEqual(["nexa-server no respondió: timeout"]);
  });

  test("un reintento sin DPI usa el que quedó guardado", async () => {
    const { d, llamadas } = deps({ fila: binding({ nexa_national_id: "9999999999999" }) });
    await solicitarCuentaNexa({ numeroSifco: "01010214100000" }, d);
    expect(llamadas).toMatchObject([{ nationalId: "9999999999999" }]);
  });

  test("sin DPI en ningún lado queda pendiente", async () => {
    const { d, llamadas } = deps();
    const r = await solicitarCuentaNexa({ numeroSifco: "01010214100000" }, d);
    expect(r).toMatchObject({ estado: "pendiente" });
    expect(llamadas).toHaveLength(0);
  });

  test("DPI mal formado y crédito inexistente", async () => {
    const { d } = deps();
    expect(await solicitarCuentaNexa({ numeroSifco: "01010214100000", dpi: "123" }, d)).toEqual({ estado: "dpi_invalido" });
    expect(await solicitarCuentaNexa({ numeroSifco: "000", dpi: "1234567890123" }, d)).toEqual({ estado: "credito_no_encontrado" });
  });
});

describe("helpers", () => {
  test("normalizarDpi exige 13 dígitos", () => {
    expect(normalizarDpi("1234-56789-0123")).toBe("1234567890123");
    expect(normalizarDpi("12345")).toBeNull();
    expect(normalizarDpi(null)).toBeNull();
  });

  test("descripción recortada a 80", () => {
    expect(descripcionCuentaNexa("1", "x".repeat(200))).toHaveLength(80);
  });
});
