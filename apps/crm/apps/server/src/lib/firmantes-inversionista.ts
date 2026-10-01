import { ORPCError } from "@orpc/server";
import type { ContractSigner } from "../services/legal-docs-api";
import {
	aplicarCorreosDePrueba,
	correoRepetido,
	correosDePruebaFaltantes,
} from "./contratos-correos-prueba";
import { contratoDeInversion } from "./contratos-inversiones";
import {
	REP_LEGAL_INVERSIONES_EMAIL,
	REP_LEGAL_INVERSIONES_NOMBRE,
	REP_LEGAL_RDBE_EMAIL,
	REP_LEGAL_RDBE_NOMBRE,
} from "./contratos-rep-legal";
import type { IdentificacionDelInversionista } from "./identidad-inversionista";
import { isTestModeEnabled } from "./messaging-test-mode";

/** Lo que hace falta saber del inversionista para mandarlo a firmar. */
export interface InversionistaQueFirma {
	nombre: string;
	email: string | null;
	/**
	 * Qué verificación de identidad se le pide en esta compra
	 * (`identificacionParaLaCompra`, en `lib/identidad-inversionista.ts`).
	 */
	identificacion: IdentificacionDelInversionista;
}

/**
 * Quiénes firman un contrato de inversiones, con su rol y en condiciones de
 * mandarse a WeeTrust.
 *
 * El inversionista entra como `TITULAR`, que es el rol con el que el generador
 * ubica la línea del bloque de deudores; no hay cofirmantes. Los representantes
 * **los pone el servidor**, nunca el navegador: si vinieran de afuera,
 * cualquiera podría mandar su propio correo con ese rol y quedarse con el
 * enlace de firma de la entidad.
 *
 * Qué entidades firman cada contrato sale del catálogo, no de quien llama: el
 * acuerdo y la cesión llevan a CUBE, el de servicios lleva además a RDBE, y las
 * cartas y anexos los firma sólo el inversionista.
 */
export function firmantesDeContratoDeInversion(
	contractType: string,
	inversionista: InversionistaQueFirma,
): ContractSigner[] {
	const contrato = contratoDeInversion(contractType);
	if (!contrato) {
		throw new ORPCError("BAD_REQUEST", {
			message: `El contrato "${contractType}" no es de inversiones o no tiene layout de firmas auditado.`,
		});
	}

	// Sin correo no hay a dónde mandarle el enlace, y WeeTrust rechaza el envío
	// entero. Se corta acá para poder decir qué falta y dónde arreglarlo.
	const email = inversionista.email?.trim();
	if (!email) {
		throw new ORPCError("BAD_REQUEST", {
			message:
				"El inversionista no tiene correo registrado en cartera. Cargalo antes de emitir sus contratos.",
		});
	}

	const firmantes: ContractSigner[] = [
		{
			role: "TITULAR",
			email,
			name: inversionista.nombre,
			identification: inversionista.identificacion,
		},
		...(contrato.entidades.includes("CUBE")
			? [
					{
						role: "REP_LEGAL" as const,
						email: REP_LEGAL_INVERSIONES_EMAIL,
						name: REP_LEGAL_INVERSIONES_NOMBRE,
					},
				]
			: []),
		...(contrato.entidades.includes("RDBE")
			? [
					{
						role: "REP_LEGAL_RDBE" as const,
						email: REP_LEGAL_RDBE_EMAIL,
						name: REP_LEGAL_RDBE_NOMBRE,
					},
				]
			: []),
	];

	if (!isTestModeEnabled()) {
		// Dos firmantes con el mismo correo son uno solo en WeeTrust, y una de las
		// firmas desaparece del documento. Pasa de verdad: un inversionista que es
		// de la casa, o los dos representantes mal configurados con el mismo buzón.
		const repetido = correoRepetido(firmantes);
		if (repetido) {
			throw new ORPCError("BAD_REQUEST", {
				message: `El correo ${repetido} está repetido entre los firmantes: cada uno tiene que firmar con el suyo.`,
			});
		}
		return firmantes;
	}

	// En modo prueba se corta si el inversionista se quedaría con su correo real:
	// es preferible un error a mandarle el contrato a alguien de verdad.
	const faltan = correosDePruebaFaltantes(firmantes);
	if (faltan.length > 0) {
		throw new ORPCError("BAD_REQUEST", {
			message: `TEST_MESSAGE=true pero falta configurar ${faltan.join(" y ")}: el enlace de firma saldría al correo real del inversionista.`,
		});
	}

	const conPrueba = aplicarCorreosDePrueba(firmantes);
	const repetido = correoRepetido(conPrueba);
	if (repetido) {
		throw new ORPCError("BAD_REQUEST", {
			message: `TEST_MESSAGE=true: el correo de prueba ${repetido} quedaría para dos firmantes. Revisá CONTRATOS_TEST_EMAIL_TITULAR, CONTRATOS_REP_LEGAL_INVERSIONES_EMAIL y CONTRATOS_REP_LEGAL_RDBE_EMAIL.`,
		});
	}

	return conPrueba;
}
