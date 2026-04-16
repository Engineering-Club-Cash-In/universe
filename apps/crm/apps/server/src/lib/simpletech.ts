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
