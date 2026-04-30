import { SimpleTechClient } from "@repo/simpletech";

export const SIMPLETECH_BOT_NUMBER = process.env.CCI_BOT_NUMBER!;
export const SIMPLETECH_TEMPLATE_NAME =
	process.env.SIMPLETECH_TEMPLATE_NAME || "mensaje1parametro";

function splitTemplateParams(message: string): string[] {
	const parts = message
		.split(/\n\s*\n/g)
		.map((part) => part.trim())
		.filter(Boolean);

	if (parts.length === 0) {
		return [message.trim()];
	}

	if (parts.length <= 4) {
		return parts;
	}

	// SimpleTech solo soporta hasta 4 parámetros por template.
	// Concatenamos cualquier exceso en el 4to parámetro para no perder texto.
	return [...parts.slice(0, 3), parts.slice(3).join("\n\n")];
}

function resolveTemplateNameByParamCount(
	baseTemplateName: string,
	paramCount: number,
): string {
	const match = /\d+/.exec(baseTemplateName);
	if (!match) return baseTemplateName;

	const baseNumber = Number.parseInt(match[0], 10);
	if (!Number.isFinite(baseNumber) || baseNumber <= 0) {
		return baseTemplateName;
	}

	const nextNumber = baseNumber * Math.max(1, paramCount);
	return baseTemplateName.replace(match[0], String(nextNumber));
}

function normalizeParamsForTemplate(
	params: string[],
	templateParamCount: number,
): string[] {
	if (params.length === templateParamCount) {
		return params;
	}

	if (params.length > templateParamCount) {
		if (templateParamCount <= 1) {
			return [params.join("\n\n")];
		}

		return [
			...params.slice(0, templateParamCount - 1),
			params.slice(templateParamCount - 1).join("\n\n"),
		];
	}

	return [
		...params,
		...new Array(templateParamCount - params.length).fill(""),
	];
}

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
	const digits = phone.replaceAll(/\D/g, "");
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
	const bodyParams = splitTemplateParams(params.message);
	const templateName = resolveTemplateNameByParamCount(
		SIMPLETECH_TEMPLATE_NAME,
		bodyParams.length,
	);
	const templateRequest = {
		templateName,
		serviceIdentifier: SIMPLETECH_BOT_NUMBER,
		messages: [
			{
				number: phoneNormalized,
				body: bodyParams,
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

	const firstMessage = normalized[0]?.message ?? "";
	const templateParamCount = splitTemplateParams(firstMessage).length;
	const templateName = resolveTemplateNameByParamCount(
		SIMPLETECH_TEMPLATE_NAME,
		templateParamCount,
	);

	const templateRequest = {
		templateName,
		serviceIdentifier: SIMPLETECH_BOT_NUMBER,
		messages: normalized.map((r) => ({
			number: r.phoneNormalized,
			body: normalizeParamsForTemplate(
				splitTemplateParams(r.message),
				templateParamCount,
			),
		})),
	};

	console.log(`${prefix} Enviando batch a ${normalized.length} destinatarios`);
	console.log(
		`${prefix} Template debug:`,
		JSON.stringify(
			{
				templateBase: SIMPLETECH_TEMPLATE_NAME,
				templateParamCount,
				templateName,
				firstMessagePreview: firstMessage.slice(0, 200),
				firstBody: templateRequest.messages[0]?.body,
			},
			null,
			2,
		),
	);
	console.log(`${prefix} Request:`, JSON.stringify(templateRequest, null, 2));

	try {
		const result = await client.sendTemplate(templateRequest);

		// SimpleTech puede devolver el número con formato distinto al que enviamos
		// (con o sin "+", con prefijo, etc.). Comparamos por dígitos.
		const toDigits = (n: string) => n.replaceAll(/\D/g, "");

		// Si dos destinatarios comparten el mismo número (p.ej. un cliente con
		// varios créditos), usar un Map por dígitos pisaría al primero. Matcheamos
		// posicionalmente: recorremos `results[]` en el orden devuelto y lo
		// asociamos al primer recipient no consumido con dígitos iguales.
		const matchByIdx = new Array<
			{ templateMessageId: string; error: string } | undefined
		>(normalized.length);
		const used = new Array<boolean>(normalized.length).fill(false);
		for (const r of result.results ?? []) {
			const rDigits = toDigits(String(r.number));
			for (let i = 0; i < normalized.length; i++) {
				if (
					!used[i] &&
					toDigits(normalized[i].phoneNormalized) === rDigits
				) {
					matchByIdx[i] = {
						templateMessageId: r.templateMessageId ?? "",
						error: r.error ?? "",
					};
					used[i] = true;
					break;
				}
			}
		}

		return {
			items: normalized.map((r, idx) => {
				const match = matchByIdx[idx];
				if (match?.error === "") {
					return {
						phone: r.phone,
						phoneNormalized: r.phoneNormalized,
						externalRef: r.externalRef,
						success: true,
						templateMessageId: match.templateMessageId || undefined,
					};
				}
				return {
					phone: r.phone,
					phoneNormalized: r.phoneNormalized,
					externalRef: r.externalRef,
					success: false,
					error:
						match?.error ||
						(result.success
							? "No reportado por SimpleTech"
							: "SimpleTech reportó fallo en el batch"),
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
