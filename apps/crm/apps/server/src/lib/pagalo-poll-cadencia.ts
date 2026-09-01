/**
 * Cada cuánto le preguntamos a Págalo por un link.
 *
 * Vive aparte del job porque lo necesitan los dos extremos: quien CREA el link
 * (bot y orquestador, para sembrar la primera revisión) y quien lo POLLEA
 * (jobs/pagalo-poll.ts, para el backoff). Tenerlo en el job obligaría a que
 * pago-link.ts lo importara y se armaría un ciclo.
 *
 * La primera revisión NO es inmediata: nadie paga un link en los primeros
 * segundos, y preguntar de una gasta una llamada garantizada a fallar que
 * además arranca el backoff antes de tiempo. Se le dan 5 minutos.
 *
 * De ahí el backoff duplica hasta un tope de 15 minutos — antes eran 30, que
 * en un link recién pagado se sentía como que el sistema no se enteraba
 * (2026-09-01, Daniel). Con el tope en 15 el peor caso se parte a la mitad, y
 * para no esperar ni eso está el botón "Verificar ahora" de la Ficha 360, que
 * consulta ese grupo puntual sin tocar la cadencia.
 *
 *   creación → 5 min → 10 min → 15 min → 15 min → …
 */
export const MINUTOS_PRIMERA_REVISION = 5;
const BACKOFF_BASE_SEGUNDOS = MINUTOS_PRIMERA_REVISION * 60;
const BACKOFF_TOPE_SEGUNDOS = 15 * 60;

/** Cuándo se revisa por primera vez un link recién creado. */
export function primeraRevisionPoll(desde: Date = new Date()): Date {
	return new Date(desde.getTime() + MINUTOS_PRIMERA_REVISION * 60 * 1000);
}

/**
 * Próxima revisión tras `pollAttempts` intentos fallidos (el contador YA
 * incrementado). Duplica desde la base hasta el tope.
 */
export function proximoIntentoPoll(
	pollAttempts: number,
	desde: Date = new Date(),
): Date {
	const segundos = Math.min(
		BACKOFF_BASE_SEGUNDOS * 2 ** Math.max(0, pollAttempts - 1),
		BACKOFF_TOPE_SEGUNDOS,
	);
	return new Date(desde.getTime() + segundos * 1000);
}
