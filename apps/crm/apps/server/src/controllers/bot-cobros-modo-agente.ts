/**
 * Servicio 10 · El cliente pasó a MODO AGENTE (pidió hablar con una persona).
 *
 * POST /api/bot/cobros/conversacion/modo-agente → { referencia, numeroSifco }
 *
 * SimpleTech lo llama cuando su motor pasa la conversación a un agente humano.
 * Nosotros no devolvemos datos del crédito: creamos la alerta `bot_modo_agente`
 * para el asesor dueño, enlazada a la de "tu cliente escribió" de la misma
 * conversación (ver `services/aviso-bot-modo-agente.ts`).
 *
 * Mismo formato de respuesta que el resto del bot (D-22): `data.mensaje` viene
 * siempre, y el bot rutea por `codigo`.
 */

import type { Context } from "hono";
import { verificarAcceso } from "../lib/bot-cobros/menu-credito";
import { avisarAsesorModoAgente } from "../services/aviso-bot-modo-agente";

/**
 * Cuánto vale la referencia para ESTE servicio: 24 horas, no los 30 minutos
 * del menú.
 *
 * El modo agente llega justo cuando el bot ya no pudo resolver, y eso pasa
 * muchas veces después de una conversación larga o de que el cliente volvió
 * más tarde al chat. Con 30 minutos, el aviso que más importa sería el que
 * más se pierde. Estirarlo acá no abre datos: este servicio no devuelve nada
 * del crédito, solo avisa a su asesor, y sigue exigiendo que la referencia sea
 * de un código canjeado y que el crédito sea de esa persona.
 */
const VIGENCIA_MODO_AGENTE_MINUTOS = 24 * 60;

type RespuestaError = {
	codigo: string;
	mensaje: string;
	estado: 400 | 401 | 404 | 500 | 503;
};

/** Mismo formato de `controllers/bot-cobros.ts`: el mensaje va también en `data`. */
function error(c: Context, { codigo, mensaje, estado }: RespuestaError) {
	return c.json(
		{
			success: false,
			error: { codigo, mensaje },
			data: { mensaje, codigo },
		},
		estado,
	);
}

const MENSAJE_AVISADO =
	"Listo, ya le avisamos a tu asesor. En un momento te atiende por este chat.";
const MENSAJE_SIN_ASESOR = "En un momento un asesor te atiende por este chat.";

export async function modoAgenteBotCobros(c: Context) {
	try {
		const body = await c.req.json<{
			referencia?: unknown;
			numeroSifco?: unknown;
		}>();
		const referencia = String(body.referencia ?? "").trim();
		const numeroSifco = String(body.numeroSifco ?? "").trim();

		if (!referencia || !numeroSifco) {
			return error(c, {
				codigo: "PARAMETROS_INVALIDOS",
				mensaje: "Faltan datos para avisarle a tu asesor.",
				estado: 400,
			});
		}

		// Sin esto, la API key sola alcanzaría para disparar alertas a cualquier
		// asesor con un SIFCO inventado.
		const acceso = await verificarAcceso(
			referencia,
			numeroSifco,
			VIGENCIA_MODO_AGENTE_MINUTOS,
		);
		if (!acceso.ok) {
			switch (acceso.codigo) {
				case "SESION_VENCIDA":
					return error(c, {
						codigo: "SESION_VENCIDA",
						mensaje:
							"Por seguridad tu sesión expiró. Vuelve a identificarte para continuar.",
						estado: 401,
					});
				// Mismo mensaje para "no es tuyo" y "no existe" (ver infoCredito).
				case "CREDITO_NO_ES_DEL_CLIENTE":
					return error(c, {
						codigo: "CREDITO_NO_ENCONTRADO",
						mensaje: "No encontramos ese crédito.",
						estado: 404,
					});
				default:
					return error(c, {
						codigo: "REFERENCIA_INVALIDA",
						mensaje: "No encontramos tu solicitud. Comienza de nuevo.",
						estado: 401,
					});
			}
		}

		const resultado = await avisarAsesorModoAgente({
			// La sesión del historial ES el id del OTP: misma llave con la que
			// se deduplicó el aviso inicial, que es lo que permite enlazarlos.
			sesionId: acceso.identidad.otpId,
			numeroSifco,
		});

		if (!resultado.ok) {
			return error(c, {
				codigo: "CARTERA_NO_DISPONIBLE",
				mensaje:
					"No pudimos avisarle a tu asesor en este momento. Intenta de nuevo en unos minutos.",
				estado: 503,
			});
		}

		const notificado = resultado.motivo !== "SIN_ASESOR";
		return c.json({
			success: true,
			data: {
				notificado,
				motivo: resultado.motivo,
				mensaje: notificado ? MENSAJE_AVISADO : MENSAJE_SIN_ASESOR,
			},
		});
	} catch (err) {
		console.error("[BotCobros] conversacion/modo-agente:", err);
		return error(c, {
			codigo: "ERROR_INTERNO",
			mensaje: "Ocurrió un error. Intenta de nuevo en unos minutos.",
			estado: 500,
		});
	}
}
