/**
 * Cuándo una oportunidad es de una sociedad y quién firma por ella.
 *
 * Ventas carga a la empresa como lead y a su representante legal como
 * codeudor. La oportunidad es de sociedad si el lead es una empresa o si uno de
 * sus codeudores está marcado como representante legal (a veces la empresa se
 * cargó como individual). Los contratos de sociedad los firma sólo el
 * representante: no tienen lugar para más codeudores.
 *
 * Lo importa también el navegador: no puede leer `process.env` ni la base.
 */

/** Lo mínimo de un codeudor para saber si representa a la empresa. */
export interface CodeudorDeLaOportunidad {
	id: string;
	esRepresentanteLegal: boolean;
}

export interface DatosDeSociedad<C extends CodeudorDeLaOportunidad> {
	/** `leads.client_type` del dueño de la oportunidad. */
	clientType: string | null | undefined;
	/** En orden de registro. */
	coDeudores: readonly C[];
}

export function esOportunidadDeSociedad<C extends CodeudorDeLaOportunidad>(
	datos: DatosDeSociedad<C>,
): boolean {
	return (
		datos.clientType === "empresa" ||
		datos.coDeudores.some((cd) => cd.esRepresentanteLegal)
	);
}

/**
 * El codeudor que firma por la empresa: el marcado. Si no hay ninguno marcado
 * y el lead es una empresa con un solo codeudor, es ése, como se cargaban
 * antes de la marca. Con dos o más sin marcar no se adivina: `null`.
 */
export function representanteLegalDe<C extends CodeudorDeLaOportunidad>(
	datos: DatosDeSociedad<C>,
): C | null {
	const marcado = datos.coDeudores.find((cd) => cd.esRepresentanteLegal);
	if (marcado) return marcado;
	if (datos.clientType === "empresa" && datos.coDeudores.length === 1) {
		return datos.coDeudores[0];
	}
	return null;
}

/**
 * Los codeudores que sobran en una oportunidad de sociedad: todos menos el
 * representante. Fuera de una sociedad no sobra ninguno.
 */
export function codeudoresDeMas<C extends CodeudorDeLaOportunidad>(
	datos: DatosDeSociedad<C>,
): C[] {
	if (!esOportunidadDeSociedad(datos)) return [];
	const representante = representanteLegalDe(datos);
	return datos.coDeudores.filter((cd) => cd.id !== representante?.id);
}
