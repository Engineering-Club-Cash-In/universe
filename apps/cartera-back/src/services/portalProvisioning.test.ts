import { describe, expect, it } from "bun:test";
import { provisionarInversionista } from "./portalProvisioning";

const OPTS_BASE = {
  baseUrl: "http://auth-google:9500",
  secreto: "s3cr3to",
  buscarRepresentante: async () => null,
};

const fila = (over: any = {}) => ({
  inversionista_id: 1,
  nombre: "Ana Pérez",
  email: "ana@example.com",
  dpi: 1234567890101,
  dpi_rep_legal: null,
  ...over,
});

const fetchQueDevuelve = (cuerpo: any, status = 200) => {
  const llamadas: any[] = [];
  const impl = (async (url: any, init: any) => {
    llamadas.push({ url: String(url), init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(cuerpo), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { impl, llamadas };
};

const RESPUESTA_OK = {
  estado: "creada",
  usuarioEmail: "ana@example.com",
  resueltoPor: null,
  correo: { enviado: true, plantilla: "bienvenida", redirigido: false, destinatarioReal: null },
  advertencias: [],
  motivo: null,
};

describe("provisionarInversionista", () => {
  it("manda al endpoint de cuenta y devuelve el resultado tal cual", async () => {
    const { impl, llamadas } = fetchQueDevuelve(RESPUESTA_OK);
    const r = await provisionarInversionista(fila(), { ...OPTS_BASE, fetchImpl: impl });

    expect(llamadas[0].url).toBe(
      "http://auth-google:9500/internal/provisioning/ensure-investor-account",
    );
    expect(llamadas[0].init.headers["X-Provisioning-Secret"]).toBe("s3cr3to");
    expect(llamadas[0].body).toMatchObject({ email: "ana@example.com", dpi: "1234567890101" });
    expect(r).toMatchObject({ inversionistaId: 1, estado: "creada" });
  });

  it("a un inversionista sin correo lo omite EXPLÍCITAMENTE y no llama a nadie", async () => {
    const { impl, llamadas } = fetchQueDevuelve(RESPUESTA_OK);
    const r = await provisionarInversionista(fila({ email: null }), { ...OPTS_BASE, fetchImpl: impl });
    expect(r).toMatchObject({ estado: "omitida", motivo: "sin_correo" });
    expect(llamadas).toEqual([]);
  });

  it("una empresa avisa a su representante, resuelto contra cartera", async () => {
    const { impl, llamadas } = fetchQueDevuelve({ ...RESPUESTA_OK, estado: "avisada" });
    const r = await provisionarInversionista(
      fila({ inversionista_id: 86, nombre: "Cube Investments S.A.", dpi: null, dpi_rep_legal: "1573661970101" }),
      {
        ...OPTS_BASE,
        fetchImpl: impl,
        buscarRepresentante: async (dpi: string) => {
          expect(dpi).toBe("1573661970101");
          return { nombre: "Richard Kachler", email: "richardkachler93@gmail.com" };
        },
      },
    );

    expect(llamadas[0].url).toBe(
      "http://auth-google:9500/internal/provisioning/notify-company-added",
    );
    expect(llamadas[0].body).toMatchObject({
      representanteEmail: "richardkachler93@gmail.com",
      representanteDpi: "1573661970101",
      inversionistaNombre: "Cube Investments S.A.",
    });
    expect(r.estado).toBe("avisada");
  });

  it("si el representante no existe en cartera lo reporta, no adivina", async () => {
    const { impl, llamadas } = fetchQueDevuelve(RESPUESTA_OK);
    const r = await provisionarInversionista(
      fila({ dpi: null, dpi_rep_legal: "9999999999999" }),
      { ...OPTS_BASE, fetchImpl: impl, buscarRepresentante: async () => null },
    );
    expect(r).toMatchObject({ estado: "fallo", motivo: "representante_no_encontrado_en_cartera" });
    expect(llamadas).toEqual([]);
  });

  it("sin secreto configurado NO llama: lo reporta antes de salir a la red", async () => {
    const { impl, llamadas } = fetchQueDevuelve(RESPUESTA_OK);
    const r = await provisionarInversionista(fila(), { ...OPTS_BASE, secreto: "", fetchImpl: impl });
    expect(r).toMatchObject({ estado: "fallo", motivo: "provisionamiento_no_configurado" });
    expect(llamadas).toEqual([]);
  });

  it("NUNCA tira: el alta ya está escrita y un throw la haría parecer fallida", async () => {
    const impl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const r = await provisionarInversionista(fila(), { ...OPTS_BASE, fetchImpl: impl });
    expect(r.estado).toBe("fallo");
    expect(r.motivo).toContain("ECONNREFUSED");
  });

  it("un 503 del servicio se reporta como fallo legible", async () => {
    const { impl } = fetchQueDevuelve({ error: "provisioning_no_configurado" }, 503);
    const r = await provisionarInversionista(fila(), { ...OPTS_BASE, fetchImpl: impl });
    expect(r).toMatchObject({ estado: "fallo" });
    expect(r.motivo).toContain("503");
  });

  it("corta por timeout en vez de colgar el alta", async () => {
    const impl = ((_url: any, init: any) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
      })) as unknown as typeof fetch;

    const r = await provisionarInversionista(fila(), {
      ...OPTS_BASE,
      fetchImpl: impl,
      timeoutMs: 10,
    });
    expect(r).toMatchObject({ estado: "fallo", motivo: "timeout" });
  });

  it("propaga las advertencias del envío para que queden en audit_logs", async () => {
    const { impl } = fetchQueDevuelve({
      ...RESPUESTA_OK,
      correo: { enviado: true, plantilla: "bienvenida", redirigido: true, destinatarioReal: "jalvarado@clubcashin.com" },
      advertencias: ["correo_redirigido_por_modo_no_prod"],
    });
    const r = await provisionarInversionista(fila(), { ...OPTS_BASE, fetchImpl: impl });
    expect(r.correo).toMatchObject({ redirigido: true, destinatarioReal: "jalvarado@clubcashin.com" });
    expect(r.advertencias).toContain("correo_redirigido_por_modo_no_prod");
  });
});
