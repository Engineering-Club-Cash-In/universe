import type { QueryClient } from "@tanstack/react-query";
import { QK_RUBROS } from "./rubrosCache";
import type { TipoRubro } from "../services/rubros.services";

/** Clave raíz de las queries de tipos; las variantes cuelgan de acá. */
export const QK_TIPOS = "rubrosTipos";

/**
 * Lo que el formulario de edición de tipos puede cambiar.
 *
 * Ya no es lo que se siembra —para eso va la fila COMPLETA que devuelve el PUT—,
 * pero sigue nombrando el patch que el formulario arma.
 */
export type EdicionTipo = Pick<TipoRubro, "nombre" | "descripcion" | "obligatorio">;

/**
 * Aplica sobre una lista en caché la fila que el backend YA guardó.
 *
 * Se siembra la fila AUTORITATIVA completa, no una proyección del formulario.
 * Antes se parchaban sólo `nombre`, `descripcion` y `obligatorio` y se conservaba
 * el `activo` de la caché, con el argumento de que el formulario no lo toca. El
 * argumento fallaba en el caso que importa: si OTRO administrador desactiva el
 * tipo mientras este formulario está abierto, el PUT contesta `activo: false` y
 * la siembra volvía a pintarlo activo. Con el refetch pausado o caído, el
 * desplegable de creación —que es de sólo activos— seguía ofreciendo un tipo que
 * el backend rechaza.
 *
 * Por eso `soloActivos`: en la variante `[QK_TIPOS, false]` un tipo que volvió
 * inactivo no se parcha, se SACA. Dejarlo ahí con `activo: false` sería el mismo
 * problema con otra forma, porque esa lista no filtra al pintar — filtra al pedir.
 *
 * Reordena por nombre porque el backend devuelve los tipos con `ORDER BY nombre`
 * y un renombrado que se queda en su lugar viejo hace saltar la lista cuando
 * entra el refetch.
 */
export function aplicarEdicionTipo(
  actuales: TipoRubro[] | undefined,
  tipoId: number,
  tipo: TipoRubro,
  opciones: { soloActivos: boolean }
): TipoRubro[] | undefined {
  if (!actuales) return actuales;

  if (opciones.soloActivos && !tipo.activo) {
    return actuales.filter((t) => t.tipo_id !== tipoId);
  }

  return actuales
    .map((t) => (t.tipo_id === tipoId ? { ...t, ...tipo } : t))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/**
 * Deja al día las dos variantes de la query de tipos después de editar una.
 *
 * Hace falta porque `VistaEditarTipo` REEMPLAZA a `VistaAdminTipos` en el
 * Dialog en vez de abrirse encima: mientras se edita, tanto `[QK_TIPOS, true]`
 * (el listado de administración) como `[QK_TIPOS, false]` (el desplegable de
 * "crear") están DESMONTADAS. Un `invalidateQueries` pelado no las vuelve a
 * pedir —su default es `refetchType: "active"`, o sea que a una query inactiva
 * sólo la marca obsoleta—, así que al volver el listado se pintaba con el
 * nombre, la descripción y el "obligatorio" viejos. Si el administrador reabre
 * esa fila antes de que llegue el refetch de fondo, el formulario nace con los
 * datos viejos y el PUT siguiente PISA la edición recién guardada.
 *
 * Se hacen las dos cosas, y en este orden, porque ninguna alcanza sola:
 *  - la siembra sostiene el dato correcto aunque el refetch falle (la red se
 *    cayó justo después del PUT), que es el caso en el que perder la edición
 *    dolería más;
 *  - el refetch —`refetchType: "all"`, que sí alcanza a las inactivas— confirma
 *    contra el servidor y trae de paso lo que haya cambiado en OTRAS filas.
 *
 * (`editarTipoRubro` ya devuelve la fila guardada, así que la siembra le cree al
 * servidor y no al formulario. Antes respondía `void` y había que adivinarla.)
 *
 * El `await` es parte del contrato: quien llama vuelve al listado recién
 * cuando el dato nuevo ya está en caché.
 */
export async function sincronizarTipoEditado(
  queryClient: QueryClient,
  tipoId: number,
  /** La fila que DEVOLVIÓ el PUT, que es la única versión autoritativa. */
  tipo: TipoRubro
): Promise<void> {
  queryClient.setQueryData<TipoRubro[]>([QK_TIPOS, false], (a) =>
    aplicarEdicionTipo(a, tipoId, tipo, { soloActivos: true })
  );
  queryClient.setQueryData<TipoRubro[]>([QK_TIPOS, true], (a) =>
    aplicarEdicionTipo(a, tipoId, tipo, { soloActivos: false })
  );
  await queryClient.invalidateQueries({
    queryKey: [QK_TIPOS],
    refetchType: "all",
  });

  /**
   * Y la LISTA DE RUBROS del crédito, que también guarda el nombre del tipo.
   *
   * Cada `RubroCredito` trae `tipo_nombre` pegado desde el join del GET, así que
   * renombrar un tipo deja esa copia vieja en caché. La query del listado vive
   * en el componente padre y NO se desmonta mientras se navega por las vistas
   * internas, así que al volver de administrar tipos la tabla sigue mostrando el
   * nombre anterior —y el encabezado del historial también— hasta que algo no
   * relacionado la refresque.
   *
   * Se invalida sin esperar y sin `refetchType`: la query está activa, así que el
   * refetch sale solo, y a quien renombró un tipo no hay por qué hacerlo esperar
   * una lista que ni siquiera está mirando.
   */
  queryClient.invalidateQueries({ queryKey: [QK_RUBROS] });
}
