/**
 * Send Pagalo Links Whatsapp Service (CB-028)
 *
 * D-04 (docs/features/pagalo/DECISIONES.md): "Cliente recibe un solo mensaje
 * con todos los links requeridos etiquetados. CRM no envía nada hasta crear
 * grupo completo... Texto visible siempre neutro: `Pago` o `Pago 1 de 2` /
 * `Pago 2 de 2`; nunca nombra mora o intereses." El crédito se identifica
 * como "vehículo {marca modelo año} · {placa}" cuando el contrato tiene
 * vehículo cargado, si no cae a "crédito {sifco}" (pagalo-link-orchestrator.ts).
 *
 * Mismo patrón que send-welcome-message.ts / send-recibo-pago-whatsapp.ts:
 * texto plano vía sendWhatsappTemplate sin templateName explícito (se
 * auto-resuelve mensajeNparametro por cantidad de párrafos), log en
 * cobros_send_logs, y nunca lanza al caller — un fallo de WhatsApp no debe
 * romper la creación de links, que ya ocurrió.
 */

import { persistCobrosSendLog } from "../lib/cobros-send-log";
import { getTestPhone, isTestModeEnabled } from "../lib/messaging-test-mode";
import { sendWhatsappTemplate } from "../lib/simpletech";

const LOG_PREFIX = "[PagaloLinksWhatsapp]";
const PLANTILLA_ID = "pagalo_links";

export type PagaloLinkParaEnviar = {
	linkType: "CAPITAL" | "MORA_INTERES";
	paymentUrl: string;
};

/**
 * El orden en que el cliente ve los links: **primero MORA_INTERES, después
 * CAPITAL** — mismo criterio que el bot (bot-cobros/pago-link.ts, D-52):
 * cartera aplica el dinero contra la mora vigente solo con el link
 * MORA_INTERES, jamás con el de CAPITAL, así que "Pago 1 de 2" tiene que
 * ser el de interés y mora.
 */
export const ORDEN_LINKS_PAGALO: Array<"CAPITAL" | "MORA_INTERES"> = [
	"MORA_INTERES",
	"CAPITAL",
];

export const porOrdenDeLinkPagalo = (
	a: { linkType: "CAPITAL" | "MORA_INTERES" },
	b: { linkType: "CAPITAL" | "MORA_INTERES" },
) =>
	ORDEN_LINKS_PAGALO.indexOf(a.linkType) -
	ORDEN_LINKS_PAGALO.indexOf(b.linkType);

export interface SendPagaloLinksWhatsappParams {
	numeroSifco: string;
	/** "vehículo {marca modelo año} · {placa}" cuando está cargado, si no "crédito {sifco}". */
	identificadorCredito: string;
	telefono: string;
	clienteNombre: string;
	links: PagaloLinkParaEnviar[];
	createdBy: string;
}

export type SendPagaloLinksWhatsappResult =
	| { sent: true; templateMessageId?: string; telefono: string }
	| { sent: false; skipped?: boolean; reason?: string; error?: string };

/**
 * Etiqueta neutra igual a la que ya lleva el link (pagalo-link-orchestrator.ts):
 * "Pago" si es uno solo, "Pago 1 de 2"/"Pago 2 de 2" si son dos, en el orden
 * fijo de ORDEN_LINKS_PAGALO sin importar el orden en que llegue el array.
 */
export function construirMensajePagaloLinks(
	clienteNombre: string,
	identificadorCredito: string,
	links: PagaloLinkParaEnviar[],
): string {
	const ordenados = [...links].sort(porOrdenDeLinkPagalo);
	const dosLinks = ordenados.length === 2;
	const saludo = clienteNombre ? `Hola ${clienteNombre}` : "Hola";
	const lineas = ordenados.map((link, index) => {
		const etiqueta = dosLinks ? `Pago ${index + 1} de 2` : "Pago";
		return `${etiqueta}: ${link.paymentUrl}`;
	});
	return `${saludo}, aquí tienes el enlace de pago de tu ${identificadorCredito}.\n\n${lineas.join("\n")}`;
}

/** Deps inyectables solo para tests — en producción no se pasa nada. */
export interface SendPagaloLinksWhatsappDeps {
	enviar?: typeof sendWhatsappTemplate;
	guardarLog?: typeof persistCobrosSendLog;
}

export async function sendPagaloLinksWhatsapp(
	params: SendPagaloLinksWhatsappParams,
	deps: SendPagaloLinksWhatsappDeps = {},
): Promise<SendPagaloLinksWhatsappResult> {
	const {
		numeroSifco,
		identificadorCredito,
		telefono,
		clienteNombre,
		links,
		createdBy,
	} = params;
	const enviar = deps.enviar ?? sendWhatsappTemplate;
	const guardarLog = deps.guardarLog ?? persistCobrosSendLog;

	if (links.length === 0) {
		console.log(
			`${LOG_PREFIX} SIFCO ${numeroSifco} sin links que enviar; se omite`,
		);
		return { sent: false, skipped: true, reason: "sin_links" };
	}

	const testMode = isTestModeEnabled();
	const telefonoDestino = testMode ? getTestPhone(2) : telefono;
	const mensaje = construirMensajePagaloLinks(
		clienteNombre,
		identificadorCredito,
		links,
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

	// El log es best-effort: si el envío ya llegó al proveedor (result.success)
	// y el log falla (ej. DB caída momentáneamente), NO debe convertirse en un
	// "sent: false" — el modal instruiría al asesor a reenviar manualmente y
	// duplicaría el mensaje al cliente que ya lo recibió (hallazgo de Codex,
	// PR #1477).
	try {
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
	} catch (error) {
		console.error(
			`${LOG_PREFIX} Error guardando log para ${numeroSifco} (envío ${result.success ? "exitoso" : "fallido"}, no afecta el resultado):`,
			error instanceof Error ? error.message : error,
		);
	}

	if (!result.success) {
		console.error(
			`${LOG_PREFIX} Falló envío para ${numeroSifco}: ${result.error}`,
		);
		return { sent: false, error: result.error };
	}

	console.log(`${LOG_PREFIX} ✓ Links Págalo enviados para ${numeroSifco}`);
	return {
		sent: true,
		templateMessageId: result.templateMessageId,
		telefono: telefonoDestino,
	};
}
