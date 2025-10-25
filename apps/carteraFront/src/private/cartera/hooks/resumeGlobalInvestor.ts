// hooks/useResumenGlobal.ts
import { useQuery } from "@tanstack/react-query"; 
import { type ResumenGlobalParams, inversionistasService, type InversionistaResumen } from "../services/services";

export const useResumenGlobal = (params: ResumenGlobalParams) => {
  return useQuery({
    queryKey: ["resumen-global", params],
    queryFn: async () => {
      const result = await inversionistasService.getResumenGlobal(params);
      
      // Si viene con excel=true, devuelve la URL
      if ("success" in result) {
        return result;
      }
      
      // Si no, devuelve el array de inversionistas
      return result as InversionistaResumen[];
    },
    enabled: !params.excel, // Solo auto-fetch si no es para Excel
  });
};

// 📥 Hook separado para descargar Excel
export const useDescargarResumenExcel = () => {
  return useQuery({
    queryKey: ["resumen-global-excel"],
    queryFn: async () => {
      // Este no se ejecuta automáticamente
      return null;
    },
    enabled: false, // Manual trigger
  });
};