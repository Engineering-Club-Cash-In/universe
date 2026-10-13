import { useQuery } from "@tanstack/react-query";
import { previewBoletaTardia } from "../services/boletaTardia.services";
import type { ParamsPreviewBoletaTardia, VistaPreviaBoletaTardia } from "../components/boletaTardia";

/** Solo mientras el modal está abierto. `aperturaId` (un contador que 10.b sube en cada apertura) va en la queryKey: cada apertura es una consulta nueva y trae un intentoId NUEVO del servidor. */
export function useBoletaTardiaPreview(params: ParamsPreviewBoletaTardia | null, abierto: boolean, aperturaId = 0) {
  return useQuery<VistaPreviaBoletaTardia, Error>({
    queryKey: ["boleta-tardia-preview", aperturaId, params],
    queryFn: () => previewBoletaTardia(params!),
    enabled: abierto && params !== null,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
}
