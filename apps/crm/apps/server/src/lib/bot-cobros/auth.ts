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
import { marcarBotAutenticado } from "./historial";

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
		const mensaje = "El servicio no está disponible en este momento.";

		// `data` va también en los errores: el motor del bot lee siempre esa
		// variable y sin ella se queda sin nada que mostrarle al cliente.
		return c.json(
			{
				success: false,
				error: { codigo: "SERVICIO_NO_DISPONIBLE", mensaje },
				data: { mensaje, codigo: "SERVICIO_NO_DISPONIBLE" },
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

		const mensaje = "No autorizado.";

		return c.json(
			{
				success: false,
				error: { codigo: "NO_AUTORIZADO", mensaje },
				data: { mensaje, codigo: "NO_AUTORIZADO" },
			},
			401,
		);
	}

	// La llave es buena: recién ACÁ la petición puede dejar historial. El
	// middleware comodín exige esta marca — filtrar códigos de error no prueba
	// que la autenticación corrió (un 404/405 de Hono ni pasa por acá).
	marcarBotAutenticado(c);

	await next();
}

/**
 * Autenticación del circuito de vuelta (cartera → CRM).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ES OTRA LLAVE, Y NO POR PROLIJIDAD.
 *
 * La del bot la tiene SimpleTech, un tercero, y sirve para *consultar*. Esta
 * dispara **mensajes de WhatsApp a clientes**: quien puede preguntar por un
 * crédito no tiene por qué poder hacer que le escribamos a su dueño diciéndole
 * que su pago fue rechazado.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Va por `x-api-key` y no por `Authorization: Bearer` porque del otro lado está
 * cartera-back, no el motor del bot (§6 del contrato del paso 4).
 */
export async function autenticarCarteraWebhook(
	c: Context,
	next: () => Promise<void>,
) {
	const esperada = process.env.CARTERA_WEBHOOK_API_KEY;

	// Falla cerrado, igual que la del bot.
	if (!esperada) {
		console.error(
			"[BotCobros] CARTERA_WEBHOOK_API_KEY no está configurada; se rechaza el evento",
		);
		return c.json(
			{ success: false, error: { codigo: "SERVICIO_NO_DISPONIBLE" } },
			503,
		);
	}

	const recibida = (c.req.header("x-api-key") ?? "").trim();

	if (!recibida || !sonIguales(recibida, esperada)) {
		console.warn(
			"[BotCobros] Evento de cartera rechazado por API key inválida",
		);
		return c.json({ success: false, error: { codigo: "NO_AUTORIZADO" } }, 401);
	}

	await next();
}
