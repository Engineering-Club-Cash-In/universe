import { expect, test } from "bun:test";
import { avisoCuotaMesNexa, mesLargoNexa, porcentajesNexa, segmentosCuotaMesNexa, bancoTexto, conteoFranjaNexa, diasAlVencimiento, esParcialNexa, estadoCuotaTexto, fraccionPagadaNexa, hoyGuatemala, mesCortoNexa, rellenoCuotaNexa, resumenFranjaNexa, pagoCuotaMesTexto, resumenRechazosNexa, tituloCuotaNexa, tonoCuotaNexa } from "./cuotasNexa";
import { estadoNexa, motivoRechazoNexa } from "./estadoNexa";

const cuota = (o) => ({ numero: 18, vencimiento: "2026-09-05", pagada: true, medio: "NEXA", banco: null, aplicado: "1752.36", monto: "1752.36", ...o });

test("color: morado Nexa, verde otro medio, gris no pagada aunque tenga abono", () => {
  expect(tonoCuotaNexa(cuota({}))).toBe("nexa");
  expect(tonoCuotaNexa(cuota({ medio: "MANUAL", banco: "Banrural" }))).toBe("otro");
  expect(tonoCuotaNexa(cuota({ pagada: false, medio: "NEXA" }))).toBe("pendiente");
  expect(tonoCuotaNexa(cuota({ pagada: false, medio: null }))).toBe("pendiente");
});

test("tooltip: número, vencimiento, completo o parcial, medio y banco", () => {
  expect(tituloCuotaNexa(cuota({}))).toBe("Cuota 18 · vence 05/09/2026 · Pagada · pago completo · Nexa");
  expect(tituloCuotaNexa(cuota({ medio: "MANUAL", banco: "Banrural" }))).toBe("Cuota 18 · vence 05/09/2026 · Pagada · pago completo · Manual · Banrural");
  expect(tituloCuotaNexa(cuota({ medio: "MANUAL" }))).toBe("Cuota 18 · vence 05/09/2026 · Pagada · pago completo · Manual · Sin banco");
  expect(tituloCuotaNexa(cuota({ pagada: false, medio: null, aplicado: "0.00" }))).toBe("Cuota 18 · vence 05/09/2026 · No pagada");
  // Pagada solo por el flag: completa aunque no tenga plata aplicada.
  expect(tituloCuotaNexa(cuota({ medio: null, aplicado: "0.00" }))).toBe("Cuota 18 · vence 05/09/2026 · Pagada · pago completo · sin detalle del medio");
  expect(tonoCuotaNexa(cuota({ medio: null }))).toBe("otro");
  expect(tituloCuotaNexa(cuota({ pagada: false, medio: "NEXA", aplicado: "500.00" })))
    .toBe("Cuota 18 · vence 05/09/2026 · No pagada · pago parcial Q 500.00 de Q 1,752.36 · Nexa");
  expect(tituloCuotaNexa(cuota({ pagada: false, medio: "MANUAL", banco: "Banrural", aplicado: "242.45", monto: "3751.51" })))
    .toBe("Cuota 18 · vence 05/09/2026 · No pagada · pago parcial Q 242.45 de Q 3,751.51 · Manual · Banrural");
});

test("parcial: no pagada con plata aplicada; la barra se llena con el color del medio", () => {
  expect(esParcialNexa(cuota({ pagada: false, aplicado: "500.00" }))).toBe(true);
  expect(esParcialNexa(cuota({ pagada: false, aplicado: "0.00" }))).toBe(false);
  expect(esParcialNexa(cuota({ pagada: true, aplicado: "500.00" }))).toBe(false);
  expect(rellenoCuotaNexa(cuota({ medio: "NEXA" }))).toBe("bg-purple-600");
  expect(rellenoCuotaNexa(cuota({ medio: "MANUAL" }))).toBe("bg-green-600");
  expect(rellenoCuotaNexa(cuota({ medio: null }))).toBe("bg-green-600");
});

test("relleno de la barra: pagada llena, parcial en proporción (con topes), sin pago vacía", () => {
  expect(fraccionPagadaNexa(cuota({}))).toBe(1);
  expect(fraccionPagadaNexa(cuota({ aplicado: "0.00", medio: null }))).toBe(1);
  expect(fraccionPagadaNexa(cuota({ pagada: false, aplicado: "600.00", monto: "1000.00" }))).toBe(0.6);
  // Un abono chico igual se ve; un parcial casi completo no parece pagado.
  expect(fraccionPagadaNexa(cuota({ pagada: false, aplicado: "1.00", monto: "1000.00" }))).toBe(0.08);
  expect(fraccionPagadaNexa(cuota({ pagada: false, aplicado: "999.00", monto: "1000.00" }))).toBe(0.92);
  expect(fraccionPagadaNexa(cuota({ pagada: false, aplicado: "0.00" }))).toBe(0);
  expect(fraccionPagadaNexa(cuota({ pagada: false, aplicado: "50.00", monto: "0" }))).toBe(0);
});

test("fechas: mes corto, días al vencimiento y hoy en Guatemala", () => {
  expect(mesCortoNexa("2026-05-05")).toBe("may");
  expect(mesCortoNexa("2025-12-31")).toBe("dic");
  expect(diasAlVencimiento("2026-10-05", "2026-10-08")).toBe(-3);
  expect(diasAlVencimiento("2026-10-08", "2026-10-08")).toBe(0);
  expect(diasAlVencimiento("2026-11-01", "2026-10-31")).toBe(1);
  expect(diasAlVencimiento("2026-03-10", "2026-02-28")).toBe(10);
  // 03:00 UTC del 9 = 21:00 del 8 en Guatemala (UTC-6).
  expect(hoyGuatemala(new Date("2026-10-09T03:00:00Z"))).toBe("2026-10-08");
});

test("estado de cada cuota en una frase", () => {
  const hoy = "2026-10-08";
  expect(estadoCuotaTexto(cuota({}), hoy)).toBe("Pagada por Nexa");
  expect(estadoCuotaTexto(cuota({ medio: "MANUAL", banco: "Banrural" }), hoy)).toBe("Pagada por otro medio (Banrural)");
  expect(estadoCuotaTexto(cuota({ medio: null }), hoy)).toBe("Pagada (sin detalle del medio)");
  expect(estadoCuotaTexto(cuota({ pagada: false, aplicado: "600.00", monto: "1000.00" }), hoy))
    .toBe("Vencida, pago parcial Q 600.00 de Q 1,000.00 por Nexa");
  expect(estadoCuotaTexto(cuota({ pagada: false, medio: null, aplicado: "0.00" }), hoy)).toBe("Vencida, sin pagar");
  expect(estadoCuotaTexto(cuota({ pagada: false, medio: null, aplicado: "0.00", vencimiento: "2026-10-08" }), hoy)).toBe("Por vencer, sin pagar");
});

test("resumen de la franja: conteo y rango de meses", () => {
  const cuotas = [
    cuota({ numero: 30, vencimiento: "2025-11-05" }),
    cuota({ numero: 31, vencimiento: "2025-12-05", medio: "MANUAL" }),
    cuota({ numero: 32, vencimiento: "2026-01-05", pagada: false, aplicado: "100.00" }),
    cuota({ numero: 33, vencimiento: "2026-02-05", pagada: false, medio: null, aplicado: "0.00" }),
  ];
  expect(conteoFranjaNexa(cuotas)).toBe("2 pagadas (1 por Nexa) · 1 parcial · 1 sin pagar");
  expect(resumenFranjaNexa(cuotas)).toBe("4 cuotas, de nov 2025 a feb 2026: 2 pagadas (1 por Nexa) · 1 parcial · 1 sin pagar");
  expect(resumenFranjaNexa([])).toBe("Sin cuotas");
  expect(conteoFranjaNexa([cuota({ medio: "MANUAL" })])).toBe("1 pagada");
});

test("cuota del mes en palabras: titular, detalle y versión corta", () => {
  const hoy = "2026-10-08";
  const mes = (o) => ({ numero: 41, vencimiento: "2026-10-05", estado: "pagada", pago: "completa", aplicado: "1000.00", monto: "1000.00", medio: "NEXA", ...o });
  expect(avisoCuotaMesNexa(mes({}), hoy)).toEqual({
    etiqueta: "Cuota de este mes", tono: "nexa", titulo: "Pagada por Nexa", detalle: "Pago completo", corto: "Completa",
    porValidar: false, leido: "Pagada por Nexa",
  });
  expect(avisoCuotaMesNexa(mes({ medio: "MANUAL" }), hoy, "Banrural")).toMatchObject({
    tono: "otro", titulo: "Pagada por otro medio", detalle: "Pago completo · Banrural", corto: "Completa · Banrural",
  });
  expect(avisoCuotaMesNexa(mes({ medio: null }), hoy)).toMatchObject({ tono: "otro", titulo: "Pagada", detalle: "Pago completo · sin detalle del medio" });
  // Freddy: vencida con parcial Nexa.
  expect(avisoCuotaMesNexa(mes({ estado: "vencida", pago: "parcial", aplicado: "600.00" }), hoy)).toEqual({
    etiqueta: "Cuota de este mes", tono: "vencida", titulo: "Vencida hace 3 días",
    detalle: "Pago parcial: Q 600.00 de Q 1,000.00 por Nexa · faltan Q 400.00", corto: "Parcial Q 600.00 de Q 1,000.00 · Nexa",
    porValidar: false, leido: "Vencida hace 3 días",
  });
  expect(avisoCuotaMesNexa(mes({ estado: "vencida", pago: "parcial", aplicado: "0.10", monto: "0.30", medio: "MANUAL" }), "2026-10-06", "BI").detalle)
    .toBe("Pago parcial: Q 0.10 de Q 0.30 por otro medio (BI) · faltan Q 0.20");
  expect(avisoCuotaMesNexa(mes({ estado: "vencida", pago: "sin_pago", aplicado: "0.00", medio: null }), "2026-10-06"))
    .toMatchObject({ titulo: "Vencida hace 1 día", detalle: "Sin pagos · faltan Q 1,000.00", corto: "Sin pagos" });
  const porVencer = mes({ vencimiento: "2026-10-11", estado: "por_vencer", pago: "sin_pago", aplicado: "0.00", medio: null });
  expect(avisoCuotaMesNexa(porVencer, hoy)).toMatchObject({ tono: "pendiente", titulo: "Pendiente · vence en 3 días" });
  expect(avisoCuotaMesNexa(porVencer, "2026-10-10").titulo).toBe("Pendiente · vence mañana");
  expect(avisoCuotaMesNexa(porVencer, "2026-10-11").titulo).toBe("Pendiente · vence hoy");
  // Sin cuota este mes: el back manda la última vencida.
  expect(avisoCuotaMesNexa(mes({ vencimiento: "2026-09-05" }), hoy).etiqueta).toBe("Último vencimiento");
});

test("cuota del mes: completa con su medio, parcial con su monto, o sin pago", () => {
  const mes = (o) => ({ numero: 18, vencimiento: "2026-10-15", estado: "pagada", pago: "completa", aplicado: "1752.36", monto: "1752.36", medio: "NEXA", ...o });
  expect(pagoCuotaMesTexto(mes({}))).toBe("Completa · Nexa");
  expect(pagoCuotaMesTexto(mes({ medio: "MANUAL" }))).toBe("Completa · Manual");
  expect(pagoCuotaMesTexto(mes({ medio: null, aplicado: "0.00" }))).toBe("Completa · Manual");
  expect(pagoCuotaMesTexto(mes({ estado: "vencida", pago: "parcial", aplicado: "2994.30", monto: "5617.77" }))).toBe("Parcial · Q 2,994.30 de Q 5,617.77");
  expect(pagoCuotaMesTexto(mes({ estado: "por_vencer", pago: "sin_pago", aplicado: "0.00", medio: null }))).toBe("Sin pago");
});

test("banco: Nexa dice Nexa; manual sin banco dice Sin banco", () => {
  expect(bancoTexto("NEXA", "Banrural")).toBe("Nexa");
  expect(bancoTexto("MANUAL", "Banco Industrial")).toBe("Banco Industrial");
  expect(bancoTexto("MANUAL", null)).toBe("Sin banco");
});

test("motivos de rechazo en español, con genérico para los desconocidos", () => {
  expect(motivoRechazoNexa("token_mismatch")).toBe("El token es de otro crédito");
  expect(motivoRechazoNexa("binding_inactive")).toBe("Crédito cancelado");
  expect(motivoRechazoNexa("credit_cancelled")).toBe("Crédito cancelado");
  expect(motivoRechazoNexa("payment_not_applied")).toBe("Cartera no pudo aplicar el pago");
  expect(motivoRechazoNexa("credit_not_payable")).toBe("El crédito no admite pagos en su estado");
  expect(motivoRechazoNexa("amount_exceeds_binding")).toBe("El monto supera el tope permitido para Nexa");
  expect(motivoRechazoNexa("binding_expired")).toBe("La habilitación de Nexa del crédito venció");
  expect(motivoRechazoNexa("payment_outcome_uncertain:condonacion_anulada")).toBe("No se pudo confirmar si el pago quedó aplicado (condonacion_anulada)");
  expect(motivoRechazoNexa("codigo_nuevo")).toBe("Otro motivo (codigo_nuevo)");
  expect(motivoRechazoNexa(null)).toBe("Otro motivo (sin código)");
});

test("revisión manual se distingue de rechazado", () => {
  expect(estadoNexa("manual_review").etiqueta).toBe("En revisión manual");
  expect(estadoNexa("failed").etiqueta).toBe("Rechazado");
});

test("resumen de rechazos: separa rechazados de revisión manual y avisa si hay más", () => {
  const r = (estado) => ({ fecha: "2026-10-05T10:00:00", monto: "50.00", codigo: "token_mismatch", estado });
  expect(resumenRechazosNexa([r("failed")], 1)).toBe("1 rechazado");
  expect(resumenRechazosNexa([r("failed"), r("failed"), r("manual_review")], 3)).toBe("2 rechazados · 1 en revisión manual");
  expect(resumenRechazosNexa([r("manual_review")], 4)).toBe("1 en revisión manual · 3 más");
  expect(resumenRechazosNexa([], 0)).toBe("");
});

test("por validar: la cuota pagada con un pago pendiente sigue pagada y lo avisa en todos los textos", () => {
  const hoy = "2026-10-08";
  // Caso real: crédito 961, cuota 39, pago 53563 manual sin validar.
  const mes = { numero: 39, vencimiento: "2026-10-06", estado: "pagada", pago: "completa", aplicado: "1627.78", monto: "1627.78", medio: "MANUAL", porValidar: true };
  expect(avisoCuotaMesNexa(mes, hoy, "Banco Industrial")).toMatchObject({
    tono: "otro", titulo: "Pagada por otro medio", porValidar: true, leido: "Pagada por otro medio · Por validar",
    corto: "Completa · Banco Industrial",
  });
  // Parcial con pago pendiente: también.
  expect(avisoCuotaMesNexa({ ...mes, estado: "vencida", pago: "parcial", aplicado: "600.00" }, hoy).porValidar).toBe(true);
  // Sin pago no tiene nada que validar, aunque el flag venga prendido.
  expect(avisoCuotaMesNexa({ ...mes, estado: "vencida", pago: "sin_pago", aplicado: "0.00", medio: null }, hoy).porValidar).toBe(false);
  // Franja: detalle, tooltip y conteo.
  const c39 = cuota({ numero: 39, vencimiento: "2026-10-06", medio: "MANUAL", banco: "Banco Industrial", porValidar: true });
  expect(estadoCuotaTexto(c39, hoy)).toBe("Pagada por otro medio (Banco Industrial) · pago por validar");
  expect(tituloCuotaNexa(c39)).toBe("Cuota 39 · vence 06/10/2026 · Pagada · pago completo · Manual · Banco Industrial · pago por validar");
  expect(estadoCuotaTexto(cuota({ porValidar: false }), hoy)).toBe("Pagada por Nexa");
  expect(conteoFranjaNexa([c39, cuota({ numero: 38 })])).toBe("2 pagadas (1 por Nexa) · 1 con pago por validar");
});

test("cabecera: cuatro grupos que suman el total, cada uno con su filtro, y porcentajes que suman 100", () => {
  const d = { conCuotaMes: 20, pagadaNexa: 5, pagadaManual: 2, parcialNexa: 2, parcialManual: 1, sinPago: 10 };
  const segs = segmentosCuotaMesNexa(d);
  expect(segs.map((s) => [s.id, s.conteo, s.pct])).toEqual([["nexa", 5, 25], ["manual", 2, 10], ["parcial", 3, 15], ["sinpago", 10, 50]]);
  expect(segs.reduce((a, s) => a + s.conteo, 0)).toBe(d.conCuotaMes);
  expect(segs.map((s) => s.filtro)).toEqual([
    { cuotaMes: "pagados", medio: "nexa" }, { cuotaMes: "pagados", medio: "manual" },
    { cuotaMes: "parciales", medio: "" }, { cuotaMes: "sinpago", medio: "" },
  ]);
  // 1/3 cada uno: 34 + 33 + 33, nunca 99.
  expect(porcentajesNexa([1, 1, 1, 0])).toEqual([34, 33, 33, 0]);
  expect(porcentajesNexa([0, 0, 0, 0])).toEqual([0, 0, 0, 0]);
  expect(porcentajesNexa([0, 1, 1, 3])).toEqual([0, 20, 20, 60]);
  expect(mesLargoNexa("2026-10-08")).toBe("octubre");
});
