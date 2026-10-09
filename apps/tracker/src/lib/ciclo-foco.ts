/**
 * A dónde mandar el foco al presionar Tab dentro de una ventana modal, para
 * que no se escape a la página de atrás. Devuelve el elemento que hay que
 * enfocar, o null si el navegador puede seguir con su orden normal.
 */
export function destinoDelTab<T>(
	enfocables: T[],
	activo: T | null,
	haciaAtras: boolean,
): T | null {
	if (enfocables.length === 0) return null;
	const primero = enfocables[0];
	const ultimo = enfocables[enfocables.length - 1];
	const indice = activo === null ? -1 : enfocables.indexOf(activo);
	// Fuera de la ventana (o en nada): se vuelve a entrar por el extremo.
	if (indice === -1) return haciaAtras ? ultimo : primero;
	if (haciaAtras && indice === 0) return ultimo;
	if (!haciaAtras && indice === enfocables.length - 1) return primero;
	return null;
}
