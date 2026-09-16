import type { QueryClient } from "@tanstack/react-query";
import { QK_RUBROS } from "./rubrosCache";
import type { TipoRubro } from "../services/rubros.services";

/** Clave raíz de las queries de tipos; las variantes cuelgan de acá. */
export const QK_TIPOS = "rubrosTipos";

/** Lo que el formulario de edición de tipos puede cambiar. */
export type EdicionTipo = Pick<TipoRubro, "nombre" | "descripcion" | "obligatorio">;

/**
 * Aplica sobre una lista en caché la edición que el backend YA guardó.
 *
 * Parcha la fila existente en vez de construir una nueva: el formulario de
 * edición no toca `activo` —eso lo mueve el botón de activar/desactivar del
 * listado—, así que reemplazar la fila entera perdería ese estado. Reordena
 * por nombre porque el backend devuelve los tipos con `ORDER BY nombre` y un
 * renombrado que se queda en su lugar viejo hace saltar la lista cuando entra
 * el refetch.
 */
export function aplicarEdicionTipo(
  actuales: TipoRubro[] | undefined,
  tipoId: number,
  cambios: EdicionTipo
): TipoRubro[] | undefined {
  if (!actuales) return actuales;
  return actuales
    .map((t) =>
      t.tipo_id === tipoId
        ? {
            ...t,
            nombre: cambios.nombre,
            // Se siembra TAL CUAL lo que va en el PUT, sin convertir la cadena
            // vacía a null. Es lo que el backend va a tener: `actualizarTipo`
            // copia `descripcion` del patch sin normalizar, y el router tampoco
            // la toca, así que vaciar la descripción guarda "" y el refetch
            // devuelve "". Convertirla acá a null fabricaría justo la
            // diferencia entre siembra y refetch que esta función existe para
            // no tener. (El null sí aparece por otro lado: un tipo creado sin
            // descripción nace con null, porque el alta sí hace `?? null`.)
            descripcion: cambios.descripcion,
            obligatorio: cambios.obligatorio,
          }
        : t
    )
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
 *  - el refetch —`refetchType: "all"`, que sí alcanza a las inactivas— trae lo
 *    que el backend haya normalizado, que es lo que la siembra no puede
 *    adivinar: `editarTipoRubro` responde `void`, no la fila guardada, así que
 *    sembrar y quedarse ahí sería creerle al formulario y no al servidor.
 *
 * El `await` es parte del contrato: quien llama vuelve al listado recién
 * cuando el dato nuevo ya está en caché.
 */
export async function sincronizarTipoEditado(
  queryClient: QueryClient,
  tipoId: number,
  cambios: EdicionTipo
): Promise<void> {
  const aplicar = (actuales: TipoRubro[] | undefined) =>
    aplicarEdicionTipo(actuales, tipoId, cambios);
  queryClient.setQueryData<TipoRubro[]>([QK_TIPOS, false], aplicar);
  queryClient.setQueryData<TipoRubro[]>([QK_TIPOS, true], aplicar);
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
