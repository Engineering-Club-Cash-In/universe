import { useQuery } from "@tanstack/react-query";
import {
  getPagosPorVencimiento,
  type PagosPorVencimientoParams,
  type PagosPorVencimientoResponse,
} from "../services/services";

export const usePagosPorVencimiento = (params: PagosPorVencimientoParams) => {
  return useQuery<PagosPorVencimientoResponse, Error>({
    queryKey: [
      "pagosPorVencimiento",
      params.mes,
      params.anio,
      params.page,
      params.pageSize,
      params.numero_credito_sifco,
      params.nombre_usuario,
      params.tipo_fecha,
      params.asesor,
      params.rango_mora,
    ],
    queryFn: async () => {
      const response = await getPagosPorVencimiento(params);
      if (!response.success) throw new Error("Error al obtener pagos por vencimiento");
      return response;
    },
    refetchOnWindowFocus: false,
    staleTime: 1000 * 60 * 5,
    retry: 1,
  });
};
