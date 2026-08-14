/**
 * Endpoints que consume el bot de WhatsApp de cobros (SimpleTech).
 *
 * Contratos y decisiones:
 * docs/features/bot-whatsapp-cobros/01-identificacion-y-acceso.md
 *
 * Servicio 1 · POST /api/bot/cobros/buscar-cliente → identifica y manda el OTP
 * Servicio 2 · POST /api/bot/cobros/creditos      → valida el OTP y lista créditos
 *
 * Todas las respuestas siguen el mismo formato:
 *   éxito → { success: true, data: {...} }
 *   error → { success: false, error: { codigo, mensaje } }
 * El bot rutea por `codigo`, nunca por el texto.
 */

import type { Context } from "hono";
import { db } from "../db";
import {
	buscarCliente,
	listarCreditosDeCliente,
} from "../lib/bot-cobros/buscar-cliente";
import {
	elegirTelefonoParaOtp,
	telefonoEstaRegistrado,
} from "../lib/bot-cobros/identificadores";
import {
	enviarOtp,
	obtenerCodigoDePrueba,
	validarOtp,
} from "../lib/bot-cobros/otp";

type RespuestaError = {
	codigo: string;
	mensaje: string;
	estado: 400 | 401 | 403 | 404 | 429 | 500 | 503;
};

function error(c: Context, { codigo, mensaje, estado }: RespuestaError) {
	return c.json({ success: false, error: { codigo, mensaje } }, estado);
}

/**
 * Servicio 1 · Busca al cliente por NIT, DPI o placa y le manda el código.
 *
 * El OTP se envía siempre (D-03); `celEnCrm` es solo información para el bot.
 */
export async function buscarClienteBotCobros(c: Context) {
	try {
		const body = await c.req.json<{ search?: unknown; telefono?: unknown }>();

		const search = String(body.search ?? "").trim();
		const telefonoChat = String(body.telefono ?? "").trim();

		if (!search) {
			return error(c, {
				codigo: "PARAMETROS_INVALIDOS",
				mensaje: "Falta el dato de búsqueda (NIT, DPI o placa).",
				estado: 400,
			});
		}

		const resultado = await buscarCliente(search);

		if (resultado.estado === "dato_invalido") {
			return error(c, {
				codigo: "BUSQUEDA_INVALIDA",
				mensaje:
					"No pudimos leer ese dato. Envíanos tu NIT, DPI o número de placa.",
				estado: 400,
			});
		}

		if (resultado.estado === "ambiguo") {
			return error(c, {
				codigo: "PLACA_AMBIGUA",
				mensaje:
					"Encontramos más de un vehículo con esa placa. Por favor envíala completa, incluyendo la letra inicial.",
				estado: 400,
			});
		}

		// Respuesta genérica: no se revela si el dato existe pero no tiene crédito.
		if (resultado.estado === "no_encontrado") {
			return c.json({ success: true, data: { encontrado: false } });
		}

		const { cliente, tipoBusqueda } = resultado;

		const telefonoDestino = elegirTelefonoParaOtp(cliente.telefonos);

		if (!telefonoDestino) {
			return error(c, {
				codigo: "SIN_TELEFONO_REGISTRADO",
				mensaje:
					"No tenemos un número de celular registrado para enviarte el código. Por favor contacta a soporte.",
				estado: 400,
			});
		}

		const envio = await enviarOtp({
			leadId: cliente.tipo === "titular" ? cliente.leadId : null,
			coDebtorId: cliente.coDebtorId,
			dpi: cliente.dpi,
			telefono8: telefonoDestino,
		});

		if (!envio.enviado) {
			if (envio.codigo === "DEMASIADOS_ENVIOS") {
				return c.json(
					{
						success: false,
						error: {
							codigo: "DEMASIADOS_ENVIOS",
							mensaje:
								"Ya te enviamos un código hace poco. Espera un momento antes de pedir otro.",
						},
						data: { reintentarEnSegundos: envio.reintentarEnSegundos },
					},
					429,
				);
			}

			return error(c, {
				codigo: "OTP_NO_ENVIADO",
				mensaje:
					"No pudimos enviarte el código en este momento. Intenta de nuevo en unos minutos.",
				estado: 500,
			});
		}

		return c.json({
			success: true,
			data: {
				encontrado: true,
				celEnCrm: telefonoEstaRegistrado(telefonoChat, cliente.telefonos),
				otpEnviado: true,
				// Solo en dev: true = no salió SMS y el código se consulta en
				// /api/bot/cobros/pruebas/otp. En producción siempre false.
				otpSimulado: envio.simulado,
				// El bot guarda esta referencia y la devuelve en el servicio 2:
				// ata el código a esta persona.
				referencia: envio.referencia,
				otpEnviadoA: envio.enviadoA,
				otpExpiraEnSegundos: envio.expiraEnSegundos,
				cliente: { nombreCompleto: cliente.nombreCompleto },
				tipoBusqueda,
			},
		});
	} catch (err) {
		console.error("[BotCobros] buscar-cliente:", err);
		return error(c, {
			codigo: "ERROR_INTERNO",
			mensaje: "Ocurrió un error. Intenta de nuevo en unos minutos.",
			estado: 500,
		});
	}
}

/**
 * Servicio 2 · Valida el código y devuelve los créditos del cliente.
 *
 * Hace las dos cosas en una sola llamada: si el código no sirve, se responde el
 * error y no se lista nada. La identidad sale de la fila del OTP —quedó
 * guardada al emitirlo—, así que no se vuelve a buscar por `search`.
 */
export async function listarCreditosBotCobros(c: Context) {
	try {
		const body = await c.req.json<{
			referencia?: unknown;
			otp?: unknown;
		}>();

		const referencia = String(body.referencia ?? "").trim();
		const codigo = String(body.otp ?? "").trim();

		if (!referencia || !codigo) {
			return error(c, {
				codigo: "PARAMETROS_INVALIDOS",
				mensaje: "Faltan datos para validar el código.",
				estado: 400,
			});
		}

		// Validar y listar van en la MISMA transacción, con la fila del OTP
		// bloqueada:
		//   · Dos peticiones simultáneas no pueden pisarse el contador de
		//     intentos y saltarse el tope de 3.
		//   · Si el listado falla, se revierte también el "código usado", así el
		//     cliente puede reintentar sin pedir otro SMS.
		const resultado = await db.transaction(async (tx) => {
			const validacion = await validarOtp(referencia, codigo, tx);

			if (!validacion.valido) {
				// Se retorna (no se lanza) para que el intento fallido sí quede
				// contado al hacer commit.
				return { validacion, creditos: null };
			}

			const creditos = await listarCreditosDeCliente(validacion.identidad, tx);
			return { validacion, creditos };
		});

		const { validacion, creditos } = resultado;

		if (!validacion.valido) {
			switch (validacion.codigo) {
				case "OTP_VENCIDO":
					return error(c, {
						codigo: "OTP_VENCIDO",
						mensaje: "Tu código venció. Solicita uno nuevo.",
						estado: 401,
					});
				case "OTP_YA_USADO":
					return error(c, {
						codigo: "OTP_YA_USADO",
						mensaje: "Ese código ya fue utilizado. Solicita uno nuevo.",
						estado: 401,
					});
				case "DEMASIADOS_INTENTOS":
					return error(c, {
						codigo: "DEMASIADOS_INTENTOS",
						mensaje:
							"Alcanzaste el máximo de intentos. Solicita un código nuevo.",
						estado: 429,
					});
				case "REFERENCIA_INVALIDA":
					return error(c, {
						codigo: "REFERENCIA_INVALIDA",
						mensaje: "No encontramos tu solicitud. Comienza de nuevo.",
						estado: 401,
					});
				default:
					return c.json(
						{
							success: false,
							error: {
								codigo: "OTP_INVALIDO",
								mensaje: "El código no es correcto.",
							},
							data: { intentosRestantes: validacion.intentosRestantes },
						},
						401,
					);
			}
		}

		return c.json({ success: true, data: { creditos: creditos ?? [] } });
	} catch (err) {
		console.error("[BotCobros] creditos:", err);
		return error(c, {
			codigo: "ERROR_INTERNO",
			mensaje: "Ocurrió un error. Intenta de nuevo en unos minutos.",
			estado: 500,
		});
	}
}

/**
 * Solo dev · Devuelve el código de un OTP para poder probar sin recibir el SMS.
 *
 * El proveedor de SMS solo acepta peticiones desde IPs en su whitelist y la de
 * esta instancia no está, así que el envío muere en timeout. Con
 * `BOT_COBROS_OTP_SIMULADO` prendida no se manda SMS y el código se pide acá,
 * simulando que llegó.
 *
 * Responde 404 con la env apagada: en producción este endpoint no existe.
 * Ver `obtenerCodigoDePrueba` para los candados.
 */
export async function otpDePruebaBotCobros(c: Context) {
	try {
		const body = await c.req.json<{ referencia?: unknown }>();
		const referencia = String(body.referencia ?? "").trim();

		const resultado = await obtenerCodigoDePrueba(referencia);

		if (!resultado.disponible) {
			switch (resultado.codigo) {
				case "PRUEBAS_NO_HABILITADAS":
					return error(c, {
						codigo: "NO_ENCONTRADO",
						mensaje: "Recurso no encontrado.",
						estado: 404,
					});
				case "NO_ES_CLIENTE_DE_PRUEBA":
					return error(c, {
						codigo: "NO_ES_CLIENTE_DE_PRUEBA",
						mensaje:
							"Esa referencia no es de un cliente de prueba. Solo se puede consultar el código de los clientes ficticios sembrados para el equipo.",
						estado: 403,
					});
				default:
					return error(c, {
						codigo: "REFERENCIA_INVALIDA",
						mensaje: "No encontramos esa solicitud de código.",
						estado: 404,
					});
			}
		}

		return c.json({
			success: true,
			data: {
				otp: resultado.codigo,
				usado: resultado.usado,
				intentosFallidos: resultado.intentosFallidos,
				expiraEnSegundos: resultado.expiraEnSegundos,
			},
		});
	} catch (err) {
		console.error("[BotCobros] pruebas/otp:", err);
		return error(c, {
			codigo: "ERROR_INTERNO",
			mensaje: "Ocurrió un error. Intenta de nuevo en unos minutos.",
			estado: 500,
		});
	}
}
