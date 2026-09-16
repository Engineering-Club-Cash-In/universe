/**
 * Servicio 10 · El cliente pasó a MODO AGENTE (pidió hablar con una persona).
 *
 * POST /api/bot/cobros/conversacion/modo-agente
 *   → { referencia?, telefono?, numeroSifco? }   (referencia o telefono, al menos uno)
 *
 * SimpleTech lo llama cuando su motor pasa la conversación a un agente humano.
 * Nosotros no devolvemos datos del crédito: creamos la alerta `bot_modo_agente`
 * para el asesor dueño de cada crédito de esa persona. Quién es, se resuelve en
 * `lib/bot-cobros/modo-agente.ts`; la alerta, en
 * `services/aviso-bot-modo-agente.ts`.
 *
 * Mismo formato de respuesta que el resto del bot (D-22): `data.mensaje` viene
 * siempre, y el bot rutea por `codigo`.
 */

import type { Context } from "hono";
import { buscarCreditosPorTelefono } from "../lib/bot-cobros/cliente-por-telefono";
import { anotarIdentidadBot } from "../lib/bot-cobros/historial";
import { verificarSesion } from "../lib/bot-cobros/menu-credito";
import { resolverClienteModoAgente } from "../lib/bot-cobros/modo-agente";
import { avisarAsesorModoAgente } from "../services/aviso-bot-modo-agente";

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

// El mismo texto pase lo que pase: al cliente no se le cuenta si tiene asesor
// ni si su número está en el CRM. Y no promete "ya le avisamos": con
// `SIN_ASESOR` o `CLIENTE_NO_IDENTIFICADO` no se avisó a nadie — lo atiende
// quien tome el chat en modo agente.
const MENSAJE_AL_CLIENTE = "En un momento un asesor te atiende por este chat.";

export async function modoAgenteBotCobros(c: Context) {
	try {
		const body = await c.req.json<{
			referencia?: unknown;
			telefono?: unknown;
			numeroSifco?: unknown;
		}>();

		const resolucion = await resolverClienteModoAgente(
			{
				referencia: String(body.referencia ?? "").trim(),
				telefono: String(body.telefono ?? "").trim(),
				numeroSifco: String(body.numeroSifco ?? "").trim(),
			},
			{ verificarSesion, buscarPorTelefono: buscarCreditosPorTelefono },
		);

		if (resolucion.estado === "error") {
			switch (resolucion.codigo) {
				case "PARAMETROS_INVALIDOS":
					return error(c, {
						codigo: "PARAMETROS_INVALIDOS",
						mensaje: "Faltan datos para avisarle a tu asesor.",
						estado: 400,
					});
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

		if (resolucion.estado === "no_identificado") {
			return c.json({
				success: true,
				data: {
					notificado: false,
					motivo: "CLIENTE_NO_IDENTIFICADO",
					asesoresNotificados: 0,
					identificadoPor: null,
					mensaje: MENSAJE_AL_CLIENTE,
				},
			});
		}

		// Sin referencia, el historial no tiene de qué ficha colgar la
		// interacción: se le pasa la persona que salió del teléfono.
		if (resolucion.identidad) anotarIdentidadBot(c, resolucion.identidad);

		const resultado = await avisarAsesorModoAgente({
			origen: resolucion.origen,
			creditos: resolucion.creditos,
		});

		if (!resultado.ok) {
			return error(c, {
				codigo: "CARTERA_NO_DISPONIBLE",
				mensaje:
					"No pudimos avisarle a tu asesor en este momento. Intenta de nuevo en unos minutos.",
				estado: 503,
			});
		}

		return c.json({
			success: true,
			data: {
				notificado: resultado.motivo !== "SIN_ASESOR",
				motivo: resultado.motivo,
				asesoresNotificados: resultado.asesores,
				identificadoPor: resolucion.origen.tipo,
				mensaje: MENSAJE_AL_CLIENTE,
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
