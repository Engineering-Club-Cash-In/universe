import { beforeEach, describe, expect, it } from "bun:test";
import type { AxiosInstance } from "axios";
import { enviarWhatsappPorCrm, obtenerContactosDelCrm } from "./crmEstadoCuenta.service";

// Cliente HTTP simulado: ninguna prueba sale a la red ni llega al CRM.

const PARAMS = {
  intentoId: "6f1c1b7e-8a4d-4c1e-9a52-1b2c3d4e5f60",
  telefono: "+50235219722",
  mensaje: "Hola",
  numeroCreditoSifco: "01020304",
};

let llamadas: { metodo: string; url: string; config: any; body?: unknown }[] = [];
const cliente = (respuesta: () => Promise<any>): AxiosInstance =>
  ({
    get: async (url: string, config: any) => {
      llamadas.push({ metodo: "GET", url, config });
      return respuesta();
    },
    post: async (url: string, body: unknown, config: any) => {
      llamadas.push({ metodo: "POST", url, config, body });
      return respuesta();
    },
  }) as unknown as AxiosInstance;

const errorHttp = (status: number | undefined, data?: unknown, code?: string) =>
  Object.assign(new Error(`HTTP ${status ?? code}`), { response: status ? { status, data } : undefined, code });

beforeEach(() => {
  llamadas = [];
  process.env.CARTERA_RELAY_SECRET = "secreto-de-prueba";
});

describe("obtenerContactosDelCrm", () => {
  it("manda el secreto y el número de crédito, y devuelve los contactos", async () => {
    const contactos = [{ telefono: "+50235219722", fuente: "LEAD", sugerido: true }];
    const r = await obtenerContactosDelCrm("01020304", cliente(async () => ({ data: { success: true, contactos } })));
    expect(r).toEqual(contactos as any);
    expect(llamadas[0].url).toBe("/api/cartera/estado-cuenta/contactos");
    expect(llamadas[0].config.params).toEqual({ numero_sifco: "01020304" });
    expect(llamadas[0].config.headers["x-cartera-relay-secret"]).toBe("secreto-de-prueba");
  });

  it("respuesta sin éxito → lanza (Cartera responde 502)", async () => {
    await expect(
      obtenerContactosDelCrm("01020304", cliente(async () => ({ data: { success: false, error: "x" } })))
    ).rejects.toThrow();
  });
});

describe("enviarWhatsappPorCrm", () => {
  it("ENVIADO con id y modo prueba", async () => {
    const r = await enviarWhatsappPorCrm(
      PARAMS,
      cliente(async () => ({ data: { resultado: "ENVIADO", mensajeId: "tm-1", modoPrueba: true, proveedor: "SimpleTech" } }))
    );
    expect(r).toEqual({ resultado: "ENVIADO", proveedor: "SimpleTech", mensajeId: "tm-1", modoPrueba: true });
    expect(llamadas[0].body).toEqual(PARAMS);
  });

  it("el CRM contesta 400 con NO_ENVIADO → NO_ENVIADO", async () => {
    const r = await enviarWhatsappPorCrm(PARAMS, cliente(async () => {
      throw errorHttp(400, { resultado: "NO_ENVIADO", error: "Teléfono inválido" });
    }));
    expect(r.resultado).toBe("NO_ENVIADO");
  });

  it("401 (secreto inválido) → NO_ENVIADO: el CRM no lo intentó", async () => {
    const r = await enviarWhatsappPorCrm(PARAMS, cliente(async () => {
      throw errorHttp(401, { success: false, error: "No autorizado" });
    }));
    expect(r.resultado).toBe("NO_ENVIADO");
  });

  it("CRM inaccesible (conexión rechazada) → NO_ENVIADO", async () => {
    const r = await enviarWhatsappPorCrm(PARAMS, cliente(async () => {
      throw errorHttp(undefined, undefined, "ECONNREFUSED");
    }));
    expect(r.resultado).toBe("NO_ENVIADO");
  });

  it("timeout o 5xx del CRM → INCIERTO (pudo haber salido)", async () => {
    for (const err of [errorHttp(undefined, undefined, "ECONNABORTED"), errorHttp(502, "Bad Gateway")]) {
      const r = await enviarWhatsappPorCrm(PARAMS, cliente(async () => {
        throw err;
      }));
      expect(r.resultado).toBe("INCIERTO");
    }
  });

  it("sin CARTERA_RELAY_SECRET → NO_ENVIADO sin llamar al CRM", async () => {
    delete process.env.CARTERA_RELAY_SECRET;
    const r = await enviarWhatsappPorCrm(PARAMS, cliente(async () => ({ data: {} })));
    expect(r.resultado).toBe("NO_ENVIADO");
    expect(llamadas.length).toBe(0);
  });
});
