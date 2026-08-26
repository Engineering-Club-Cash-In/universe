/**
 * Send Pagalo Reminder Whatsapp Service (CB-028)
 *
 * Recordatorio periódico (job cada 3h, `jobs/pagalo-reminder.ts`) para links
 * Págalo que siguen sin pagar. Distinto de `send-pagalo-links-whatsapp.ts`
 * (el envío inicial D-04) en dos cosas a propósito:
 *
 * - Copy de "recordatorio", no "aquí está tu link" — mismo texto neutro de
 *   D-04 (nunca "mora" ni "interés" en texto visible), pero tono distinto.
 * - Orden MORA_INTERES primero si sigue pendiente, CAPITAL solo si mora ya
 *   se pagó o el grupo nunca tuvo lado facturable — inverso al orden fijo
 *   CAPITAL-primero de `construirMensajePagaloLinks`. El caller (el job) ya
 *   entrega `links` en el orden correcto; esta función NO reordena.
 *
 * Misma infra de envío que el original: `sendWhatsappTemplate` sin
 * templateName explícito, log en `cobros_send_logs`, nunca lanza al caller.
 */

import { persistCobrosSendLog } from "../lib/cobros-send-log";
import { getTestPhone, isTestModeEnabled } from "../lib/messaging-test-mode";
import { sendWhatsappTemplate } from "../lib/simpletech";

const LOG_PREFIX = "[PagaloReminderWhatsapp]";
const PLANTILLA_ID = "pagalo_reminder";

export type PagaloLinkParaEnviar = {
	linkType: "CAPITAL" | "MORA_INTERES";
	paymentUrl: string;
};

export type VehiculoRecordatorioPagalo = {
	marca: string | null;
	modelo: string | null;
	year: number | null;
	placa: string | null;
};

export interface SendPagaloReminderWhatsappParams {
	numeroSifco: string;
	telefono: string;
	clienteNombre: string;
	links: PagaloLinkParaEnviar[];
	vehiculo?: VehiculoRecordatorioPagalo;
	createdBy: string;
}

export type SendPagaloReminderWhatsappResult =
	| { sent: true; templateMessageId?: string; telefono: string }
	| { sent: false; skipped?: boolean; reason?: string; error?: string };

/**
 * `links` debe llegar ya en el orden correcto (MORA_INTERES primero si
 * pendiente, CAPITAL solo si es lo único que falta) — a diferencia de
 * `construirMensajePagaloLinks`, esta función no reordena.
 */
export function construirMensajeRecordatorioPagalo(
	clienteNombre: string,
	numeroSifco: string,
	links: PagaloLinkParaEnviar[],
	vehiculo?: VehiculoRecordatorioPagalo,
): string {
	const dosLinks = links.length === 2;
	const saludo = clienteNombre ? `Hola ${clienteNombre}` : "Hola";
	const descripcionVehiculo = [vehiculo?.marca, vehiculo?.modelo, vehiculo?.year]
		.filter((valor): valor is string | number => valor != null && valor !== "")
		.join(" ");
	const identificador = descripcionVehiculo
		? `tu ${descripcionVehiculo}${vehiculo?.placa ? `, placas ${vehiculo.placa}` : ""}`
		: vehiculo?.placa
			? `tu vehículo, placas ${vehiculo.placa}`
			: `tu crédito ${numeroSifco}`;
	const explicacion = dosLinks
		? "Para completar este pago, realiza ambos enlaces de pago:"
		: "Puedes realizar este pago aquí:";
	const lineas = links.map((link, index) => {
		const etiqueta = dosLinks ? `Pago ${index + 1} de 2` : "Pago";
		return `${etiqueta}: ${link.paymentUrl}`;
	});
	return (
		`${saludo}, tienes un pago pendiente de ${identificador}.\n\n` +
		`${explicacion}\n\n${lineas.join("\n")}\n\n` +
		"Si ya realizaste el pago, puedes ignorar este mensaje."
	);
}

/** Deps inyectables solo para tests — en producción no se pasa nada. */
export interface SendPagaloReminderWhatsappDeps {
	enviar?: typeof sendWhatsappTemplate;
	guardarLog?: typeof persistCobrosSendLog;
}

export async function sendPagaloReminderWhatsapp(
	params: SendPagaloReminderWhatsappParams,
	deps: SendPagaloReminderWhatsappDeps = {},
): Promise<SendPagaloReminderWhatsappResult> {
	const { numeroSifco, telefono, clienteNombre, links, vehiculo, createdBy } = params;
	const enviar = deps.enviar ?? sendWhatsappTemplate;
	const guardarLog = deps.guardarLog ?? persistCobrosSendLog;

	if (links.length === 0) {
		console.log(
			`${LOG_PREFIX} SIFCO ${numeroSifco} sin links pendientes; se omite`,
		);
		return { sent: false, skipped: true, reason: "sin_links" };
	}

	const testMode = isTestModeEnabled();
	const telefonoDestino = testMode ? getTestPhone(0) : telefono;
	const mensaje = construirMensajeRecordatorioPagalo(
		clienteNombre,
		numeroSifco,
		links,
		vehiculo,
	);

	let result: Awaited<ReturnType<typeof sendWhatsappTemplate>>;
	try {
		result = await enviar({
			phone: telefonoDestino,
			message: mensaje,
			logPrefix: testMode ? `${LOG_PREFIX}[TEST]` : LOG_PREFIX,
		});
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error(
			`${LOG_PREFIX} Error no controlado enviando a ${numeroSifco}: ${msg}`,
		);
		return { sent: false, error: msg };
	}

	await guardarLog({
		numeroCreditoSifco: numeroSifco,
		plantillaId: PLANTILLA_ID,
		telefono: telefonoDestino,
		mensaje,
		providerRequest: result.providerRequest ?? null,
		createdBy,
		result: result.success
			? {
					success: true,
					providerResponse: {
						...(result.providerResponse ?? {}),
						templateMessageId: result.templateMessageId,
						testMode,
						realTarget: testMode ? telefono : undefined,
					},
				}
			: {
					success: false,
					errorMessage: result.error,
					providerResponse: {
						...(result.providerResponse ?? {}),
						...(testMode ? { testMode, realTarget: telefono } : {}),
					},
				},
	});

	if (!result.success) {
		console.error(
			`${LOG_PREFIX} Falló envío para ${numeroSifco}: ${result.error}`,
		);
		return { sent: false, error: result.error };
	}

	console.log(
		`${LOG_PREFIX} ✓ Recordatorio Págalo enviado para ${numeroSifco}`,
	);
	return {
		sent: true,
		templateMessageId: result.templateMessageId,
		telefono: telefonoDestino,
	};
}
