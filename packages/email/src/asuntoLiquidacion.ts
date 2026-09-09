/**
 * El asunto del correo de liquidación.
 *
 * Vive en su propio módulo y no dentro de `sendLiquidationEmail` porque
 * `index.ts` TIRA al importarse si faltan `RESEND_API_KEY`/`EMAIL_DOMAIN`: un
 * asunto no se puede probar sin arrastrar el cliente de Resend. Acá sí.
 */
export const asuntoDeLiquidacion = (
  investorName: string,
  date: string,
  representativeName?: string,
): string =>
  // El nombre de la entidad va en el asunto SOLO cuando el correo cae en el
  // buzón de un representante: él recibe varias liquidaciones el mismo día en
  // el mismo buzón y sin el nombre los asuntos serían idénticos. A los 182
  // inversionistas que no son sociedad eso no les aporta nada y les cambiaría
  // un asunto que reciben desde siempre —y por el que filtran en su bandeja—,
  // así que el suyo no se toca.
  representativeName
    ? `Liquidación Procesada - ${investorName} - ${date}`
    : `Liquidación Procesada - ${date}`;
