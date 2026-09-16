/**
 * Qué pantalla toca cuando lo que se muestra cuelga de una entidad (la ficha de
 * inversionista que está viendo la persona).
 *
 * Son CUATRO estados, no tres. El que faltaba —y por el que existe este
 * módulo— es "sin entidades": `/api/cartera/entidades` respondió 200 con `[]`.
 * No es una carga, no es un error, y NO es "no hay datos": es que el usuario
 * todavía no está atado a ninguna ficha. Al no distinguirlo, cada pantalla
 * caía en su estado vacío —el perfil se pintaba entero, con los botones de
 * editar banco que revientan sin entidad (`ModalConfirmChange.tsx:60`), y los
 * documentos decían "No tienes documentos"—, que es la misma confusión que ya
 * documenta `ErrorCarga`: una pantalla vacía se lee como un dato real.
 *
 * El orden es la mitad del asunto: un error NUNCA puede degradar a "no estás
 * vinculado", porque manda a llamar al asesor por lo que puede ser una caída de
 * red. Por eso vive aquí, en un solo sitio con pruebas, y no repetido en cada
 * componente.
 */
export type PantallaDeEntidad =
  | "cargando"
  | "error"
  | "sin-entidades"
  | "contenido";

export const pantallaDeEntidad = (estado: {
  cargando: boolean;
  /** Falló la lista de entidades o el dato que cuelga de ella. */
  hayError: boolean;
  /** Cartera CONFIRMÓ que no hay ninguna (ver `useEntidades.sinEntidades`). */
  sinEntidades: boolean;
}): PantallaDeEntidad => {
  if (estado.cargando) return "cargando";
  if (estado.hayError) return "error";
  if (estado.sinEntidades) return "sin-entidades";
  return "contenido";
};
