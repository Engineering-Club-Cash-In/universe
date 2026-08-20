/**
 * Circuito de vuelta · cartera-back le avisa al CRM que conta resolvió un pago.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VIVE APARTE DE `bot-cobros.ts` A PROPÓSITO.
 *
 * Ese archivo tiene los endpoints de **SimpleTech**, y el candado de la
 * documentación (`openapi.test.ts`) exige que cada error suyo esté en el
 * Swagger que ellos consumen. Este endpoint no es de ellos: lo llama cartera,
 * con otra llave, y publicarlo en la spec del bot sería documentarle a un
 * tercero una puerta que no le corresponde.
 *
 * Separarlo mantiene el candado estricto donde tiene que serlo, en vez de
 * agregarle excepciones que después se usan para colar otras cosas.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Contrato: docs/features/bot-whatsapp-cobros/04-validacion-de-boleta.md (§6)
 */

import type { Context } from "hono";
import {
	type EventoPago,
	procesarEventoPago,
} from "../lib/bot-cobros/eventos-pago";

/**
 * Circuito de vuelta · cartera avisa que contabilidad resolvió un pago.
 *
 * ⚠️ **Este endpoint NO es de SimpleTech**: lo llama cartera-back con su propia
 * llave, y por eso no está en el Swagger del bot.
 *
 * **Siempre responde 200**, incluso cuando no notifica nada. Del otro lado, un
 * 4xx se leería como fallo de la validación del pago y llenaría los logs de
 * contabilidad de rojo por el funcionamiento normal: el 99% de los pagos del
 * sistema no salen del bot.
 */
const EVENTOS_VALIDOS: EventoPago[] = [
	"validado",
	"revertido",
	"regresado_a_pendiente",
	"marcado_falso",
];

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
		const evento = String(body.evento ?? "").trim() as EventoPago;

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

		if (!EVENTOS_VALIDOS.includes(evento)) {
			return c.json(
				{
					success: false,
					error: {
						codigo: "EVENTO_DESCONOCIDO",
						mensaje: `Evento no reconocido: ${evento}`,
					},
				},
				400,
			);
		}

		// Una fecha ilegible NO se rechaza: es parte de la llave de idempotencia,
		// así que perder el evento por eso sería peor que datarlo ahora. Se anota
		// con la hora de llegada, que es lo más cercano a la verdad que tenemos.
		const ocurrido = new Date(String(body.ocurridoEn ?? ""));
		const ocurridoEn = Number.isNaN(ocurrido.getTime())
			? new Date().toISOString()
			: ocurrido.toISOString();

		const resultado = await procesarEventoPago({
			pagoId,
			creditoId: body.creditoId === undefined ? null : Number(body.creditoId),
			numeroSifco:
				body.numeroSifco === undefined ? null : String(body.numeroSifco),
			evento,
			motivo: body.motivo === undefined ? null : String(body.motivo),
			usuario: body.usuario === undefined ? null : String(body.usuario),
			ocurridoEn,
		});

		return c.json({ success: true, data: resultado });
	} catch (err) {
		console.error("[BotCobros] evento-pago:", err);
		// Tampoco acá se devuelve 5xx a la ligera: cartera reintentaría o lo
		// marcaría como fallo de una acción que del lado de ellos salió bien.
		return c.json(
			{
				success: true,
				data: { notificado: false, motivo: "ERROR_INTERNO" },
			},
			200,
		);
	}
}
