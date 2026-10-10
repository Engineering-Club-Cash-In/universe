import { describe, expect, test } from "bun:test";
// El controlador importa la base; con una URL inalcanzable el pool se crea sin conectarse.
process.env.SUPABASE_DB_URL ??= "postgresql://test@127.0.0.1:1/test";
const { mapNexaDashboardRows, parseNexaDashboardParams, mapNexaCreditPayments, mapPagosNexaCredito } = await import("./nexaDashboard");

describe("parseNexaDashboardParams", () => {
  test.each([
    [{}, { q: "", page: 1, pageSize: 20, desde: "", hasta: "", medio: "", cuotaMes: "" }],
    [{ q: "  juan ", page: "3", pageSize: "500" }, { q: "juan", page: 3, pageSize: 100, desde: "", hasta: "", medio: "", cuotaMes: "" }],
    [{ page: "-2", pageSize: "0" }, { q: "", page: 1, pageSize: 20, desde: "", hasta: "", medio: "", cuotaMes: "" }],
    [{ q: "x".repeat(150) }, { q: "x".repeat(100), page: 1, pageSize: 20, desde: "", hasta: "", medio: "", cuotaMes: "" }],
    [{ desde: "2026-09-01", hasta: "2026-09-30" }, { q: "", page: 1, pageSize: 20, desde: "2026-09-01", hasta: "2026-09-30", medio: "", cuotaMes: "" }],
    [{ desde: "2026-02-30", hasta: "30/09/2026" }, { q: "", page: 1, pageSize: 20, desde: "", hasta: "", medio: "", cuotaMes: "" }],
    [{ desde: "2026-09-01'; drop", hasta: 7 }, { q: "", page: 1, pageSize: 20, desde: "", hasta: "", medio: "", cuotaMes: "" }],
    // Postgres no tiene año 0000: llegaría al ::date y daría 500.
    [{ desde: "0000-01-01", hasta: "0001-01-01" }, { q: "", page: 1, pageSize: 20, desde: "", hasta: "0001-01-01", medio: "", cuotaMes: "" }],
    [{ medio: "nexa", cuotaMes: "pagados" }, { q: "", page: 1, pageSize: 20, desde: "", hasta: "", medio: "nexa", cuotaMes: "pagados" }],
    [{ medio: "manual", cuotaMes: "pagados" }, { q: "", page: 1, pageSize: 20, desde: "", hasta: "", medio: "manual", cuotaMes: "pagados" }],
    // El medio filtra con cualquier cuota salvo sinpago, donde se descarta.
    [{ medio: "nexa", cuotaMes: "pendientes" }, { q: "", page: 1, pageSize: 20, desde: "", hasta: "", medio: "nexa", cuotaMes: "pendientes" }],
    [{ medio: "manual" }, { q: "", page: 1, pageSize: 20, desde: "", hasta: "", medio: "manual", cuotaMes: "" }],
    [{ cuotaMes: "parciales" }, { q: "", page: 1, pageSize: 20, desde: "", hasta: "", medio: "", cuotaMes: "parciales" }],
    [{ cuotaMes: "sinpago" }, { q: "", page: 1, pageSize: 20, desde: "", hasta: "", medio: "", cuotaMes: "sinpago" }],
    [{ medio: "nexa", cuotaMes: "parciales" }, { q: "", page: 1, pageSize: 20, desde: "", hasta: "", medio: "nexa", cuotaMes: "parciales" }],
    [{ medio: "nexa", cuotaMes: "sinpago" }, { q: "", page: 1, pageSize: 20, desde: "", hasta: "", medio: "", cuotaMes: "sinpago" }],
    [{ medio: "otro", cuotaMes: "parciales" }, { q: "", page: 1, pageSize: 20, desde: "", hasta: "", medio: "", cuotaMes: "parciales" }],
    // Los valores viejos (pagada / vencida / por_vencer) ya no son filtros.
    [{ medio: "nexa", cuotaMes: "vencida" }, { q: "", page: 1, pageSize: 20, desde: "", hasta: "", medio: "nexa", cuotaMes: "" }],
    [{ medio: "NEXA", cuotaMes: "pagados" }, { q: "", page: 1, pageSize: 20, desde: "", hasta: "", medio: "", cuotaMes: "pagados" }],
    [{ medio: ["nexa"], cuotaMes: "pagados' OR '1'='1" }, { q: "", page: 1, pageSize: 20, desde: "", hasta: "", medio: "", cuotaMes: "" }],
  ])("%j → %j", (query, expected) => {
    expect(parseNexaDashboardParams(query)).toEqual(expected as ReturnType<typeof parseNexaDashboardParams>);
  });
});

describe("mapNexaDashboardRows", () => {
  const params = { q: "", page: 2, pageSize: 10, desde: "", hasta: "", cuotaMes: "" as const, medio: "" as const };
  const totales = (n: string) => ({
    total_creditos: n, total_con_token: "1", total_pagos_nexa: "8", total_monto_nexa: "8423.92",
    total_rechazos_nexa: "1", total_ultimo_pago_nexa: "2",
    d_creditos: "20", d_con_cuota_mes: "19", d_pagada_nexa: "5", d_pagada_manual: "2", d_parcial_nexa: "2",
    d_parcial_manual: "1", d_sin_pago: "9", d_vencida_sin_pago: "4", d_por_validar: "1", d_con_token: "18",
    d_pagos_nexa: "37", d_monto_nexa: "45210.50", d_rechazos_nexa: "3",
  });
  const desglose = {
    creditos: 20, conCuotaMes: 19, pagadaNexa: 5, pagadaManual: 2, parcialNexa: 2, parcialManual: 1, sinPago: 9,
    vencidaSinPago: 4, porValidar: 1, conToken: 18, pagosNexa: 37, montoNexa: "45210.50", rechazosNexa: 3,
  };
  const desgloseCero = {
    creditos: 0, conCuotaMes: 0, pagadaNexa: 0, pagadaManual: 0, parcialNexa: 0, parcialManual: 0, sinPago: 0,
    vencidaSinPago: 0, porValidar: 0, conToken: 0, pagosNexa: 0, montoNexa: "0", rechazosNexa: 0,
  };
  const fila = {
    credito_id: "445", numero_credito_sifco: "01010214116430", cliente: "Cliente 445", estado: "EN_CONVENIO",
    nexa_token: "1111222233334444", activo: true, ultimo_pago_fecha: "2026-10-05T10:00:00",
    ultimo_pago_monto: "50.00", ultimo_pago_nexa: true, ultimo_pago_banco: null, pagos_nexa: "5", monto_nexa: "600.00", rechazos_nexa: "1",
    rechazos_detalle: [{ fecha: "2026-10-05T11:16:49", monto: "50.00", codigo: "token_mismatch", estado: "failed" }],
    ultimas_cuotas: [{ numero: 18, vencimiento: "2026-10-05", pagada: true, medio: "NEXA", banco: null, aplicado: "1752.36", monto: "1752.36" }],
    cuota_mes_numero: 18, cuota_mes_vencimiento: "2026-10-05", cuota_mes_estado: "pagada",
    cuota_mes_pago: "completa", cuota_mes_aplicado: "1752.36", cuota_mes_monto: "1752.36", cuota_mes_medio: "NEXA",
    cuota_mes_por_validar: false,
    cuota_mes_cubierta_pendiente: false,
  };

  test("convierte filas y toma los totales de la primera", () => {
    const sinToken = { ...fila, credito_id: "352", nexa_token: null, ultimo_pago_fecha: null, ultimo_pago_monto: null, ultimo_pago_nexa: false };
    const result = mapNexaDashboardRows([{ ...fila, ...totales("2") }, { ...sinToken, ...totales("99") }], params);

    expect(result.creditos[0]).toEqual({
      creditoId: 445, numeroCreditoSifco: "01010214116430", cliente: "Cliente 445", estado: "EN_CONVENIO",
      nexaToken: "1111222233334444", bindingActivo: true, ultimoPagoFecha: "2026-10-05T10:00:00",
      ultimoPagoMonto: "50.00", ultimoPagoNexa: true, ultimoPagoBanco: null, pagosNexa: 5, montoNexa: "600.00", rechazosNexa: 1,
      rechazosDetalle: [{ fecha: "2026-10-05T11:16:49", monto: "50.00", codigo: "token_mismatch", estado: "failed" }],
      ultimasCuotas: [{ numero: 18, vencimiento: "2026-10-05", pagada: true, medio: "NEXA", banco: null, aplicado: "1752.36", monto: "1752.36" }],
      cuotaMes: { numero: 18, vencimiento: "2026-10-05", estado: "pagada", pago: "completa", aplicado: "1752.36", monto: "1752.36", medio: "NEXA", porValidar: false, cubiertaPorPendiente: false },
    });
    // Parcial: vencida con plata aplicada y sin medio de pago completo.
    const parcial = mapNexaDashboardRows([{ ...fila, cuota_mes_estado: "vencida", cuota_mes_pago: "parcial",
      cuota_mes_aplicado: "500.00", cuota_mes_medio: "MANUAL" }], params).creditos[0];
    expect(parcial!.cuotaMes).toEqual({ numero: 18, vencimiento: "2026-10-05", estado: "vencida", pago: "parcial", aplicado: "500.00", monto: "1752.36", medio: "MANUAL", porValidar: false, cubiertaPorPendiente: false });
    expect(result.creditos[1]).toMatchObject({ creditoId: 352, nexaToken: null, ultimoPagoFecha: null, ultimoPagoMonto: null, ultimoPagoNexa: false });
    // Manual con banco, sin cuotas ni rechazos: el SQL los manda NULL.
    const manual = mapNexaDashboardRows([{ ...fila, ultimo_pago_banco: "Banrural", rechazos_detalle: null, ultimas_cuotas: null,
      cuota_mes_numero: null, cuota_mes_vencimiento: null, cuota_mes_estado: null }], params).creditos[0];
    expect(manual).toMatchObject({ ultimoPagoBanco: "Banrural", rechazosDetalle: [], ultimasCuotas: [], cuotaMes: null });
    expect(result.totales).toEqual({ creditos: 2, conToken: 1, pagosNexa: 8, montoNexa: "8423.92", rechazosNexa: 1, ultimoPagoNexa: 2, desglose });
    expect({ total: result.total, page: result.page, pageSize: result.pageSize }).toEqual({ total: 2, page: 2, pageSize: 10 });
  });

  test("cubiertaPorPendiente de la cuota del mes: solo un true del SQL lo prende", () => {
    const de = (v: unknown) => mapNexaDashboardRows([{ ...fila, cuota_mes_cubierta_pendiente: v }], params).creditos[0]!.cuotaMes!.cubiertaPorPendiente;
    expect(de(true)).toBe(true);
    for (const v of [false, null, undefined, "t", 1]) expect(de(v)).toBe(false);
  });

  test("porValidar de la cuota del mes: solo un true del SQL lo prende", () => {
    const de = (v: unknown) => mapNexaDashboardRows([{ ...fila, cuota_mes_por_validar: v }], params).creditos[0]!.cuotaMes!.porValidar;
    expect(de(true)).toBe(true);
    // El SQL lo manda con COALESCE; un null o un texto no inventan un aviso.
    for (const v of [false, null, undefined, "false", "t"]) expect(de(v)).toBe(false);
  });

  test("página vacía: la fila solo de totales no es un crédito", () => {
    const result = mapNexaDashboardRows([{ credito_id: null, ...totales("21") }], params);
    expect(result.creditos).toEqual([]);
    expect(result.total).toBe(21);
    expect(result.totales).toEqual({ creditos: 21, conToken: 1, pagosNexa: 8, montoNexa: "8423.92", rechazosNexa: 1, ultimoPagoNexa: 2, desglose });
  });

  test("sin filas: totales en cero", () => {
    expect(mapNexaDashboardRows([], params)).toEqual({
      totales: { creditos: 0, conToken: 0, pagosNexa: 0, montoNexa: "0", rechazosNexa: 0, ultimoPagoNexa: 0, desglose: desgloseCero },
      creditos: [], total: 0, page: 2, pageSize: 10,
    });
  });
});

describe("mapNexaCreditPayments", () => {
  test("agrupa pagos Nexa y manuales con validación correcta", () => {
    const pagos = [
      {
        fecha_pago: "2026-10-04T15:30:00", monto_boleta: "500.00", es_nexa: true, registrado_por: null,
        autorizacion: "AUTH123", validado: true, filas: "3", evento_estado: "billed", cuotas: [18, 19, 20], banco: null,
      },
      {
        fecha_pago: "2026-10-03T10:00:00", monto_boleta: "250.00", es_nexa: false, registrado_por: "cobros@x.com",
        autorizacion: null, validado: false, filas: "2", evento_estado: null, cuotas: null, banco: "Banco Industrial",
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
      registradoPor: null, autorizacion: "AUTH123", validado: true, filas: 3, eventoEstado: "billed", cuotas: [18, 19, 20], banco: null,
    });
    expect(result.pagos[1]).toEqual({
      fechaPago: "2026-10-03T10:00:00", montoBoleta: "250.00", canal: "MANUAL",
      registradoPor: "cobros@x.com", autorizacion: null, validado: false, filas: 2, eventoEstado: null, cuotas: [], banco: "Banco Industrial",
    });
    expect(result.eventosSinPago[0]).toEqual({
      referencia: "E2E-1", monto: "50.00", estado: "failed", error: "token_mismatch", creado: "2026-10-05T10:00:00", tieneFilasVivas: false,
    });
  });

  test("listas vacías retorna respuesta vacía", () => {
    const result = mapNexaCreditPayments(7, [], []);
    expect(result).toEqual({ creditoId: 7, pagos: [], eventosSinPago: [] });
  });
});

describe("mapPagosNexaCredito", () => {
  test("convierte la fila", () => {
    expect(mapPagosNexaCredito({ cantidad: "2", monto_total: "450.00" })).toEqual({ cantidad: 2, montoTotal: "450.00" });
  });
  test("sin fila: cero", () => {
    expect(mapPagosNexaCredito(undefined)).toEqual({ cantidad: 0, montoTotal: "0" });
  });
});
