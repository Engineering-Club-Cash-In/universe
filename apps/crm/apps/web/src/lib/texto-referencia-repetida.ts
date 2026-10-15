import { PARENTESCO_LABELS } from "./parentesco-referencia";

/** Lo que el servidor devuelve por cada cliente que ya tiene a la persona como referencia. */
export type CoincidenciaDeReferencia = {
	tipo: "cobros" | "personal" | "familiar";
	clienteNombre: string | null;
	referenciaNombre: string | null;
	parentesco: string | null;
	dadaPor: { nombre: string | null; rol: "titular" | "codeudor" };
	coincidePor: "dpi" | "telefono";
};

/** Una referencia de la solicitud que ya figura en otro cliente. */
export type ReferenciaRevisada = {
	/** Cuál lista de la solicitud se revisó: personal o familiar. */
	tipo: "personal" | "familiar";
	indice: number;
	nombre: string;
	dpi: string;
	/** Cuántos otros clientes la tienen. */
	total: number;
};

export type ReferenciaConCoincidencias = ReferenciaRevisada & {
	coincidencias: unknown[];
};

/** Cuando la búsqueda falló: no es lo mismo que «sin coincidencias». */
export const TEXTO_SIN_VERIFICAR =
	"No se pudo verificar si las referencias están repetidas.";

/** Si falta un nombre se omite esa parte de la frase, no se rellena. */
export function textoCoincidencia(c: CoincidenciaDeReferencia): string {
	const cliente = c.clienteNombre?.trim() || "Otro cliente";
	const nombre = c.referenciaNombre?.trim();
	// Cobros guarda un enum; la solicitud, texto libre.
	const parentescoCrudo = c.parentesco?.trim();
	const parentesco = parentescoCrudo
		? ` (${c.tipo === "cobros" ? (PARENTESCO_LABELS[parentescoCrudo] ?? parentescoCrudo) : parentescoCrudo})`
		: "";
	const porque = `coincide por ${c.coincidePor === "dpi" ? "DPI" : "teléfono"}`;

	// Cómo la tiene el otro cliente: en cobros, o en su solicitud (quién la dio y en qué lista).
	let como = nombre ? ` como «${nombre}»` : "";
	let quien = "registrada en cobros";
	if (c.tipo !== "cobros") {
		const lista = `referencia ${c.tipo === "familiar" ? "familiar" : "personal"}`;
		como = ` como ${lista}${nombre ? ` «${nombre}»` : ""}`;
		const codeudor = c.dadaPor.nombre?.trim();
		quien =
			c.dadaPor.rol === "codeudor"
				? `en su solicitud la dio su codeudor${codeudor ? ` ${codeudor}` : ""}`
				: "en su solicitud la dio el titular";
	}
	return `${cliente} — ${quien}${como}${parentesco} · ${porque}`;
}

/** «La referencia personal «Ana» (DPI …)», o «#2» si no tiene nombre. */
function laReferencia(ref: ReferenciaRevisada): string {
	const nombre = ref.nombre.trim()
		? `«${ref.nombre.trim()}»`
		: `#${ref.indice + 1}`;
	const dpi = ref.dpi.trim() ? ` (DPI ${ref.dpi.trim()})` : "";
	return `La referencia ${ref.tipo === "familiar" ? "familiar" : "personal"} ${nombre}${dpi}`;
}

/** «… ya aparece como referencia de otro cliente» / «de otros 3 clientes». */
function yaAparece(ref: ReferenciaRevisada): string {
	const destino =
		ref.total === 1 ? "otro cliente" : `otros ${ref.total} clientes`;
	return `${laReferencia(ref)} ya aparece como referencia de ${destino}`;
}

export function encabezadoReferencia(ref: ReferenciaConCoincidencias): string {
	return `${yaAparece(ref)}:`;
}

/** Para quien no ve el detalle: sin nombres ni datos de los otros clientes. */
export function textoAvisoReferencia(ref: ReferenciaRevisada): string {
	return `${yaAparece(ref)}.`;
}

/** «y N más» cuando el servidor recortó la lista. */
export function textoMas(ref: ReferenciaConCoincidencias): string | null {
	const faltan = ref.total - ref.coincidencias.length;
	return faltan > 0 ? `y ${faltan} más` : null;
}
