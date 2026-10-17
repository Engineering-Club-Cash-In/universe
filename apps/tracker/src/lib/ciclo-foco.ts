// Controles que pueden recibir foco dentro de una ventana. `:disabled` (y no
// `[disabled]`) también excluye lo que hereda el estado de un <fieldset disabled>,
// que deshabilita sus controles sin ponerles el atributo.
export const ENFOCABLES =
	'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * A dónde mandar el foco al presionar Tab dentro de una ventana modal, para
 * que no se escape a la página de atrás. Devuelve el elemento que hay que
 * enfocar, o null si el navegador puede seguir con su orden normal. Si no hay
 * nada enfocable (p. ej. la X está deshabilitada mientras se guarda), devuelve
 * el `respaldo` —el propio panel— para que el foco no se escape a la página.
 */
export function destinoDelTab<T>(
	enfocables: T[],
	activo: T | null,
	haciaAtras: boolean,
	respaldo: T | null = null,
): T | null {
	if (enfocables.length === 0) return respaldo;
	const primero = enfocables[0];
	const ultimo = enfocables[enfocables.length - 1];
	const indice = activo === null ? -1 : enfocables.indexOf(activo);
	// Fuera de la ventana (o en nada): se vuelve a entrar por el extremo.
	if (indice === -1) return haciaAtras ? ultimo : primero;
	if (haciaAtras && indice === 0) return ultimo;
	if (!haciaAtras && indice === enfocables.length - 1) return primero;
	return null;
}

/**
 * Si un cierre accidental (clic en el fondo, Escape) debe cerrar la ventana.
 * Una ventana protegida solo se cierra con sus botones.
 */
export function cierraSinBoton(protegida: boolean | undefined): boolean {
	return !protegida;
}
