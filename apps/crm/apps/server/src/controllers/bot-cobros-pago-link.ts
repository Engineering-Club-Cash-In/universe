/**
 * Paso 3 del bot · Pago con link de Págalo (CB-105).
 *
 * Contrato: docs/features/bot-whatsapp-cobros/07-pago-con-link.md (§4)
 *
 * Servicio 7 · POST /api/bot/cobros/pago-link/opciones → cuántas cuotas puede pagar
 * Servicio 8 · POST /api/bot/cobros/pago-link/crear    → arma el grupo y devuelve los links
 *
 * Los handlers solo traducen el resultado de `lib/bot-cobros/pago-link.ts` al
 * formato del bot (D-22: todo lo que no termina en dato sale con estado HTTP
 * de error, `data` siempre viene con `mensaje`). La lógica vive allá.
 *
 * Alcance de este slice: generar los links y dejarlos en el circuito CB-028.
 * El pago lo detecta el poller y lo aplica cartera (D-49/D-50); esa parte se
 * integra aparte.
 */

import type { Context } from "hono";
import {
	crearPagoLink,
	obtenerOpcionesPagoLink,
} from "../lib/bot-cobros/pago-link";

type RespuestaError = {
	codigo: string;
	mensaje: string;
	estado: 400 | 401 | 404 | 409 | 500 | 502 | 503;
};

/** Mismo formato de `controllers/bot-cobros.ts`: el mensaje va también en `data`. */
function error(
	c: Context,
	{ codigo, mensaje, estado }: RespuestaError,
	datos: Record<string, unknown> = {},
) {
	return c.json(
		{
			success: false,
			error: { codigo, mensaje },
			data: { mensaje, codigo, ...datos },
		},
		estado,
	);
}

/**
 * Los errores que comparten los dos servicios: identidad del paso 2 (D-24),
 * cartera, y los candados del flujo (§4.1). Devuelve `null` si el código no
 * es de esta tabla.
 */
function errorComun(
	c: Context,
	codigo: string,
	datos: Record<string, unknown> = {},
) {
	// El mensaje específico (qué grupo está en proceso, qué link falta) lo arma
	// la lib; acá solo se pone el genérico si no vino.
	const mensajeDe = (porDefecto: string) =>
		typeof datos.mensaje === "string" && datos.mensaje
			? datos.mensaje
			: porDefecto;
	const { mensaje: _m, ...extra } = datos;

	switch (codigo) {
		case "SESION_VENCIDA":
			return error(c, {
				codigo: "SESION_VENCIDA",
				mensaje:
					"Por seguridad tu sesión expiró. Vuelve a identificarte para continuar.",
				estado: 401,
			});
		case "REFERENCIA_INVALIDA":
			return error(c, {
				codigo: "REFERENCIA_INVALIDA",
				mensaje: "No encontramos tu solicitud. Comienza de nuevo.",
				estado: 401,
			});
		case "CREDITO_NO_ES_DEL_CLIENTE":
			return error(c, {
				codigo: "CREDITO_NO_ENCONTRADO",
				mensaje: "No encontramos ese crédito.",
				estado: 404,
			});
		case "CREDITO_SIN_DATOS":
			return error(c, {
				codigo: "CREDITO_SIN_DATOS",
				mensaje:
					"No pudimos consultar la información de ese crédito. Por favor contacta a soporte.",
				estado: 404,
			});
		case "CARTERA_NO_DISPONIBLE":
			return error(c, {
				codigo: "CARTERA_NO_DISPONIBLE",
				mensaje:
					"No pudimos consultar tu crédito en este momento. Intenta de nuevo en unos minutos.",
				estado: 503,
			});
		case "MORA_POR_CONFIRMAR":
			return error(c, {
				codigo: "MORA_POR_CONFIRMAR",
				mensaje:
					"Estamos confirmando el monto de tu mora. Tu asesor te va a indicar cuánto pagar.",
				estado: 409,
			});
		case "CREDITO_NO_PAGABLE_POR_LINK":
			return error(c, {
				codigo: "CREDITO_NO_PAGABLE_POR_LINK",
				mensaje:
					"Este crédito no puede pagarse con link. Tu asesor te va a ayudar.",
				estado: 409,
			});
		case "SIN_CUOTAS_QUE_PAGAR":
			return error(c, {
				codigo: "SIN_CUOTAS_QUE_PAGAR",
				mensaje: "No tenés cuotas pendientes de pago por ahora.",
				estado: 409,
			});
		case "PAGO_EN_PROCESO":
			return error(
				c,
				{
					codigo: "PAGO_EN_PROCESO",
					mensaje: mensajeDe(
						"Ya tenés un pago en proceso. En cuanto se confirme te mandamos tu recibo.",
					),
					estado: 409,
				},
				extra,
			);
		case "PAGO_PARCIAL_EN_CURSO":
			return error(
				c,
				{
					codigo: "PAGO_PARCIAL_EN_CURSO",
					mensaje: mensajeDe(
						"Ya recibimos una parte de tu pago. Te falta completar el resto.",
					),
					estado: 409,
				},
				extra,
			);
		default:
			return null;
	}
}

/** Servicio 7 · Opciones de pago (cuántas cuotas + mora). */
export async function opcionesPagoLinkBotCobros(c: Context) {
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
				mensaje: "Faltan datos para armar tu pago.",
				estado: 400,
			});
		}

		const resultado = await obtenerOpcionesPagoLink(referencia, numeroSifco);
		if (!resultado.ok) {
			return (
				errorComun(c, resultado.codigo, resultado.datos) ??
				error(c, {
					codigo: "REFERENCIA_INVALIDA",
					mensaje: "No encontramos tu solicitud. Comienza de nuevo.",
					estado: 401,
				})
			);
		}
		return c.json({ success: true, data: resultado.data });
	} catch (err) {
		console.error("[BotCobros] pago-link/opciones:", err);
		return error(c, {
			codigo: "ERROR_INTERNO",
			mensaje: "Ocurrió un error. Intenta de nuevo en unos minutos.",
			estado: 500,
		});
	}
}

/** Servicio 8 · Crea el grupo Págalo y devuelve los links. */
export async function crearPagoLinkBotCobros(c: Context) {
	try {
		const body = await c.req.json<{
			referencia?: unknown;
			numeroSifco?: unknown;
			monto?: unknown;
		}>();
		const referencia = String(body.referencia ?? "").trim();
		const numeroSifco = String(body.numeroSifco ?? "").trim();
		const monto = body.monto;
		if (
			!referencia ||
			!numeroSifco ||
			monto === undefined ||
			monto === null ||
			monto === ""
		) {
			return error(c, {
				codigo: "PARAMETROS_INVALIDOS",
				mensaje: "Faltan datos para armar tu pago.",
				estado: 400,
			});
		}

		const resultado = await crearPagoLink(referencia, numeroSifco, monto);
		if (!resultado.ok) {
			switch (resultado.codigo) {
				case "MONTO_DESACTUALIZADO":
					return error(c, {
						codigo: "MONTO_DESACTUALIZADO",
						mensaje:
							"El monto de tu pago cambió. Te muestro las opciones actualizadas.",
						estado: 409,
					});
				case "PAGALO_NO_DISPONIBLE":
					return error(c, {
						codigo: "PAGALO_NO_DISPONIBLE",
						mensaje:
							"No pudimos generar tu link de pago en este momento. Intenta más tarde o sube tu boleta.",
						estado: 502,
					});
				default:
					return (
						errorComun(c, resultado.codigo, resultado.datos) ??
						error(c, {
							codigo: "REFERENCIA_INVALIDA",
							mensaje: "No encontramos tu solicitud. Comienza de nuevo.",
							estado: 401,
						})
					);
			}
		}
		return c.json({ success: true, data: resultado.data });
	} catch (err) {
		console.error("[BotCobros] pago-link/crear:", err);
		return error(c, {
			codigo: "ERROR_INTERNO",
			mensaje: "Ocurrió un error. Intenta de nuevo en unos minutos.",
			estado: 500,
		});
	}
}
