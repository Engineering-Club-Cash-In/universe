const MINUTO = 60 * 1000;

/**
 * Caché de las consultas con alcance de entidad.
 *
 * Cambiar de entidad en el selector, o moverse entre Perfil / Inversiones /
 * Documentos, desmonta y vuelve a montar las pantallas. Con el `staleTime` en 0
 * que trae react-query por defecto, cada uno de esos movimientos disparaba una
 * consulta nueva: ir y venir entre dos sociedades le pegaba a la API en cada
 * clic aunque los datos fueran los mismos de hace dos segundos.
 *
 * El `gcTime` es más largo que el `staleTime` a propósito: al volver a una
 * entidad que ya se vio, los datos salen del caché al instante en vez de dejar
 * el spinner, y si ya se pasaron de frescos react-query los revalida por
 * detrás sin vaciar la pantalla.
 *
 * Nada de esto tapa un cambio recién hecho: las mutaciones siguen llamando a
 * `refetch()`, que ignora el `staleTime`.
 */

/** Catálogos que no cambian durante una sesión (bancos). */
export const CACHE_CATALOGO = {
  staleTime: 30 * MINUTO,
  gcTime: 60 * MINUTO,
} as const;

/**
 * Qué entidades puede operar la persona. Solo cambia cuando el CRM le da de
 * alta una sociedad nueva, y para eso ya hay un minuto de caché en el servidor.
 */
export const CACHE_ENTIDADES = {
  staleTime: 5 * MINUTO,
  gcTime: 30 * MINUTO,
} as const;

/** Ficha de la entidad: perfil y documentos. Se mueve de vez en cuando. */
export const CACHE_FICHA = {
  staleTime: 5 * MINUTO,
  gcTime: 15 * MINUTO,
} as const;

/**
 * Plata: estadísticas y liquidaciones. Se mueven con cada liquidación, no cada
 * minuto, pero se les deja el vencimiento más corto de los tres.
 */
export const CACHE_MOVIMIENTOS = {
  staleTime: 2 * MINUTO,
  gcTime: 15 * MINUTO,
} as const;
