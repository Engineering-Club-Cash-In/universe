/**
 * Reglas del resumen del crédito. Lo que se prueba acá se le muestra al cliente
 * en un chat de WhatsApp, así que un número mal no es un bug cosmético.
 */

import { describe, expect, it } from "bun:test";
import { armarResumen, type InsumosResumen } from "./resumenCredito";

const HOY = "2026-08-18";

const base: InsumosResumen = {
  credito: {
    credito_id: 1,
    numero_credito_sifco: "01010214120240",
    capital: "198252.40",
    cuota: "5891.15",
    plazo: 84,
    statusCredit: "ACTIVO",
    no_poliza: null,
  },
  totalAbonos: "0",
  conteos: { atrasadas: 0, pagadas: 0 },
  pendientes: null,
  mora: null,
  convenio: null,
  nombreAseguradora: null,
  hoy: HOY,
};

describe("capital activo", () => {
  it("resta los abonos a capital, igual que cartera", () => {
    const r = armarResumen({ ...base, totalAbonos: "5861.13" });

    expect(r.capital).toBe("198252.40");
    expect(r.capital_activo).toBe("192391.27");
  });

  it("sin abonos, el activo es el capital original", () => {
    expect(armarResumen(base).capital_activo).toBe("198252.40");
  });

  // Pasa con créditos sobrepagados. Un "-Q1,200.00" en el chat no lo entiende
  // nadie y suena a que el banco le debe al cliente.
  it("nunca devuelve negativo", () => {
    const r = armarResumen({ ...base, totalAbonos: "999999.99" });
    expect(r.capital_activo).toBe("0.00");
  });

  // Sumar float da 16488.770000000004; los montos se muestran como dinero.
  it("redondea a centavos", () => {
    const r = armarResumen({
      ...base,
      credito: { ...base.credito, capital: "106488.77" },
      totalAbonos: "90000",
    });
    expect(r.capital_activo).toBe("16488.77");
  });
});

describe("cuota actual vs próxima fecha de pago", () => {
  // El caso que motivó separarlos: con atraso, la cuota que debe venció en
  // junio pero la próxima que le toca es en agosto.
  it("las distingue cuando hay atraso", () => {
    const r = armarResumen({
      ...base,
      conteos: { atrasadas: 2, pagadas: 8 },
      pendientes: {
        numero_pendiente: 8,
        fecha_pendiente: "2026-06-30",
        proxima_futura: "2026-08-30",
      },
    });

    expect(r.cuota_actual).toEqual({
      numero: 8,
      de: 84,
      fecha_vencimiento: "2026-06-30",
      vencida: true,
    });
    expect(r.proxima_fecha_pago).toBe("2026-08-30");
  });

  it("al día: la cuota actual no está vencida", () => {
    const r = armarResumen({
      ...base,
      pendientes: {
        numero_pendiente: 9,
        fecha_pendiente: "2026-08-30",
        proxima_futura: "2026-08-30",
      },
    });

    expect(r.cuota_actual?.vencida).toBe(false);
  });

  // Vence hoy: todavía puede pagar, no está vencida.
  it("la que vence hoy NO cuenta como vencida", () => {
    const r = armarResumen({
      ...base,
      pendientes: {
        numero_pendiente: 9,
        fecha_pendiente: HOY,
        proxima_futura: HOY,
      },
    });

    expect(r.cuota_actual?.vencida).toBe(false);
  });

  it("crédito sin cuotas pendientes: ambos en null", () => {
    const r = armarResumen(base);

    expect(r.cuota_actual).toBeNull();
    expect(r.proxima_fecha_pago).toBeNull();
  });

  // Todas vencidas y ninguna futura: no hay próxima fecha que ofrecer.
  it("todo vencido: hay cuota actual pero no próxima fecha", () => {
    const r = armarResumen({
      ...base,
      conteos: { atrasadas: 5, pagadas: 0 },
      pendientes: {
        numero_pendiente: 1,
        fecha_pendiente: "2026-01-30",
        proxima_futura: null,
      },
    });

    expect(r.cuota_actual?.vencida).toBe(true);
    expect(r.proxima_fecha_pago).toBeNull();
  });
});

describe("mora y convenio", () => {
  it("sin mora activa, va null y no un cero", () => {
    expect(armarResumen(base).mora).toBeNull();
  });

  it("con mora, devuelve monto y cuotas", () => {
    const r = armarResumen({
      ...base,
      mora: {
        monto_mora: "27554.69",
        porcentaje_mora: "5.00",
        cuotas_atrasadas: 36,
      },
    });

    expect(r.mora).toEqual({
      monto: "27554.69",
      porcentaje: "5.00",
      cuotas_atrasadas: 36,
    });
  });

  // La columna es timestamp: sin normalizar sale "Sat Aug 01 2026 11:35:36
  // GMT-0600 (Central Standard Time)", que el bot tendría que parsear.
  it("la fecha del convenio sale como YYYY-MM-DD", () => {
    const r = armarResumen({
      ...base,
      convenio: {
        monto_total_convenio: "5891.15",
        monto_pagado: "981.86",
        monto_pendiente: "4909.29",
        cuota_mensual: "981.86",
        numero_meses: 6,
        pagos_realizados: 1,
        pagos_pendientes: 5,
        fecha_convenio: new Date("2026-08-01T17:35:36.000Z"),
      },
    });

    expect(r.convenio?.fecha_convenio).toBe("2026-08-01");
    expect(r.convenio?.monto_pendiente).toBe("4909.29");
  });

  it("sin convenio, va null", () => {
    expect(armarResumen(base).convenio).toBeNull();
  });
});

describe("aseguradora", () => {
  it("devuelve nombre y póliza cuando existen", () => {
    const r = armarResumen({
      ...base,
      credito: { ...base.credito, no_poliza: "(Nuevo) JIM RE" },
      nombreAseguradora: "Universales",
    });

    expect(r.aseguradora).toBe("Universales");
    expect(r.numero_poliza).toBe("(Nuevo) JIM RE");
  });

  // 699 de 1,809 créditos tienen la columna vacía, no nula.
  it("póliza vacía se normaliza a null", () => {
    const r = armarResumen({
      ...base,
      credito: { ...base.credito, no_poliza: "" },
    });

    expect(r.numero_poliza).toBeNull();
  });
});

// Los conteos y la cuota actual salen de una consulta que canoniza las cuotas
// (una fila por numero_cuota, la de cuota_id mayor) y descarta las que tienen
// un pago esperando validación. Eso vive en SQL —`consultaDeCuotas`— y se
// verificó contra el sandbox; acá se fija el CONTRATO que esa consulta debe
// cumplir, para que un cambio futuro no lo rompa en silencio.
describe("contrato de la consulta de cuotas (Codex PR #1326)", () => {
  it("una cuota con pago en revisión no está atrasada NI es la actual", () => {
    // Lo que la consulta devuelve cuando la única cuota vencida tiene boleta
    // subida: no cuenta como atraso y tampoco se le pide pagarla.
    const r = armarResumen({
      ...base,
      conteos: { atrasadas: 0, pagadas: 3 },
      pendientes: {
        numero_pendiente: 4,
        fecha_pendiente: "2026-09-30",
        proxima_futura: "2026-09-30",
      },
    });

    expect(r.cuotas_atrasadas).toBe(0);
    // Antes de este arreglo, acá salía la cuota 3 —la que el cliente acababa
    // de pagar— mientras el conteo decía 0 atrasadas.
    expect(r.cuota_actual?.numero).toBe(4);
    expect(r.cuota_actual?.vencida).toBe(false);
  });

  it("las cuotas duplicadas cuentan una sola vez", () => {
    // 78 grupos duplicados en 51 créditos del sandbox: mismo numero_cuota con
    // dos cuota_id. Hoy ninguna pareja tiene ambas copias vencidas, pero si la
    // tuviera, contar filas físicas le mostraría 2 atrasos por una sola cuota.
    const r = armarResumen({
      ...base,
      conteos: { atrasadas: 1, pagadas: 0 },
      pendientes: {
        numero_pendiente: 17,
        fecha_pendiente: "2026-07-30",
        proxima_futura: "2026-08-30",
      },
    });

    expect(r.cuotas_atrasadas).toBe(1);
    expect(r.cuota_actual?.numero).toBe(17);
  });
});
