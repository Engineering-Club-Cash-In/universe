import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib";
import { getEntidades, type Entidad } from "../services/entitiesService";
import { useEntidadActivaStore } from "../store/useEntidadActiva";
import { CACHE_ENTIDADES } from "../constants/cache";

/**
 * Entidades del inversionista logueado y cuál está viendo.
 *
 * Todo lo que dependa de una entidad debe esperar a `inversionistaId`
 * (`enabled: !!inversionistaId`) y meterlo en su queryKey: si no, al cambiar de
 * entidad se quedan pintados los datos de la anterior.
 */
export const useEntidades = () => {
  const { user } = useAuth();
  const isInvestor = user?.role === "INVESTOR";
  const userId = user?.id;

  const porUsuario = useEntidadActivaStore((s) => s.porUsuario);
  const setEntidadActiva = useEntidadActivaStore((s) => s.setEntidadActiva);

  const { data, isLoading } = useQuery({
    queryKey: ["entidades", userId],
    queryFn: getEntidades,
    enabled: !!userId && isInvestor,
    ...CACHE_ENTIDADES,
  });

  const entidades: Entidad[] = data ?? [];
  const guardada = userId ? porUsuario[userId] : undefined;

  // El id guardado se valida siempre contra la lista del servidor. Si ya no
  // está, se cae a la primera entidad sin avisarle al usuario.
  const entidadActiva =
    entidades.find((e) => e.inversionista_id === guardada) ??
    entidades[0] ??
    null;

  useEffect(() => {
    if (!userId || !entidadActiva) return;
    if (entidadActiva.inversionista_id !== guardada) {
      setEntidadActiva(userId, entidadActiva.inversionista_id);
    }
  }, [userId, entidadActiva, guardada, setEntidadActiva]);

  const seleccionar = (inversionistaId: number) => {
    if (userId) setEntidadActiva(userId, inversionistaId);
  };

  return {
    entidades,
    entidadActiva,
    inversionistaId: entidadActiva?.inversionista_id ?? null,
    seleccionar,
    isLoading: isLoading && isInvestor,
    /** El usuario es inversionista pero no tiene ninguna entidad en cartera. */
    sinEntidades: isInvestor && !isLoading && entidades.length === 0,
  };
};
