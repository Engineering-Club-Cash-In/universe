/**
 * COBROS-02 W3 · Reglas puras del escalado a Jurídico (B5). Sin base de datos:
 * el controlador (controllers/buckets/juridico.ts) las usa, y así se prueban
 * sin levantar la conexión.
 */

/** Bucket destino: B5 · Jurídico. */
export const BUCKET_JURIDICO = 5;

/** Desde qué bucket se puede escalar: B3 y B4 (el crédito ya fue gestionado). */
export const BUCKET_MINIMO_ORIGEN_JURIDICO = 3;

/** Por qué NO se puede escalar desde este bucket (null si sí se puede). */
export function motivoBucketNoJuridico(bucketActual: number): string | null {
  if (bucketActual < BUCKET_MINIMO_ORIGEN_JURIDICO) {
    return `El crédito está en B${bucketActual}: escalar a Jurídico aplica desde B${BUCKET_MINIMO_ORIGEN_JURIDICO}.`;
  }
  if (bucketActual >= BUCKET_JURIDICO) {
    return `El crédito ya está en B${bucketActual}: no hay nada que escalar.`;
  }
  return null;
}
