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
					"| `cuentasPago` | **Dónde deposita el cliente.** `texto` se muestra literal (ya trae emojis, saltos y negrita); `cuentas` es lo mismo en estructura. Son fijas: no cambian entre créditos ni entre clientes |",
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
											cuentasPago: {
												texto:
													"🏦 *Cuentas para tu pago*\n\nTodas a nombre de *CUBE INVESTMENTS, S.A.* (monetarias):\n\n• *Banco Industrial* — 5520029876\n• *Banco Agromercantil (BAM)* — 3020123033\n• *Banco G&T Continental* — 01300039945\n• *Banrural* — 3394002346",
												cuentas: [
													{
														banco: "Banco Industrial",
														bancoId: 1,
														numero: "5520029876",
														titular: "CUBE INVESTMENTS, S.A.",
														tipo: "monetaria",
													},
													{
														banco: "Banco Agromercantil (BAM)",
														bancoId: 16,
														numero: "3020123033",
														titular: "CUBE INVESTMENTS, S.A.",
														tipo: "monetaria",
													},
													{
														banco: "Banco G&T Continental",
														bancoId: 19,
														numero: "01300039945",
														titular: "CUBE INVESTMENTS, S.A.",
														tipo: "monetaria",
													},
													{
														banco: "Banrural",
														bancoId: 2,
														numero: "3394002346",
														titular: "CUBE INVESTMENTS, S.A.",
														tipo: "monetaria",
													},
												],
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
		"/api/bot/cobros/boleta/leer": {
			post: {
				tags: ["Pago con boleta"],
				summary: "Lee la boleta que mandó el cliente",
				description: [
					"Descarga la foto, la lee con IA y devuelve **lo que entendimos** para que el cliente confirme.",
					"",
					"⚠️ **Este endpoint NO registra el pago.** Eso lo hace `/boleta/confirmar`, que todavía no está disponible.",
					"",
					"**Qué pasa por dentro, en orden:** se comprueba que el crédito sea de quien pregunta → se descarga la imagen (única vez que salimos a tu nube) → se lee con IA → se guarda en nuestro almacenamiento → se cruza con el crédito.",
					"",
					"**Si el cliente dice que los datos están mal, no se corrigen: pedile otra foto y volvé a llamar acá.** Eso cuenta como el intento 2. Al cuarto, el endpoint responde `429` y hay que pasarlo con un asesor.",
					"",
					"| Campo | Nota |",
					"| --- | --- |",
					"| `boletaId` | El identificador del borrador. Es lo **único** que se manda para confirmar: el monto no viaja en el request, sale de acá |",
					"| `expiraEn` | El borrador vive 15 minutos. Después hay que pedir la foto de nuevo |",
					"| `lectura.banco` | `null` si no lo reconocimos. Ahí viene `bancosSugeridos` para que el cliente elija de una lista |",
					"| `lectura.cuentaReconocida` | Cuál de nuestras cuentas recibió el dinero. `null` NO significa que esté mal: puede ser que el número se leyera incompleto |",
					"| `camposFaltantes` | Qué no se pudo leer. Si trae `fechaBoleta`, se usó la fecha de hoy |",
					"| `confianza` | `alta` / `media` / `baja`. Es para modular el mensaje, no para ramificar |",
					"| `aplicacion` | A dónde va a ir el dinero, **en el orden en que se aplica: la mora primero**. `paraCuota` es lo que le queda a la cuota DESPUÉS de la mora, y `cubreCuota` se calcula con eso. Si `moraPorConfirmar` viene en `true`, hay mora pero **no se puede citar el monto**: ahí `paraCuota` es `null` y no se afirma nada sobre la cuota. **Es una estimación** (`estimado: true`): la aplicación real la hace contabilidad al validar |",
					"| `mensajes` | Los mismos datos ya escritos para el chat, en tres formatos. Se pegan tal cual |",
				].join("\n"),
				operationId: "leerBoleta",
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["referencia", "numeroSifco", "imagenUrl"],
								properties: {
									referencia: {
										type: "string",
										format: "uuid",
										description: "La misma del paso 1, ya canjeada.",
									},
									numeroSifco: {
										type: "string",
										description: "El crédito que eligió en el menú.",
									},
									imagenUrl: {
										type: "string",
										format: "uri",
										description:
											"URL https de la imagen. El dominio tiene que estar en la lista permitida; avisanos si cambian de CDN.",
									},
								},
							},
							example: {
								referencia: "3b530493-1d4e-4f6a-9b7c-2e5d8a1f0c33",
								numeroSifco: "01010214113290",
								imagenUrl: "https://cdn.simpletech.gt/media/abc123.jpg",
							},
						},
					},
				},
				responses: {
					"200": {
						description: "Se leyó la boleta. Falta que el cliente confirme.",
						content: {
							"application/json": {
								example: {
									success: true,
									data: {
										boletaId: "b3d1f0a4-77c2-4c19-9a56-0f2b8e4d1a90",
										intento: 1,
										intentosRestantes: 2,
										expiraEn: "2026-08-20T21:15:00.000Z",
										lectura: {
											banco: { id: 2, nombre: "Banrural", leido: "BANRURAL" },
											monto: "500.00",
											fechaBoleta: "2026-04-27",
											numeroAutorizacion: "524075550",
											cuentaDestino: "3394002346",
											cuentaReconocida: {
												banco: "Banrural",
												bancoId: 2,
												titular: "CUBE INVESTMENTS, S.A.",
											},
											observaciones: null,
										},
										camposFaltantes: [],
										confianza: "alta",
										aplicacion: {
											estimado: true,
											cuota: {
												numero: 8,
												de: 84,
												fechaVencimiento: "2026-07-30",
											},
											saldoCuota: "5891.15",
											mora: "1178.23",
											orden: ["mora", "cuota_8"],
											moraPorConfirmar: false,
											paraCuota: "0.00",
											cubreMora: false,
											cubreCuota: false,
											excedente: "0.00",
										},
										mensajes: {
											titulo: "🧾 *Boleta recibida · Q500.00*",
											resumen:
												"🧾 *Boleta recibida · Q500.00*\n\n💵 Monto: *Q500.00*\n🏦 Banco: Banrural\n📅 Fecha: 27 de abril de 2026\n🔢 No. de autorización: 524075550\n\n¿Está correcto?",
											completo:
												"🧾 *Boleta recibida · Q500.00*\n\n💵 Monto: *Q500.00*\n🏦 Banco: Banrural\n📅 Fecha: 27 de abril de 2026\n🔢 No. de autorización: 524075550\n\n📄 *Cómo se va a aplicar*\n   1. A tu mora de Q1,178.23\n   2. A tu cuota 8 de 84\n   Falta de esa cuota: Q5,891.15\n\n¿Está correcto?",
										},
									},
								},
							},
						},
					},
					"400": {
						description: "Faltan datos, o la URL no se puede abrir.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								examples: {
									PARAMETROS_INVALIDOS: {
										summary: "Falta referencia, crédito o imagen",
										value: {
											success: false,
											error: {
												codigo: "PARAMETROS_INVALIDOS",
												mensaje: "Faltan datos para leer tu boleta.",
											},
										},
									},
									URL_NO_PERMITIDA: {
										summary: "No es https, o el dominio no está permitido",
										value: {
											success: false,
											error: {
												codigo: "URL_NO_PERMITIDA",
												mensaje: "No pudimos abrir esa imagen.",
											},
										},
									},
								},
							},
						},
					},
					"401": {
						description: "La sesión no sirve. **Ruteá por `codigo`.**",
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
										summary: "La referencia no existe o nunca se canjeó",
										value: {
											success: false,
											error: {
												codigo: "REFERENCIA_INVALIDA",
												mensaje:
													"No encontramos tu solicitud. Comienza de nuevo.",
											},
										},
									},
								},
							},
						},
					},
					"404": {
						description:
							"El crédito no es de esa persona, o no está en cartera.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								examples: {
									CREDITO_NO_ENCONTRADO: {
										summary: "Ese crédito no es del cliente",
										value: {
											success: false,
											error: {
												codigo: "CREDITO_NO_ENCONTRADO",
												mensaje: "No encontramos ese crédito.",
											},
										},
									},
									CREDITO_SIN_DATOS: {
										summary: "Está en el CRM pero no en cartera",
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
					"409": {
						description:
							"Boleta repetida, o el crédito no puede recibir pagos.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								examples: {
									BOLETA_DUPLICADA: {
										summary: "Es la MISMA foto que ya mandó en esta sesión",
										value: {
											success: false,
											error: {
												codigo: "BOLETA_DUPLICADA",
												mensaje: "Esa boleta ya nos la habías mandado.",
											},
										},
									},
									CREDITO_NO_ACEPTA_BOLETA: {
										summary:
											"Cancelado, incobrable, o sin ninguna cuota abierta",
										value: {
											success: false,
											error: {
												codigo: "CREDITO_NO_ACEPTA_BOLETA",
												mensaje:
													"Este crédito no puede recibir pagos por este medio. Tu asesor te va a ayudar.",
											},
										},
									},
								},
							},
						},
					},
					"502": {
						description:
							"El CDN de la imagen falló. **La sesión sigue siendo válida**: no hay que reiniciar nada, alcanza con volver a mandar la foto.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								example: {
									success: false,
									error: {
										codigo: "IMAGEN_NO_DESCARGABLE",
										mensaje:
											"No pudimos descargar tu imagen. Intenta mandarla de nuevo, por favor.",
									},
								},
							},
						},
					},
					"413": {
						description: "La imagen pesa más de 8 MB.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								example: {
									success: false,
									error: {
										codigo: "ARCHIVO_MUY_GRANDE",
										mensaje:
											"La imagen pesa demasiado. Mandanos una foto más liviana, por favor.",
									},
								},
							},
						},
					},
					"422": {
						description:
							"El archivo no se puede leer, o la foto no es un comprobante. **Gasta un intento.**",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								examples: {
									BOLETA_ILEGIBLE: {
										summary: "No se leyó ni el monto, o no es una boleta",
										value: {
											success: false,
											error: {
												codigo: "BOLETA_ILEGIBLE",
												mensaje:
													"No pudimos leer tu boleta. Mandanos otra foto donde se vean bien el monto y la fecha.",
											},
										},
									},
									ARCHIVO_NO_SOPORTADO: {
										summary: "No es JPG, PNG, WEBP ni PDF",
										value: {
											success: false,
											error: {
												codigo: "ARCHIVO_NO_SOPORTADO",
												mensaje:
													"Ese archivo no lo podemos leer. Mandanos una foto (JPG o PNG) o el PDF de tu boleta.",
											},
										},
									},
								},
							},
						},
					},
					"429": {
						description: "Se acabaron los tres intentos de esta sesión.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								example: {
									success: false,
									error: {
										codigo: "DEMASIADOS_INTENTOS",
										mensaje:
											"Ya intentamos leer tu boleta varias veces. Tu asesor te va a ayudar a registrarla.",
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
							"Problema **nuestro**, no del cliente: por eso NO le gasta un intento. Se puede reintentar con la misma foto.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								examples: {
									LECTOR_NO_DISPONIBLE: {
										summary: "El lector de boletas no respondió",
										value: {
											success: false,
											error: {
												codigo: "LECTOR_NO_DISPONIBLE",
												mensaje:
													"No pudimos leer tu boleta en este momento. Intenta de nuevo en unos minutos.",
											},
										},
									},
									ALMACENAMIENTO_NO_DISPONIBLE: {
										summary: "No se pudo guardar la imagen",
										value: {
											success: false,
											error: {
												codigo: "ALMACENAMIENTO_NO_DISPONIBLE",
												mensaje:
													"No pudimos guardar tu boleta en este momento. Intenta de nuevo en unos minutos.",
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
