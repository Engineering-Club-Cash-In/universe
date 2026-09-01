import { describe, expect, it } from "bun:test";
import { convertirReporteAUSD } from "./reporteMoneda";
import { formatToUSD, getTipoCambioUSD } from "./currencyConverter";

// Flujo Capital: es el inversionista con tipo de cambio propio (7.78), así que
// es el caso que importa cuidar.
const FLUJO_CAPITAL = 84;

/**
 * Reproduce lo que hace `resumeInvestor` al armar el reporte: aplica su helper
 * `formatValue` a los mismos campos. Sirve de oráculo — el objeto derivado por
 * convertirReporteAUSD tiene que salir idéntico a este.
 */
const fv = (val: any) => formatToUSD(val, FLUJO_CAPITAL);

// `any` a propósito: es un fixture que imita la salida sin tipar de
// resumeInvestor, y las aserciones comparan valores, no formas.
const reporteEnQuetzales = (): any => ({
  inversionista_id: FLUJO_CAPITAL,
  nombre_inversionista: "Flujo Capital",
  moneda: "quetzales",
  moneda_inversionista: "dolares",
  currencySymbol: "Q.",
  // Crudos a propósito: el builder del Excel los convierte por su cuenta.
  monto_reinversion: "50000.00",
  saldo_reinversion: "1200.00",
  creditos: [
    {
      credito_id: 1,
      numero_credito_sifco: "01010214117590",
      nombre_usuario: "Cliente Uno",
      capital: "100000.00",
      capital_actual: "83333.33",
      porcentaje_interes: 2.5,
      cuota_interes: "2500.00",
      iva12: "300.00",
      monto_aportado: "95000.00",
      porcentaje_inversionista: 84.94564,
      cuota_inversionista: "2123.64",
      plazo: 24,
      meses_en_credito: 8,
      total_abono_capital: "16666.67",
      total_abono_interes: "8000.00",
      total_abono_iva: "960.00",
      total_isr: "560.00",
      total_neto_impuestos: null,
      total_cuota: "24106.67",
      pagos: [
        {
          id: 11,
          mes: "2026-03",
          abono_capital: "2083.33",
          abono_interes: "1000.00",
          abono_iva: "120.00",
          isr: "70.00",
          porcentaje_inversor: 84.94564,
          cuota_inversor: "3013.33",
          cuota: 3500,
          cuota_inversionista: "2123.64",
          abonoGeneralInteres: "930.00",
          tasaInteresInvesor: 2.1236,
          estado_liquidacion: "LIQUIDADO",
          interes_partido: false,
        },
      ],
    },
  ],
  subtotal: {
    total_abono_capital: "16666.67",
    total_abono_interes: "8000.00",
    total_abono_iva: "960.00",
    total_isr: "560.00",
    total_neto_impuestos: null,
    total_cuota_sin_reinversion: "24106.67",
    total_cuota_con_reinversion: "24106.67",
    total_cuota: "24106.67",
    total_reinversion_capital: "0",
    total_reinversion_interes: "0",
    total_reinversion: "0",
    total_monto_aportado: "95000.00",
    total_abono_general_interes: "7440.00",
    total_capital_creditos: "100000.00",
    total_capital_actual: "83333.33",
    total_reinv_tipo_capital: "0",
    total_reinv_tipo_interes: "0",
    total_reinv_tipo_total: "0",
  },
});

describe("convertirReporteAUSD", () => {
  it("convierte cada monto con el mismo tipo de cambio que usa resumeInvestor", () => {
    const usd = convertirReporteAUSD(reporteEnQuetzales());
    const q = reporteEnQuetzales();

    expect(usd.subtotal.total_cuota).toBe(fv(q.subtotal.total_cuota));
    expect(usd.subtotal.total_abono_capital).toBe(fv(q.subtotal.total_abono_capital));
    expect(usd.creditos[0].monto_aportado).toBe(fv(q.creditos[0].monto_aportado));
    expect(usd.creditos[0].pagos[0].abono_capital).toBe(fv(q.creditos[0].pagos[0].abono_capital));

    // Prueba concreta con el tipo de cambio real de Flujo Capital.
    expect(getTipoCambioUSD(FLUJO_CAPITAL)).toBe(7.78);
    expect(usd.subtotal.total_abono_capital).toBe(Number((16666.67 / 7.78).toFixed(2)));
  });

  it("cubre TODOS los campos monetarios: no deja ningún monto en quetzales", () => {
    const q = reporteEnQuetzales();
    const usd = convertirReporteAUSD(q);

    // Todo campo que en el original es un monto tiene que haber cambiado de
    // valor. Si alguien agrega un campo monetario a resumeInvestor y olvida
    // registrarlo en reporteMoneda.ts, este test lo caza.
    const montosSubtotal = Object.entries(q.subtotal).filter(
      ([, v]) => v !== null && Number(v) > 0
    );
    for (const [campo, valorQ] of montosSubtotal) {
      expect(`${campo}=${(usd.subtotal as any)[campo]}`).toBe(`${campo}=${fv(valorQ)}`);
    }

    const montosCredito = Object.entries(q.creditos[0]).filter(
      ([campo, v]) =>
        typeof v === "string" && Number(v) > 0 && campo !== "numero_credito_sifco"
    );
    for (const [campo, valorQ] of montosCredito) {
      expect(`${campo}=${(usd.creditos[0] as any)[campo]}`).toBe(`${campo}=${fv(valorQ)}`);
    }
  });

  it("no toca porcentajes, plazos, fechas ni identificadores", () => {
    const usd = convertirReporteAUSD(reporteEnQuetzales());
    const c = usd.creditos[0];

    expect(c.porcentaje_interes).toBe(2.5);
    expect(c.porcentaje_inversionista).toBe(84.94564);
    expect(c.plazo).toBe(24);
    expect(c.meses_en_credito).toBe(8);
    expect(c.credito_id).toBe(1);
    expect(c.numero_credito_sifco).toBe("01010214117590");
    expect(c.pagos[0].porcentaje_inversor).toBe(84.94564);
    expect(c.pagos[0].tasaInteresInvesor).toBe(2.1236);
    expect(c.pagos[0].estado_liquidacion).toBe("LIQUIDADO");
    expect(c.pagos[0].mes).toBe("2026-03");
    // `cuota` hoy tampoco pasa por formatValue en resumeInvestor: se respeta.
    expect(c.pagos[0].cuota).toBe(3500);
  });

  it("respeta los null: 'no aplica' no se vuelve cero", () => {
    const usd = convertirReporteAUSD(reporteEnQuetzales());
    expect(usd.subtotal.total_neto_impuestos).toBeNull();
    expect(usd.creditos[0].total_neto_impuestos).toBeNull();
  });

  it("marca el objeto como dólares para que el Excel rotule con $", () => {
    const usd = convertirReporteAUSD(reporteEnQuetzales());
    expect(usd.moneda).toBe("dolares");
    expect(usd.currencySymbol).toBe("$");
  });

  it("deja crudos monto_reinversion y saldo_reinversion (los convierte el builder)", () => {
    const usd = convertirReporteAUSD(reporteEnQuetzales());
    expect(usd.monto_reinversion).toBe("50000.00");
    expect(usd.saldo_reinversion).toBe("1200.00");
  });

  it("no muta el reporte en quetzales que recibe", () => {
    const q = reporteEnQuetzales();
    convertirReporteAUSD(q);

    expect(q.moneda).toBe("quetzales");
    expect(q.subtotal.total_cuota).toBe("24106.67");
    expect(q.creditos[0].monto_aportado).toBe("95000.00");
    expect(q.creditos[0].pagos[0].abono_capital).toBe("2083.33");
  });

  it("los totales del reporte en dólares no arrastran centavos", () => {
    // El total en USD se deriva del total en Q, NO de sumar líneas ya
    // redondeadas. Es la razón de convertir en dirección Q → USD.
    const q = reporteEnQuetzales();
    const usd = convertirReporteAUSD(q);

    const totalDesdeQ = fv(q.subtotal.total_abono_capital);
    const sumaDeLineasUSD = q.creditos.reduce(
      (acc: number, c: any) => acc + fv(c.total_abono_capital),
      0
    );

    expect(usd.subtotal.total_abono_capital).toBe(totalDesdeQ);
    // El total NO es la suma de líneas redondeadas — ese es justo el descuadre
    // que se evita. Aquí coinciden porque hay un solo crédito, pero el valor
    // publicado siempre sale del total en quetzales.
    expect(usd.subtotal.total_abono_capital).toBe(Number(sumaDeLineasUSD.toFixed(2)));
  });

  it("un inversionista sin créditos no truena", () => {
    const vacio = convertirReporteAUSD({
      inversionista_id: FLUJO_CAPITAL,
      moneda: "quetzales",
      creditos: [],
      subtotal: undefined,
    });
    expect(vacio.creditos).toEqual([]);
    expect(vacio.moneda).toBe("dolares");
  });
});
