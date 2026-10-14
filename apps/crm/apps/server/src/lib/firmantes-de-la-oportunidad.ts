import type { ContractSigner } from "../services/legal-docs-api";
import {
	esOportunidadDeSociedad,
	representanteLegalDe,
} from "./oportunidad-de-sociedad";

/** Una persona tal como está en el CRM: el lead o un codeudor. */
export interface PersonaDelCrm {
	email: string | null;
	name: string;
	dpi?: string | null;
}

/** Un codeudor, con lo que hace falta para saber si firma por la sociedad. */
export interface CodeudorDelCrm extends PersonaDelCrm {
	id: string;
	esRepresentanteLegal: boolean;
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
 * Por eso, con `sociedadFirmaPorSuRepresentante` y una oportunidad de sociedad
 * (ver `lib/oportunidad-de-sociedad.ts`), la sociedad no es un firmante: su
 * representante legal firma como titular y el resto sigue como codeudor. Sólo
 * lo pide la subida a mano; los contratos que arma el generador no cambian. Sin
 * codeudores la sociedad sigue como titular, como antes. Con codeudores pero
 * sin saber cuál es el representante (varios y ninguno marcado) se corta: no se
 * puede adivinar quién firma por la empresa.
 *
 * Los codeudores sin correo se omiten: no hay a dónde mandarles el link, y
 * meterlos igual hace que WeeTrust rechace el envío entero. El representante
 * no se puede omitir, así que sin correo se corta.
 */
export function armarFirmantes(params: {
	titular: PersonaDelCrm;
	codeudores: CodeudorDelCrm[];
	/** `leads.client_type` del titular. */
	clientType: string | null | undefined;
	sociedadFirmaPorSuRepresentante: boolean;
}): ContractSigner[] {
	const { titular, codeudores, clientType, sociedadFirmaPorSuRepresentante } =
		params;

	const conDpi = (dpi?: string | null) => (dpi ? { dpi } : {});
	const cofirmantes = (personas: PersonaDelCrm[]) =>
		personas.flatMap((cd): ContractSigner[] =>
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
		);

	const deLaOportunidad = { clientType, coDeudores: codeudores };
	if (
		sociedadFirmaPorSuRepresentante &&
		codeudores.length > 0 &&
		esOportunidadDeSociedad(deLaOportunidad)
	) {
		const representante = representanteLegalDe(deLaOportunidad);
		if (!representante) {
			throw new Error(
				"La oportunidad es de una sociedad y no se sabe quién es su representante legal. Marcalo entre los co-firmantes antes de subir el contrato.",
			);
		}
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
			...cofirmantes(codeudores.filter((cd) => cd.id !== representante.id)),
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
	signers.push(...cofirmantes(codeudores));
	return signers;
}
