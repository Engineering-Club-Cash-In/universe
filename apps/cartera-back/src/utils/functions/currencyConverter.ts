import { USD_EXCHANGE_RATE } from "./const";

/**
 * Tipo de cambio Q → USD que le corresponde a un inversionista.
 *
 * Único lugar del sistema donde vive esa tasa: `formatToUSD` la consume y la
 * liquidación la guarda junto al reporte para dejarlo reproducible. El día que
 * las tasas se muevan a una tabla, este es el único punto a cambiar.
 */
export const getTipoCambioUSD = (inversionistaId?: number): number =>
  inversionistaId === 84 ? 7.78 : USD_EXCHANGE_RATE;

export const formatToUSD = (montoEnQuetzales: number | string | null | undefined, inversionistaId?: number): number => {
  if (montoEnQuetzales === null || montoEnQuetzales === undefined) return 0;
  const val = Number(montoEnQuetzales);
  if (isNaN(val)) return 0;

  const exchangeRate = getTipoCambioUSD(inversionistaId);

  // Prevenir división por cero si la variable de entorno no está correctamente configurada
  if (!exchangeRate || exchangeRate <= 0) return 0;

  return Number((val / exchangeRate).toFixed(2));
};
