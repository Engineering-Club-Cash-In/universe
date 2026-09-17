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
 * Deja la lista del crédito al día después de CREAR o ANULAR un rubro, y recién
 * entonces resuelve.
 *
 * Es el mismo agujero de TIEMPO que tenía la edición y que arregla
 * `sincronizarRubroEditado`: la lista vive en el componente padre y sigue
 * activa, así que el refetch salía solo — lo que faltaba era ESPERARLO. Sin el
 * await se volvía a la lista en el acto y, durante el viaje del GET, se pintaba
 * la de antes: el rubro recién creado no estaba (con el toast de "Rubro creado"
 * arriba, y en un crédito sin rubros el cartel de "no hay rubros" todavía a la
 * vista), y el recién anulado seguía diciendo "Activo" con su saldo pendiente de
 * antes, ofreciendo editar y anular — acciones que el servidor ya rechaza.
 *
 * No siembra nada, a diferencia del helper de edición, y no es una omisión:
 * `crearRubro` y `anularRubro` responden `void` porque el POST y el
 * POST /anular del backend no devuelven la fila. No hay "estado posterior a la
 * escritura" que poner en caché, así que el refetch es la única fuente y no hay
 * orden refresco/siembra que decidir.
 *
 * Que `invalidateQueries` se trague el error del refetch es lo que acá se
 * quiere: el cargo ya se creó o se anuló en la base, y una red caída después no
 * puede dejar al usuario atrapado en el formulario.
 */
export async function refrescarRubros(
  queryClient: QueryClient,
  creditoId: number | null
): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: [QK_RUBROS, creditoId] });
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
 * QUIÉN MANDA: el servidor. El refetch posterior al PUT es lo que queda en
 * pantalla, y `guardado` —la fila que el backend devolvió de nuestro propio
 * UPDATE— entra SÓLO si ese refetch no trajo nada.
 *
 * Parece al revés, porque `guardado` es dato fresco del backend y no lo que el
 * formulario mandó. Pero entre que el PUT respondió y el GET volvió, otro
 * administrador puede haber editado la misma fila: el refetch trae SU valor, más
 * nuevo que el nuestro, y sembrar encima lo revierte. Peor, no queda sólo en
 * pantalla — el que reabre esa fila carga el formulario con el valor revertido y
 * al guardar lo persiste. Entre mostrar un dato viejo un rato y borrarle la
 * edición a otro, se elige lo primero: es visible y se cura solo al refrescar.
 *
 * CUÁNDO SIEMBRA: sólo si el refetch no trajo valor nuevo — y eso se MIDE, no se
 * deduce de la causa. Se guarda el `dataUpdatedAt` antes de invalidar y se
 * compara después: si no avanzó, no llegó nada.
 *
 * Enumerar las causas fue el primer intento y se quedó corto tres veces, porque
 * ninguna de ellas levanta una excepción y varias dejan el estado diciendo
 * `success`:
 *
 *   * **la red se cayó** — `invalidateQueries` resuelve igual, sin tirar error, y
 *     deja el fetch en `fetchStatus: "paused"` mientras el `status` sigue en
 *     `success` porque conserva el último dato bueno;
 *   * **el refetch no salió por inactiva** — el default es
 *     `refetchType: "active"`, y a una query sin observadores sólo la marca
 *     obsoleta. De ahí el `refetchType: "all"`, igual que en los TIPOS;
 *   * **el refetch no salió por DESHABILITADA**, que es el caso real y el que
 *     `"all"` tampoco alcanza: la query de rubros es `enabled: open && …`, así
 *     que al cerrar el modal el observer sigue MONTADO con `enabled: false`. Eso
 *     la vuelve `isDisabled`, y `refetchQueries` filtra las deshabilitadas
 *     incluso con `"all"`. Estado final: `success`/`idle`, o sea "todo bien".
 *
 * Mirar el `dataUpdatedAt` cubre las tres y las que vengan, porque pregunta por
 * el resultado en vez de por el motivo. Y no se confunde con un refetch exitoso
 * que devuelve lo mismo: el sello avanza en cada respuesta buena, aunque los
 * datos sean idénticos. Las cinco situaciones están medidas contra la versión
 * instalada de TanStack, no deducidas.
 *
 * Perder la edición es peor justo en esos casos, porque el cargo YA está cambiado
 * en la base: el administrador vuelve a la lista, ve el monto anterior y lo
 * "corrige" sobre un dato que ya no existe.
 *
 * El refetch además es lo único que trae `tipo_nombre` y `abonado`, que el PUT no
 * devuelve.
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

  // El sello de la última respuesta buena, ANTES de pedir la nueva. Es la vara
  // con la que después se mide si llegó algo.
  const selloPrevio = queryClient.getQueryState<RubroCredito[]>(queryKey)
    ?.dataUpdatedAt;

  // `refetchType: "all"` alcanza a la query inactiva, que el default
  // (`"active"`) deja sin refrescar. No alcanza a la DESHABILITADA —ver arriba—,
  // y por eso la decisión no se apoya en esto sino en el sello.
  //
  // No hace falta cancelar a mano lo que esté en vuelo: la invalidación dispara
  // su refetch con `cancelRefetch: true`, y eso descarta el resultado del GET
  // rezagado aunque el `queryFn` no acepte un AbortSignal —la cancelación actúa
  // sobre el caché, no sobre el socket—.
  await queryClient.invalidateQueries({ queryKey, refetchType: "all" });

  // Si llegó algo del servidor, manda el servidor. La siembra es el plan B.
  const estado = queryClient.getQueryState<RubroCredito[]>(queryKey);

  // Sin entrada en caché no hay lista que corregir: la próxima vez que monte va
  // a pedirla de cero. Sembrar acá dejaría un listado de una sola fila.
  const noLlegoNada =
    estado !== undefined && estado.dataUpdatedAt === selloPrevio;

  if (guardado && noLlegoNada) {
    queryClient.setQueryData<RubroCredito[]>(queryKey, (actuales) =>
      aplicarEdicionRubro(actuales, rubroId, guardado)
    );
  }
}
