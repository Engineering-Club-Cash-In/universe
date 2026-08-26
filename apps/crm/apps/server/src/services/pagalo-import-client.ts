/**
 * Cliente al endpoint interno de cartera-back que aplica el pago Págalo ya
 * confirmado (CB-028, paso 3 — el dispatcher). Deliberadamente NO pasa por
 * `carteraBackClient.request()`: ese helper comparte el circuit breaker con
 * tráfico de otro propósito — un fallo despachando pagos no debe abrir el
 * breaker de lecturas normales de cartera, ni viceversa. Sí reusa el mismo
 * Bearer JWT (`cartera-auth.service.ts`) que usa `carteraBackClient`: el
 * endpoint está detrás del mismo `authMiddleware` que cualquier otra ruta de
 * `payments.ts`, no hay secreto de servicio separado.
 *
 * Política del repo (cartera-back-client.ts): los POSTs mutantes nunca se
 * reintentan a nivel HTTP salvo por un único reintento tras invalidar/
 * refrescar el token en un 401/403 — el token expirado no significa que
 * cartera-back haya procesado nada. El reintento por fallo real de negocio o
 * de red vive en el dispatcher (`jobs/pagalo-dispatch.ts`) vía
 * `nextDispatchAt` con backoff, no acá.
 */
import { getCarteraAccessToken, invalidateAndReauth } from "./cartera-auth.service";
import type { PagaloCommandForHash } from "../lib/pagalo-payload-hash";

const TIMEOUT_MS = 10_000;

export type PagaloImportCommand = PagaloCommandForHash & { payload_hash: string };

export type PagaloImportSuccess = {
	success: true;
	status: "APPLIED";
	import_id: number;
	payment_ids: number[];
	idempotent_replay: boolean;
};

export type PagaloImportReviewRequired = {
	success: false;
	status: "REVIEW_REQUIRED";
	code: "PAGALO_PAYLOAD_HASH_CONFLICT" | "PAGALO_LIVE_DEBT_REVIEW";
	import_id?: number;
};

export type PagaloImportInvalidCommand = {
	success: false;
	status: "INVALID_COMMAND";
	errors: Array<{ code: string; message: string }>;
};

export type PagaloImportServiceError = {
	success: false;
	status: "AUTH_ERROR" | "NETWORK_ERROR" | "UNEXPECTED_RESPONSE";
	message: string;
};

export type PagaloImportResult =
	| PagaloImportSuccess
	| PagaloImportReviewRequired
	| PagaloImportInvalidCommand
	| PagaloImportServiceError;

function getCarteraBackUrl(): string {
	return process.env.CARTERA_BACK_URL || "http://localhost:7000";
}

async function enviar(command: PagaloImportCommand, token: string): Promise<Response> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
	try {
		return await fetch(`${getCarteraBackUrl()}/pagalo/payment-imports`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify(command),
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timeout);
	}
}

/** Nunca lanza: cualquier fallo (red, timeout, auth) vuelve como resultado tipado. */
export async function postPagaloPaymentImport(
	command: PagaloImportCommand,
): Promise<PagaloImportResult> {
	let response: Response;
	try {
		const token = await getCarteraAccessToken();
		response = await enviar(command, token);
		// 401/403 significa token vencido/inválido — la request no procesó nada
		// del lado de cartera, así que un único reintento con token fresco es
		// seguro (no duplica ningún efecto).
		if (response.status === 401 || response.status === 403) {
			const freshToken = await invalidateAndReauth();
			response = await enviar(command, freshToken);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { success: false, status: "NETWORK_ERROR", message };
	}

	const raw = await response.text();
	let body: unknown;
	try {
		body = raw ? JSON.parse(raw) : null;
	} catch {
		console.error(
			`[Págalo][IMPORT] Respuesta no-JSON de cartera-back (HTTP ${response.status}). Body crudo:\n${raw.slice(0, 4000)}`,
		);
		return {
			success: false,
			status: "UNEXPECTED_RESPONSE",
			message: `Respuesta no-JSON de cartera-back (HTTP ${response.status}).`,
		};
	}

	if (response.status === 401 || response.status === 403) {
		return {
			success: false,
			status: "AUTH_ERROR",
			message: "cartera-back rechazó el token de servicio tras reautenticar.",
		};
	}
	if (!body || typeof body !== "object") {
		return {
			success: false,
			status: "UNEXPECTED_RESPONSE",
			message: `Respuesta vacía o inválida de cartera-back (HTTP ${response.status}).`,
		};
	}
	return body as PagaloImportResult;
}
