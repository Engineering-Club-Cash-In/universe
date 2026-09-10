/**
 * Clamp defensivo de paginación, compartido por los listados de mora
 * (`getCreditosWithMoras`, `getCondonacionesMora`, `getMoraHistorialSnapshot`).
 *
 * Evita OFFSET negativo / NaN si llega page/pageSize inválido —vienen de un
 * query string— y topa pageSize a 500 para que nadie se traiga la tabla entera
 * en un request.
 */
export function clampPagination(page?: number, pageSize?: number) {
  // OJO: se redondea PRIMERO y se valida el valor ya redondeado. Al revés
  // —validar el crudo y truncar después— un fraccionario como 0.5 pasaba el
  // `> 0` y recién entonces `Math.floor` lo hundía a 0, devolviendo
  // `page: 0` con `offset: -20`, o `pageSize: 0` (página vacía eterna).
  const p = enteroPositivo(page) ?? 1;
  const psPedido = enteroPositivo(pageSize);
  const ps = psPedido == null ? 20 : Math.min(psPedido, 500);
  return { page: p, pageSize: ps, offset: (p - 1) * ps };
}

/** El valor truncado a entero, o null si no es un entero >= 1. */
function enteroPositivo(v?: number): number | null {
  if (!Number.isFinite(v)) return null;
  const n = Math.floor(v as number);
  return n > 0 ? n : null;
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
