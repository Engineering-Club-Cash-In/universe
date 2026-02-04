import { useQuery } from "@tanstack/react-query";
import { getEfectividadAsesores, type EfectividadAsesor } from "../services/services";

export const useEfectividadAsesores = (params: {
  dia?: number;
  mes: number;
  anio: number;
  asesor_id?: number;
}) => {
  return useQuery<EfectividadAsesor[], Error>({
    queryKey: ["efectividadAsesores", params.dia, params.mes, params.anio, params.asesor_id],
    queryFn: async () => {
      const response = await getEfectividadAsesores(params);
      if (!response.ok) throw new Error("Error al obtener efectividad");
      return response.data;
    },
    refetchOnWindowFocus: false,
    staleTime: 1000 * 60 * 5,
    retry: 1,
  });
};
