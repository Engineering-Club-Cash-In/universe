import { USD_EXCHANGE_RATE } from "./const";

export const formatToUSD = (montoEnQuetzales: number | string | null | undefined, inversionistaId?: number): number => {
  if (montoEnQuetzales === null || montoEnQuetzales === undefined) return 0;
  const val = Number(montoEnQuetzales);
  if (isNaN(val)) return 0;

  const exchangeRate = inversionistaId === 84 ? 7.78 : USD_EXCHANGE_RATE;

  // Prevenir división por cero si la variable de entorno no está correctamente configurada
  if (!exchangeRate || exchangeRate <= 0) return 0;

  return Number((val / exchangeRate).toFixed(2));
};
