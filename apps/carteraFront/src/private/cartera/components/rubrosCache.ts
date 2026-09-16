import type { QueryClient } from "@tanstack/react-query";
import type { RubroCredito, RubroGuardado } from "../services/rubros.services";

/** Clave de la lista de rubros de un crédito. */
export const QK_RUBROS = "rubrosCredito";

/**
 * Aplica sobre la lista en caché la edición que el backend YA guardó.
 *
 * Parcha la fila en vez de reemplazarla, y eso no es prolijidad: la respuesta
 * del PUT es la fila cruda de `rubros`, sin `tipo_nombre` —que sale del join con
 * `rubros_tipos`— ni `abonado` —que lo deriva el GET de la lista—. Sustituir la
 * fila entera dejaría la columna "Tipo" vacía y el abonado en blanco, o sea
 * cambiaría un dato viejo por dos datos faltantes.
 *
 * No reordena, a diferencia del helper de tipos: la lista de rubros va por
 * `created_at` y una edición no lo toca.
 */
export function aplicarEdicionRubro(
  actuales: RubroCredito[] | undefined,
  rubroId: number,
  guardado: RubroGuardado | null
): RubroCredito[] | undefined {
  if (!actuales || !guardado) return actuales;
  return actuales.map((r) =>
    r.rubro_id === rubroId ? { ...r, ...guardado } : r
  );
}

/**
 * Deja la lista del crédito al día después de editar un rubro, y recién
 * entonces resuelve.
 *
 * El `await` es el arreglo, no un detalle de estilo. Antes se disparaba el
 * `invalidateQueries` sin esperarlo y se volvía a la lista en el acto: durante
 * el viaje del GET, la lista se pintaba con la fila VIEJA, y el administrador
 * que reabría esa fila en ese hueco cargaba el formulario con el monto y la
 * descripción anteriores — el PUT siguiente PISABA la edición que acababa de
 * guardar, sin que nada se lo avisara.
 *
 * Es el mismo defecto que ya se había arreglado para los TIPOS de rubro, pero no
 * el mismo caso, y conviene saber en qué difiere: allá la query queda DESMONTADA
 * al editar, así que el `invalidateQueries` pelado ni siquiera la volvía a pedir
 * y hubo que forzar `refetchType: "all"`. Acá la query vive en el componente
 * padre y sigue activa, así que el refetch sí salía — el agujero era de TIEMPO.
 *
 * ORDEN: primero se refresca y DESPUÉS se siembra, que es al revés de lo que
 * parece natural. El motivo es que `guardado` no es lo que el formulario mandó:
 * es la fila que el backend devolvió de su propio UPDATE, o sea el estado
 * posterior a la escritura. Cualquier GET que estuviera en vuelo salió ANTES del
 * PUT y por lo tanto trae datos más viejos; si se sembrara primero, esa
 * respuesta rezagada aterrizaría encima y la pantalla volvería sola al monto
 * anterior sin que nadie tocara nada. Sembrando al final, lo último que queda en
 * caché es siempre lo que el servidor guardó.
 *
 * Eso mismo cubre el caso en que el refetch FALLA —la red se cayó justo después
 * del PUT, que es cuando perder la edición más duele porque el cargo ya está
 * cambiado en la base—: `invalidateQueries` se traga el error y resuelve igual,
 * y la siembra posterior deja en pantalla lo guardado y no lo anterior.
 *
 * El refetch sigue haciendo falta aunque la siembra sea la que manda: es lo que
 * trae `tipo_nombre` y `abonado`, que el PUT no devuelve.
 *
 * Todo va apuntado a `[QK_RUBROS, creditoId]`: sembrar por `rubro_id` sin mirar
 * de quién es la lista pondría el cargo de un cliente en la ficha de otro.
 */
export async function sincronizarRubroEditado(
  queryClient: QueryClient,
  creditoId: number | null,
  rubroId: number,
  guardado: RubroGuardado | null
): Promise<void> {
  const queryKey = [QK_RUBROS, creditoId];

  await queryClient.invalidateQueries({ queryKey });

  if (guardado) {
    queryClient.setQueryData<RubroCredito[]>(queryKey, (actuales) =>
      aplicarEdicionRubro(actuales, rubroId, guardado)
    );
  }
}
