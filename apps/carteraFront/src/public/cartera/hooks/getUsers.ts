import { useMemo } from "react";
import { getUsersWithSifco } from "../services/services";
import type { UsuarioConCreditosSifco } from "../services/services";

import { useQuery } from "@tanstack/react-query";
/**
 * Hook para obtener usuarios con sus números de crédito SIFCO
 */
export function useUsersWithSifco() {
  return useQuery<UsuarioConCreditosSifco[], Error>({
    queryKey: ["users-with-sifco"],
    queryFn: getUsersWithSifco,
    staleTime: 1000 * 60, // 1 minuto
    refetchOnWindowFocus: false,
  });
}
export function useSearchUsuariosConSifco(data: UsuarioConCreditosSifco[], search: string) {
  const searchLower = search.trim().toLowerCase();
  return useMemo(() => {
    if (!searchLower) return data;
    return data.filter(u =>
      u.nombre.toLowerCase().includes(searchLower) ||
      u.numeros_credito_sifco.some(sifco => sifco.toLowerCase().includes(searchLower))
    );
  }, [data, searchLower]);
}