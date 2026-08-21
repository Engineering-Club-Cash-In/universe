/**
 * Documentación OpenAPI de los endpoints del bot de cobros.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔒 REGLA: TODO CAMBIO EN LOS ENDPOINTS DEL BOT SE DOCUMENTA ACÁ, EN EL MISMO
 * COMMIT.
 *
 * No es una recomendación: `openapi.test.ts` compara los códigos de error de
 * esta spec contra los que devuelve `controllers/bot-cobros.ts` y el middleware
 * `auth.ts`. Si agregás un error, cambiás un código o sumás un endpoint sin
 * documentarlo, **las pruebas fallan y el pipeline no despliega**.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Por qué escrita a mano y no generada desde schemas (`@hono/zod-openapi`):
 * generarla obligaría a reescribir cómo los handlers parsean el body, y con eso
 * cambiaría el formato de los errores de validación — que es justo lo que
 * SimpleTech ya integró. No se mueve el contrato bajo sus pies por elegancia
 * interna. La prueba de arriba cubre el riesgo de que esto se desincronice.
 *
 * Los ejemplos usan datos REALES de la base de dev (copia de producción), para
 * que quien abra la página pueda ejecutar las llamadas y ver respuestas de
 * verdad. Lo único que no aparece es el código del modo simulado: ese lo tiene
 * el equipo de IT y no se publica (ver `esModoSimulado` en `otp.ts`).
 */

/** Base pública de la instancia de dev del bot. */
const SERVIDOR_DEV = "https://tgmt4r4n8pjjqpi7rjqf5lfb.devteamatcci.site";

const RESPUESTA_ERROR = {
	type: "object",
	required: ["success", "error"],
	properties: {
		success: { type: "boolean", enum: [false] },
		error: {
			type: "object",
			required: ["codigo", "mensaje"],
			properties: {
				codigo: {
					type: "string",
					description:
						"Identificador estable del error. **Ruteá por este campo**, no por el mensaje ni por el estado HTTP: los textos cambian y varios casos comparten estado.",
				},
				mensaje: {
					type: "string",
					description:
						"Texto en español, listo para mostrarle al cliente en el chat.",
				},
			},
		},
		data: {
			type: "object",
			description:
				"**Viene siempre**, también en los errores: trae `mensaje` (el mismo texto de `error.mensaje`, listo para el chat) y `codigo`. Algunos errores agregan datos extra — ver los ejemplos de cada uno.",
			additionalProperties: true,
			properties: {
				mensaje: { type: "string" },
				codigo: { type: "string" },
			},
		},
	},
} as const;

export const especificacionBotCobros = {
	openapi: "3.1.0",
	info: {
		title: "API del bot de cobros",
		version: "1.0.0",
		description: [
			"Endpoints que consume el bot de WhatsApp de cobros (SimpleTech).",
			"",
			"**El CRM es el único punto de acceso:** el bot nunca habla con cartera-back directo.",
			"",
			"## Cómo probar",
			"",
			"1. Tocá **Authorize** (arriba a la derecha) y pegá la API key.",
			"2. Llamá a `/buscar-cliente` con un NIT, DPI o placa.",
			"3. Guardá la `referencia` que devuelve.",
			"4. Llamá a `/creditos` con esa referencia y el código que recibió el cliente.",
			"",
			"## Reglas del contrato",
			"",
			"- **Un `200` significa que hay dato.** Cualquier otra cosa —no encontrado, dato ilegible, código malo— sale con estado HTTP de error y `success: false`.",
			"- **`data` viene siempre, también en los errores**, con un `mensaje` listo para mostrarle al cliente. Así el bot puede leer `data.mensaje` sin ramificar por `success`.",
			"- **Ruteá por el campo `codigo`**, no por el estado HTTP a secas: cuatro casos distintos comparten el 401.",
			"- El código del OTP **nunca viaja** en la respuesta: se valida en el servicio 2.",
			"",
			"> ⏳ En esta instancia de dev el SMS no sale todavía (falta que el proveedor habilite la IP del servidor). El código se genera igual y el equipo de IT sabe cómo obtenerlo.",
		].join("\n"),
	},
	servers: [{ url: SERVIDOR_DEV, description: "Dev (instancia del bot)" }],
	tags: [
		{
			name: "Identificación y acceso",
			description:
				"Paso 1 del bot: identificar al cliente y darle acceso a sus créditos.",
		},
		{
			name: "Menú del crédito",
			description:
				"Paso 2 del bot: la información del crédito que el cliente eligió.",
		},
	],
	components: {
		securitySchemes: {
			apiKey: {
				type: "http",
				scheme: "bearer",
				description:
					"La API key de SimpleTech, en `Authorization: Bearer <llave>`. Identifica al integrador, no al cliente final.",
			},
		},
		schemas: { RespuestaError: RESPUESTA_ERROR },
	},
	security: [{ apiKey: [] }],
	paths: {
		"/api/bot/cobros/buscar-cliente": {
			post: {
				tags: ["Identificación y acceso"],
				summary: "Servicio 1 · Buscar al cliente y enviarle el código",
				description: [
					"Recibe un dato de búsqueda **sin decir de qué tipo es**: el CRM deduce si es DPI, NIT o placa.",
					"",
					"| Tipo | Cómo se reconoce |",
					"| --- | --- |",
					"| **DPI** | 13 dígitos, con CUI válido. Se busca en clientes **y en codeudores** |",
					"| **Placa** | Contiene letras (`P-247JYT`, `p 247 jyt`, `247JYT` — las tres funcionan) |",
					"| **NIT** | Solo dígitos, y no son 13 |",
					"",
					"**El código se envía siempre**, coincida o no el teléfono desde el que escribe el cliente; lo que cambia es a dónde se manda. Si el dato resultó ser de un codeudor, va al teléfono del codeudor.",
					"",
					"Límites: **60 segundos** entre códigos y **5 por hora** por persona. Cada código nuevo invalida los anteriores.",
				].join("\n"),
				operationId: "buscarCliente",
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["search"],
								properties: {
									search: {
										type: "string",
										description: "NIT, DPI o placa. Sin indicar cuál es.",
									},
									telefono: {
										type: "string",
										description:
											"Número desde el que escribe el cliente. Solo sirve para responder `celEnCrm`; no cambia si se manda el código.",
									},
								},
							},
							examples: {
								porDpi: {
									summary: "Por DPI",
									value: { search: "2266849380101", telefono: "50255551234" },
								},
								porPlaca: {
									summary: "Por placa",
									value: { search: "P-247JYT", telefono: "50255551234" },
								},
								porNit: {
									summary: "Por NIT",
									value: { search: "39131297", telefono: "50255551234" },
								},
							},
						},
					},
				},
				responses: {
					"200": {
						description: "Cliente encontrado y código enviado.",
						content: {
							"application/json": {
								example: {
									success: true,
									data: {
										encontrado: true,
										celEnCrm: false,
										otpEnviado: true,
										otpSimulado: true,
										referencia: "3b530493-eff1-492d-8394-26adf5b5e211",
										otpEnviadoA: "****4315",
										otpExpiraEnSegundos: 300,
										cliente: { nombreCompleto: "María Medrano" },
										tipoBusqueda: "dpi",
									},
								},
							},
						},
					},
					"400": {
						description:
							"El dato no sirve para buscar, o el cliente no tiene a dónde recibir el código.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								examples: {
									PARAMETROS_INVALIDOS: {
										summary: "Falta `search`",
										value: {
											success: false,
											error: {
												codigo: "PARAMETROS_INVALIDOS",
												mensaje:
													"Falta el dato de búsqueda (NIT, DPI o placa).",
											},
										},
									},
									BUSQUEDA_INVALIDA: {
										summary: 'No parece DPI, NIT ni placa (ej. "hola")',
										value: {
											success: false,
											error: {
												codigo: "BUSQUEDA_INVALIDA",
												mensaje:
													"No pudimos leer ese dato. Envíanos tu NIT, DPI o número de placa.",
											},
										},
									},
									PLACA_AMBIGUA: {
										summary: "La placa da con más de un vehículo",
										value: {
											success: false,
											error: {
												codigo: "PLACA_AMBIGUA",
												mensaje:
													"Encontramos más de un vehículo con esa placa. Por favor envíala completa, incluyendo la letra inicial.",
											},
										},
									},
									SIN_TELEFONO_REGISTRADO: {
										summary:
											"Es cliente, pero no tiene móvil registrado (~12% de la cartera)",
										value: {
											success: false,
											error: {
												codigo: "SIN_TELEFONO_REGISTRADO",
												mensaje:
													"No tenemos un número de celular registrado para enviarte el código. Por favor contacta a soporte.",
											},
										},
									},
								},
							},
						},
					},
					"401": {
						description: "API key ausente o incorrecta.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								example: {
									success: false,
									error: { codigo: "NO_AUTORIZADO", mensaje: "No autorizado." },
								},
							},
						},
					},
					"404": {
						description: [
							"No hay cliente con ese dato.",
							"",
							"**El código es el mismo** tanto si el dato no existe como si existe pero no tiene crédito: distinguirlos convertiría el endpoint en un detector de clientes de Cash In para quien tenga la llave.",
						].join("\n"),
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								example: {
									success: false,
									error: {
										codigo: "CLIENTE_NO_ENCONTRADO",
										mensaje:
											"No encontramos un crédito con ese dato. Revisa tu NIT, DPI o número de placa.",
									},
									data: { encontrado: false },
								},
							},
						},
					},
					"429": {
						description:
							"Pidió otro código demasiado pronto, o ya lleva 5 en la última hora.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								example: {
									success: false,
									error: {
										codigo: "DEMASIADOS_ENVIOS",
										mensaje:
											"Ya te enviamos un código hace poco. Espera un momento antes de pedir otro.",
									},
									data: { reintentarEnSegundos: 42 },
								},
							},
						},
					},
					"500": {
						description: "El proveedor de SMS falló, o un error inesperado.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								examples: {
									OTP_NO_ENVIADO: {
										summary: "No se pudo mandar el SMS",
										value: {
											success: false,
											error: {
												codigo: "OTP_NO_ENVIADO",
												mensaje:
													"No pudimos enviarte el código en este momento. Intenta de nuevo en unos minutos.",
											},
										},
									},
									ERROR_INTERNO: {
										summary: "Cualquier otra cosa",
										value: {
											success: false,
											error: {
												codigo: "ERROR_INTERNO",
												mensaje:
													"Ocurrió un error. Intenta de nuevo en unos minutos.",
											},
										},
									},
								},
							},
						},
					},
					"503": {
						description:
							"El servidor no tiene configurada la API key: no se atiende a nadie.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								example: {
									success: false,
									error: {
										codigo: "SERVICIO_NO_DISPONIBLE",
										mensaje: "El servicio no está disponible en este momento.",
									},
								},
							},
						},
					},
				},
			},
		},
		"/api/bot/cobros/creditos": {
			post: {
				tags: ["Identificación y acceso"],
				summary: "Servicio 2 · Validar el código y listar los créditos",
				description: [
					"Hace las dos cosas en una sola llamada: valida el código y, si es correcto, devuelve los créditos. Si no lo es, responde el error y no lista nada.",
					"",
					"**Por qué va la `referencia` y no el dato de búsqueda:** con solo el código de 4 dígitos, alguien con la API key podría probar `0000`…`9999` hasta caer en el código vivo de cualquier cliente. La referencia ata el código a **una** persona.",
					"",
					"El cliente ve **todos los créditos donde aparece**, sea como titular o como codeudor. El campo `etiqueta` viene armado para usarlo tal cual en el menú del chat.",
					"",
					"**Para armar el menú sin recorrer el arreglo:** la misma información va repetida plana dentro de `data`.",
					"",
					"| Campo | Para qué |",
					"| --- | --- |",
					"| `cantidadCreditos` | Cuántas opciones tiene el menú. Si es `1`, no hay nada que preguntar: seguí directo con ese crédito. |",
					"| `etiqueta1` … `etiquetaN` | El texto de cada opción, en orden. |",
					"| `numeroSifco1` … `numeroSifcoN` | El número de crédito de esa misma opción. |",
					"",
					"El número de la clave es la posición en el menú: si el cliente elige la **opción 2**, el crédito que hay que mandar en las llamadas siguientes es el de `numeroSifco2`. El orden es fijo y `creditos` sigue trayendo lo mismo, por si preferís recorrerlo.",
					"",
					"El código **vence a los 5 minutos**, sirve **una sola vez** y se bloquea al **tercer** intento fallido.",
				].join("\n"),
				operationId: "listarCreditos",
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["referencia", "otp"],
								properties: {
									referencia: {
										type: "string",
										format: "uuid",
										description: "La que devolvió el servicio 1.",
									},
									otp: {
										type: "string",
										description: "Los 4 dígitos que escribió el cliente.",
									},
								},
							},
							example: {
								referencia: "3b530493-eff1-492d-8394-26adf5b5e211",
								otp: "5463",
							},
						},
					},
				},
				responses: {
					"200": {
						description: "Código correcto: acá van sus créditos.",
						content: {
							"application/json": {
								example: {
									success: true,
									data: {
										cantidadCreditos: 2,
										etiqueta1: "MAZDA CX-5 GRAND TOURING AWD 2016 · P-247JYT",
										numeroSifco1: "01010214113290",
										etiqueta2: "TOYOTA YARIS 2019 · P-882BFR",
										numeroSifco2: "01010214117590",
										creditos: [
											{
												numeroSifco: "01010214113290",
												etiqueta:
													"MAZDA CX-5 GRAND TOURING AWD 2016 · P-247JYT",
												vehiculo: {
													placa: "P-247JYT",
													marca: "MAZDA",
													modelo: "CX-5 GRAND TOURING AWD",
													anio: 2016,
												},
											},
											{
												numeroSifco: "01010214117590",
												etiqueta: "TOYOTA YARIS 2019 · P-882BFR",
												vehiculo: {
													placa: "P-882BFR",
													marca: "TOYOTA",
													modelo: "YARIS",
													anio: 2019,
												},
											},
										],
									},
								},
							},
						},
					},
					"400": {
						description: "Falta la referencia o el código.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								example: {
									success: false,
									error: {
										codigo: "PARAMETROS_INVALIDOS",
										mensaje: "Faltan datos para validar el código.",
									},
								},
							},
						},
					},
					"401": {
						description:
							"El código no sirve, o la API key es incorrecta. **Cuatro casos distintos comparten este estado: ruteá por `codigo`.**",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								examples: {
									OTP_INVALIDO: {
										summary: "Código incorrecto — trae los intentos que quedan",
										value: {
											success: false,
											error: {
												codigo: "OTP_INVALIDO",
												mensaje: "El código no es correcto.",
											},
											data: { intentosRestantes: 2 },
										},
									},
									OTP_VENCIDO: {
										summary: "Pasaron los 5 minutos",
										value: {
											success: false,
											error: {
												codigo: "OTP_VENCIDO",
												mensaje: "Tu código venció. Solicita uno nuevo.",
											},
										},
									},
									OTP_YA_USADO: {
										summary: "Ese código ya se canjeó",
										value: {
											success: false,
											error: {
												codigo: "OTP_YA_USADO",
												mensaje:
													"Ese código ya fue utilizado. Solicita uno nuevo.",
											},
										},
									},
									REFERENCIA_INVALIDA: {
										summary: "La referencia no existe o no es un uuid",
										value: {
											success: false,
											error: {
												codigo: "REFERENCIA_INVALIDA",
												mensaje:
													"No encontramos tu solicitud. Comienza de nuevo.",
											},
										},
									},
									NO_AUTORIZADO: {
										summary: "API key ausente o incorrecta",
										value: {
											success: false,
											error: {
												codigo: "NO_AUTORIZADO",
												mensaje: "No autorizado.",
											},
										},
									},
								},
							},
						},
					},
					"404": {
						description:
							"El código era bueno pero no quedó ningún crédito que listar. Pasa poco —el servicio 1 solo encuentra a quien tiene crédito— pero puede darse si el crédito cambia de estado entre una llamada y la otra.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								example: {
									success: false,
									error: {
										codigo: "SIN_CREDITOS",
										mensaje:
											"No encontramos créditos activos a tu nombre. Por favor contacta a soporte.",
									},
								},
							},
						},
					},
					"429": {
						description:
							"Tercer código fallido. Hay que volver al servicio 1 por uno nuevo.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								example: {
									success: false,
									error: {
										codigo: "DEMASIADOS_INTENTOS",
										mensaje:
											"Alcanzaste el máximo de intentos. Solicita un código nuevo.",
									},
								},
							},
						},
					},
					"500": {
						description: "Error inesperado.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								example: {
									success: false,
									error: {
										codigo: "ERROR_INTERNO",
										mensaje:
											"Ocurrió un error. Intenta de nuevo en unos minutos.",
									},
								},
							},
						},
					},
					"503": {
						description: "El servidor no tiene configurada la API key.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								example: {
									success: false,
									error: {
										codigo: "SERVICIO_NO_DISPONIBLE",
										mensaje: "El servicio no está disponible en este momento.",
									},
								},
							},
						},
					},
				},
			},
		},
		"/api/bot/cobros/credito/info": {
			post: {
				tags: ["Menú del crédito"],
				summary: "Servicio 3 · Info del crédito elegido",
				description: [
					"La información que el bot muestra al entrar al menú de un crédito: capital activo, cuotas atrasadas, cuota actual, mora, próxima fecha de pago, vehículo y convenio.",
					"",
					"**Se manda la MISMA `referencia` del servicio 1.** Es lo que prueba que el cliente ya validó su código y que el crédito es suyo: con la API key sola se podría preguntar por el crédito de cualquiera. La referencia sirve **30 minutos** desde que se validó el código; después hay que volver a identificarse.",
					"",
					"**Qué esperar de cada campo:**",
					"",
					"| Campo | Nota |",
					"| --- | --- |",
					"| `capitalActivo` | El capital del crédito — **el mismo número que la pantalla de cobros del CRM**, para que asesor y cliente vean lo mismo. Ojo: es el monto del crédito, no el saldo pendiente |",
					"| `cuotaActual` | La más vieja **sin pagar**. Si hay atraso, su fecha ya pasó: por eso trae `vencida` |",
					"| `proximaFechaPago` | La próxima cuota que **todavía no vence**. Con atraso NO es la misma que `cuotaActual` |",
					"| `mora` | `null` si no tiene, **o si su monto no es confiable ahora mismo** — ver `moraPorConfirmar`. Un convenio activo la congela |",
					"| `moraPorConfirmar` | `true` = tiene mora pero su monto no se puede citar. El saldo lo refresca un job a las 23:59: entre que el cliente paga y esa corrida, la cifra guardada no cuadra. Antes que decirle un número equivocado, no se manda ninguno — conviene ofrecerle hablar con su asesor |",
					"| `convenio` | `null` si no tiene |",
					"| `asesor` | Con quién puede hablar el cliente sobre este crédito. `telefono` puede venir vacío |",
					"| `mensajes` | **Los mismos datos ya escritos para el chat**, en tres formatos: `titulo` (una línea), `resumen` (lo accionable) y `completo` (todo). Se pueden pegar tal cual — traen emojis y negrita de WhatsApp (`*así*`). Los campos de arriba siguen estando para lo que necesites ramificar |",
					"| `vehiculo` | `null` si el crédito no tiene vehículo registrado — se responde igual, no es error |",
				].join("\n"),
				operationId: "infoCredito",
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["referencia", "numeroSifco"],
								properties: {
									referencia: {
										type: "string",
										format: "uuid",
										description: "La que devolvió el servicio 1.",
									},
									numeroSifco: {
										type: "string",
										description:
											"El crédito que eligió el cliente, tal como vino en el servicio 2.",
									},
								},
							},
							example: {
								referencia: "3b530493-eff1-492d-8394-26adf5b5e211",
								numeroSifco: "01010214120240",
							},
						},
					},
				},
				responses: {
					"200": {
						description: "La info del crédito.",
						content: {
							"application/json": {
								example: {
									success: true,
									data: {
										credito: {
											numeroSifco: "01010214120240",
											etiqueta: "MAZDA CX-5 GRAND TOURING AWD 2016 · P-247JYT",
											estado: "EN_CONVENIO",
											capitalActivo: "198252.40",
											cuotaMensual: "5891.15",
											cuotasAtrasadas: 2,
											cuotaActual: {
												numero: 8,
												de: 84,
												fechaVencimiento: "2026-06-30",
												vencida: true,
											},
											proximaFechaPago: "2026-08-30",
											mora: null,
											moraPorConfirmar: false,
											convenio: {
												cuotaMensual: "981.86",
												montoPendiente: "4909.29",
												pagosRealizados: 1,
												pagosPendientes: 5,
												numeroMeses: 6,
											},
											asesor: {
												nombre: "Erik Rivas",
												telefono: "50255551234",
											},
											vehiculo: {
												placa: "P-247JYT",
												marca: "MAZDA",
												modelo: "CX-5 GRAND TOURING AWD",
												anio: 2016,
											},
											mensajes: {
												titulo:
													"⚠️ *MAZDA CX-5 GRAND TOURING AWD 2016 · P-247JYT*",
												resumen:
													"⚠️ *MAZDA CX-5 GRAND TOURING AWD 2016 · P-247JYT*\n📄 Cuota 8 de 84 · Q5,891.15\n⚠️ Tenés 2 cuotas atrasadas\n📅 Próximo pago: 30 de agosto de 2026",
												completo:
													"⚠️ *MAZDA CX-5 GRAND TOURING AWD 2016 · P-247JYT*\n\n💵 Monto del crédito: Q198,252.40\n📄 Cuota mensual: Q5,891.15\n🔢 Vas en la cuota 8 de 84\n⚠️ Tenés *2 cuotas atrasadas*\n📅 Próxima fecha de pago: 30 de agosto de 2026\n\n🤝 *Tu convenio de pago*\n   Cuota del convenio: Q981.86\n   Llevás 1 de 6 pagos\n   Te falta: Q4,909.29\n\n🚙 Vehículo: MAZDA CX-5 GRAND TOURING AWD 2016\n   Placa: P-247JYT\n\n👤 Tu asesor: Erik Rivas\n   📞 35111822",
											},
										},
									},
								},
							},
						},
					},
					"400": {
						description: "Falta la referencia o el número de crédito.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								example: {
									success: false,
									error: {
										codigo: "PARAMETROS_INVALIDOS",
										mensaje: "Faltan datos para consultar el crédito.",
									},
								},
							},
						},
					},
					"401": {
						description:
							"La referencia no sirve, o pasaron los 30 minutos. **Ruteá por `codigo`.**",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								examples: {
									SESION_VENCIDA: {
										summary: "Pasaron 30 min desde que validó el código",
										value: {
											success: false,
											error: {
												codigo: "SESION_VENCIDA",
												mensaje:
													"Por seguridad tu sesión expiró. Vuelve a identificarte para continuar.",
											},
										},
									},
									REFERENCIA_INVALIDA: {
										summary: "No existe, o su código nunca se validó",
										value: {
											success: false,
											error: {
												codigo: "REFERENCIA_INVALIDA",
												mensaje:
													"No encontramos tu solicitud. Comienza de nuevo.",
											},
										},
									},
									NO_AUTORIZADO: {
										summary: "API key ausente o incorrecta",
										value: {
											success: false,
											error: {
												codigo: "NO_AUTORIZADO",
												mensaje: "No autorizado.",
											},
										},
									},
								},
							},
						},
					},
					"404": {
						description:
							"El crédito no es de ese cliente, o cartera no tiene sus datos.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								examples: {
									CREDITO_NO_ENCONTRADO: {
										summary:
											"No es un crédito de esta persona (mismo mensaje que si no existiera, a propósito)",
										value: {
											success: false,
											error: {
												codigo: "CREDITO_NO_ENCONTRADO",
												mensaje: "No encontramos ese crédito.",
											},
										},
									},
									CREDITO_SIN_DATOS: {
										summary: "Está en el CRM pero cartera no lo tiene",
										value: {
											success: false,
											error: {
												codigo: "CREDITO_SIN_DATOS",
												mensaje:
													"No pudimos consultar la información de ese crédito. Por favor contacta a soporte.",
											},
										},
									},
								},
							},
						},
					},
					"500": {
						description: "Error inesperado.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								example: {
									success: false,
									error: {
										codigo: "ERROR_INTERNO",
										mensaje:
											"Ocurrió un error. Intenta de nuevo en unos minutos.",
									},
								},
							},
						},
					},
					"503": {
						description:
							"No se pudo responder ahora mismo. **Se puede reintentar**: ninguno de los dos es culpa del cliente ni de su crédito.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								examples: {
									CARTERA_NO_DISPONIBLE: {
										summary:
											"El sistema de cartera no contestó. Volvé a intentar en unos minutos",
										value: {
											success: false,
											error: {
												codigo: "CARTERA_NO_DISPONIBLE",
												mensaje:
													"No pudimos consultar tu crédito en este momento. Intenta de nuevo en unos minutos.",
											},
										},
									},
									SERVICIO_NO_DISPONIBLE: {
										summary: "El servidor no tiene configurada la API key",
										value: {
											success: false,
											error: {
												codigo: "SERVICIO_NO_DISPONIBLE",
												mensaje:
													"El servicio no está disponible en este momento.",
											},
										},
									},
								},
							},
						},
					},
				},
			},
		},
		"/api/bot/cobros/credito/estado-cuenta": {
			post: {
				tags: ["Menú del crédito"],
				summary: "Servicio 4 · Estado de cuenta (PDF)",
				description: [
					"Genera el estado de cuenta del crédito y devuelve el **enlace al PDF**. Es el mismo documento que descarga el botón *Descargar Estado de Cuenta* del sistema interno.",
					"",
					"Pide la misma `referencia` del paso 1 y comprueba lo mismo que `/credito/info`: sin eso, con la API key se podría bajar el estado de cuenta de cualquiera.",
					"",
					"**El documento se genera en el momento de cada llamada** (no está pre-hecho), así que la respuesta tarda más que los otros servicios. Conviene llamarlo solo cuando el cliente lo pide, no al abrir el menú.",
					"",
					"El enlace apunta a un archivo público: **quien lo tenga puede abrirlo**. Es un dato del cliente, así que no debería reenviarse a nadie más.",
				].join("\n"),
				operationId: "estadoDeCuenta",
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["referencia", "numeroSifco"],
								properties: {
									referencia: {
										type: "string",
										format: "uuid",
										description: "La que devolvió el servicio 1.",
									},
									numeroSifco: {
										type: "string",
										description: "El crédito que eligió el cliente.",
									},
								},
							},
							example: {
								referencia: "3b530493-eff1-492d-8394-26adf5b5e211",
								numeroSifco: "01010214124000",
							},
						},
					},
				},
				responses: {
					"200": {
						description: "El enlace al PDF.",
						content: {
							"application/json": {
								example: {
									success: true,
									data: {
										url: "https://…/reportes/estado_cuenta_01010214124000_1755550000000.pdf",
										formato: "pdf",
									},
								},
							},
						},
					},
					"400": {
						description: "Falta la referencia o el número de crédito.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								example: {
									success: false,
									error: {
										codigo: "PARAMETROS_INVALIDOS",
										mensaje: "Faltan datos para generar el estado de cuenta.",
									},
								},
							},
						},
					},
					"401": {
						description: "La referencia no sirve, o pasaron los 30 minutos.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								examples: {
									SESION_VENCIDA: {
										summary: "Pasaron 30 min desde que validó el código",
										value: {
											success: false,
											error: {
												codigo: "SESION_VENCIDA",
												mensaje:
													"Por seguridad tu sesión expiró. Vuelve a identificarte para continuar.",
											},
										},
									},
									REFERENCIA_INVALIDA: {
										summary: "No existe, o su código nunca se validó",
										value: {
											success: false,
											error: {
												codigo: "REFERENCIA_INVALIDA",
												mensaje:
													"No encontramos tu solicitud. Comienza de nuevo.",
											},
										},
									},
									NO_AUTORIZADO: {
										summary: "API key ausente o incorrecta",
										value: {
											success: false,
											error: {
												codigo: "NO_AUTORIZADO",
												mensaje: "No autorizado.",
											},
										},
									},
								},
							},
						},
					},
					"404": {
						description:
							"El crédito no es de ese cliente, o todavía no hay movimientos que reportar.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								examples: {
									CREDITO_NO_ENCONTRADO: {
										summary: "No es un crédito de esta persona",
										value: {
											success: false,
											error: {
												codigo: "CREDITO_NO_ENCONTRADO",
												mensaje: "No encontramos ese crédito.",
											},
										},
									},
									SIN_ESTADO_DE_CUENTA: {
										summary: "El crédito no tiene pagos que reportar todavía",
										value: {
											success: false,
											error: {
												codigo: "SIN_ESTADO_DE_CUENTA",
												mensaje:
													"Todavía no hay movimientos para generar tu estado de cuenta.",
											},
										},
									},
									CREDITO_SIN_DATOS: {
										summary:
											"El crédito está en el CRM pero no en cartera — NO es lo mismo que no tener movimientos",
										value: {
											success: false,
											error: {
												codigo: "CREDITO_SIN_DATOS",
												mensaje:
													"No pudimos consultar la información de ese crédito. Por favor contacta a soporte.",
											},
										},
									},
								},
							},
						},
					},
					"500": {
						description: "No se pudo generar el documento.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								example: {
									success: false,
									error: {
										codigo: "ERROR_INTERNO",
										mensaje:
											"No pudimos generar tu estado de cuenta en este momento. Intenta de nuevo en unos minutos.",
									},
								},
							},
						},
					},
					"503": {
						description: "El servidor no tiene configurada la API key.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								example: {
									success: false,
									error: {
										codigo: "SERVICIO_NO_DISPONIBLE",
										mensaje: "El servicio no está disponible en este momento.",
									},
								},
							},
						},
					},
				},
			},
		},
	},
} as const;

/**
 * Todos los `codigo` que aparecen en los ejemplos de la spec.
 *
 * Se recorre el documento en vez de mantener una lista aparte: una segunda
 * lista sería una segunda cosa que se olvida de actualizar. `openapi.test.ts`
 * compara esto contra lo que devuelve el controlador.
 */
export function codigosDocumentados(): Set<string> {
	const encontrados = new Set<string>();

	const recorrer = (valor: unknown): void => {
		if (Array.isArray(valor)) {
			for (const item of valor) recorrer(item);
			return;
		}

		if (!valor || typeof valor !== "object") return;

		for (const [clave, contenido] of Object.entries(valor)) {
			if (clave === "codigo" && typeof contenido === "string") {
				encontrados.add(contenido);
			} else {
				recorrer(contenido);
			}
		}
	};

	recorrer(especificacionBotCobros);

	return encontrados;
}
