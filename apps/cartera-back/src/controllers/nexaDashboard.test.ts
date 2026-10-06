import { describe, expect, test } from "bun:test";
// El controlador importa la base; con una URL inalcanzable el pool se crea sin conectarse.
process.env.SUPABASE_DB_URL ??= "postgresql://test@127.0.0.1:1/test";
const { mapNexaDashboardRows, parseNexaDashboardParams, mapNexaCreditPayments } = await import("./nexaDashboard");

describe("parseNexaDashboardParams", () => {
  test.each([
    [{}, { q: "", page: 1, pageSize: 20 }],
    [{ q: "  juan ", page: "3", pageSize: "500" }, { q: "juan", page: 3, pageSize: 100 }],
    [{ page: "-2", pageSize: "0" }, { q: "", page: 1, pageSize: 20 }],
    [{ q: "x".repeat(150) }, { q: "x".repeat(100), page: 1, pageSize: 20 }],
  ])("%j → %j", (query, expected) => {
    expect(parseNexaDashboardParams(query)).toEqual(expected);
  });
});

describe("mapNexaDashboardRows", () => {
  const params = { q: "", page: 2, pageSize: 10 };
  const totales = (n: string) => ({
    total_creditos: n, total_con_token: "1", total_pagos_nexa: "8", total_monto_nexa: "8423.92",
    total_rechazos_nexa: "1", total_ultimo_pago_nexa: "2",
  });
  const fila = {
    credito_id: "445", numero_credito_sifco: "01010214116430", cliente: "Cliente 445", estado: "EN_CONVENIO",
    nexa_token: "1111222233334444", activo: true, ultimo_pago_fecha: "2026-10-05T10:00:00",
    ultimo_pago_monto: "50.00", ultimo_pago_nexa: true, pagos_nexa: "5", monto_nexa: "600.00", rechazos_nexa: "1",
  };

  test("convierte filas y toma los totales de la primera", () => {
    const sinToken = { ...fila, credito_id: "352", nexa_token: null, ultimo_pago_fecha: null, ultimo_pago_monto: null, ultimo_pago_nexa: false };
    const result = mapNexaDashboardRows([{ ...fila, ...totales("2") }, { ...sinToken, ...totales("99") }], params);

    expect(result.creditos[0]).toEqual({
      creditoId: 445, numeroCreditoSifco: "01010214116430", cliente: "Cliente 445", estado: "EN_CONVENIO",
      nexaToken: "1111222233334444", bindingActivo: true, ultimoPagoFecha: "2026-10-05T10:00:00",
      ultimoPagoMonto: "50.00", ultimoPagoNexa: true, pagosNexa: 5, montoNexa: "600.00", rechazosNexa: 1,
    });
    expect(result.creditos[1]).toMatchObject({ creditoId: 352, nexaToken: null, ultimoPagoFecha: null, ultimoPagoMonto: null, ultimoPagoNexa: false });
    expect(result.totales).toEqual({ creditos: 2, conToken: 1, pagosNexa: 8, montoNexa: "8423.92", rechazosNexa: 1, ultimoPagoNexa: 2 });
    expect({ total: result.total, page: result.page, pageSize: result.pageSize }).toEqual({ total: 2, page: 2, pageSize: 10 });
  });

  test("sin filas: totales en cero", () => {
    expect(mapNexaDashboardRows([], params)).toEqual({
      totales: { creditos: 0, conToken: 0, pagosNexa: 0, montoNexa: "0", rechazosNexa: 0, ultimoPagoNexa: 0 },
      creditos: [], total: 0, page: 2, pageSize: 10,
    });
  });
});

describe("mapNexaCreditPayments", () => {
  test("agrupa pagos Nexa y manuales con validación correcta", () => {
    const pagos = [
      {
        fecha_pago: "2026-10-04T15:30:00", monto_boleta: "500.00", es_nexa: true, registrado_por: null,
        autorizacion: "AUTH123", validado: true, filas: "3", evento_estado: "billed",
      },
      {
        fecha_pago: "2026-10-03T10:00:00", monto_boleta: "250.00", es_nexa: false, registrado_por: "cobros@x.com",
        autorizacion: null, validado: false, filas: "2", evento_estado: null,
      },
    ];
    const eventos = [
      {
        referencia: "E2E-1", monto: "50.00", estado: "failed", error: "token_mismatch",
        creado: "2026-10-05T10:00:00",
      },
    ];
    const result = mapNexaCreditPayments(7, pagos, eventos);

    expect(result.creditoId).toBe(7);
    expect(result.pagos[0]).toEqual({
      fechaPago: "2026-10-04T15:30:00", montoBoleta: "500.00", canal: "NEXA",
      registradoPor: null, autorizacion: "AUTH123", validado: true, filas: 3, eventoEstado: "billed",
    });
    expect(result.pagos[1]).toEqual({
      fechaPago: "2026-10-03T10:00:00", montoBoleta: "250.00", canal: "MANUAL",
      registradoPor: "cobros@x.com", autorizacion: null, validado: false, filas: 2, eventoEstado: null,
    });
    expect(result.eventosSinPago[0]).toEqual({
      referencia: "E2E-1", monto: "50.00", estado: "failed", error: "token_mismatch", creado: "2026-10-05T10:00:00",
    });
  });

  test("listas vacías retorna respuesta vacía", () => {
    const result = mapNexaCreditPayments(7, [], []);
    expect(result).toEqual({ creditoId: 7, pagos: [], eventosSinPago: [] });
  });
});
