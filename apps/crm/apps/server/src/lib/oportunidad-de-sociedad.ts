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

/**
 * El nombre de la sociedad como va en los contratos: el del lead, que en una
 * empresa es la razón social repartida entre los campos de nombre, en
 * mayúsculas y sin los espacios dobles que deja esa repartición.
 */
export function nombreDeLaSociedad(
	partes: ReadonlyArray<string | null | undefined>,
): string {
	return partes
		.filter(Boolean)
		.join(" ")
		.replace(/\s+/g, " ")
		.trim()
		.toUpperCase();
}

/**
 * Los contratos de la batería individual que también van en la de sociedad,
 * tal cual. La declaración del vendedor la firma el vendedor, no el cliente:
 * no tiene versión de sociedad.
 */
export const CONTRATOS_DE_VENTA_TAMBIEN_EN_SOCIEDAD: readonly string[] = [
	"declaracion_vendedor",
];

/** Si el tipo es de la batería de sociedad (`*_sociedad`). */
export function esContratoDeSociedad(contractType: string): boolean {
	return contractType.endsWith("_sociedad");
}

/**
 * Por qué no se pueden generar estos contratos para la oportunidad, o null.
 *
 * La batería la decide la oportunidad, no quien genera: una sociedad lleva los
 * de sociedad (firma su representante), y una persona los individuales. Además
 * los de sociedad no tienen lugar para codeudores, así que con codeudores de
 * más, o sin saber quién es el representante, no se genera nada.
 */
export function motivoParaNoGenerar<C extends CodeudorDeLaOportunidad>(
	datos: DatosDeSociedad<C>,
	contractTypes: readonly string[],
): string | null {
	if (!esOportunidadDeSociedad(datos)) {
		const deSociedad = contractTypes.filter(esContratoDeSociedad);
		return deSociedad.length > 0
			? "La oportunidad no es de una sociedad: van los contratos individuales."
			: null;
	}

	if (!representanteLegalDe(datos)) {
		return "La oportunidad es de una sociedad y no tiene marcado a su representante legal, que es quien firma. Marcalo en los co-firmantes de la oportunidad.";
	}
	const deMas = codeudoresDeMas(datos).length;
	if (deMas > 0) {
		return `Los contratos de sociedad sólo los firma el representante legal y no tienen lugar para codeudores: hay ${deMas === 1 ? "un co-firmante" : `${deMas} co-firmantes`} de más en la oportunidad.`;
	}
	const individuales = contractTypes.filter(
		(tipo) =>
			!esContratoDeSociedad(tipo) &&
			!CONTRATOS_DE_VENTA_TAMBIEN_EN_SOCIEDAD.includes(tipo),
	);
	return individuales.length > 0
		? "La oportunidad es de una sociedad: van los contratos de sociedad, no los individuales."
		: null;
}

/**
 * Por qué no se puede volver a emitir con el titular de la última generación,
 * o null.
 *
 * Regenerar y enlazar reusan los firmantes de la generación. En una sociedad
 * el titular es el representante legal: si después lo cambiaron, o le
 * corrigieron el correo, la batería saldría a firma con el anterior (y el
 * WhatsApp, que busca por el correo de hoy, no encontraría sus enlaces). Tienen
 * que coincidir el correo y, si la foto lo guardó, el DPI.
 */
export function motivoPorRepresentanteCambiado(
	representante: { dpi: string; email: string | null } | null,
	titular: { dpi?: string; email: string } | undefined,
): string | null {
	if (!representante || !titular) return null;
	const soloDigitos = (dpi: string) => dpi.replace(/\D/g, "");
	const mismoDpi =
		!titular.dpi?.trim() ||
		soloDigitos(titular.dpi) === soloDigitos(representante.dpi);
	const mismoCorreo =
		titular.email.trim().toLowerCase() ===
		(representante.email ?? "").trim().toLowerCase();
	const mismo = mismoDpi && mismoCorreo;
	return mismo
		? null
		: "El representante legal de la sociedad cambió desde la última generación: generá la batería de nuevo desde el asistente.";
}

/** Lo que hace falta de un codeudor para firmar por la sociedad. */
export interface DatosDelRepresentante extends CodeudorDeLaOportunidad {
	dpi: string | null;
	email: string | null;
	phone: string | null;
	gender: string | null;
	age: number | null;
	maritalStatus: string | null;
}

/**
 * Lo que le falta a una sociedad para sus contratos, del lado de quien firma.
 *
 * El lead es la empresa: no tiene DPI, nacimiento, género ni estado civil, y
 * esos datos los ponen los contratos del representante legal. Tiene que estar
 * marcado, con DPI, correo y celular (a ese número le llegan los enlaces por
 * WhatsApp, no al de la empresa), género, edad y estado civil, y sin codeudores
 * de más. Fuera de una sociedad no aplica: lista vacía.
 *
 * Lo usan jurídico (`validateOpportunityForContracts`) y el paso de análisis a
 * 80%, para que pidan lo mismo.
 */
export function faltantesDelRepresentante<C extends DatosDelRepresentante>(
	datos: DatosDeSociedad<C>,
): string[] {
	if (!esOportunidadDeSociedad(datos)) return [];
	const faltan: string[] = [];
	const representante = representanteLegalDe(datos);
	if (!representante) {
		faltan.push("Marcar al representante legal en los co-firmantes");
	} else {
		if (!representante.dpi?.trim()) faltan.push("DPI");
		if (!representante.email?.trim()) faltan.push("Correo");
		if (!representante.phone?.trim()) faltan.push("Teléfono");
		if (!representante.gender) faltan.push("Género");
		if (!representante.age) faltan.push("Edad");
		if (!representante.maritalStatus) faltan.push("Estado Civil");
	}
	const deMas = codeudoresDeMas(datos).length;
	if (deMas > 0) {
		faltan.push(
			`Quitar ${deMas === 1 ? "el co-firmante" : `los ${deMas} co-firmantes`} de más: los contratos de sociedad sólo los firma el representante`,
		);
	}
	return faltan;
}
