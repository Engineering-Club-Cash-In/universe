/**
 * Los contratos de inversiones cuyo layout de firmas está auditado, y quién los
 * firma además del inversionista.
 *
 * La fuente de verdad del layout es `signaturePatterns.ts` del generador: son
 * los tipos con `bloques` declarados. Acá se repite la lista porque el CRM tiene
 * que decidir, antes de mandar nada, si un contrato se puede repartir por rol y
 * a qué representantes hay que sumarle. Un tipo que no esté acá no se emite:
 * caería al reparto por orden de llegada y las firmas quedarían donde caigan.
 *
 * **Sin `process.env`**: lo importa también el navegador para armar el
 * selector de contratos, y ahí `process` no existe.
 */

/** Jurídico elige una categoría antes de elegir contratos. */
export type CategoriaDeInversion = "individual" | "sociedad";

/**
 * Las entidades que firman un contrato, además del inversionista.
 *
 * - `CUBE`: la línea de Cube Investments, que firma su representante legal.
 * - `RDBE`: la segunda línea de entidad del contrato de servicios. Tiene que ser
 *   una persona **distinta** de la de CUBE: WeeTrust junta a los firmantes por
 *   correo, y con el mismo correo en las dos líneas una de las dos firmas
 *   desaparece del documento.
 */
export type EntidadFirmante = "CUBE" | "RDBE";

export interface ContratoDeInversion {
	tipo: string;
	categoria: CategoriaDeInversion;
	entidades: EntidadFirmante[];
}

export const CONTRATOS_DE_INVERSION: readonly ContratoDeInversion[] = [
	// ===== Inversionista individual =====
	{
		tipo: "acuerdo_inversion_cash_in",
		categoria: "individual",
		entidades: ["CUBE"],
	},
	{
		tipo: "carta_confirmacion_inversion_inicial",
		categoria: "individual",
		entidades: [],
	},
	{
		tipo: "carta_eleccion_modalidad_pago_reinversion",
		categoria: "individual",
		entidades: [],
	},
	{
		tipo: "carta_instruccion_inversion_cartera_activa",
		categoria: "individual",
		entidades: [],
	},
	{
		tipo: "carta_incremento_inversion",
		categoria: "individual",
		entidades: [],
	},
	{
		tipo: "carta_instruccion_pago_anticipado",
		categoria: "individual",
		entidades: [],
	},
	{
		tipo: "designacion_beneficiario",
		categoria: "individual",
		entidades: [],
	},
	{
		// Cada anexo lleva dos líneas: la del inversionista y la de quien recibe
		// por Cube, que va impresa con su nombre en el template.
		tipo: "anexos_confirmacion_participacion_beneficiario",
		categoria: "individual",
		entidades: ["CUBE"],
	},
	{ tipo: "cesion_creditos", categoria: "individual", entidades: ["CUBE"] },
	{
		tipo: "contrato_participacion_administracion_cartera",
		categoria: "individual",
		entidades: ["CUBE"],
	},
	{
		tipo: "contrato_servicios_cash_in_inversor_general",
		categoria: "individual",
		entidades: ["CUBE", "RDBE"],
	},

	// ===== Inversionista sociedad =====
	{
		tipo: "acuerdo_inversion_cash_in_sociedad",
		categoria: "sociedad",
		entidades: ["CUBE"],
	},
	{
		tipo: "carta_confirmacion_inversion_inicial_sociedad",
		categoria: "sociedad",
		entidades: [],
	},
	{
		tipo: "carta_eleccion_modalidad_pago_reinversion_sociedad",
		categoria: "sociedad",
		entidades: [],
	},
	{
		tipo: "carta_instruccion_inversion_cartera_activa_sociedad",
		categoria: "sociedad",
		entidades: [],
	},
	{
		tipo: "carta_incremento_inversion_sociedad",
		categoria: "sociedad",
		entidades: [],
	},
	{
		tipo: "carta_instruccion_pago_anticipado_sociedad",
		categoria: "sociedad",
		entidades: [],
	},
	{
		tipo: "designacion_beneficiario_sociedad",
		categoria: "sociedad",
		entidades: [],
	},
	{
		tipo: "cesion_creditos_sociedad",
		categoria: "sociedad",
		entidades: ["CUBE"],
	},
	{
		tipo: "contrato_servicios_cash_in_inversor_general_sociedad",
		categoria: "sociedad",
		entidades: ["CUBE", "RDBE"],
	},
] as const;

const POR_TIPO = new Map(CONTRATOS_DE_INVERSION.map((c) => [c.tipo, c]));

export function contratoDeInversion(
	contractType: string,
): ContratoDeInversion | undefined {
	return POR_TIPO.get(contractType);
}

export function esContratoDeInversion(contractType: string): boolean {
	return POR_TIPO.has(contractType);
}

export function contratosDeCategoria(
	categoria: CategoriaDeInversion,
): ContratoDeInversion[] {
	return CONTRATOS_DE_INVERSION.filter((c) => c.categoria === categoria);
}
