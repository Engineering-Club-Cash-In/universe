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
 * alta una sociedad nueva.
 *
 * EL MINUTO NO ES UN NÚMERO SUELTO: es el TTL que ya tiene la resolución en
 * auth-google. Poner aquí más que allá no ahorra ninguna llamada —la de más ya
 * la contesta el servidor de su propio caché— y sí alarga lo que se tarda en
 * ver una sociedad nueva. Con cinco minutos, una recarga hecha dentro del TTL
 * del servidor se traía la lista vieja y la daba por fresca otros cinco.
 *
 * Y refresca al volver a la pestaña, que es lo único que rompe la asimetría de
 * este dato. Perder una entidad se cura solo: la petición siguiente contesta
 * 403 y el manejador global invalida esta consulta. GANAR una no dispara
 * ningún 403 —nada falla— así que sin esto la sociedad recién dada de alta no
 * aparecía hasta que la pantalla se desmontara con el caché ya vencido, o sea
 * nunca si la persona se queda mirando. Y el momento en que vuelve a la
 * pestaña es exactamente cuando le acaban de decir "listo, ya te la agregué".
 *
 * Se eligió el foco y no un `refetchInterval` a propósito: esto le pasa a una
 * persona cada varios meses, y sondear cada minuto en todos los portales
 * abiertos para siempre es mucho tráfico por un aviso que el foco ya da gratis.
 */
export const CACHE_ENTIDADES = {
  staleTime: 1 * MINUTO,
  gcTime: 30 * MINUTO,
  refetchOnWindowFocus: true,
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
