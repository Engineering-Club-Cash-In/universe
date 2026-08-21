/**
 * Circuito de vuelta · cartera le avisa al CRM que conta RECHAZÓ una boleta.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VIVE APARTE DE `bot-cobros.ts` A PROPÓSITO.
 *
 * Ese archivo tiene los endpoints de **SimpleTech**, y el candado de la
 * documentación (`openapi.test.ts`) exige que cada error suyo esté en el
 * Swagger que ellos consumen. Este endpoint no es de ellos: lo llama cartera,
 * con otra llave, y publicarlo en la spec del bot sería documentarle a un
 * tercero una puerta que no le corresponde.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Solo existe UN evento: `rechazado`, el del botón "Pago no válido" de conta
 * (D-39). Ni validaciones, ni reversos internos, ni nada más: la intención se
 * declara, no se adivina.
 *
 * Contrato: docs/features/bot-whatsapp-cobros/04-validacion-de-boleta.md (§6)
 */

import type { Context } from "hono";
import { procesarRechazoPago } from "../lib/bot-cobros/eventos-pago";

export async function eventoPagoBotCobros(c: Context) {
	try {
		const body = await c.req.json<{
			pagoId?: unknown;
			creditoId?: unknown;
			numeroSifco?: unknown;
			evento?: unknown;
			motivo?: unknown;
			usuario?: unknown;
			ocurridoEn?: unknown;
		}>();

		const pagoId = Number(body.pagoId);
		const evento = String(body.evento ?? "").trim();

		if (!Number.isInteger(pagoId) || pagoId <= 0) {
			return c.json(
				{
					success: false,
					error: {
						codigo: "PARAMETROS_INVALIDOS",
						mensaje: "pagoId inválido.",
					},
				},
				400,
			);
		}

		// El único evento del circuito. Cualquier otro es un llamador
		// desactualizado, y ESO sí es un error que cartera tiene que ver.
		if (evento !== "rechazado") {
			return c.json(
				{
					success: false,
					error: {
						codigo: "EVENTO_DESCONOCIDO",
						mensaje: `Evento no reconocido: ${evento}. El único evento del circuito es 'rechazado' (D-39).`,
					},
				},
				400,
			);
		}

		const ocurridoEn = String(body.ocurridoEn ?? "").trim();

		const resultado = await procesarRechazoPago({
			pagoId,
			creditoId: Number.isInteger(Number(body.creditoId))
				? Number(body.creditoId)
				: null,
			numeroSifco: body.numeroSifco ? String(body.numeroSifco) : null,
			motivo: body.motivo ? String(body.motivo) : null,
			usuario: body.usuario ? String(body.usuario) : null,
			ocurridoEn: Number.isNaN(Date.parse(ocurridoEn))
				? new Date().toISOString()
				: ocurridoEn,
		});

		// Siempre 200 con el detalle adentro: cartera muestra en pantalla si el
		// cliente quedó avisado, y un `SIN_TELEFONO` no es un fallo del request.
		return c.json({
			success: true,
			notificado: resultado.notificado,
			motivo: resultado.motivo,
		});
	} catch (error) {
		console.error("[BotCobrosEventos] evento de cartera:", error);
		return c.json(
			{
				success: false,
				error: { codigo: "ERROR_INTERNO", mensaje: "No se pudo procesar." },
			},
			500,
		);
	}
}
