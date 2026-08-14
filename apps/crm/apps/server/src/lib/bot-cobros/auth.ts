/**
 * Autenticación de los endpoints del bot de cobros (D-18).
 *
 * A diferencia de `/info/*` (bot de ventas) y `/api/public/lead`, que están
 * abiertos, estos endpoints devuelven datos de clientes con crédito, así que
 * exigen la API key del integrador.
 *
 * La llave identifica a SimpleTech, NO al cliente final: cualquiera con la
 * llave puede preguntar por cualquier DPI. El control de acceso a los datos del
 * crédito es el OTP validado (D-16); por eso este servicio solo devuelve nombre
 * y máscara del teléfono.
 */

import { timingSafeEqual } from "node:crypto";
import type { Context } from "hono";

/** Compara sin filtrar la respuesta por tiempo. */
function sonIguales(a: string, b: string): boolean {
	const bufferA = Buffer.from(a);
	const bufferB = Buffer.from(b);

	// timingSafeEqual exige el mismo largo; la comparación de largos sí puede
	// hacerse directo porque el largo de la llave no es secreto.
	if (bufferA.length !== bufferB.length) return false;

	return timingSafeEqual(bufferA, bufferB);
}

/**
 * Middleware de Hono. Acepta la llave vigente y, opcionalmente, la anterior,
 * para poder rotar sin coordinar un despliegue simultáneo con SimpleTech.
 */
export async function autenticarBotCobros(
	c: Context,
	next: () => Promise<void>,
) {
	const llaves = [
		process.env.BOT_COBROS_API_KEY,
		process.env.BOT_COBROS_API_KEY_PREV,
	].filter((llave): llave is string => Boolean(llave));

	// Falla cerrado: sin llave configurada el endpoint no queda abierto.
	if (llaves.length === 0) {
		console.error(
			"[BotCobros] BOT_COBROS_API_KEY no está configurada; se rechaza la petición",
		);
		return c.json(
			{
				success: false,
				error: {
					codigo: "SERVICIO_NO_DISPONIBLE",
					mensaje: "El servicio no está disponible en este momento.",
				},
			},
			503,
		);
	}

	const header = c.req.header("Authorization") ?? "";
	const recibida = header.startsWith("Bearer ")
		? header.slice("Bearer ".length).trim()
		: "";

	if (!recibida || !llaves.some((llave) => sonIguales(recibida, llave))) {
		// Nunca se registra la llave recibida, ni siquiera parcial.
		console.warn("[BotCobros] Petición rechazada por API key inválida", {
			path: c.req.path,
			ip:
				c.req.header("cf-connecting-ip") ||
				c.req.header("x-forwarded-for") ||
				"desconocida",
		});

		return c.json(
			{
				success: false,
				error: {
					codigo: "NO_AUTORIZADO",
					mensaje: "No autorizado.",
				},
			},
			401,
		);
	}

	await next();
}
