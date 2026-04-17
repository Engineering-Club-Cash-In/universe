import { SimpleTechClient } from "@repo/simpletech";

export const SIMPLETECH_BOT_NUMBER = process.env.CCI_BOT_NUMBER!;
export const SIMPLETECH_TEMPLATE_NAME =
	process.env.SIMPLETECH_TEMPLATE_NAME || "mensaje2";

export function getSimpletechClient(): SimpleTechClient | null {
	if (
		!process.env.SIMPLETECH_BASE_URL ||
		!process.env.SIMPLETECH_USERNAME ||
		!process.env.SIMPLETECH_PASSWORD
	) {
		return null;
	}

	return new SimpleTechClient({
		credentials: {
			username: process.env.SIMPLETECH_USERNAME,
			password: process.env.SIMPLETECH_PASSWORD,
		},
		baseUrl: process.env.SIMPLETECH_BASE_URL,
	});
}

export function normalizePhone(phone: string): string {
	const digits = phone.replace(/\D/g, "");
	if (digits.startsWith("502")) return `+${digits}`;
	return `+502${digits}`;
}

export interface WhatsappSendResult {
	success: boolean;
	templateMessageId?: string;
	error?: string;
}

/**
 * Envía un mensaje de WhatsApp usando la template genérica de SimpleTech.
 * Reutiliza el mismo bot y template configurados globalmente.
 */
export async function sendWhatsappTemplate(params: {
	phone: string;
	message: string;
	logPrefix?: string;
}): Promise<WhatsappSendResult> {
	const prefix = params.logPrefix ?? "[SimpleTech]";
	const client = getSimpletechClient();
	if (!client) {
		return { success: false, error: "Servicio de mensajería no configurado" };
	}

	const phoneNormalized = normalizePhone(params.phone);
	const templateRequest = {
		templateName: SIMPLETECH_TEMPLATE_NAME,
		serviceIdentifier: SIMPLETECH_BOT_NUMBER,
		messages: [
			{
				number: phoneNormalized,
				body: [params.message],
			},
		],
	};

	console.log(`${prefix} Enviando template a:`, phoneNormalized);
	console.log(`${prefix} Request:`, JSON.stringify(templateRequest, null, 2));

	try {
		const result = await client.sendTemplate(templateRequest);
		console.log(`${prefix} Response:`, JSON.stringify(result, null, 2));
		if (result.success) {
			return {
				success: true,
				templateMessageId: result.results[0]?.templateMessageId,
			};
		}
		return {
			success: false,
			error: result.failed[0]?.error ?? "Error desconocido",
		};
	} catch (err) {
		console.error(`${prefix} Exception:`, err);
		return {
			success: false,
			error: err instanceof Error ? err.message : "Error desconocido",
		};
	}
}

export interface WhatsappBatchRecipient {
	/** Teléfono sin normalizar, tal como viene de nuestros datos */
	phone: string;
	/** Mensaje ya interpolado */
	message: string;
	/** Llave externa (sifco, id, etc.) para correlacionar el resultado */
	externalRef?: string;
}

export interface WhatsappBatchResultItem {
	phone: string;
	phoneNormalized: string;
	externalRef?: string;
	success: boolean;
	templateMessageId?: string;
	error?: string;
}

export interface WhatsappBatchResult {
	transportError?: string;
	items: WhatsappBatchResultItem[];
}

/**
 * Envía un batch de mensajes de WhatsApp en una sola llamada sendTemplate.
 * SimpleTech acepta múltiples destinatarios en `messages[]`; esta función
 * preserva la correlación para que el caller pueda loguear por destinatario.
 *
 * Si el transporte falla por completo (credenciales, red, etc.), se retorna
 * `transportError` y cada item se marca como fallido con ese mismo motivo.
 */
export async function sendWhatsappTemplateBatch(params: {
	recipients: WhatsappBatchRecipient[];
	logPrefix?: string;
}): Promise<WhatsappBatchResult> {
	const prefix = params.logPrefix ?? "[SimpleTech][batch]";
	const client = getSimpletechClient();

	const normalized = params.recipients.map((r) => ({
		...r,
		phoneNormalized: normalizePhone(r.phone),
	}));

	if (!client) {
		const msg = "Servicio de mensajería no configurado";
		return {
			transportError: msg,
			items: normalized.map((r) => ({
				phone: r.phone,
				phoneNormalized: r.phoneNormalized,
				externalRef: r.externalRef,
				success: false,
				error: msg,
			})),
		};
	}

	const templateRequest = {
		templateName: SIMPLETECH_TEMPLATE_NAME,
		serviceIdentifier: SIMPLETECH_BOT_NUMBER,
		messages: normalized.map((r) => ({
			number: r.phoneNormalized,
			body: [r.message],
		})),
	};

	console.log(`${prefix} Enviando batch a ${normalized.length} destinatarios`);

	try {
		const result = await client.sendTemplate(templateRequest);

		// SimpleTech responde `results[]` para exitosos y `failed[]` para fallidos,
		// cada uno con el número. Indexamos por número para matchear.
		const successByNumber = new Map<string, string | undefined>();
		for (const r of result.results ?? []) {
			successByNumber.set(String(r.number), r.templateMessageId);
		}
		const failByNumber = new Map<string, string>();
		for (const f of result.failed ?? []) {
			failByNumber.set(String(f.number), f.error ?? "Error desconocido");
		}

		return {
			items: normalized.map((r) => {
				if (successByNumber.has(r.phoneNormalized)) {
					return {
						phone: r.phone,
						phoneNormalized: r.phoneNormalized,
						externalRef: r.externalRef,
						success: true,
						templateMessageId: successByNumber.get(r.phoneNormalized),
					};
				}
				const err =
					failByNumber.get(r.phoneNormalized) ??
					(result.success ? undefined : "Error desconocido");
				return {
					phone: r.phone,
					phoneNormalized: r.phoneNormalized,
					externalRef: r.externalRef,
					success: false,
					error: err ?? "No reportado por SimpleTech",
				};
			}),
		};
	} catch (err) {
		console.error(`${prefix} Exception:`, err);
		const msg = err instanceof Error ? err.message : "Error desconocido";
		return {
			transportError: msg,
			items: normalized.map((r) => ({
				phone: r.phone,
				phoneNormalized: r.phoneNormalized,
				externalRef: r.externalRef,
				success: false,
				error: msg,
			})),
		};
	}
}
