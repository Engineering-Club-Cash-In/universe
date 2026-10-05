/**
 * Cuándo la lista de entidades que tiene el navegador dejó de ser cierta.
 *
 * `entidades` se cachea cinco minutos y auth-google guarda su propia copia un
 * minuto. Si el equipo le quita una sociedad a alguien que la tenía
 * seleccionada, durante esa ventana `useEntidades` sigue eligiendo el id que ya
 * no le pertenece: el servidor contesta 403 a cada consulta con alcance de
 * entidad y la persona ve un perfil vacío o una pantalla de inversiones sin
 * nada, sin que nada le diga por qué ni se corrija solo.
 *
 * El 403 ES la señal de que la lista caducó. Con él se invalida `entidades`, se
 * vuelve a pedir, y la selección guardada cae sola a una entidad que sí es
 * suya: `useEntidades` ya valida el id contra la lista del servidor.
 */

/** La primera parte de la queryKey de la lista de entidades. */
export const CLAVE_ENTIDADES = "entidades";

/**
 * ¿Este error es un "esa entidad no es tuya"?
 *
 * Solo 403. Un 401 es sesión caída y lo resuelve el guard mandando al login; un
 * 404 o un 500 no dicen nada sobre a quién pertenece qué, y refrescar la lista
 * por ellos convertiría cualquier caída del backend en una tormenta de
 * consultas.
 */
export const esEntidadNoAutorizada = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;

  const { status, response } = error as {
    status?: unknown;
    response?: { status?: unknown } | null;
  };

  return status === 403 || response?.status === 403;
};

/**
 * ¿Hay que refrescar la lista por culpa de ESTE error, en ESTA consulta?
 *
 * La propia `entidades` queda fuera a propósito: si su 403 disparara otra
 * invalidación, cada refresco pediría el siguiente y no habría forma de parar.
 */
export const hayQueRefrescarEntidades = (
  error: unknown,
  queryKey: readonly unknown[],
): boolean =>
  esEntidadNoAutorizada(error) && queryKey[0] !== CLAVE_ENTIDADES;
