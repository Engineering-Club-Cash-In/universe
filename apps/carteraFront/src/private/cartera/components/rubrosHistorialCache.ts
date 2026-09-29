import type { QueryClient } from "@tanstack/react-query";

/** Clave del historial de UN rubro. */
export const QK_HISTORIAL = "rubroHistorial";

/**
 * Tira de la caché el historial de un rubro que acaba de cambiar.
 *
 * Hace falta porque el historial se mira ANTES de editar o anular: se abre desde
 * la lista, se vuelve, y recién entonces se toca el rubro. Esa query queda en
 * caché con los eventos de antes, y tanto `editarRubro` como `anularRubro`
 * escriben su propia fila en `rubros_historial` (verificado en
 * `cartera-back/src/controllers/rubros.ts`), así que lo que quedó guardado ya no
 * es todo lo que pasó — le falta justo el cambio recién hecho y su motivo, que
 * es lo único que después explica por qué ese cobro se tocó.
 *
 * Se OLVIDA en vez de invalidar, y no es lo mismo:
 *
 *  - `invalidateQueries` marca obsoleto pero NO vacía. Al reabrir el historial,
 *    React Query entrega `status: "success"` con los eventos viejos e
 *    `isLoading === false`, así que `VistaHistorial` —que decide por
 *    `isLoading`— pinta la lista vieja mientras el GET viaja de fondo. El
 *    refetch ya salía solo (el `staleTime` por defecto es 0 y la vista se
 *    remonta cada vez); lo que sobraba era el dato viejo listo para pintarse.
 *  - `refetchType: "all"`, que es como se arregló el caso de los TIPOS, tampoco
 *    corresponde. Allá se vuelve al listado en el acto y hay que tener el dato
 *    puesto antes de llegar; acá el historial puede no abrirse nunca, y salir a
 *    buscar eventos que nadie está mirando cuesta un GET en el mismo momento en
 *    que el usuario espera que vuelva la lista de rubros.
 *
 * Sin dato en caché, quien reabra arranca con el spinner y ve lo que el servidor
 * tenga. Por eso tampoco devuelve promesa: no hay nada que esperar, y quien
 * llama puede volver a la lista en el acto.
 *
 * Va apuntado al `rubro_id`: tirar la caché de todos los historiales haría que
 * mirar un cargo cueste un GET nuevo por culpa de la edición de otro.
 */
export function olvidarHistorialRubro(
  queryClient: QueryClient,
  rubroId: number
): void {
  queryClient.removeQueries({ queryKey: [QK_HISTORIAL, rubroId] });
}
