/**
 * Cliente Págalo. Solo CRM server lo importa: token nunca baja al navegador ni
 * se reenvía a cartera-back. Esta integración acepta exclusivamente sandbox.
 */
import { z } from "zod";

const SANDBOX_ORIGIN = "https://api.pagalodev.com";

export type PagaloClientConfig = {
	baseUrl: string;
	authorization: string;
	linkCreationEnabled: boolean;
};

export type PagaloFetch = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

export const pagaloCreateRequestSchema = z
	.object({
		uuid_branch: z.string().uuid().optional(),
		total_amount: z.number().positive(),
		currency: z.literal("GTQ"),
		description: z.string().trim().min(1).max(250),
		external_identifier: z.string().trim().min(1).max(150),
		type_request: z.literal("SP"),
		n_quotas: z.boolean().default(false),
		// D-51: links sin vencimiento durante MVP.
		expiration: z.literal(false),
		client: z
			.object({
				first_name: z.string().trim().min(1),
				last_name: z.string().trim().min(1),
				email: z.string().email().optional(),
				phone: z.string().trim().min(1).optional(),
				country: z.string().trim().min(1).optional(),
				city: z.string().trim().min(1).optional(),
				state: z.string().trim().min(1).optional(),
				postal_code: z.string().trim().min(1).optional(),
				location: z.string().trim().min(1).optional(),
			})
			.strict(),
		products: z
			.array(
				z
					.object({
						product_uuid: z.union([z.string(), z.number()]).optional(),
						name: z.string().trim().min(1),
						product_name: z.string().trim().min(1),
						amount: z.number().positive(),
						quantity: z.number().int().positive(),
						subtotal: z.number().positive(),
					})
					.strict(),
			)
			.min(1),
	})
	.strict();
export type PagaloCreateRequest = z.infer<typeof pagaloCreateRequestSchema>;

export class PagaloClientError extends Error {
	constructor(
		message: string,
		readonly code:
			| "PAGALO_SANDBOX_REQUIRED"
			| "PAGALO_MISSING_AUTHORIZATION"
			| "PAGALO_LINK_CREATION_DISABLED"
			| "PAGALO_HTTP_ERROR",
		readonly status?: number,
	) {
		super(message);
	}
}

/** Págalo recibe JSON number. Nunca redondear centavos para acomodarlo. */
export function toPagaloProviderAmount(amount: string): number {
	const match = amount.match(/^(\d+)\.(\d{2})$/);
	if (!match) throw new Error("Monto Págalo inválido.");
	const cents = BigInt(match[1]) * 100n + BigInt(match[2]);
	if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new Error("Págalo no puede representar este monto sin perder centavos.");
	}
	const providerAmount = Number(cents) / 100;
	const serialized = JSON.stringify(providerAmount);
	const roundTrip = serialized.match(/^(\d+)(?:\.(\d{1,2}))?$/);
	if (!roundTrip || `${roundTrip[1]}.${(roundTrip[2] ?? "").padEnd(2, "0")}` !== amount) {
		throw new Error("Págalo no puede representar este monto sin perder centavos.");
	}
	return providerAmount;
}

export function getPagaloSandboxConfig(
	env: Record<string, string | undefined> = process.env,
): PagaloClientConfig {
	const baseUrl = (env.PAGALO_BASE_URL ?? SANDBOX_ORIGIN).replace(/\/+$/, "");
	if (baseUrl !== SANDBOX_ORIGIN) {
		throw new PagaloClientError(
			"Págalo solo puede configurarse contra sandbox api.pagalodev.com.",
			"PAGALO_SANDBOX_REQUIRED",
		);
	}
	if (!env.PAGALO_AUTHORIZATION?.trim()) {
		throw new PagaloClientError(
			"Falta PAGALO_AUTHORIZATION en configuración de servidor.",
			"PAGALO_MISSING_AUTHORIZATION",
		);
	}
	return {
		baseUrl,
		authorization: env.PAGALO_AUTHORIZATION.trim(),
		linkCreationEnabled: env.PAGALO_LINK_CREATION_ENABLED === "true",
	};
}

/** Quita secretos y datos de tarjeta antes de guardar respuesta/problema externo. */
export function sanitizePagaloPayload(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sanitizePagaloPayload);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>).map(([key, child]) => [
			key,
			/(authorization|token|pan|card_?number|cvv|expiration|expiry)/i.test(key)
				? "[REDACTED]"
				: sanitizePagaloPayload(child),
		]),
	);
}

export function createPagaloClient(
	config: PagaloClientConfig,
	fetchImpl: PagaloFetch = fetch,
) {
	const request = async (path: string, init: RequestInit = {}) => {
		const response = await fetchImpl(`${config.baseUrl}${path}`, {
			...init,
			headers: {
				authorization: config.authorization,
				...(init.body ? { "content-type": "application/json" } : {}),
				...init.headers,
			},
		});
		const raw = await response.text();
		let body: unknown = raw;
		try {
			body = raw ? JSON.parse(raw) : null;
		} catch {
			// Proveedor puede responder HTML/texto en errores; nunca se persiste crudo.
		}
		if (!response.ok) {
			throw new PagaloClientError(
				`Págalo respondió HTTP ${response.status}.`,
				"PAGALO_HTTP_ERROR",
				response.status,
			);
		}
		return sanitizePagaloPayload(body);
	};

	return {
		/** Consulta segura para verificar sandbox/credencial; no crea recursos. */
		getBranches: () => request("/v1/getSucursal"),
		/** Consulta segura de transacciones Págalo. */
		getPayments: () => request("/v1/getPayments"),
		/**
		 * Consulta estado de un link por su uuid. Status documentado: 1=creado,
		 * 2=pagado, 3=cancelado, 4=expirado. Mismo authorization fijo que crea
		 * el link — confirmado en sandbox que no requiere login V2.
		 */
		getRequestByUuid: (uuid: string) =>
			request("/v1/payment/request/uuid", {
				method: "POST",
				body: JSON.stringify({ uuid }),
			}),
		/**
		 * Detalle real de una transacción por `id_external` (el
		 * `external_identifier` que nosotros generamos al crear el link).
		 * Confirmado en sandbox: `transactions_uuid` con el uuid del link no
		 * encuentra registro, pero `id_external` sí — y trae no. de transacción
		 * real, tarjeta enmascarada y fecha de pago. Mismo `authorization` fijo
		 * del comercio, sin login separado.
		 */
		getTransactionByIdExternalRaw: (idExternal: string) =>
			request("/v1/payment/transaction/uuid", {
				method: "POST",
				body: JSON.stringify({ id_external: idExternal }),
			}),
		/**
		 * Único mutador. Código existe para despliegue, pero queda apagado salvo
		 * habilitación explícita de flag en sandbox por operador humano.
		 */
		createPaymentRequest: async (input: PagaloCreateRequest) => {
			if (!config.linkCreationEnabled) {
				throw new PagaloClientError(
					"Creación de links Págalo deshabilitada por configuración.",
					"PAGALO_LINK_CREATION_DISABLED",
				);
			}
			const payload = pagaloCreateRequestSchema.parse(input);
			return request("/v1/payment/request", {
				method: "POST",
				body: JSON.stringify(payload),
			});
		},
	};
}
