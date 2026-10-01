import "../utils/baseFalsaParaPruebas";
import { describe, expect, it } from "bun:test";
import Big from "big.js";
import { decidirMoraDelCron } from "./latefee";
import { anotacionesDeMoraAbonada } from "../utils/anotacionesDeMoraAbonada";
import { anotacionesAGuardar, montoParaLedger } from "../utils/montoLedger";

/**
 * Pagar EXACTAMENTE la mora que ve el cliente la deja en cero. Con el ledger
 * redondeando cada fila a centavos, los restos de fracción por cuota sumaban
 * Q0.01 y el cron lo volvía a cobrar (crédito MOROSO por un centavo).
 *
 * Lo guardado se calcula con `anotacionesAGuardar`, el mismo filtro que usa
 * anotarMoraPagada, importado del módulo puro: otras suites mockean
 * anotarMoraPagada para todo el proceso.
 */
describe("redondeo del ledger: pagar la mora mostrada no deja un centavo colgando", () => {
  it("capital Q1,487.80 con dos cuotas topadas: tras pagar Q33.33, el cron aplica Q0.00", () => {
    const capital = "1487.80";
    const cuotas = [
      { cuota_id: 1, diasAtraso: 45, pagado: "0" },
      { cuota_id: 2, diasAtraso: 35, pagado: "0" },
    ];
    const antes = decidirMoraDelCron({ capital, cuotasParaPendiente: cuotas } as any);
    expect(antes).toEqual({ accion: "APLICAR", montoStr: "33.33" });

    // El cliente paga lo que ve; se anota como lo guarda el ledger.
    const filas = anotacionesDeMoraAbonada({ credito_id: 9, monto: "33.33", capital, cuotas, tipo: "PAGO", pago_id: 77 });
    // Simular exactamente qué es lo que se guarda en el ledger (6 decimales, filtrando ceros).
    const guardado = new Map(
      anotacionesAGuardar(filas).map((f) => [f.cuota_id, montoParaLedger(f.montoBig)])
    );
    const despues = decidirMoraDelCron({
      capital,
      cuotasParaPendiente: cuotas.map((c) => ({ ...c, pagado: guardado.get(c.cuota_id) ?? "0" })),
    } as any);
    expect(despues).toEqual({ accion: "APLICAR", montoStr: "0.00" });
  });
});

describe("redondeo del ledger: pagar en dos partes no anota filas en 0.000000", () => {
  it("capital Q10,000, cuotas de 10 y 5 días: Q40 y luego el resto; lo guardado es > 0 y la mora queda en Q0.00", () => {
    const capital = "10000";
    const base = [
      { cuota_id: 1, diasAtraso: 10, pagado: "0" },
      { cuota_id: 2, diasAtraso: 5, pagado: "0" },
    ];
    // Simular lo que el ledger GUARDA: solo las filas que pasen el filtro de 6 decimales > 0.
    const guardado = new Map<number, string>();
    const almacenarEnLedger = (filas: any[]) => {
      // Simular exactamente lo que hace anotacionesAGuardar + el cálculo de guardado.
      const aGuardar = anotacionesAGuardar(filas);
      for (const f of aGuardar) {
        guardado.set(f.cuota_id, new Big(guardado.get(f.cuota_id) ?? 0).plus(montoParaLedger(f.montoBig)).toFixed(6));
      }
      return aGuardar.map((f) => ({ cuota_id: f.cuota_id, monto: montoParaLedger(f.montoBig) }));
    };
    const conPagado = () => base.map((c) => ({ ...c, pagado: guardado.get(c.cuota_id) ?? "0" }));

    // Primer pago: Q40
    const primerPago = anotacionesDeMoraAbonada({ credito_id: 9, monto: "40", capital, cuotas: base, tipo: "PAGO", pago_id: 1 });
    almacenarEnLedger(primerPago);
    const resto = decidirMoraDelCron({ capital, cuotasParaPendiente: conPagado() } as any);
    expect(resto.accion).toBe("APLICAR");

    // Segundo pago: el resto. El reparto del resto deja un resto de fracción (< 1e-6) en la cuota 1: el filtro no lo guarda.
    const segundoPago = anotacionesDeMoraAbonada({
      credito_id: 9,
      monto: (resto as any).montoStr,
      capital,
      cuotas: conPagado(),
      tipo: "PAGO",
      pago_id: 2,
    });
    const filasGuardadas = almacenarEnLedger(segundoPago);

    // Ninguna FILA guardada en 0.000000 (el CHECK monto <> 0 la rechazaría).
    for (const f of filasGuardadas) expect(Number(f.monto)).toBeGreaterThan(0);
    expect(decidirMoraDelCron({ capital, cuotasParaPendiente: conPagado() } as any)).toEqual({ accion: "APLICAR", montoStr: "0.00" });
  });
});
