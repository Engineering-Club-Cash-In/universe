/** Acepta "", "-", "." y "1.2" mientras se escribe; el resto se descarta. */
const EN_PROGRESO = /^-?\d*\.?\d*$/;
/** Igual, pero sin signo: para los montos, que nunca son negativos. */
const EN_PROGRESO_SIN_SIGNO = /^\d*\.?\d*$/;
const CERO_A_LA_IZQUIERDA = /^(-?)0+(\d)/;

/**
 * Decide qué hacer con lo que el usuario acaba de escribir en un campo numérico.
 * Devuelve `null` cuando la entrada no es válida y hay que descartar la tecla.
 * El `valor` que sale siempre es `number`: nunca `""` ni `NaN`.
 */
export function normalizarEntrada(
  crudo: string,
  permiteNegativos = true,
): { texto: string; valor: number } | null {
  const patron = permiteNegativos ? EN_PROGRESO : EN_PROGRESO_SIN_SIGNO;
  if (!patron.test(crudo)) return null;

  // "05" -> "5", pero "0.5" se respeta.
  const texto = crudo.replace(CERO_A_LA_IZQUIERDA, "$1$2");
  const parseado = Number(texto);

  return { texto, valor: texto === "" || Number.isNaN(parseado) ? 0 : parseado };
}
