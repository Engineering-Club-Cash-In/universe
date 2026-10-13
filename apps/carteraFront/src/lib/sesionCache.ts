import type { QueryClient } from "@tanstack/react-query";

/**
 * Borra todo lo que React Query guardó de la sesión que se va.
 *
 * Los queryKey de la app no llevan la identidad del usuario y casi todos tienen
 * staleTime, así que si la caché sobrevive a un cambio de sesión (un ADMIN sale y
 * entra un ASESOR en la misma pestaña) el nuevo usuario ve, sin pedirlos, los datos
 * del anterior hasta que venza el staleTime. Se cancela primero lo que está en vuelo:
 * una respuesta que llega tarde no debe volver a escribir en la caché ya vacía.
 * Se llama al cerrar sesión (por cualquier motivo) y antes de abrir una nueva.
 */
export function limpiarCacheDeSesion(
  queryClient: Pick<QueryClient, "cancelQueries" | "clear">,
): void {
  void queryClient.cancelQueries();
  queryClient.clear();
}
