import { formatToUSD } from "./currencyConverter";

/**
 * Convierte a dólares un reporte de inversionista que viene en quetzales
 * (`resumeInvestor(..., rawValues = true)`).
 *
 * Existe para poder emitir el mismo reporte en las dos monedas sin volver a
 * consultar la base: se pide UNA vez en quetzales y esta función deriva la
 * versión en dólares en memoria.
 *
 * La dirección importa: Q → USD es la única exacta. Convertir al revés
 * (multiplicar dólares ya redondeados a 2 decimales por el tipo de cambio)
 * arrastra centavos por línea y descuadra los totales.
 *
 * Las listas de abajo son EXACTAMENTE los campos que `resumeInvestor` pasa por
 * su helper `formatValue`, ni uno más ni uno menos: así el objeto derivado es
 * idéntico al que devuelve `resumeInvestor` con la conversión activada. Si
 * mañana se agrega un campo monetario allá, hay que agregarlo aquí — el test
 * `reporteMoneda.test.ts` falla si las dos versiones dejan de coincidir.
 */

// Campos monetarios de cada pago (`creditos[].pagos[]`).
// `cuota` queda fuera a propósito: hoy tampoco pasa por formatValue.
const CAMPOS_PAGO = [
  "abono_capital",
  "abono_interes",
  "abono_iva",
  "isr",
  "cuota_inversor",
  "cuota_inversionista",
  "abonoGeneralInteres",
] as const;

// Campos monetarios de cada crédito (`creditos[]`).
const CAMPOS_CREDITO = [
  "capital",
  "capital_actual",
  "cuota_interes",
  "iva12",
  "monto_aportado",
  "cuota_inversionista",
  "total_abono_capital",
  "total_abono_interes",
  "total_abono_iva",
  "total_isr",
  "total_neto_impuestos",
  "total_cuota",
] as const;

// Campos monetarios del subtotal. Cubre tanto el subtotal que arma
// `resumeInvestor` como el que devuelve `getInvestorTotalsGlobales` (que trae
// además los pools de excedente/variable de la modalidad combinada).
const CAMPOS_SUBTOTAL = [
  "total_abono_capital",
  "total_abono_interes",
  "total_abono_iva",
  "total_isr",
  "total_neto_impuestos",
  "total_cuota_sin_reinversion",
  "total_cuota_con_reinversion",
  "total_cuota",
  "total_reinversion_capital",
  "total_reinversion_interes",
  "total_reinversion",
  "total_monto_aportado",
  "total_abono_general_interes",
  "total_capital_creditos",
  "total_capital_actual",
  "total_reinv_tipo_capital",
  "total_reinv_tipo_interes",
  "total_reinv_tipo_total",
  "total_reinv_tipo_excedente",
  "total_reinv_tipo_variable",
] as const;

/**
 * Aplica formatToUSD a los campos listados, dejando intactos los que no están
 * (porcentajes, plazos, fechas, ids) y respetando los `null` — `formatToUSD`
 * devuelve 0 para null, y un `total_neto_impuestos: null` significa "no aplica",
 * no "cero".
 */
function convertirCampos<T extends Record<string, any>>(
  obj: T,
  campos: readonly string[],
  inversionistaId?: number
): T {
  const salida: Record<string, any> = { ...obj };
  for (const campo of campos) {
    if (salida[campo] === null || salida[campo] === undefined) continue;
    salida[campo] = formatToUSD(salida[campo], inversionistaId);
  }
  return salida as T;
}

/**
 * Deriva la versión en dólares de un reporte de inversionista en quetzales.
 * No muta el original: devuelve una copia nueva.
 *
 * `monto_reinversion` y `saldo_reinversion` se dejan crudos a propósito —
 * `buildInversionistaWorkbook` los convierte por su cuenta según `inv.moneda`.
 */
export function convertirReporteAUSD<T extends Record<string, any>>(reporteEnQuetzales: T): T {
  const inversionistaId = reporteEnQuetzales.inversionista_id;

  const creditos = (reporteEnQuetzales.creditos ?? []).map((credito: any) => {
    const convertido = convertirCampos(credito, CAMPOS_CREDITO, inversionistaId);
    convertido.pagos = (credito.pagos ?? []).map((pago: any) =>
      convertirCampos(pago, CAMPOS_PAGO, inversionistaId)
    );
    return convertido;
  });

  return {
    ...reporteEnQuetzales,
    moneda: "dolares",
    currencySymbol: "$",
    creditos,
    subtotal: reporteEnQuetzales.subtotal
      ? convertirCampos(reporteEnQuetzales.subtotal, CAMPOS_SUBTOTAL, inversionistaId)
      : reporteEnQuetzales.subtotal,
  };
}
