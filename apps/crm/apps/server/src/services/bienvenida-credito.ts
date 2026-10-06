/**
 * Mensajes al cliente cuando su crédito se crea (al 90%, al confirmar los
 * contratos firmados):
 *
 *   1. Pide a cartera la cuenta Nexa del crédito (cartera la crea en
 *      nexa-server y la guarda en el crédito). Si cartera o Nexa fallan, sigue
 *      sin cuenta: cartera la reintenta sola y, cuando la tenga, le avisa al
 *      cliente con un mensaje aparte (`send-cuenta-nexa-whatsapp.ts`).
 *   2. Manda la bienvenida, con la línea de la cuenta Nexa si ya existe.
 *   3. Si la bienvenida salió con la cuenta, le avisa a cartera para que no
 *      mande el mensaje aparte.
 *   4. Manda el documento de cobertura del seguro (apagado por env hasta que
 *      mercadeo entregue el PDF).
 *
 * Va en ese orden y esperando cada paso: así el saludo llega antes que el
 * PDF del seguro. Nunca lanza: lo llama el cierre del crédito sin esperarlo.
 */

import { eq } from "drizzle-orm";
import { db } from "../db";
import { leads, opportunities } from "../db/schema/crm";
import {
	type CuentaNexaCredito,
	carteraBackClient,
} from "./cartera-back-client";
import { isCarteraBackEnabled } from "./cartera-back-integration";
import { sendCoverageDocument } from "./send-coverage-document";
import { sendWelcomeMessage } from "./send-welcome-message";

const LOG_PREFIX = "[BienvenidaCredito]";

export interface BienvenidaCreditoParams {
	opportunityId: string;
	userId: string;
	numeroSifco: string;
}

/** Deps inyectables solo para tests — en producción no se pasa nada. */
export interface BienvenidaCreditoDeps {
	carteraHabilitada?: () => boolean;
	dpiDelCliente?: (opportunityId: string) => Promise<string | null>;
	solicitarCuentaNexa?: (
		numeroSifco: string,
		dpi: string | null,
	) => Promise<CuentaNexaCredito>;
	marcarCuentaNexaNotificada?: (numeroSifco: string) => Promise<void>;
	enviarBienvenida?: typeof sendWelcomeMessage;
	enviarCobertura?: typeof sendCoverageDocument;
}

async function dpiDelClienteEnCrm(
	opportunityId: string,
): Promise<string | null> {
	const [row] = await db
		.select({ dpi: leads.dpi })
		.from(opportunities)
		.innerJoin(leads, eq(leads.id, opportunities.leadId))
		.where(eq(opportunities.id, opportunityId))
		.limit(1);
	return row?.dpi ?? null;
}

export async function enviarMensajesDeCreditoNuevo(
	params: BienvenidaCreditoParams,
	deps: BienvenidaCreditoDeps = {},
): Promise<{ cuentaNexa: string | null; bienvenidaEnviada: boolean }> {
	const carteraHabilitada = deps.carteraHabilitada ?? isCarteraBackEnabled;
	const dpiDelCliente = deps.dpiDelCliente ?? dpiDelClienteEnCrm;
	const solicitar =
		deps.solicitarCuentaNexa ??
		((sifco: string, dpi: string | null) =>
			carteraBackClient.solicitarCuentaNexa(sifco, dpi));
	const marcar =
		deps.marcarCuentaNexaNotificada ??
		((sifco: string) => carteraBackClient.marcarCuentaNexaNotificada(sifco));
	const enviarBienvenida = deps.enviarBienvenida ?? sendWelcomeMessage;
	const enviarCobertura = deps.enviarCobertura ?? sendCoverageDocument;

	let cuentaNexa: string | null = null;
	let bienvenidaEnviada = false;

	try {
		// 1. Cuenta Nexa (best-effort).
		if (carteraHabilitada()) {
			try {
				const dpi = await dpiDelCliente(params.opportunityId);
				const resultado = await solicitar(params.numeroSifco, dpi);
				if (resultado.estado === "lista") {
					cuentaNexa = resultado.cuenta.token;
				} else if (resultado.estado !== "deshabilitada") {
					console.warn(
						`${LOG_PREFIX} Cuenta Nexa de ${params.numeroSifco} no lista (${resultado.estado}); la bienvenida sale sin ella`,
					);
				}
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				console.error(
					`${LOG_PREFIX} No se pudo pedir la cuenta Nexa de ${params.numeroSifco}: ${msg}`,
				);
			}
		}

		// 2. Bienvenida.
		const bienvenida = await enviarBienvenida({
			opportunityId: params.opportunityId,
			userId: params.userId,
			numeroSifco: params.numeroSifco,
			cuentaNexa,
		});
		bienvenidaEnviada = bienvenida.sent;

		// 3. La cuenta ya llegó en la bienvenida: que cartera no la mande aparte.
		if (bienvenida.sent && cuentaNexa) {
			try {
				await marcar(params.numeroSifco);
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				console.error(
					`${LOG_PREFIX} No se pudo marcar la cuenta Nexa de ${params.numeroSifco} como avisada: ${msg}`,
				);
			}
		}

		// 4. Documento del seguro (apagado por env).
		await enviarCobertura({
			opportunityId: params.opportunityId,
			userId: params.userId,
		});
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error(`${LOG_PREFIX} Error no controlado: ${msg}`);
	}

	return { cuentaNexa, bienvenidaEnviada };
}
