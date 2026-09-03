/**
 * Send Coverage Document Service
 *
 * Envía por WhatsApp el documento (PDF) de cobertura/instrucciones del seguro
 * junto a un texto dinámico, usando el template `mensaje_adjunto` de WittyBots
 * (header de documento + body de 1 variable). El adjunto es SIEMPRE el mismo
 * archivo (URL fija); lo único dinámico es el texto.
 *
 * Mismo diseño que `send-welcome-message.ts`: autocontenido, desacoplado
 * (recibe solo `opportunityId` + `userId`) y nunca lanza error al caller. Hoy se
 * dispara desde un botón de prueba en oportunidades; mañana se llamará en el
 * cierre del crédito (junto al de bienvenida) — SOLO se reubica la llamada, la
 * lógica es la misma.
 *
 * NO depende de cartera: nombre y vehículo salen del CRM local, así se puede
 * probar sobre cualquier oportunidad (tenga o no crédito creado).
 */

import { eq } from "drizzle-orm";
import { db } from "../db";
import { leads, opportunities } from "../db/schema/crm";
import { vehicles } from "../db/schema/vehicles";
import { persistCobrosSendLog } from "../lib/cobros-send-log";
import { getTestPhone, isTestModeEnabled } from "../lib/messaging-test-mode";
import { primerTelefono } from "../lib/phone-utils";
import { sendWhatsappTemplate } from "../lib/simpletech";

/** Template de WittyBots: header documento + 1 variable de body. */
const TEMPLATE_NAME = "mensaje_adjunto";

/**
 * URL pública del PDF de cobertura a adjuntar (header del template). Se lee de
 * la env `COBERTURA_SEGURO_PDF_URL`. Si NO está definida, no se envía el
 * documento (se omite y se registra) — nunca rompe el cierre del crédito.
 */
const DOCUMENTO_URL = process.env.COBERTURA_SEGURO_PDF_URL;

/** Nombre con el que se ve el archivo en WhatsApp. */
const DOCUMENTO_FILENAME = "Cobertura-Seguro.pdf";

const LOG_PREFIX = "[MensajeAdjunto]";

export interface SendCoverageDocumentParams {
	opportunityId: string;
	userId: string;
	/**
	 * Si es true, el mensaje se manda SIEMPRE al primer teléfono de prueba
	 * (`TEST_PHONES[0]`), nunca al del lead. Lo usa el botón de prueba para no
	 * escribirle a números reales de oportunidades (que aun en la DB de test son
	 * reales). En producción (cierre del crédito) se llama SIN esto.
	 */
	toTestPhone?: boolean;
}

export interface SendCoverageDocumentResult {
	sent: boolean;
	/** true cuando no se envió por una condición esperada (sin teléfono, etc.). */
	skipped?: boolean;
	reason?: string;
	error?: string;
	templateMessageId?: string;
}

/**
 * Texto del mensaje (va completo en la única variable del template). Solo agrega
 * la línea del vehículo si la oportunidad tiene placa o, en su defecto, VIN.
 */
function construirTexto(
	nombre: string,
	placa: string | null,
	vin: string | null,
): string {
	const saludo = nombre ? `Hola ${nombre}` : "Hola";
	let vehiculo = "";
	if (placa) vehiculo = ` Tu vehículo registrado tiene placa ${placa}.`;
	else if (vin) vehiculo = ` Tu vehículo registrado tiene VIN ${vin}.`;
	return `${saludo}, te compartimos la cobertura y las instrucciones de tu seguro en el documento adjunto.${vehiculo} Cualquier duda, escribinos por acá.`;
}

export async function sendCoverageDocument(
	params: SendCoverageDocumentParams,
): Promise<SendCoverageDocumentResult> {
	const { opportunityId, userId } = params;

	try {
		// 0. Sin URL de documento configurada, no se envía nada (se omite y se
		//    registra). Es una condición esperada, no un error.
		if (!DOCUMENTO_URL) {
			console.log(
				`${LOG_PREFIX} COBERTURA_SEGURO_PDF_URL no definida; no se envía documento`,
			);
			return { sent: false, skipped: true, reason: "sin_documento_url" };
		}

		// 1. Datos locales: nombre del cliente, teléfono, placa/VIN y numeroSifco
		//    (este último solo para la traza del log; puede no existir aún).
		const [row] = await db
			.select({
				leadPhone: leads.phone,
				firstName: leads.firstName,
				lastName: leads.lastName,
				numeroSifco: opportunities.numeroSifco,
				placa: vehicles.licensePlate,
				vin: vehicles.vinNumber,
			})
			.from(opportunities)
			.leftJoin(leads, eq(opportunities.leadId, leads.id))
			.leftJoin(vehicles, eq(opportunities.vehicleId, vehicles.id))
			.where(eq(opportunities.id, opportunityId))
			.limit(1);

		if (!row) {
			console.error(`${LOG_PREFIX} Oportunidad ${opportunityId} no encontrada`);
			return { sent: false, error: "Oportunidad no encontrada" };
		}

		// Teléfono real del lead — solo para la traza del log (a quién hubiera ido).
		const realPhone = primerTelefono(row.leadPhone);

		const nombre = `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim();
		const mensaje = construirTexto(nombre, row.placa, row.vin);

		// 2. Resolver destino. Con `toTestPhone` (botón de prueba) o test-mode global
		//    activo, mandamos SIEMPRE al primer teléfono de prueba (TEST_PHONES[0]);
		//    así no le escribimos a números reales de oportunidades. En producción
		//    (cierre del crédito) se llama sin esto y se usa el teléfono del lead.
		const testMode = params.toTestPhone || isTestModeEnabled();
		let telefonoDestino: string;
		if (testMode) {
			telefonoDestino = getTestPhone(0);
		} else {
			if (!realPhone) {
				console.log(
					`${LOG_PREFIX} Oportunidad ${opportunityId} sin teléfono válido; se omite`,
				);
				return { sent: false, skipped: true, reason: "sin_telefono" };
			}
			telefonoDestino = realPhone;
		}

		const result = await sendWhatsappTemplate({
			phone: telefonoDestino,
			message: mensaje,
			templateName: TEMPLATE_NAME,
			// El template tiene 1 sola variable de body: mandamos todo el texto como
			// un único parámetro (sin partir por párrafos).
			bodyParams: [mensaje],
			header: {
				type: "document",
				url: DOCUMENTO_URL,
				filename: DOCUMENTO_FILENAME,
			},
			logPrefix: testMode ? `${LOG_PREFIX}[TEST]` : LOG_PREFIX,
		});

		// 3. Log de traza en cobros_send_logs.
		await persistCobrosSendLog({
			numeroCreditoSifco: row.numeroSifco,
			plantillaId: TEMPLATE_NAME,
			telefono: telefonoDestino,
			mensaje,
			providerRequest: result.providerRequest ?? null,
			createdBy: userId,
			result: result.success
				? {
						success: true,
						providerResponse: {
							...(result.providerResponse ?? {}),
							templateMessageId: result.templateMessageId,
							testMode,
							realTarget: testMode ? (realPhone ?? undefined) : undefined,
						},
					}
				: {
						success: false,
						errorMessage: result.error,
						providerResponse: {
							...(result.providerResponse ?? {}),
							...(testMode
								? { testMode, realTarget: realPhone ?? undefined }
								: {}),
						},
					},
		});

		if (!result.success) {
			console.error(
				`${LOG_PREFIX} Falló envío para oportunidad ${opportunityId}: ${result.error}`,
			);
			return { sent: false, error: result.error };
		}

		console.log(
			`${LOG_PREFIX} ✓ Documento enviado para oportunidad ${opportunityId}`,
		);
		return { sent: true, templateMessageId: result.templateMessageId };
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error(`${LOG_PREFIX} Error no controlado: ${msg}`);
		return { sent: false, error: msg };
	}
}
