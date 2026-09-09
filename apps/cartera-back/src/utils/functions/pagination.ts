/**
 * Clamp defensivo de paginación, compartido por los listados de mora
 * (`getCreditosWithMoras`, `getCondonacionesMora`, `getMoraHistorialSnapshot`).
 *
 * Evita OFFSET negativo / NaN si llega page/pageSize inválido —vienen de un
 * query string— y topa pageSize a 500 para que nadie se traiga la tabla entera
 * en un request.
 */
export function clampPagination(page?: number, pageSize?: number) {
  const p = Number.isFinite(page) && (page as number) > 0 ? Math.floor(page as number) : 1;
  const ps = Number.isFinite(pageSize) && (pageSize as number) > 0
    ? Math.min(Math.floor(pageSize as number), 500)
    : 20;
  return { page: p, pageSize: ps, offset: (p - 1) * ps };
}

/**
 * Escapa los comodines de LIKE/ILIKE en un término de búsqueda del usuario.
 *
 * Sin esto, buscar "_" en un nombre matchea a TODOS (es el comodín de "un
 * carácter cualquiera") y "%" devuelve la tabla completa. El carácter de
 * escape por defecto de Postgres es la contrabarra, así que no hace falta
 * cláusula ESCAPE; por eso también hay que escapar la contrabarra misma.
 */
export function escaparLike(termino: string): string {
  return termino.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Patrón `%término%` con los comodines del usuario ya neutralizados. */
export function contienePatron(termino: string): string {
  return `%${escaparLike(termino)}%`;
}
