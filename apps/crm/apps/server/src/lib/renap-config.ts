/**
 * Consulta a RENAP (Centinela) en las validaciones del análisis.
 *
 * En `false` mientras la API key de Centinela está fallando: RENAP no se
 * consulta ni bloquea la aprobación, e Infornet se consulta sin exigir
 * `renapinfo`. Volver a `true` cuando Centinela se restablezca.
 */
export const CONSULTAR_RENAP = false;
