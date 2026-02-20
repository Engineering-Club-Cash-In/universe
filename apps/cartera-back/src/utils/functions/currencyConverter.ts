import { USD_EXCHANGE_RATE } from "./const";

export const formatToUSD = (montoEnQuetzales: number | string | null | undefined): number => {
  if (montoEnQuetzales === null || montoEnQuetzales === undefined) return 0;
  const val = Number(montoEnQuetzales);
  if (isNaN(val)) return Number(montoEnQuetzales) || 0;
  return Number((val / USD_EXCHANGE_RATE).toFixed(2));
};
