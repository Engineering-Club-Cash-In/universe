import { describe, expect, it, mock, spyOn } from "bun:test";
import type { PagaloGrupoSupervision, PagaloSupervisionResponse } from "../services/crm.service";

const getPagaloSupervision = mock(
  async (_params: any, _timeout?: number): Promise<PagaloSupervisionResponse> => ({
    success: true,
    grupos: [] as PagaloGrupoSupervision[],
    total: 0,
    conteoPorEstado: {},
  }),
);

// Se reexporta lo demás del módulo: `mock.module` lo reemplaza para todo el
// proceso de test, y los suites que importan otras funciones de crm.service
// (p. ej. reportes.test.ts con getVehiclesBySifcoMap) abortarían al cargar.
const crmServiceReal = await import("../services/crm.service");
mock.module("../services/crm.service", () => ({
  ...crmServiceReal,
  getPagaloSupervision,
}));

const {
  traerDatasetCompletoPagalo,
  LIMITE_EXPORT_PAGALO,
  fetchLogoBase64,
  TIMEOUT_LOGO_MS,
  buildPagaloSupervisionWorkbook,
  buildPagaloSupervisionHTML,
} = await import("./pagaloSupervisionReporte");

const grupo = (id: string): PagaloGrupoSupervision =>
  ({ id, numeroCreditoSifco: id, totalAmount: "100", origen: "BOT" }) as PagaloGrupoSupervision;

const grupos = (desde: number, cantidad: number) =>
  Array.from({ length: cantidad }, (_, i) => grupo(`g${desde + i}`));

describe("traerDatasetCompletoPagalo", () => {
  it("encadena páginas hasta agotar el total del servidor", async () => {
    getPagaloSupervision.mockClear();
    getPagaloSupervision
      .mockResolvedValueOnce({
        success: true,
        grupos: grupos(0, 1000),
        total: 1500,
        conteoPorEstado: {},
        resumenKpis: {
          grupos: 1500,
          capitalTotal: "10000",
          facturableTotal: "5000",
          totalAmount: "15000",
          linksTotal: 3000,
          linksPagados: 100,
        },
      })
      .mockResolvedValueOnce({ success: true, grupos: grupos(1000, 500), total: 1500, conteoPorEstado: {} });

    const resultado = await traerDatasetCompletoPagalo({});

    expect(resultado.filas).toHaveLength(1500);
    expect(resultado.total).toBe(1500);
    expect(resultado.truncado).toBe(false);
    expect(resultado.resumenKpis).toEqual({
      grupos: 1500,
      capitalTotal: "10000",
      facturableTotal: "5000",
      totalAmount: "15000",
      linksTotal: 3000,
      linksPagados: 100,
    });
    expect(getPagaloSupervision).toHaveBeenCalledTimes(2);
    expect(getPagaloSupervision.mock.calls[0][0].incluirKpis).toBe(true);
    expect(getPagaloSupervision.mock.calls[1][0].offset).toBe(1000);
    expect(getPagaloSupervision.mock.calls[1][0].incluirKpis).toBe(false);
  });

  it("deduplica por id los grupos que se repiten entre páginas y marca el faltante", async () => {
    getPagaloSupervision.mockClear();
    // Una página puede corrérsele al llegar una escritura entre request y
    // request: sin dedup el mismo grupo saldría dos veces en el reporte.
    getPagaloSupervision
      .mockResolvedValueOnce({ success: true, grupos: grupos(0, 1000), total: 1200, conteoPorEstado: {} })
      .mockResolvedValueOnce({ success: true, grupos: grupos(990, 200), total: 1200, conteoPorEstado: {} });

    const resultado = await traerDatasetCompletoPagalo({});

    expect(resultado.filas).toHaveLength(1190);
    expect(new Set(resultado.filas.map((f) => f.id)).size).toBe(1190);
    // Las 10 filas que el corrimiento dejó fuera nunca se piden: el archivo sale
    // incompleto y tiene que decirlo, aunque el total esté lejos del tope.
    expect(resultado.truncado).toBe(true);
  });

  it("no marca truncado cuando el dataset vino completo", async () => {
    getPagaloSupervision.mockClear();
    getPagaloSupervision.mockResolvedValueOnce({
      success: true,
      grupos: grupos(0, 300),
      total: 300,
      conteoPorEstado: {},
    });

    const resultado = await traerDatasetCompletoPagalo({});

    expect(resultado.filas).toHaveLength(300);
    expect(resultado.truncado).toBe(false);
  });

  it("no marca truncado por un dataset vacío", async () => {
    getPagaloSupervision.mockClear();
    getPagaloSupervision.mockResolvedValueOnce({
      success: true,
      grupos: [],
      total: 0,
      conteoPorEstado: {},
    });

    const resultado = await traerDatasetCompletoPagalo({});

    expect(resultado.filas).toHaveLength(0);
    expect(resultado.truncado).toBe(false);
  });

  it("corta en el límite y marca truncado cuando el filtro excede el tope", async () => {
    getPagaloSupervision.mockClear();
    getPagaloSupervision.mockImplementation(async (params: any) => ({
      success: true,
      grupos: grupos(params.offset, 1000),
      total: 9000,
      conteoPorEstado: {},
    }));

    const resultado = await traerDatasetCompletoPagalo({});

    expect(resultado.filas).toHaveLength(LIMITE_EXPORT_PAGALO);
    expect(resultado.total).toBe(9000);
    expect(resultado.truncado).toBe(true);
  });

  it("falla con un mensaje claro si el CRM responde sin el listado", async () => {
    getPagaloSupervision.mockClear();
    getPagaloSupervision.mockResolvedValueOnce({ success: false } as any);

    // Sin la guarda, esto reventaba con "grupos is not iterable" y el usuario
    // recibía un 500 opaco en vez de un archivo.
    await expect(traerDatasetCompletoPagalo({})).rejects.toThrow(
      /listado de grupos/,
    );
  });

  it("propaga los filtros a cada página pedida al CRM", async () => {
    getPagaloSupervision.mockClear();
    getPagaloSupervision.mockResolvedValueOnce({
      success: true,
      grupos: grupos(0, 5),
      total: 5,
      conteoPorEstado: {},
    });

    await traerDatasetCompletoPagalo({ fechaDesde: "2026-01-01", sortBy: "totalAmount" });

    expect(getPagaloSupervision.mock.calls[0][0]).toMatchObject({
      fechaDesde: "2026-01-01",
      sortBy: "totalAmount",
    });
  });
});

describe("fetchLogoBase64", () => {
  it("incluye timeout acotado y retorna base64 si responde ok", async () => {
    const axios = (await import("axios")).default;
    const spyAxios = spyOn(axios, "get").mockResolvedValueOnce({
      data: Buffer.from("fake-png"),
      headers: { "content-type": "image/png" },
    });

    const logo = await fetchLogoBase64();
    expect(logo).not.toBeNull();
    expect(logo?.ext).toBe("png");
    expect(spyAxios).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeout: TIMEOUT_LOGO_MS, responseType: "arraybuffer" }),
    );
  });

  it("retorna null en caso de timeout o error sin arrojar excepción", async () => {
    const axios = (await import("axios")).default;
    spyOn(axios, "get").mockRejectedValueOnce(new Error("timeout of 5000ms exceeded"));

    const logo = await fetchLogoBase64();
    expect(logo).toBeNull();
  });

  it("genera el Excel y el HTML correctamente cuando el logo no está disponible", async () => {
    const axios = (await import("axios")).default;
    spyOn(axios, "get").mockRejectedValue(new Error("Host unreachable"));

    const filasPrueba: PagaloGrupoSupervision[] = [
      {
        id: "g1",
        numeroCreditoSifco: "010101",
        clienteNombre: "Cliente Prueba",
        asesoresNombres: ["Asesor 1"],
        status: "PENDING_PAYMENT",
        totalAmount: "100",
        capitalTotal: "80",
        facturableTotal: "20",
        origen: "BOT",
        createdAt: "2026-01-01T00:00:00Z",
        links: [],
      } as unknown as PagaloGrupoSupervision,
    ];
    const wbBuffer = await buildPagaloSupervisionWorkbook(filasPrueba);
    expect(wbBuffer.byteLength).toBeGreaterThan(0);

    const html = await buildPagaloSupervisionHTML(filasPrueba, {
      total: 1,
      truncado: false,
    });
    expect(html).toContain("Supervisión Págalo");
    expect(html).toContain("010101");
  });
});
