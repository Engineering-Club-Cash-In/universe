/**
 * Autenticación de los endpoints de notificaciones servidor-a-servidor
 * (cartera-back → CRM). Mismo patrón que `bot-cobros/auth.ts`: falla cerrado
 * sin llave configurada, comparación en tiempo constante, soporta rotación
 * con una llave previa.
 */

import { timingSafeEqual } from "node:crypto";
import type { Context } from "hono";

function sonIguales(a: string, b: string): boolean {
	const bufferA = Buffer.from(a);
	const bufferB = Buffer.from(b);

	if (bufferA.length !== bufferB.length) return false;

	return timingSafeEqual(bufferA, bufferB);
}

/**
 * Middleware de Hono. Acepta la llave vigente y, opcionalmente, la anterior,
 * para poder rotar sin coordinar un despliegue simultáneo con cartera-back.
 */
export async function autenticarNotificacionesCarteraBack(
	c: Context,
	next: () => Promise<void>,
) {
	const llaves = [
		process.env.CARTERA_BACK_API_KEY,
		process.env.CARTERA_BACK_API_KEY_PREV,
	].filter((llave): llave is string => Boolean(llave));

	if (llaves.length === 0) {
		console.error(
			"[NotificacionesCarteraBack] CARTERA_BACK_API_KEY no está configurada; se rechaza la petición",
		);
		return c.json(
			{ success: false, error: "El servicio no está disponible en este momento." },
			503,
		);
	}

	const header = c.req.header("Authorization") ?? "";
	const recibida = header.startsWith("Bearer ")
		? header.slice("Bearer ".length).trim()
		: "";

	if (!recibida || !llaves.some((llave) => sonIguales(recibida, llave))) {
		console.warn(
			"[NotificacionesCarteraBack] Petición rechazada por API key inválida",
			{ path: c.req.path },
		);
		return c.json({ success: false, error: "No autorizado." }, 401);
	}

	await next();
}
