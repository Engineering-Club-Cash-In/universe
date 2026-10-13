import type { DocumentCategoria } from "@/services/documents";

/**
 * Categorías que ya no se generan acá sino en el CRM. Jurídico seguía armando
 * los contratos de ventas e inversiones en esta plataforma y no en el CRM, que
 * es donde salen a firma; se ocultan para que no haya dos caminos. Para volver
 * a mostrar una, sacarla de esta lista.
 */
export const CATEGORIAS_EN_EL_CRM: ReadonlySet<DocumentCategoria> = new Set([
  "ventas",
  "inversiones",
  "inversiones_sociedad",
]);

/**
 * Si la categoría se puede usar en esta plataforma. Lo mira la pantalla y
 * también el borrador guardado en el navegador: uno de antes con una
 * categoría oculta seguía de largo aunque su tarjeta ya no se viera.
 */
export function categoriaDisponible(
  categoria: DocumentCategoria | undefined | null
): categoria is DocumentCategoria {
  return Boolean(categoria) && !CATEGORIAS_EN_EL_CRM.has(categoria as DocumentCategoria);
}
