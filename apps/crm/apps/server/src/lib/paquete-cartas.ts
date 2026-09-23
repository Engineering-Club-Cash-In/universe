/**
 * Las cartas de una venta van unidas en un solo documento para firmar.
 *
 * A los clientes les llegaban once enlaces y no los firmaban. Las cartas son lo
 * que se puede juntar: sólo las firman el cliente y sus codeudores, y casi todas
 * son de una hoja. Unidas, cada persona recibe un enlace para todas.
 *
 * En el CRM el paquete es **un contrato**: una fila, un PDF, un documento en
 * WeeTrust. No hay una fila por carta: dos filas apuntando al mismo documento
 * se tratan como duplicado (ver `anularContratoReemplazado`), y anular una
 * anularía el documento de todas.
 *
 * La fuente de verdad de qué es una carta es el generador
 * (`legal-docs-blueprints/services/signaturePatterns.ts`, `CARTAS_UNIFICABLES`).
 * Acá se repite porque el CRM tiene que agruparlas antes de pedírselas.
 *
 * OJO: lo importa también el navegador (la ficha y el modal de regenerar), así
 * que no puede leer `process.env`.
 */

/** El tipo con que se guarda el paquete. */
export const PAQUETE_CARTAS = "paquete_cartas";

/** Cómo se llama en la ficha, en WeeTrust y en el WhatsApp. */
export const ETIQUETA_PAQUETE_CARTAS = "Cartas";

/**
 * Las cartas que van unidas.
 *
 * Los contratos no: llevan al representante legal y la rúbrica por página, y
 * cada uno tiene que poder anularse o regenerarse por separado. El descargo de
 * responsabilidades tampoco, aunque sea de una hoja: no es una carta. Y la
 * declaración de vendedor se firma en papel.
 */
export const CARTAS_UNIFICABLES = [
	"carta_emision_cheques",
	"carta_carro_nuevo",
	"carta_aceptacion_instalacion_gps",
	"carta_traspaso_vehiculo_rdbe",
	"solicitud_compra_vehiculo_tercero",
	"cobertura_inrexsa",
	"cobertura_inrexsa_comercial",
] as const;

export function esCartaUnificable(contractType: string): boolean {
	return (CARTAS_UNIFICABLES as readonly string[]).includes(contractType);
}

/** Si el tipo es una carta o el paquete que las junta. */
export function esCartaOPaquete(contractType: string): boolean {
	return contractType === PAQUETE_CARTAS || esCartaUnificable(contractType);
}

/**
 * Qué tipos deja sin efecto un contrato nuevo de este tipo.
 *
 * Un contrato común reemplaza al anterior del mismo tipo. El paquete reemplaza
 * al paquete anterior **y a las cartas sueltas que trae**: las oportunidades de
 * antes de unificarlas tienen una fila por carta, y si quedaran vivas el
 * cliente tendría esas cartas dos veces, sueltas y en el paquete.
 *
 * Sólo las que trae, no todas. Una carta suelta que el paquete nuevo no
 * incluye puede estar firmada, y anularla sería perder una firma que nadie
 * pidió reemplazar. (El paquete anterior sí se va entero: es un solo documento
 * y no se puede anular a medias.)
 */
export function tiposQueReemplaza(
	contractType: string,
	cartasQueTrae: readonly string[] = [],
): string[] {
	return contractType === PAQUETE_CARTAS
		? [PAQUETE_CARTAS, ...cartasQueTrae.filter(esCartaUnificable)]
		: [contractType];
}

/** Una carta dentro del paquete, como la describe el generador. */
export interface CartaDelPaquete {
	contractType: string;
	label: string;
	paginas: number;
}

/**
 * Las cartas que trae un paquete ya generado, leídas de la respuesta del
 * generador que quedó guardada en la fila. `[]` si no es un paquete.
 */
export function cartasDelPaquete(apiResponse: unknown): CartaDelPaquete[] {
	const cartas = (apiResponse as { cartas?: unknown } | null)?.cartas;
	if (!Array.isArray(cartas)) return [];
	return cartas.filter(
		(c): c is CartaDelPaquete =>
			typeof c?.contractType === "string" && typeof c?.label === "string",
	);
}

/**
 * Reemplaza las cartas de una lista de contratos a generar por **un** paquete
 * que las trae, en el lugar donde estaba la primera.
 *
 * Es lo único que sabe agrupar, y lo usan generar y regenerar: si cada uno lo
 * hiciera a su manera, uno terminaría mandando las cartas sueltas.
 *
 * Tiene que correr **antes** de llamar al generador: quien llama empareja cada
 * resultado con su pedido por posición, así que la lista que se manda y la que
 * se usa para emparejar tienen que ser la misma.
 *
 * Los firmantes del paquete son los de las cartas sin el representante legal,
 * que no firma ninguna. Salen de la primera: el wizard les pone a todas los
 * mismos, y todas ya pasaron por las mismas validaciones y correos de prueba.
 */
export function agruparCartas<
	T extends {
		contractType: string;
		data: Record<string, unknown>;
		signers?: Array<{ role: string }>;
		options: Record<string, unknown>;
	},
>(
	contratos: T[],
): Array<
	| T
	| (Omit<T, "contractType"> & {
			contractType: typeof PAQUETE_CARTAS;
			cartas: Array<Pick<T, "contractType" | "data" | "options">>;
	  })
> {
	const cartas = contratos.filter((c) => esCartaUnificable(c.contractType));
	if (cartas.length === 0) return contratos;

	const [primera] = cartas;
	const paquete = {
		...primera,
		contractType: PAQUETE_CARTAS,
		signers: primera.signers?.filter((s) => s.role !== "REP_LEGAL"),
		cartas: cartas.map((c) => ({
			contractType: c.contractType,
			data: c.data,
			options: c.options,
		})),
	};

	const agrupados: Array<T | typeof paquete> = [];
	for (const contrato of contratos) {
		if (!esCartaUnificable(contrato.contractType)) agrupados.push(contrato);
		else if (contrato === primera) agrupados.push(paquete);
	}
	return agrupados;
}
