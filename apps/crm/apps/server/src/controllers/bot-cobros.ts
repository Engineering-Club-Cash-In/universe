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
	aplanarCreditos,
	buscarCliente,
	listarCreditosDeCliente,
} from "../lib/bot-cobros/buscar-cliente";
import {
	elegirTelefonoParaOtp,
	telefonoEstaRegistrado,
} from "../lib/bot-cobros/identificadores";
import {
	obtenerEstadoDeCuenta,
	obtenerInfoCredito,
} from "../lib/bot-cobros/menu-credito";
import { enviarOtp, validarOtp } from "../lib/bot-cobros/otp";

type RespuestaError = {
	codigo: string;
	mensaje: string;
	estado: 400 | 401 | 404 | 429 | 500 | 503;
};

/**
 * Respuesta de error.
 *
 * El mensaje va **dos veces**: en `error.mensaje` y dentro de `data`. No es
 * redundancia por descuido — el motor de SimpleTech lee siempre una variable
 * `$data`, y cuando la respuesta no la trae se queda sin nada que mostrarle al
 * cliente. Con esto, cualquier error tiene un texto listo para el chat sin que
 * el bot tenga que ramificar por `success`.
 *
 * `data` extra (por ejemplo `reintentarEnSegundos`) se pasa en `datos` y se
 * mezcla; el `mensaje` siempre está.
 */
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

		// Va como 404 y no como 200: el bot rutea los fallos por el estado HTTP, y
		// con un 200 tenía que mirar además el cuerpo para darse cuenta de que no
		// había cliente (lo pidió SimpleTech).
		//
		// El código es el MISMO tanto si el dato no existe como si existe pero no
		// tiene crédito: distinguirlos convertiría el endpoint en un detector de
		// clientes de Cash In para quien tenga la llave.
		if (resultado.estado === "no_encontrado") {
			return error(
				c,
				{
					codigo: "CLIENTE_NO_ENCONTRADO",
					mensaje:
						"No encontramos un crédito con ese dato. Revisa tu NIT, DPI o número de placa.",
					estado: 404,
				},
				// `encontrado` se mantiene del contrato original, para no romper si el
				// bot ya lo leía.
				{ encontrado: false },
			);
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
				return error(
					c,
					{
						codigo: "DEMASIADOS_ENVIOS",
						mensaje:
							"Ya te enviamos un código hace poco. Espera un momento antes de pedir otro.",
						estado: 429,
					},
					{ reintentarEnSegundos: envio.reintentarEnSegundos },
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
				// Solo en dev: true = no salió SMS y el código es el fijo de pruebas.
				// En producción siempre false.
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
 * Servicio 3 · Info del crédito que el cliente eligió (paso 2, menú).
 *
 * Recibe la MISMA referencia del paso 1: es lo que prueba que quien pregunta ya
 * validó su código y que el crédito es suyo. Ver `obtenerInfoCredito`, donde
 * está el control de acceso.
 */
export async function infoCreditoBotCobros(c: Context) {
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
				mensaje: "Faltan datos para consultar el crédito.",
				estado: 400,
			});
		}

		const resultado = await obtenerInfoCredito(referencia, numeroSifco);

		if (!resultado.ok) {
			switch (resultado.codigo) {
				case "SESION_VENCIDA":
					return error(c, {
						codigo: "SESION_VENCIDA",
						mensaje:
							"Por seguridad tu sesión expiró. Vuelve a identificarte para continuar.",
						estado: 401,
					});
				// Mismo mensaje para "no es tuyo" y "no existe": distinguirlos
				// permitiría averiguar qué créditos existen probando números.
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
				// Problema NUESTRO, no del cliente ni de su crédito: cartera no
				// contestó. Va 503 y no 500 para que el bot lo trate como algo
				// transitorio y le diga que vuelva a intentar, en vez de mandarlo a
				// soporte por una caída que dura cinco minutos.
				case "CARTERA_NO_DISPONIBLE":
					return error(c, {
						codigo: "CARTERA_NO_DISPONIBLE",
						mensaje:
							"No pudimos consultar tu crédito en este momento. Intenta de nuevo en unos minutos.",
						estado: 503,
					});
				default:
					return error(c, {
						codigo: "REFERENCIA_INVALIDA",
						mensaje: "No encontramos tu solicitud. Comienza de nuevo.",
						estado: 401,
					});
			}
		}

		return c.json({ success: true, data: { credito: resultado.info } });
	} catch (err) {
		console.error("[BotCobros] info-credito:", err);
		return error(c, {
			codigo: "ERROR_INTERNO",
			mensaje: "Ocurrió un error. Intenta de nuevo en unos minutos.",
			estado: 500,
		});
	}
}

/**
 * Servicio 4 · Estado de cuenta del crédito (paso 2, menú).
 *
 * Solo hace de puente: el PDF lo genera cartera, el mismo que descarga el botón
 * de carteraFront. Acá se comprueba que el crédito sea de quien lo pide.
 */
export async function estadoDeCuentaBotCobros(c: Context) {
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
				mensaje: "Faltan datos para generar el estado de cuenta.",
				estado: 400,
			});
		}

		const resultado = await obtenerEstadoDeCuenta(referencia, numeroSifco);

		if (!resultado.ok) {
			switch (resultado.codigo) {
				case "SESION_VENCIDA":
					return error(c, {
						codigo: "SESION_VENCIDA",
						mensaje:
							"Por seguridad tu sesión expiró. Vuelve a identificarte para continuar.",
						estado: 401,
					});
				case "CREDITO_NO_ES_DEL_CLIENTE":
					return error(c, {
						codigo: "CREDITO_NO_ENCONTRADO",
						mensaje: "No encontramos ese crédito.",
						estado: 404,
					});
				case "SIN_ESTADO_DE_CUENTA":
					return error(c, {
						codigo: "SIN_ESTADO_DE_CUENTA",
						mensaje:
							"Todavía no hay movimientos para generar tu estado de cuenta.",
						estado: 404,
					});
				// Distinto del anterior: acá no es que no haya movimientos, es que
				// no tenemos los datos del crédito. Al cliente se le manda a soporte
				// en vez de decirle que su crédito está vacío.
				case "CREDITO_SIN_DATOS":
					return error(c, {
						codigo: "CREDITO_SIN_DATOS",
						mensaje:
							"No pudimos consultar la información de ese crédito. Por favor contacta a soporte.",
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

		return c.json({
			success: true,
			data: { url: resultado.url, formato: "pdf" },
		});
	} catch (err) {
		console.error("[BotCobros] estado-cuenta:", err);
		return error(c, {
			codigo: "ERROR_INTERNO",
			mensaje:
				"No pudimos generar tu estado de cuenta en este momento. Intenta de nuevo en unos minutos.",
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
					return error(
						c,
						{
							codigo: "OTP_INVALIDO",
							mensaje: "El código no es correcto.",
							estado: 401,
						},
						{ intentosRestantes: validacion.intentosRestantes },
					);
			}
		}

		const lista = creditos ?? [];

		// El código era bueno pero no hay nada que mostrar. Se responde error por lo
		// mismo que arriba: que el bot no tenga que revisar si el arreglo vino
		// vacío. Pasa poco —el servicio 1 solo encuentra a quien tiene crédito—,
		// pero puede darse si el crédito cambia de estado entre una llamada y otra.
		if (lista.length === 0) {
			return error(c, {
				codigo: "SIN_CREDITOS",
				mensaje:
					"No encontramos créditos activos a tu nombre. Por favor contacta a soporte.",
				estado: 404,
			});
		}

		// Además del arreglo van las etiquetas numeradas y su SIFCO al lado: el
		// motor del bot no recorre arreglos, arma el menú con una plantilla por
		// cantidad de opciones.
		return c.json({ success: true, data: aplanarCreditos(lista) });
	} catch (err) {
		console.error("[BotCobros] creditos:", err);
		return error(c, {
			codigo: "ERROR_INTERNO",
			mensaje: "Ocurrió un error. Intenta de nuevo en unos minutos.",
			estado: 500,
		});
	}
}
