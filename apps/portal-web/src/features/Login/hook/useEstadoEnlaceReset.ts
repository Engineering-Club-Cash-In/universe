import { useQuery } from "@tanstack/react-query";
import apiAuth from "@/lib/api/apiAuth";

/**
 * Si el enlace de recuperación todavía sirve, preguntado ANTES de mostrar el
 * formulario.
 *
 * Este es el bug que reportó el PM. La pantalla abría igual con un enlace ya
 * usado —el token solo se validaba al enviar—, así que se veía exactamente
 * como uno bueno y la conclusión razonable era "el enlace sigue vigente". La
 * persona escribía la contraseña dos veces y recién entonces el servidor decía
 * que no.
 *
 * Un fallo de la consulta NO se toma como enlace muerto: se deja pasar al
 * formulario y que conteste el servidor al enviar. Bloquear por un 500 propio
 * dejaría a alguien sin poder recuperar su cuenta por un enlace que sí era
 * bueno.
 */
export type EstadoEnlace = "validando" | "valido" | "invalido";

interface RespuestaEnlace {
  success: boolean;
  data: { valido: boolean };
}

export const useEstadoEnlaceReset = (token: string): EstadoEnlace => {
  const { data, isPending, isError } = useQuery({
    queryKey: ["enlace-reset", token],
    queryFn: async () => {
      const response = await apiAuth.get<RespuestaEnlace>(
        `/api/password/enlace?token=${encodeURIComponent(token)}`,
      );
      return response.data.data.valido;
    },
    enabled: token !== "",
    // Un enlace no "se recupera" solo, y reintentar retrasa el veredicto.
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (token === "") return "invalido";
  if (isPending) return "validando";
  if (isError) return "valido";

  return data ? "valido" : "invalido";
};
