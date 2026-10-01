import type { ContractSigner } from "../services/legal-docs-api";

/** Una persona tal como está en el CRM: el lead o un codeudor. */
export interface PersonaDelCrm {
	email: string | null;
	name: string;
	dpi?: string | null;
}

/**
 * Quiénes firman, a partir del lead y sus codeudores (en orden de registro).
 *
 * Cuando el cliente es una sociedad, ventas carga a la sociedad en el lead y a
 * su representante legal como codeudor. Los documentos que arma jurídico a mano
 * para una sociedad traen una sola línea por persona: la del representante, que
 * firma por la sociedad y a título personal. Con la sociedad como titular el
 * generador esperaba una línea más de las que hay y el contrato no salía a firma
 * (pasó con una sociedad el 01-oct-2026).
 *
 * Por eso, con `sociedadFirmaPorSuRepresentante`, la sociedad no es un firmante:
 * el primer codeudor registrado firma como titular y el resto sigue como
 * codeudor. Sólo lo pide la subida a mano; los contratos que arma el generador
 * no cambian. Sin codeudores la sociedad sigue como titular, como antes.
 *
 * Los codeudores sin correo se omiten: no hay a dónde mandarles el link, y
 * meterlos igual hace que WeeTrust rechace el envío entero. El representante
 * no se puede omitir, así que sin correo se corta.
 */
export function armarFirmantes(params: {
	titular: PersonaDelCrm;
	codeudores: PersonaDelCrm[];
	sociedadFirmaPorSuRepresentante: boolean;
}): ContractSigner[] {
	const { titular, codeudores, sociedadFirmaPorSuRepresentante } = params;

	const conDpi = (dpi?: string | null) => (dpi ? { dpi } : {});

	if (sociedadFirmaPorSuRepresentante && codeudores.length > 0) {
		const [representante, ...resto] = codeudores;
		if (!representante.email) {
			throw new Error(
				`${representante.name} firma por la sociedad y no tiene correo registrado. Cargalo antes de subir el contrato.`,
			);
		}
		return [
			{
				role: "TITULAR",
				email: representante.email,
				name: representante.name || representante.email,
				...conDpi(representante.dpi),
			},
			...resto.flatMap((cd): ContractSigner[] =>
				cd.email
					? [
							{
								role: "COFIRMANTE",
								email: cd.email,
								name: cd.name || cd.email,
								...conDpi(cd.dpi),
							},
						]
					: [],
			),
		];
	}

	const signers: ContractSigner[] = [];
	if (titular.email) {
		signers.push({
			role: "TITULAR",
			email: titular.email,
			name: titular.name || titular.email,
			...conDpi(titular.dpi),
		});
	}
	for (const cd of codeudores) {
		if (!cd.email) continue;
		signers.push({
			role: "COFIRMANTE",
			email: cd.email,
			name: cd.name || cd.email,
			...conDpi(cd.dpi),
		});
	}
	return signers;
}
