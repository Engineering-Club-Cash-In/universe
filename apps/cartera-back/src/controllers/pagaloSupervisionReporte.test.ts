import { describe, expect, it, mock } from "bun:test";
import type { PagaloGrupoSupervision } from "../services/crm.service";

const getPagaloSupervision = mock(
  async (_params: any, _timeout?: number) => ({
    success: true,
    grupos: [] as PagaloGrupoSupervision[],
    total: 0,
    conteoPorEstado: {},
  }),
);

mock.module("../services/crm.service", () => ({ getPagaloSupervision }));

const { traerDatasetCompletoPagalo, LIMITE_EXPORT_PAGALO } = await import(
  "./pagaloSupervisionReporte"
);

const grupo = (id: string): PagaloGrupoSupervision =>
  ({ id, numeroCreditoSifco: id, totalAmount: "100", origen: "BOT" }) as PagaloGrupoSupervision;

const grupos = (desde: number, cantidad: number) =>
  Array.from({ length: cantidad }, (_, i) => grupo(`g${desde + i}`));

describe("traerDatasetCompletoPagalo", () => {
  it("encadena páginas hasta agotar el total del servidor", async () => {
    getPagaloSupervision.mockClear();
    getPagaloSupervision
      .mockResolvedValueOnce({ success: true, grupos: grupos(0, 1000), total: 1500, conteoPorEstado: {} })
      .mockResolvedValueOnce({ success: true, grupos: grupos(1000, 500), total: 1500, conteoPorEstado: {} });

    const resultado = await traerDatasetCompletoPagalo({});

    expect(resultado.filas).toHaveLength(1500);
    expect(resultado.total).toBe(1500);
    expect(resultado.truncado).toBe(false);
    expect(getPagaloSupervision).toHaveBeenCalledTimes(2);
    expect(getPagaloSupervision.mock.calls[1][0].offset).toBe(1000);
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
