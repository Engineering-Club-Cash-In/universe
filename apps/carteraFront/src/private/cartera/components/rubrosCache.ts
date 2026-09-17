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
async function refrescarYSembrarSiNoLlegoNada(
  queryClient: QueryClient,
  creditoId: number | null,
  sembrar: (actuales: RubroCredito[] | undefined) => RubroCredito[] | undefined
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

  if (noLlegoNada) {
    queryClient.setQueryData<RubroCredito[]>(queryKey, sembrar);
  }
}

export async function sincronizarRubroEditado(
  queryClient: QueryClient,
  creditoId: number | null,
  rubroId: number,
  guardado: RubroGuardado | null
): Promise<void> {
  await refrescarYSembrarSiNoLlegoNada(queryClient, creditoId, (actuales) =>
    aplicarEdicionRubro(actuales, rubroId, guardado)
  );
}

/**
 * Lo mismo, para una ANULACIÓN. Comparte el helper y no por simetría: es
 * literalmente la misma operación sobre el caché —parchar una fila con lo que el
 * backend devolvió— y el mismo agujero si el refetch no trae nada.
 *
 * Acá duele más que al editar, porque la anulación deja la fila TERMINAL. Sin
 * red, la lista sigue diciendo "Activo" con el saldo de antes y ofreciendo
 * Editar y Anular: el usuario aprieta botones que el backend ya rechaza con 409.
 * Con la fila sembrada —`anulado`, `completado`, `activo: false`, saldo 0—
 * `estadoDeRubro` pinta "Anulado" y los dos botones desaparecen solos.
 *
 * Se parcha en vez de reemplazar, igual que al editar: la respuesta del POST es
 * la fila cruda de `rubros`, sin `tipo_nombre` ni `abonado`.
 */
export async function sincronizarRubroAnulado(
  queryClient: QueryClient,
  creditoId: number | null,
  rubroId: number,
  anulado: RubroGuardado | null
): Promise<void> {
  await refrescarYSembrarSiNoLlegoNada(queryClient, creditoId, (actuales) =>
    aplicarEdicionRubro(actuales, rubroId, anulado)
  );
}

/**
 * Y para un rubro RECIÉN CREADO, que en vez de parchar AGREGA.
 *
 * Mismo criterio, con una diferencia que obliga a pasar el nombre del tipo: acá
 * no hay fila previa que parchar, y la respuesta del POST —igual que la del PUT—
 * es la fila cruda de `rubros`, sin el `tipo_nombre` que el GET saca del join.
 * Sembrarla pelada dejaría la columna "Tipo" en blanco, así que se usa el nombre
 * del tipo que el usuario ACABA de elegir en el formulario. No se adivina de
 * ninguna caché: es el dato que se tipeó.
 *
 * `abonado` arranca en cero porque un rubro nuevo no tiene abonos; es lo mismo
 * que va a devolver el GET.
 *
 * Si el refetch sí trajo la lista, ésta no corre — así que no hay riesgo de
 * duplicar la fila.
 */
export async function sincronizarRubroCreado(
  queryClient: QueryClient,
  creditoId: number | null,
  creado: RubroGuardado | null,
  tipoNombre: string
): Promise<void> {
  await refrescarYSembrarSiNoLlegoNada(queryClient, creditoId, (actuales) => {
    if (!creado) return actuales;
    const lista = actuales ?? [];
    // Por si el refetch lo trajo y el sello no se movió por otra razón: agregar
    // dos filas del mismo rubro sería peor que no agregar ninguna.
    if (lista.some((r) => r.rubro_id === creado.rubro_id)) return lista;
    // PRIMERO, no al final: el GET ordena `desc(rubros.created_at)`, así que el
    // más nuevo va arriba. Agregarlo al final lo dejaba como la fila más vieja y
    // en un crédito con varios cobros se iba fuera de pantalla — justo cuando la
    // siembra es lo único que lo muestra.
    return [{ ...creado, tipo_nombre: tipoNombre, abonado: "0.00" }, ...lista];
  });
}
