import { describe, expect, mock, test } from "bun:test";

mock.module("../database", () => ({ db: {}, client: {} }));
mock.module("../services/reciboPagoWhatsapp", () => ({
  enviarRecibosPagoDeCreditoBestEffort: async () => [],
}));

const { columnasReciboNexaDisponibles, intentarReciboNexa, reiniciarVerificacionReciboNexa } = await import("./nexaReciboPago");
type Deps = NonNullable<Parameters<typeof intentarReciboNexa>[1]>;

function deps(over: Partial<Deps> = {}) {
  const cierres: string[] = [];
  const envios: unknown[] = [];
  const registrados: number[] = [];
  const d: Deps = {
    tomar: async () => ({ creditoId: 55, enviados: [] }),
    pagosDelEvento: async () => [17],
    enviar: async (params) => {
      envios.push(params);
      return params.pagoIds.map(() => ({ success: true }));
    },
    cerrar: async (_id, estado) => {
      cierres.push(estado);
    },
    registrarEnviados: async (_id, ids) => {
      registrados.push(...ids);
    },
    ...over,
  };
  return { d, cierres, envios, registrados };
}

describe("intentarReciboNexa", () => {
  test("manda el recibo de los pagos del evento y lo cierra como ENVIADO", async () => {
    const { d, cierres, envios } = deps();
    expect(await intentarReciboNexa(7, d)).toBe("ENVIADO");
    expect(envios).toEqual([{ creditoId: 55, pagoIds: [17] }]);
    expect(cierres).toEqual(["ENVIADO"]);
  });

  test("si otro ya lo tomó (o ya se envió) no manda nada", async () => {
    const { d, envios, cierres } = deps({ tomar: async () => null });
    expect(await intentarReciboNexa(7, d)).toBe("OMITIDO");
    expect(envios).toHaveLength(0);
    expect(cierres).toHaveLength(0);
  });

  test("un envío fallido queda FALLIDO para reintentar", async () => {
    const { d, cierres } = deps({ enviar: async () => [{ success: false }] });
    expect(await intentarReciboNexa(7, d)).toBe("FALLIDO");
    expect(cierres).toEqual(["FALLIDO"]);
  });

  test("sin pagos vinculados o con error no lanza", async () => {
    const sinPagos = deps({ pagosDelEvento: async () => [] });
    expect(await intentarReciboNexa(7, sinPagos.d)).toBe("FALLIDO");
    const roto = deps({
      pagosDelEvento: async () => {
        throw new Error("db caída");
      },
    });
    expect(await intentarReciboNexa(7, roto.d)).toBe("FALLIDO");
  });

  test("con varios pagos, un fallo parcial deja anotados los que salieron y el reintento manda solo el resto", async () => {
    const primero = deps({
      pagosDelEvento: async () => [17, 18],
      enviar: async (params) => params.pagoIds.map((id) => ({ success: id === 17 })),
    });
    expect(await intentarReciboNexa(7, primero.d)).toBe("FALLIDO");
    expect(primero.registrados).toEqual([17]);

    const reintento = deps({
      tomar: async () => ({ creditoId: 55, enviados: [17] }),
      pagosDelEvento: async () => [17, 18],
    });
    expect(await intentarReciboNexa(7, reintento.d)).toBe("ENVIADO");
    expect(reintento.envios).toEqual([{ creditoId: 55, pagoIds: [18] }]);
  });
});

describe("columnas del recibo de Nexa", () => {
  test("sin las migraciones el recibo queda apagado y se vuelve a revisar a los 5 minutos", async () => {
    reiniciarVerificacionReciboNexa();
    let revisiones = 0;
    const faltan = async () => {
      revisiones += 1;
      return 2;
    };
    expect(await columnasReciboNexaDisponibles(faltan, 1_000_000)).toBe(false);
    expect(await columnasReciboNexaDisponibles(faltan, 1_000_000 + 60_000)).toBe(false);
    expect(revisiones).toBe(1);
    expect(await columnasReciboNexaDisponibles(async () => 4, 1_000_000 + 6 * 60_000)).toBe(true);
    // El "sí" se recuerda: ya no vuelve a consultar.
    expect(await columnasReciboNexaDisponibles(faltan, 1_000_000 + 7 * 60_000)).toBe(true);
    expect(revisiones).toBe(1);
  });

  test("si la consulta falla, el recibo queda apagado (no rompe el pago)", async () => {
    reiniciarVerificacionReciboNexa();
    expect(await columnasReciboNexaDisponibles(async () => { throw new Error("db"); }, 5_000_000)).toBe(false);
  });
});

