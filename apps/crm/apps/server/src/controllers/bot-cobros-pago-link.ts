/**
 * Paso 3 del bot · Pago con link de Págalo (CB-105).
 *
 * Contrato: docs/features/bot-whatsapp-cobros/07-pago-con-link.md (§4)
 *
 * Servicio 7 · POST /api/bot/cobros/pago-link/opciones → cuántas cuotas puede pagar
 * Servicio 8 · POST /api/bot/cobros/pago-link/crear    → arma el grupo y devuelve los links
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⏳ ESTADO: CONTRATO PUBLICADO, LÓGICA PENDIENTE.
 *
 * Los dos endpoints están montados y documentados en Swagger ANTES de tener
 * lógica, a propósito: SimpleTech necesita el contrato para ir armando el
 * árbol del bot sin esperarnos. Mientras tanto responden `501 NO_IMPLEMENTADO`
 * (nunca un 200 inventado). `CODIGOS_PAGO_LINK` es el catálogo cerrado del
 * contrato y es lo que el candado de `openapi.test.ts` compara contra la spec;
 * al implementar, cada código de acá tiene que salir de un `error(...)` real.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { Context } from "hono";

/**
 * Errores propios del flujo (§4.1 y §4.2 del contrato), además de los de
 * identidad que comparte con el paso 2 (SESION_VENCIDA, REFERENCIA_INVALIDA,
 * CREDITO_NO_ENCONTRADO, CREDITO_SIN_DATOS…).
 */
export const CODIGOS_PAGO_LINK = [
	// /opciones
	{ codigo: "MORA_POR_CONFIRMAR", estado: 409 },
	{ codigo: "CREDITO_NO_PAGABLE_POR_LINK", estado: 409 },
	{ codigo: "SIN_CUOTAS_QUE_PAGAR", estado: 409 },
	{ codigo: "PAGO_PARCIAL_EN_CURSO", estado: 409 },
	// /opciones y /crear
	{ codigo: "PAGO_EN_PROCESO", estado: 409 },
	// /crear
	{ codigo: "MONTO_DESACTUALIZADO", estado: 409 },
	{ codigo: "PAGALO_NO_DISPONIBLE", estado: 502 },
	// mientras no haya lógica
	{ codigo: "NO_IMPLEMENTADO", estado: 501 },
] as const;

function noImplementado(c: Context) {
	const mensaje =
		"El pago con link todavía no está disponible. Puedes subir tu boleta o hablar con tu asesor.";
	return c.json(
		{
			success: false,
			error: { codigo: "NO_IMPLEMENTADO", mensaje },
			data: { mensaje, codigo: "NO_IMPLEMENTADO" },
		},
		501,
	);
}

/** Servicio 7 · Opciones de pago (cuántas cuotas + mora). Pendiente. */
export async function opcionesPagoLinkBotCobros(c: Context) {
	return noImplementado(c);
}

/** Servicio 8 · Crea el grupo Págalo y devuelve los links. Pendiente. */
export async function crearPagoLinkBotCobros(c: Context) {
	return noImplementado(c);
}
