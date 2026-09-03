/**
 * Send Welcome Message Service
 *
 * Envía el WhatsApp de "Bienvenida" al cliente una vez que su crédito ya existe
 * en cartera. Reutiliza exactamente la misma infraestructura que el envío de
 * cobros ("Enviar Directo"): la plantilla del server (`cobros-plantillas.ts`),
 * la interpolación de variables (`interpolar`) y `sendWhatsappTemplate`
 * (SimpleTech / Meta).
 *
 * Diseño portable y desacoplado a propósito:
 *  - Recibe SOLO `opportunityId` + `userId` (el `numeroSifco` es opcional; si no
 *    viene se resuelve desde `opportunities.numeroSifco`, que `closeOpportunity`
 *    ya dejó seteado). Así se puede disparar desde donde sea — hoy al 90% (al
 *    confirmar contratos firmados), mañana al 100% (desembolso) o manual — sin
 *    tocar este servicio.
 *  - Nunca lanza error al caller: devuelve un resultado y loguea. Un fallo de
 *    WhatsApp jamás debe romper el flujo de cierre de la oportunidad.
 */

import { eq } from "drizzle-orm";
import { db } from "../db";
import { leads, opportunities } from "../db/schema/crm";
import { interpolar, PLANTILLAS_MENSAJES } from "../lib/cobros-plantillas";
import { persistCobrosSendLog } from "../lib/cobros-send-log";
import { getTestPhone, isTestModeEnabled } from "../lib/messaging-test-mode";
import { primerTelefono } from "../lib/phone-utils";
import { sendWhatsappTemplate } from "../lib/simpletech";
import { carteraBackClient } from "./cartera-back-client";
import { isCarteraBackEnabled } from "./cartera-back-integration";

/** Id de la plantilla de bienvenida en `cobros-plantillas.ts`. */
const PLANTILLA_BIENVENIDA_ID = "bienvenida";

const LOG_PREFIX = "[Bienvenida]";

export interface SendWelcomeMessageParams {
	opportunityId: string;
	userId: string;
	/** Si no se pasa, se resuelve desde `opportunities.numeroSifco`. */
	numeroSifco?: string;
}

export interface SendWelcomeMessageResult {
	sent: boolean;
	/** true cuando no se envió por una condición esperada (sin teléfono, etc.). */
	skipped?: boolean;
	reason?: string;
	error?: string;
	templateMessageId?: string;
}

/**
 * Día de pago para `{fechaPago}`: tomamos el día del mes de la cuota pendiente
 * más próxima (menor `fecha_vencimiento`) que devuelve cartera — mismo criterio
 * que el masivo de cobros. Si no hay cuotas pendientes, caemos al
 * `diaPagoMensual` de la oportunidad (que vive en el CRM).
 */
function resolverDiaPago(
	cuotasPendientes: Array<{ fecha_vencimiento: string }> | undefined,
	fallbackDia: number | null,
): string {
	if (cuotasPendientes && cuotasPendientes.length > 0) {
		const proxima = [...cuotasPendientes].sort((a, b) =>
			a.fecha_vencimiento.localeCompare(b.fecha_vencimiento),
		)[0];
		// `fecha_vencimiento` ISO "YYYY-MM-DD" → día = chars 8-10.
		const dia = Number.parseInt(proxima.fecha_vencimiento.substring(8, 10), 10);
		if (dia) return String(dia);
	}
	return fallbackDia ? String(fallbackDia) : "";
}

/**
 * Envía el mensaje de bienvenida del crédito recién creado.
 * Idempotencia: NO se aplica guarda — el crédito se cierra una sola vez. El log
 * en `cobros_send_logs` queda como traza de que ya se envió.
 */
export async function sendWelcomeMessage(
	params: SendWelcomeMessageParams,
): Promise<SendWelcomeMessageResult> {
	const { opportunityId, userId } = params;

	try {
		// 0. Habilitado por env: solo se envía si BIENVENIDA_WHATSAPP_ENABLED="true".
		//    Si no, se omite (condición esperada, no error) y el cierre sigue normal.
		if (process.env.BIENVENIDA_WHATSAPP_ENABLED !== "true") {
			console.log(
				`${LOG_PREFIX} BIENVENIDA_WHATSAPP_ENABLED != "true"; no se envía bienvenida`,
			);
			return { sent: false, skipped: true, reason: "deshabilitado" };
		}

		if (!isCarteraBackEnabled()) {
			console.log(
				`${LOG_PREFIX} Cartera-back deshabilitado; no se envía bienvenida`,
			);
			return { sent: false, skipped: true, reason: "cartera_back_disabled" };
		}

		// 1. Datos locales: teléfono del cliente, numeroSifco y día de pago fallback.
		const [row] = await db
			.select({
				leadPhone: leads.phone,
				numeroSifco: opportunities.numeroSifco,
				diaPagoMensual: opportunities.diaPagoMensual,
			})
			.from(opportunities)
			.leftJoin(leads, eq(opportunities.leadId, leads.id))
			.where(eq(opportunities.id, opportunityId))
			.limit(1);

		if (!row) {
			console.error(`${LOG_PREFIX} Oportunidad ${opportunityId} no encontrada`);
			return { sent: false, error: "Oportunidad no encontrada" };
		}

		const numeroSifco = params.numeroSifco ?? row.numeroSifco;
		if (!numeroSifco) {
			console.error(
				`${LOG_PREFIX} Oportunidad ${opportunityId} sin numeroSifco`,
			);
			return { sent: false, error: "Crédito sin numeroSifco" };
		}

		const telefono = primerTelefono(row.leadPhone);
		if (!telefono) {
			console.log(
				`${LOG_PREFIX} Crédito ${numeroSifco} sin teléfono válido; se omite`,
			);
			return { sent: false, skipped: true, reason: "sin_telefono" };
		}

		// 2. Traer el crédito recién creado desde cartera (asesor, cuota, cliente,
		//    cuotas). Justo tras crearlo, el primer GET es cache-miss → datos frescos.
		const credito = await carteraBackClient.getCredito(numeroSifco);

		// 3. Armar variables de la plantilla. La bienvenida solo usa clienteNombre,
		//    fechaPago, cuotaMensual, nombreAsesor y telefonoAsesor; el resto va en
		//    blanco (la interpolación reemplaza vacíos por "").
		const variables = {
			clienteNombre: credito.usuario?.nombre ?? "",
			fechaPago: resolverDiaPago(credito.cuotasPendientes, row.diaPagoMensual),
			cuotaMensual: credito.credito?.cuota ?? "",
			placa: "",
			marcaLineaModelo: "",
			montoAdeudado: "",
			cuotasAtraso: 0,
			telefonoAsesor: credito.asesor?.telefono ?? "",
			nombreAsesor: credito.asesor?.nombre ?? "",
		};

		const plantilla = PLANTILLAS_MENSAJES.find(
			(p) => p.id === PLANTILLA_BIENVENIDA_ID,
		);
		if (!plantilla) {
			console.error(
				`${LOG_PREFIX} Plantilla "${PLANTILLA_BIENVENIDA_ID}" no encontrada`,
			);
			return { sent: false, error: "Plantilla de bienvenida no encontrada" };
		}

		const mensaje = interpolar(plantilla.cuerpo, variables);

		// 4. Test-mode + envío con la MISMA función que usa "Enviar Directo".
		const testMode = isTestModeEnabled();
		const telefonoDestino = testMode ? getTestPhone() : telefono;

		const result = await sendWhatsappTemplate({
			phone: telefonoDestino,
			message: mensaje,
			logPrefix: testMode ? `${LOG_PREFIX}[TEST]` : LOG_PREFIX,
		});

		// 5. Log de traza en cobros_send_logs.
		await persistCobrosSendLog({
			numeroCreditoSifco: numeroSifco,
			plantillaId: PLANTILLA_BIENVENIDA_ID,
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

		console.log(`${LOG_PREFIX} ✓ Bienvenida enviada para ${numeroSifco}`);
		return { sent: true, templateMessageId: result.templateMessageId };
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error(`${LOG_PREFIX} Error no controlado: ${msg}`);
		return { sent: false, error: msg };
	}
}
