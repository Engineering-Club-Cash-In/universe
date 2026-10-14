import { describe, expect, test } from "bun:test";
import { planReaperturaCuotaPorAnulacion } from "./reabrirCuotaPorAnulacionPolicy";

const CUOTA = 2455.61;
const hermana = (o: Record<string, unknown> = {}) => ({
  pago_id: 1,
  validationStatus: "validated",
  paymentFalse: false,
  abono_capital: 1000,
  abono_interes: 161.38,
  abono_iva_12: 0,
  abono_seguro: 0,
  abono_gps: 0,
  membresias_pago: 0,
  ...o,
});
// Cierre de 1294.23 sobre un parcial de 1161.38: restantes ya en 0.
const cierre = (o: Record<string, unknown> = {}) => ({
  cuota_id: 48,
  abono_capital: 1000,
  abono_interes: 294.23,
  abono_iva_12: 0,
  abono_seguro: 0,
  abono_gps: 0,
  membresias_pago: 0,
  capital_restante: 0,
  interes_restante: 0,
  iva_12_restante: 0,
  seguro_restante: 0,
  gps_restante: 0,
  membresias: 0,
  ...o,
});
const plan = (o: Record<string, unknown> = {}) =>
  planReaperturaCuotaPorAnulacion({
    creditoId: 932,
    montoCuota: CUOTA,
    statusCredit: "ACTIVO",
    filaAnulada: cierre(),
    hermanas: [hermana()],
    ...o,
  } as never);

describe("planReaperturaCuotaPorAnulacion", () => {
  test("cierre anulado con parcial que no cubre: repone restantes, reabre filas y cuota", () => {
    const p = plan();
    expect(p.reabrirFilas).toBe(true);
    expect(p.reabrirCuota).toBe(true);
    expect(p.replica?.cuotaId).toBe(48);
    expect(p.replica?.creditoId).toBe(932);
    expect(p.replica?.payload).toEqual({
      capital_restante: "1000",
      interes_restante: "294.23",
      iva_12_restante: "0",
      seguro_restante: "0",
      gps_restante: "0",
      membresias: "0",
    });
  });

  test("parcial anulado (cuota seguía abierta): repone restantes igual", () => {
    const p = plan({
      filaAnulada: cierre({ abono_capital: 500, abono_interes: 0, capital_restante: 794.23, interes_restante: 294.23 }),
    });
    expect(p.replica?.payload.capital_restante).toBe("1294.23");
    expect(p.replica?.payload.interes_restante).toBe("294.23");
  });

  test("las hermanas cubren la cuota solas: no toca nada", () => {
    const p = plan({ hermanas: [hermana({ abono_capital: 2000, abono_interes: 455.61 })] });
    expect(p).toEqual({ replica: null, reabrirFilas: false, reabrirCuota: false });
  });

  test("tolerancia de un centavo: Q0.01 menos todavía cubre, Q0.02 menos no", () => {
    const cubre = plan({ hermanas: [hermana({ abono_capital: 2000, abono_interes: 455.6 })] });
    expect(cubre.reabrirFilas).toBe(false);
    const noCubre = plan({ hermanas: [hermana({ abono_capital: 2000, abono_interes: 455.59 })] });
    expect(noCubre.reabrirFilas).toBe(true);
  });

  test("hermana pendiente que cubre sola: no reabre las filas", () => {
    const p = plan({ hermanas: [hermana({ validationStatus: "pending", abono_capital: 2000, abono_interes: 455.61 })] });
    expect(p.reabrirFilas).toBe(false);
    expect(p.reabrirCuota).toBe(false);
  });

  test("hermana pendiente que cubre y la cuota ya estaba pagada por validadas: nada", () => {
    const p = plan({
      hermanas: [hermana({ abono_capital: 2000, abono_interes: 455.61 }), hermana({ pago_id: 2, validationStatus: "pending" })],
    });
    expect(p.reabrirFilas).toBe(false);
  });

  test("validada + pendiente hermanas cubren la cuota entre las dos: nada", () => {
    const p = plan({ hermanas: [hermana(), hermana({ pago_id: 2, validationStatus: "pending", abono_capital: 1294.23, abono_interes: 0 })] });
    expect(p.reabrirFilas).toBe(false);
  });

  test("hermana ya anulada no cuenta como cobertura", () => {
    const p = plan({ hermanas: [hermana({ abono_capital: 2000, abono_interes: 455.61, paymentFalse: true })] });
    expect(p.reabrirFilas).toBe(true);
  });

  test("hermana no_required sin abonos no cuenta", () => {
    const p = plan({ hermanas: [hermana({ validationStatus: "no_required", abono_capital: 0, abono_interes: 0 })] });
    expect(p.reabrirFilas).toBe(true);
  });

  test("cuota sin hermanas: repone igual (la cuota queda abierta y con su saldo)", () => {
    const p = plan({ hermanas: [] });
    expect(p.reabrirFilas).toBe(true);
    expect(p.reabrirCuota).toBe(true);
    expect(p.replica).not.toBeNull();
  });

  test("fila anulada que no aportó a la cuota (solo mora): nada", () => {
    const p = plan({
      filaAnulada: cierre({ abono_capital: 0, abono_interes: 0 }),
    });
    expect(p).toEqual({ replica: null, reabrirFilas: false, reabrirCuota: false });
  });

  test("fila sin cuota: nada", () => {
    expect(plan({ filaAnulada: cierre({ cuota_id: null }) }).reabrirFilas).toBe(false);
  });

  test("montoCuota nulo o cero: repone restantes (como la reversa) pero no reabre pagado", () => {
    for (const montoCuota of [null, 0]) {
      const p = plan({ montoCuota });
      expect(p.replica).not.toBeNull();
      expect(p.reabrirFilas).toBe(false);
      expect(p.reabrirCuota).toBe(false);
    }
  });

  test("CANCELADO: repone restantes pero no reabre", () => {
    const p = plan({ statusCredit: "CANCELADO" });
    expect(p.replica).not.toBeNull();
    expect(p.reabrirFilas).toBe(false);
    expect(p.reabrirCuota).toBe(false);
  });

  test("PENDIENTE_CANCELACION se reabre (ACTIVAR lo devuelve a ACTIVO)", () => {
    const p = plan({ statusCredit: "PENDIENTE_CANCELACION" });
    expect(p).toMatchObject({ reabrirFilas: true, reabrirCuota: true });
    expect(p.replica).not.toBeNull();
  });

  test("INCOBRABLE con capital pendiente: filas y cuota se reabren juntas", () => {
    const p = plan({ statusCredit: "INCOBRABLE", capital: 500 });
    expect(p).toMatchObject({ reabrirFilas: true, reabrirCuota: true });
    expect(p.replica).not.toBeNull();
  });

  test("INCOBRABLE con capital en cero (dentro de la tolerancia): repone pero no reabre nada", () => {
    for (const capital of [0, 0.01, null]) {
      const p = plan({ statusCredit: "INCOBRABLE", capital });
      expect(p.replica).not.toBeNull();
      expect(p.reabrirFilas).toBe(false);
      expect(p.reabrirCuota).toBe(false);
    }
  });

  test("restantes nulos se tratan como cero", () => {
    const p = plan({ filaAnulada: cierre({ capital_restante: null, membresias: null }) });
    expect(p.replica?.payload.capital_restante).toBe("1000");
    expect(p.replica?.payload.membresias).toBe("0");
  });
});
