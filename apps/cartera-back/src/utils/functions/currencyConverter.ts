import { USD_EXCHANGE_RATE } from "./const";

export const formatToUSD = (montoEnQuetzales: number | string | null | undefined): number => {
  if (montoEnQuetzales === null || montoEnQuetzales === undefined) return 0;
  const val = Number(montoEnQuetzales);
  if (isNaN(val)) return 0;
  
  // Prevenir división por cero si la variable de entorno no está correctamente configurada
  if (!USD_EXCHANGE_RATE || USD_EXCHANGE_RATE <= 0) return 0;
  
  return Number((val / USD_EXCHANGE_RATE).toFixed(2));
};
