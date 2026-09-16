/**
 * Deja un DPI en forma comparable entre `dpi` (bigint) y `dpi_rep_legal`
 * (varchar con ceros a la izquierda).
 *
 * Compara como TEXTO sin ceros a la izquierda a propósito, en vez de convertir
 * a número: `dpi_rep_legal` admite 20 dígitos y un bigint topa en 19, así que
 * un `BigInt(...)` podría desbordar con un valor mal capturado. Quitar los
 * ceros y comparar strings da el mismo resultado para dígitos y no revienta.
 *
 * NOTA DE MERGE: la pila del portal tiene esta misma función dentro de
 * `provisionamientoPortal.ts` (y `feat/portal-lista-inversionistas` una copia
 * en `grupoInversionistas.ts`). Al mergear, que aquellos importen de acá y
 * quede UNA sola: el criterio no puede divergir entre "a qué grupo pertenezco",
 * "quién recibe cuenta" y "a qué buzón va la liquidación".
 */
export const normalizarDpiParaComparar = (valor: unknown): string | null => {
  const texto = String(valor ?? "").trim();
  if (!/^\d+$/.test(texto)) return null;
  const sinCeros = texto.replace(/^0+/, "");
  return sinCeros === "" ? null : sinCeros;
};
