import { describe, expect, test } from "bun:test";
import Big from "big.js";
import {
  decidirCondonacionNexaATiempo,
  domingoDePascua,
  esDiaHabilGT,
  feriadosBancariosGT,
  pagoNexaDentroDeVentana,
  saldoDeCuotaParaNexa,
  cuotaConCierreDiferidoNexa,
  motivoCondonacionNexaATiempo,
  pagosPendientesVigentesNexa,
  sumarDiasHabilesGT,
} from "./condonacionNexaATiempo";

describe("días hábiles bancarios de Guatemala", () => {
  test("Pascua por Meeus: 2026-04-05, 2027-03-28, 2025-04-20", () => {
    expect(domingoDePascua(2026)).toBe("2026-04-05");
    expect(domingoDePascua(2027)).toBe("2027-03-28");
    expect(domingoDePascua(2025)).toBe("2025-04-20");
  });

  test("feriados fijos + Jueves y Viernes Santo", () => {
    const f = feriadosBancariosGT(2026);
    for (const d of ["2026-01-01", "2026-04-02", "2026-04-03", "2026-05-01", "2026-06-30",
      "2026-07-01", "2026-08-15", "2026-09-15", "2026-10-20", "2026-11-01", "2026-12-24", "2026-12-25", "2026-12-31"]) {
      expect(f.has(d)).toBe(true);
    }
    expect(f.size).toBe(13);
    expect(esDiaHabilGT("2026-10-20")).toBe(false);
    expect(esDiaHabilGT("2026-10-10")).toBe(false); // sábado
    expect(esDiaHabilGT("2026-10-11")).toBe(false); // domingo
    expect(esDiaHabilGT("2026-10-12")).toBe(true);
  });

  test("15-ago (Asunción) es feriado y se salta: miércoles 13-ago-2025 + 3 hábiles = martes 19-ago", () => {
    expect(esDiaHabilGT("2025-08-15")).toBe(false); // viernes feriado
    expect(esDiaHabilGT("2025-08-14")).toBe(true);
    expect(sumarDiasHabilesGT("2025-08-13", 3)).toBe("2025-08-19"); // jue 14, (vie 15 feriado), lun 18, mar 19
    expect(pagoNexaDentroDeVentana("2025-08-13", "2025-08-19")).toBe(true);
    expect(pagoNexaDentroDeVentana("2025-08-13", "2025-08-20")).toBe(false);
  });

  test("vence lunes, paga miércoles → en ventana; jueves (3.º hábil) en ventana; viernes (4.º) fuera", () => {
    expect(sumarDiasHabilesGT("2026-10-05", 3)).toBe("2026-10-08");
    expect(pagoNexaDentroDeVentana("2026-10-05", "2026-10-07")).toBe(true);
    expect(pagoNexaDentroDeVentana("2026-10-05", "2026-10-08")).toBe(true);
    expect(pagoNexaDentroDeVentana("2026-10-05", "2026-10-09")).toBe(false);
  });

  test("vence viernes, paga martes → en ventana (sábado y domingo no cuentan)", () => {
    expect(sumarDiasHabilesGT("2026-10-09", 3)).toBe("2026-10-14");
    expect(pagoNexaDentroDeVentana("2026-10-09", "2026-10-13")).toBe(true);
    expect(pagoNexaDentroDeVentana("2026-10-09", "2026-10-15")).toBe(false);
  });

  test("vence miércoles antes de Jueves/Viernes Santo: la ventana corre hasta el miércoles siguiente", () => {
    expect(sumarDiasHabilesGT("2026-04-01", 3)).toBe("2026-04-08");
    expect(pagoNexaDentroDeVentana("2026-04-01", "2026-04-08")).toBe(true);
    expect(pagoNexaDentroDeVentana("2026-04-01", "2026-04-09")).toBe(false);
  });

  test("24 y 31 de diciembre no son hábiles", () => {
    expect(sumarDiasHabilesGT("2026-12-23", 3)).toBe("2026-12-30");
    expect(sumarDiasHabilesGT("2026-12-30", 3)).toBe("2027-01-06");
    expect(sumarDiasHabilesGT("2026-12-30", 1)).toBe("2027-01-04");
  });

  test("feriado en día de semana (20-oct martes) no cuenta", () => {
    expect(sumarDiasHabilesGT("2026-10-16", 3)).toBe("2026-10-22");
  });

  test("acepta un Date de vencimiento (timestamp sin zona leído por pg)", () => {
    expect(pagoNexaDentroDeVentana(new Date(2026, 9, 5), "2026-10-08")).toBe(true);
  });
});

// Capital 10,000 → 1 día de atraso = 10,000 × 1.12% / 30 = 3.733333…
const CAPITAL = "10000";
const base = {
  statusCredit: "MOROSO",
  capital: CAPITAL,
  rubrosPendientes: 0,
  ajusteFechaIdeal: null,
};
const cuota = (cuota_id: number, numero_cuota: number, fecha_vencimiento: string, saldo = "1000") =>
  ({ cuota_id, numero_cuota, fecha_vencimiento, saldo });

describe("decidirCondonacionNexaATiempo", () => {
  // Cuota 5 vence lunes 05-oct; el cron corrió martes y miércoles: 2 días de mora.
  const enVentana = {
    ...base,
    moraActiva: "7.47",
    cuotasConMora: [{ cuota_id: 5, diasAtraso: 2, pagado: 0, fecha_vencimiento: "2026-10-05" }],
    cuotasAbiertas: [cuota(5, 5, "2026-10-05"), cuota(6, 6, "2026-11-05")],
    fechaBanco: "2026-10-07",
    hoy: "2026-10-07",
  };

  test("pago exacto de la cuota, en ventana → condona toda la mora de esa cuota", () => {
    const d = decidirCondonacionNexaATiempo({ ...enVentana, monto: "1000.00" });
    expect(d.condonar).toBe(true);
    if (!d.condonar) return;
    expect(d.monto.toFixed(2)).toBe("7.47");
    expect(d.moraACobrar.toFixed(2)).toBe("0.00");
    expect(d.cuotas.map((c) => c.cuota_id)).toEqual([5]);
    // El ledger anota lo pendiente exacto (6 decimales), nunca más.
    expect(d.cuotas[0]!.monto.toFixed(6)).toBe("7.466667");
  });

  test("cuota duplicada (mismo número): insertPayment paga solo la nueva, la vieja con mora queda → no condona", () => {
    // Las dos filas de la cuota 5 tienen mora; solo la de mayor cuota_id (50) llega a cuotasAbiertas.
    const d = decidirCondonacionNexaATiempo({
      ...enVentana,
      moraActiva: "14.93",
      cuotasConMora: [
        { cuota_id: 5, diasAtraso: 2, pagado: 0, fecha_vencimiento: "2026-10-05" },
        { cuota_id: 50, diasAtraso: 2, pagado: 0, fecha_vencimiento: "2026-10-05" },
      ],
      cuotasAbiertas: [cuota(50, 5, "2026-10-05"), cuota(6, 6, "2026-11-05")],
      monto: "1000.00",
    });
    expect(d).toEqual({ condonar: false, razon: "no_queda_al_dia" });
  });

  test("pago al 4.º día hábil → fuera de ventana, nada", () => {
    const d = decidirCondonacionNexaATiempo({
      ...enVentana, moraActiva: "14.93",
      cuotasConMora: [{ cuota_id: 5, diasAtraso: 4, pagado: 0, fecha_vencimiento: "2026-10-05" }],
      fechaBanco: "2026-10-09", hoy: "2026-10-09", monto: "1014.93",
    });
    expect(d).toEqual({ condonar: false, razon: "fuera_de_ventana" });
  });

  test("pago parcial (no alcanza la cuota) → nada", () => {
    const d = decidirCondonacionNexaATiempo({ ...enVentana, monto: "500.00" });
    expect(d).toEqual({ condonar: false, razon: "no_queda_al_dia" });
  });

  test("le falta un centavo de más de la tolerancia → nada; dentro de la tolerancia → condona", () => {
    expect(decidirCondonacionNexaATiempo({ ...enVentana, monto: "999.98" }).condonar).toBe(false);
    expect(decidirCondonacionNexaATiempo({ ...enVentana, monto: "999.99" }).condonar).toBe(true);
  });

  test("mora previa legítima de una cuota vieja: se cobra, y solo se condona la de la cuota en ventana", () => {
    const conPrevia = {
      ...enVentana,
      moraActiva: "119.47", // 112.00 (cuota 4, techo de 30 días) + 7.47 (cuota 5)
      cuotasConMora: [
        { cuota_id: 4, diasAtraso: 32, pagado: 0, fecha_vencimiento: "2026-09-05" },
        { cuota_id: 5, diasAtraso: 2, pagado: 0, fecha_vencimiento: "2026-10-05" },
      ],
      cuotasAbiertas: [cuota(4, 4, "2026-09-05"), cuota(5, 5, "2026-10-05"), cuota(6, 6, "2026-11-05")],
    };
    const d = decidirCondonacionNexaATiempo({ ...conPrevia, monto: "2112.00" });
    expect(d.condonar).toBe(true);
    if (!d.condonar) return;
    expect(d.monto.toFixed(2)).toBe("7.47");
    expect(d.moraACobrar.toFixed(2)).toBe("112.00");
    expect(d.cuotas.map((c) => c.cuota_id)).toEqual([5]);

    // Si solo alcanza para la mora y la cuota vieja, NO queda al día → nada.
    expect(decidirCondonacionNexaATiempo({ ...conPrevia, monto: "1112.00" }))
      .toEqual({ condonar: false, razon: "no_queda_al_dia" });
    // Si ni la mora legítima alcanza → nada.
    expect(decidirCondonacionNexaATiempo({ ...conPrevia, monto: "100.00" }))
      .toEqual({ condonar: false, razon: "no_alcanza_mora" });
  });

  test("dos cuotas en ventana → se condonan las dos", () => {
    const d = decidirCondonacionNexaATiempo({
      ...base,
      moraActiva: "18.67", // 3 días (11.20) + 2 días (7.466…)
      cuotasConMora: [
        { cuota_id: 5, diasAtraso: 3, pagado: 0, fecha_vencimiento: "2026-10-05" },
        { cuota_id: 6, diasAtraso: 2, pagado: 0, fecha_vencimiento: "2026-10-06" },
      ],
      cuotasAbiertas: [cuota(5, 5, "2026-10-05"), cuota(6, 6, "2026-10-06"), cuota(7, 7, "2026-11-06")],
      fechaBanco: "2026-10-08",
      hoy: "2026-10-08",
      monto: "2000.00",
    });
    expect(d.condonar).toBe(true);
    if (!d.condonar) return;
    expect(d.monto.toFixed(2)).toBe("18.67");
    expect(d.moraACobrar.toFixed(2)).toBe("0.00");
    expect(d.cuotas.map((c) => c.cuota_id)).toEqual([5, 6]);
  });

  test("redondeo de centavos: condonado + cobrado = monto_mora exacto, a favor del cliente", () => {
    // Cuota vieja con 3.733333 pendiente (ya pagó casi todo) + cuota en ventana 3.733333.
    // Total 7.466666 → monto_mora 7.47. Se cobra round(3.733333)=3.73 y se condona 3.74.
    const d = decidirCondonacionNexaATiempo({
      ...base,
      moraActiva: "7.47",
      cuotasConMora: [
        { cuota_id: 4, diasAtraso: 40, pagado: "108.266667", fecha_vencimiento: "2026-08-27" },
        { cuota_id: 5, diasAtraso: 1, pagado: 0, fecha_vencimiento: "2026-10-05" },
      ],
      cuotasAbiertas: [cuota(4, 4, "2026-08-27", "0"), cuota(5, 5, "2026-10-05")],
      fechaBanco: "2026-10-06",
      hoy: "2026-10-06",
      monto: "1003.73",
    });
    expect(d.condonar).toBe(true);
    if (!d.condonar) return;
    expect(d.monto.toFixed(2)).toBe("3.74");
    expect(d.moraACobrar.toFixed(2)).toBe("3.73");
    expect(d.monto.plus(d.moraACobrar).toFixed(2)).toBe("7.47");
  });

  test("monto_mora inflado a mano: se condona solo la de la ventana, el resto se cobra", () => {
    const d = decidirCondonacionNexaATiempo({ ...enVentana, moraActiva: "107.47", monto: "1100.00" });
    expect(d.condonar).toBe(true);
    if (!d.condonar) return;
    expect(d.monto.toFixed(2)).toBe("7.47");
    expect(d.moraACobrar.toFixed(2)).toBe("100.00");
  });

  test("rubros pendientes compiten con la cuota igual que en insertPayment", () => {
    expect(decidirCondonacionNexaATiempo({ ...enVentana, rubrosPendientes: "50", monto: "1000.00" }))
      .toEqual({ condonar: false, razon: "no_queda_al_dia" });
    expect(decidirCondonacionNexaATiempo({ ...enVentana, rubrosPendientes: "50", monto: "1050.00" }).condonar)
      .toBe(true);
  });

  test("ajuste por fecha ideal con la cuota 1 pendiente se descuenta antes de las cuotas", () => {
    const primera = {
      ...enVentana,
      cuotasConMora: [{ cuota_id: 1, diasAtraso: 2, pagado: 0, fecha_vencimiento: "2026-10-05" }],
      cuotasAbiertas: [cuota(1, 1, "2026-10-05"), cuota(2, 2, "2026-11-05")],
      ajusteFechaIdeal: { id: 9, monto_total: "80" },
    };
    expect(decidirCondonacionNexaATiempo({ ...primera, monto: "1000.00" }).condonar).toBe(false);
    expect(decidirCondonacionNexaATiempo({ ...primera, monto: "1080.00" }).condonar).toBe(true);
  });

  test("sin mora, o crédito en convenio → nada", () => {
    expect(decidirCondonacionNexaATiempo({ ...enVentana, moraActiva: null, monto: "1000.00" }))
      .toEqual({ condonar: false, razon: "sin_mora" });
    expect(decidirCondonacionNexaATiempo({ ...enVentana, moraActiva: "0", monto: "1000.00" }))
      .toEqual({ condonar: false, razon: "sin_mora" });
    expect(decidirCondonacionNexaATiempo({ ...enVentana, statusCredit: "EN_CONVENIO", monto: "1000.00" }))
      .toEqual({ condonar: false, razon: "estado_no_aplica" });
  });

  test("la mora de la ventana ya estaba abonada en el ledger → nada que condonar", () => {
    const d = decidirCondonacionNexaATiempo({
      ...enVentana,
      moraActiva: "0.01",
      cuotasConMora: [{ cuota_id: 5, diasAtraso: 2, pagado: "7.466667", fecha_vencimiento: "2026-10-05" }],
      monto: "1000.00",
    });
    expect(d).toEqual({ condonar: false, razon: "fuera_de_ventana" });
  });

  test("monto en Big o string da lo mismo", () => {
    const a = decidirCondonacionNexaATiempo({ ...enVentana, monto: new Big("1000") });
    const b = decidirCondonacionNexaATiempo({ ...enVentana, monto: "1000.00" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("saldoDeCuotaParaNexa: un pendiente cuenta solo con la ventana del cron (7 días)", () => {
  const pago = (validationStatus: string, fecha_pago: string | Date | null, pagado = true) => ({
    validationStatus, paymentFalse: false, fecha_pago, pagado,
    abono_capital: "600", abono_interes: "300", abono_iva_12: "100",
  });
  const hoy = "2026-10-07";

  test("un pendiente pagado=false no cubre, ni sumado con otro: el cron exige pc.pagado = true", () => {
    const parcial = (fecha: string) => ({
      validationStatus: "pending", paymentFalse: false, fecha_pago: fecha, pagado: false,
      abono_capital: "300", abono_interes: "150", abono_iva_12: "50",
    });
    expect(saldoDeCuotaParaNexa("1000", [parcial("2026-10-05"), parcial("2026-10-06")], hoy).toFixed(2)).toBe("1000.00");
    // Validados, los mismos dos sí la cubren.
    expect(saldoDeCuotaParaNexa("1000", [
      { ...parcial("2026-10-05"), validationStatus: "validated" },
      { ...parcial("2026-10-06"), validationStatus: "validated" },
    ], hoy).toFixed(2)).toBe("0.00");
  });

  test("pendiente de hace 30 días no cubre; de hace 7 días o de mañana sí; de pasado mañana no", () => {
    expect(saldoDeCuotaParaNexa("1000", [pago("pending", "2026-09-07")], hoy).toFixed(2)).toBe("1000.00");
    expect(saldoDeCuotaParaNexa("1000", [pago("pending", "2026-09-29")], hoy).toFixed(2)).toBe("1000.00");
    expect(saldoDeCuotaParaNexa("1000", [pago("pending", "2026-09-30")], hoy).toFixed(2)).toBe("0.00");
    expect(saldoDeCuotaParaNexa("1000", [pago("pending", new Date(2026, 9, 8))], hoy).toFixed(2)).toBe("0.00");
    expect(saldoDeCuotaParaNexa("1000", [pago("pending", "2026-10-09")], hoy).toFixed(2)).toBe("1000.00");
    expect(saldoDeCuotaParaNexa("1000", [pago("pending", null)], hoy).toFixed(2)).toBe("1000.00");
  });

  test("un validado cuenta sin importar su antigüedad", () => {
    expect(saldoDeCuotaParaNexa("1000", [pago("validated", "2026-01-01")], hoy).toFixed(2)).toBe("0.00");
  });

  test("boleta pendiente de hace 30 días en la cuota vieja → no condona (el crédito no queda al día)", () => {
    // Cuota 4 vencida el 05-sep con una boleta pendiente del 07-sep que nadie
    // validó: el cron dejó de contarla a los 7 días y le cobra mora (112.00).
    // El pago Nexa trae la mora legítima + la cuota 5, no la cuota 4.
    const saldo4 = saldoDeCuotaParaNexa("1000", [pago("pending", "2026-09-07")], hoy);
    const d = decidirCondonacionNexaATiempo({
      ...base,
      moraActiva: "119.47",
      cuotasConMora: [
        { cuota_id: 4, diasAtraso: 32, pagado: 0, fecha_vencimiento: "2026-09-05" },
        { cuota_id: 5, diasAtraso: 2, pagado: 0, fecha_vencimiento: "2026-10-05" },
      ],
      cuotasAbiertas: [
        cuota(4, 4, "2026-09-05", saldo4.toFixed(2)),
        cuota(5, 5, "2026-10-05"),
        cuota(6, 6, "2026-11-05"),
      ],
      monto: "1112.00",
      fechaBanco: hoy,
      hoy,
    });
    expect(d).toEqual({ condonar: false, razon: "no_queda_al_dia" });
  });
});

describe("cuota con un pendiente parcial: el pago Nexa no la cierra (cierre diferido)", () => {
  // Cuota 5 vencida el 05-oct: Q400 en ventanilla (pendiente de validar) y el
  // pago Nexa trae los Q600 restantes. aplicarPagoNormalEnTx difiere el cierre
  // hasta validar el pendiente: el crédito no queda al día con este pago.
  const pendiente = { validationStatus: "pending", paymentFalse: false, monto_aplicado: "400.00" };
  const enVentana = {
    ...base,
    moraActiva: "7.47",
    cuotasConMora: [{ cuota_id: 5, diasAtraso: 2, pagado: 0, fecha_vencimiento: "2026-10-05" }],
    fechaBanco: "2026-10-07",
    hoy: "2026-10-07",
    monto: "600.00",
  };

  test("detecta solo pendientes vivos con plata", () => {
    expect(cuotaConCierreDiferidoNexa([pendiente])).toBe(true);
    expect(cuotaConCierreDiferidoNexa([{ ...pendiente, paymentFalse: true }])).toBe(false);
    expect(cuotaConCierreDiferidoNexa([{ ...pendiente, monto_aplicado: "0" }])).toBe(false);
    expect(cuotaConCierreDiferidoNexa([{ ...pendiente, validationStatus: "validated" }])).toBe(false);
  });

  test("con el pendiente parcial no condona; con el mismo parcial ya validado sí", () => {
    const conPendiente = decidirCondonacionNexaATiempo({
      ...enVentana,
      cuotasAbiertas: [{ ...cuota(5, 5, "2026-10-05", "600"), cierreDiferido: true }, cuota(6, 6, "2026-11-05")],
    });
    expect(conPendiente).toEqual({ condonar: false, razon: "no_queda_al_dia" });
    const validado = decidirCondonacionNexaATiempo({
      ...enVentana,
      cuotasAbiertas: [{ ...cuota(5, 5, "2026-10-05", "600"), cierreDiferido: false }, cuota(6, 6, "2026-11-05")],
    });
    expect(validado.condonar).toBe(true);
  });

  test("un pendiente en una cuota que el pago no toca (no vencida) no impide condonar", () => {
    const d = decidirCondonacionNexaATiempo({
      ...enVentana,
      monto: "1000.00",
      cuotasAbiertas: [cuota(5, 5, "2026-10-05"), { ...cuota(6, 6, "2026-11-05", "600"), cierreDiferido: true, pagosPendientes: [61] }],
    });
    expect(d.condonar).toBe(true);
    // Una cuota que no está vencida no sostiene el "al día": no se marca.
    expect(d.condonar && d.pagosPendientes).toEqual([]);
  });

  test("cuota vencida ya cubierta por un pendiente (toma = 0): condona y queda marcada con ese pendiente", () => {
    const d = decidirCondonacionNexaATiempo({
      ...enVentana,
      moraActiva: "7.47",
      monto: "1000.00",
      cuotasAbiertas: [
        { ...cuota(4, 4, "2026-09-05", "0"), cierreDiferido: true, pagosPendientes: [41, 40] },
        cuota(5, 5, "2026-10-05"),
        cuota(6, 6, "2026-11-05"),
      ],
    });
    expect(d.condonar).toBe(true);
    expect(d.condonar && d.pagosPendientes).toEqual([40, 41]);
  });

  test("sin pendientes la condonación no queda marcada", () => {
    const d = decidirCondonacionNexaATiempo({
      ...enVentana,
      monto: "1000.00",
      cuotasAbiertas: [cuota(5, 5, "2026-10-05"), cuota(6, 6, "2026-11-05")],
    });
    expect(d.condonar).toBe(true);
    expect(d.condonar && d.pagosPendientes).toEqual([]);
  });
});

describe("pagosPendientesVigentesNexa y el motivo", () => {
  const pago = { pago_id: 7, validationStatus: "pending", paymentFalse: false, pagado: true, monto_aplicado: "1000", fecha_pago: "2026-10-05" };
  test("solo pendientes vivos, con plata y dentro de la ventana del cron", () => {
    expect(pagosPendientesVigentesNexa([pago], "2026-10-07")).toEqual([7]);
    expect(pagosPendientesVigentesNexa([{ ...pago, paymentFalse: true }], "2026-10-07")).toEqual([]);
    expect(pagosPendientesVigentesNexa([{ ...pago, monto_aplicado: "0" }], "2026-10-07")).toEqual([]);
    expect(pagosPendientesVigentesNexa([{ ...pago, validationStatus: "validated" }], "2026-10-07")).toEqual([]);
    expect(pagosPendientesVigentesNexa([{ ...pago, fecha_pago: "2026-09-20" }], "2026-10-07")).toEqual([]);
    expect(pagosPendientesVigentesNexa([{ ...pago, pagado: false }], "2026-10-07")).toEqual([]);
  });
  test("el motivo dice en qué pagos pendientes se sostiene", () => {
    expect(motivoCondonacionNexaATiempo([])).toBe("NEXA_ACH_A_TIEMPO");
    expect(motivoCondonacionNexaATiempo([40, 41])).toBe(
      "NEXA_ACH_A_TIEMPO — CON PAGO PENDIENTE: se sostiene en los pagos 40, 41, si no se valida(n) se anula");
  });
});
