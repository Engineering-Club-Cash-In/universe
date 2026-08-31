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
		{
			name: "Pago con boleta",
			description:
				"Paso 4 del bot: el cliente sube la foto de su depósito y confirma lo que leímos.",
		},
		{
			name: "Pago con link",
			description: [
				"Paso 3 del bot: el cliente elige cuántas cuotas paga y recibe **uno o dos links de pago** (Págalo). Ahí termina la conversación: del pago nos enteramos nosotros y le avisamos por WhatsApp.",
				"",
				"Contrato completo: `docs/features/bot-whatsapp-cobros/07-pago-con-link.md`. Los links se emiten en el **sandbox** de Págalo mientras dure la integración.",
			].join("\n"),
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
					"| `mensajes` | **Los mismos datos ya escritos para el chat**, en tres formatos: `titulo` (una línea), `resumen` (lo accionable) y `completo` (todo). Se pueden pegar tal cual — van SIN emojis (el motor del bot no los procesa) y con negrita de WhatsApp (`*así*`). Los campos de arriba siguen estando para lo que necesites ramificar |",
					"| `vehiculo` | `null` si el crédito no tiene vehículo registrado — se responde igual, no es error |",
					"| `cuentasPago` | **Dónde deposita el cliente.** `texto` se muestra literal (sin emojis, con saltos y negrita); `cuentas` es lo mismo en estructura. Son fijas: no cambian entre créditos ni entre clientes |",
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
													"*Cuentas para tu pago*\n\nTodas a nombre de *CUBE INVESTMENTS, S.A.* (monetarias):\n\n• *Banco Industrial* — 5520029876\n• *Banco Agromercantil (BAM)* — 3020123033\n• *Banco G&T Continental* — 01300039945\n• *Banrural* — 3394002346",
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
													"*MAZDA CX-5 GRAND TOURING AWD 2016 · P-247JYT*",
												resumen:
													"*MAZDA CX-5 GRAND TOURING AWD 2016 · P-247JYT*\nCuota 8 de 84 · Q5,891.15\nTenés 2 cuotas atrasadas\nPróximo pago: 30 de agosto de 2026",
												completo:
													"*MAZDA CX-5 GRAND TOURING AWD 2016 · P-247JYT*\n\nMonto del crédito: Q198,252.40\nCuota mensual: Q5,891.15\nVas en la cuota 8 de 84\nTenés *2 cuotas atrasadas*\nPróxima fecha de pago: 30 de agosto de 2026\n\n*Tu convenio de pago*\n   Cuota del convenio: Q981.86\n   Llevás 1 de 6 pagos\n   Te falta: Q4,909.29\n\nVehículo: MAZDA CX-5 GRAND TOURING AWD 2016\n   Placa: P-247JYT\n\nTu asesor: Erik Rivas\n   Tel. 35111822",
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
		"/api/bot/cobros/boleta/leer": {
			post: {
				tags: ["Pago con boleta"],
				summary: "Lee la boleta que mandó el cliente",
				description: [
					"Descarga la foto, la lee con IA y devuelve **lo que entendimos** para que el cliente confirme.",
					"",
					"⚠️ **Este endpoint NO registra el pago.** Eso lo hace `/boleta/confirmar`, con el `boletaId` que devuelve acá.",
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
											titulo: "*Boleta recibida · Q500.00*",
											resumen:
												"*Boleta recibida · Q500.00*\n\nMonto: *Q500.00*\nBanco: Banrural\nFecha: 27 de abril de 2026\nNo. de autorización: 524075550\n\n¿Está correcto?",
											completo:
												"*Boleta recibida · Q500.00*\n\nMonto: *Q500.00*\nBanco: Banrural\nFecha: 27 de abril de 2026\nNo. de autorización: 524075550\n\n*Cómo se va a aplicar*\n   1. A tu mora de Q1,178.23\n   2. A tu cuota 8 de 84\n   Falta de esa cuota: Q5,891.15\n\n¿Está correcto?",
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
											"Cancelado, incobrable, o sin ninguna cuota abierta (incluye el convenio con las ordinarias cerradas: hoy sale por el asesor)",
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
		"/api/bot/cobros/boleta/confirmar": {
			post: {
				tags: ["Pago con boleta"],
				summary: "El cliente confirmó: registra el pago",
				description: [
					"Registra el pago en cartera con los datos del borrador que dejó `/boleta/leer`.",
					"",
					"**Lo único que se manda además del `boletaId` es `bancoId`**, y solo cuando la lectura no reconoció el banco o el cliente lo corrigió. El monto, la fecha y la autorización **no se aceptan por el request**: salen del borrador. Es la diferencia entre que el monto lo dicte la boleta y que lo dicte quien está del otro lado del chat.",
					"",
					"**Si el cliente dice que los datos están mal, no llames acá:** pedile otra foto y volvé a `/boleta/leer`. Ese es el reintento.",
					"",
					"**El pago queda en validación de contabilidad**, no acreditado. Cuando lo validen te avisamos por el canal de notificaciones.",
					"",
					"| Campo | Nota |",
					"| --- | --- |",
					"| `pagoIds` | Es una **lista**. Una boleta que alcanza para dos cuotas atrasadas crea dos pagos, cada uno con su id. Puede venir **vacía** y eso no es un error: el pago quedó registrado igual y lo estamos terminando de identificar por dentro |",
					"| `cuotasCubiertas` | Los números de cuota que tocó el pago |",
					"| `estado` | Siempre `en_validacion` en esta respuesta |",
					"| `mensajes` | Ya escritos para el chat, se pegan tal cual |",
					"",
					"### Reintentar el mismo `boletaId`",
					"",
					"**Nunca crea un segundo pago.** Según en qué punto esté el borrador vas a recibir:",
					"",
					"| Situación | Respuesta |",
					"| --- | --- |",
					"| Ya se registró | `409 BOLETA_YA_CONFIRMADA`, **con los `pagoIds` en `data`** |",
					'| Se registró pero lo estamos verificando | `409 BORRADOR_NO_CONFIRMABLE` con `data.estado = "confirmada_a_verificar"`. **No le digas al cliente que su pago entró**: puede estar aplicado a medias y lo está revisando una persona |',
					"| Hay una confirmación a medias | `409 CONFIRMACION_EN_CURSO`. Esperá unos minutos y volvé a preguntar |",
					"| No contestamos a tiempo | `503 CARTERA_NO_DISPONIBLE`. **No reintentes automáticamente**: lo estamos verificando por dentro y te avisamos |",
				].join("\n"),
				operationId: "confirmarBoleta",
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["referencia", "numeroSifco", "boletaId"],
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
									boletaId: {
										type: "string",
										format: "uuid",
										description: "El que devolvió `/boleta/leer`.",
									},
									bancoId: {
										type: "integer",
										description:
											"Solo si `lectura.banco` vino en `null` o el cliente lo corrigió. Se toma de `bancosSugeridos`. **Omitilo (o mandá `null`) si no hay corrección**: un valor que no sea un id del catálogo responde `BANCO_INVALIDO`, no se ignora — si el cliente está corrigiendo el banco, caer de vuelta en el que la lectura reconoció mal registraría el pago contra el banco equivocado.",
									},
								},
							},
							example: {
								referencia: "3b530493-1d4e-4f6a-9b7c-2e5d8a1f0c33",
								numeroSifco: "01010214113290",
								boletaId: "b3d1f0a4-77c2-4c19-9a56-0f2b8e4d1a90",
								bancoId: 2,
							},
						},
					},
				},
				responses: {
					"200": {
						description:
							"El pago quedó registrado y en validación de contabilidad.",
						content: {
							"application/json": {
								example: {
									success: true,
									data: {
										pagoIds: [48213, 48214],
										cuotasCubiertas: [3, 4],
										estado: "en_validacion",
										monto: "12528.20",
										banco: "Banco Industrial",
										fechaBoleta: "2026-08-18",
										numeroAutorizacion: "123456789",
										mensajes: {
											titulo: "*Pago recibido · Q12,528.20*",
											resumen:
												"*Pago recibido · Q12,528.20*\n\nEstá en validación. Te avisamos cuando se acredite.",
											completo:
												"*Pago recibido · Q12,528.20*\n\nYa registramos tu pago. Nuestro equipo de contabilidad tiene que validar los fondos.\n\nTe avisamos por este mismo medio cuando quede acreditado.",
										},
									},
								},
							},
						},
					},
					"400": {
						description: "Faltan datos, o el banco no sirve.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								examples: {
									PARAMETROS_INVALIDOS: {
										summary: "Falta referencia, crédito o boletaId",
										value: {
											success: false,
											error: {
												codigo: "PARAMETROS_INVALIDOS",
												mensaje: "Faltan datos para registrar tu pago.",
											},
										},
									},
									BANCO_REQUERIDO: {
										summary:
											"No se reconoció el banco y no vino `bancoId`. Pedile al cliente que elija de `bancosSugeridos`",
										value: {
											success: false,
											error: {
												codigo: "BANCO_REQUERIDO",
												mensaje: "Necesitamos saber de qué banco es tu boleta.",
											},
										},
									},
									BANCO_INVALIDO: {
										summary: "Ese `bancoId` no está en el catálogo",
										value: {
											success: false,
											error: {
												codigo: "BANCO_INVALIDO",
												mensaje: "Ese banco no está en nuestra lista.",
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
								},
							},
						},
					},
					"404": {
						description: "No encontramos el borrador o el crédito.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								examples: {
									BORRADOR_NO_ENCONTRADO: {
										summary:
											"Ese `boletaId` no existe o es de otra conversación",
										value: {
											success: false,
											error: {
												codigo: "BORRADOR_NO_ENCONTRADO",
												mensaje:
													"No encontramos esa boleta. Mándanos la foto de nuevo, por favor.",
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
							"El borrador no está en condiciones de registrarse. **Ninguno de estos crea un pago nuevo.**",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								examples: {
									BOLETA_YA_CONFIRMADA: {
										summary:
											"Ya se registró. Los `pagoIds` vienen en `data` — no vuelvas a llamar",
										value: {
											success: false,
											error: {
												codigo: "BOLETA_YA_CONFIRMADA",
												mensaje:
													"Ese pago ya lo registramos. Está en validación y te avisamos cuando se acredite.",
											},
											data: { pagoIds: [48213, 48214] },
										},
									},
									CONFIRMACION_EN_CURSO: {
										summary:
											"Hay otra confirmación de ESTA misma boleta a medio camino",
										value: {
											success: false,
											error: {
												codigo: "CONFIRMACION_EN_CURSO",
												mensaje:
													"Ya estamos registrando ese pago. Dame un momento y te confirmo.",
											},
										},
									},
									BOLETA_DUPLICADA: {
										summary:
											"Esa referencia ya figura registrada. **No le digas al cliente que está duplicada**: lo revisa un asesor",
										value: {
											success: false,
											error: {
												codigo: "BOLETA_DUPLICADA",
												mensaje:
													"Necesitamos revisar tu boleta antes de aplicarla. Tu asesor te va a contactar.",
											},
										},
									},
									BORRADOR_NO_CONFIRMABLE: {
										summary:
											"El borrador quedó en un estado del que no se sale reintentando. El estado va en `data`",
										value: {
											success: false,
											error: {
												codigo: "BORRADOR_NO_CONFIRMABLE",
												mensaje:
													"Esa boleta ya no se puede registrar. Tu asesor te va a ayudar.",
											},
											data: { estado: "rechazada" },
										},
									},
									CREDITO_NO_ACEPTA_BOLETA: {
										summary: "El crédito se quedó sin ninguna cuota abierta",
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
					"410": {
						description:
							"Pasaron más de 15 minutos desde la lectura. Pedile la foto de nuevo y volvé a `/boleta/leer`.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								example: {
									success: false,
									error: {
										codigo: "BORRADOR_VENCIDO",
										mensaje:
											"Pasó demasiado tiempo desde que nos mandaste tu boleta. Mándanos la foto de nuevo, por favor.",
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
					"502": {
						description:
							"Cartera rechazó el pago. **No se registró nada** y el cliente puede volver a confirmar.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								example: {
									success: false,
									error: {
										codigo: "PAGO_NO_REGISTRADO",
										mensaje:
											"No pudimos registrar tu pago en este momento. Intenta de nuevo en unos minutos.",
									},
								},
							},
						},
					},
					"503": {
						description:
							"⚠️ **No sabemos si el pago se registró.** No reintentes automáticamente: lo verificamos por dentro en los próximos minutos y el resultado te llega por el canal de notificaciones.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								examples: {
									CARTERA_NO_DISPONIBLE: {
										summary: "Cartera no respondió a tiempo",
										value: {
											success: false,
											error: {
												codigo: "CARTERA_NO_DISPONIBLE",
												mensaje:
													"Estamos verificando tu pago. En unos minutos te confirmamos por este medio.",
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
		"/api/bot/cobros/pago-link/opciones": {
			post: {
				tags: ["Pago con link"],
				summary: "Servicio 7 · Opciones de pago con link",
				description: [
					"Le dice al bot **cuántas cuotas puede pagar el cliente** y cuánto cuesta cada opción, para que le muestre un select.",
					"",
					"Mismo control de acceso que `/credito/info`: la `referencia` del paso 1, viva (30 min), y un crédito de esa persona.",
					"",
					"**Cómo se arman las opciones:**",
					"- **Al día** → una sola opción (`cuotas: 1`, la cuota actual, sin mora). No hace falta mostrar select.",
					"- **Con atraso** → una opción por cada acumulado desde la cuota más vieja (`1…N`), más una que agrega la **próxima cuota por vencer** (`N+1`). No se eligen cuotas sueltas.",
					"- **Máximo 4 opciones** (`cantidadOpciones` ≤ 4). Con 4 o más cuotas atrasadas el crédito ya está en recuperación, así que se ofrecen solo los 4 primeros acumulados y no la próxima.",
					"- **La mora nunca es opcional**: va completa en toda opción con atraso.",
					"- **No hay pagos parciales**: cada opción paga cuotas completas. Si una cuota ya traía un pago parcial, la opción ofrece **lo que le falta**.",
					"",
					"`mensajes` viene armado para el chat: **no concatenes nada**. `montoTotal` y los desgloses son strings con dos decimales; `etiqueta` es el texto de cada opción del select.",
					"",
					"**Las opciones vienen dos veces**, como los créditos del servicio 2: en el arreglo `opciones` y **aplanadas** en `cantidadOpciones` + `opcion1Etiqueta`/`opcion1Monto` … `opcion4Etiqueta`/`opcion4Monto` (solo existen las que hay). Usá las planas para armar el select sin recorrer arreglos.",
					"",
					"Después de que el cliente elige, llamá a `/pago-link/crear` con el `opcionNMonto` de esa opción como `monto`. **Solo el monto**: cada opción tiene un monto distinto, con eso sabemos cuál eligió.",
				].join("\n"),
				operationId: "opcionesPagoLink",
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
						description: "Las opciones que se le ofrecen al cliente.",
						content: {
							"application/json": {
								examples: {
									con_atraso: {
										summary:
											"Crédito con 3 cuotas atrasadas (3 acumulados + la próxima)",
										value: {
											success: true,
											data: {
												resumen: {
													alDia: false,
													cuotasAtrasadas: 3,
													cuotaMensual: "2464.63",
													mora: "1250.00",
												},
												opciones: [
													{
														cuotas: 1,
														etiqueta: "1 cuota + mora — Q3,714.63",
														montoTotal: "3714.63",
														desglose: { cuotas: "2464.63", mora: "1250.00" },
													},
													{
														cuotas: 2,
														etiqueta: "2 cuotas + mora — Q6,179.26",
														montoTotal: "6179.26",
														desglose: { cuotas: "4929.26", mora: "1250.00" },
													},
													{
														cuotas: 3,
														etiqueta: "3 cuotas + mora — Q8,643.89",
														montoTotal: "8643.89",
														desglose: { cuotas: "7393.89", mora: "1250.00" },
													},
													{
														cuotas: 4,
														etiqueta:
															"3 cuotas + la próxima + mora — Q11,108.52",
														montoTotal: "11108.52",
														desglose: { cuotas: "9858.52", mora: "1250.00" },
													},
												],
												cantidadOpciones: 4,
												opcion1Etiqueta: "1 cuota + mora — Q3,714.63",
												opcion1Monto: "3714.63",
												opcion2Etiqueta: "2 cuotas + mora — Q6,179.26",
												opcion2Monto: "6179.26",
												opcion3Etiqueta: "3 cuotas + mora — Q8,643.89",
												opcion3Monto: "8643.89",
												opcion4Etiqueta:
													"3 cuotas + la próxima + mora — Q11,108.52",
												opcion4Monto: "11108.52",
												mensajes: {
													titulo: "💳 Pago con link",
													resumen:
														"Tenés 3 cuotas atrasadas y Q1,250.00 de mora. Elegí cuántas cuotas querés pagar:",
													completo:
														"💳 *Pago con link*\n\nTenés 3 cuotas atrasadas y Q1,250.00 de mora.\n\nElegí cuántas cuotas querés pagar. La mora va incluida en todas las opciones.",
												},
											},
										},
									},
									al_dia: {
										summary: "Crédito al día: una sola opción, sin mora",
										value: {
											success: true,
											data: {
												resumen: {
													alDia: true,
													cuotasAtrasadas: 0,
													cuotaMensual: "2464.63",
													mora: "0.00",
												},
												opciones: [
													{
														cuotas: 1,
														etiqueta: "Cuota de septiembre — Q2,464.63",
														montoTotal: "2464.63",
														desglose: { cuotas: "2464.63", mora: "0.00" },
													},
												],
												cantidadOpciones: 1,
												opcion1Etiqueta: "Cuota de septiembre — Q2,464.63",
												opcion1Monto: "2464.63",
												mensajes: {
													titulo: "💳 Pago con link",
													resumen:
														"Estás al día. Tu próxima cuota vence el 30/09/2026: Q2,464.63.",
													completo:
														"💳 *Pago con link*\n\nEstás al día 🎉\n\nTu próxima cuota vence el 30/09/2026 y es de Q2,464.63. ¿La pagás con link?",
												},
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
										mensaje: "Faltan datos para armar tu pago.",
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
						description: "El crédito no es de ese cliente.",
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
									CREDITO_SIN_DATOS: {
										summary: "El crédito está en el CRM pero no en cartera",
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
							"El crédito existe y es del cliente, pero **hoy no se le puede cobrar por link**. Ruteá por `codigo`.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								examples: {
									MORA_POR_CONFIRMAR: {
										summary:
											"La mora registrada no cuadra con las cuotas atrasadas: sin cifra confiable no se genera link",
										value: {
											success: false,
											error: {
												codigo: "MORA_POR_CONFIRMAR",
												mensaje:
													"Estamos confirmando el monto de tu mora. Tu asesor te va a indicar cuánto pagar.",
											},
										},
									},
									CREDITO_REQUIERE_REVISION: {
										summary:
											"Hay una cuota vencida sin saldo que cobrar: el crédito quedó en un estado del que no se puede deducir el monto",
										value: {
											success: false,
											error: {
												codigo: "CREDITO_REQUIERE_REVISION",
												mensaje:
													"Tenemos que revisar el estado de tu crédito antes de darte un link. Tu asesor te va a indicar cuánto pagar.",
											},
										},
									},
									CREDITO_NO_PAGABLE_POR_LINK: {
										summary:
											"Estado del crédito fuera del flujo (convenio, incobrable, cancelado, pendiente de cancelación, caído)",
										value: {
											success: false,
											error: {
												codigo: "CREDITO_NO_PAGABLE_POR_LINK",
												mensaje:
													"Este crédito no puede pagarse con link. Tu asesor te va a ayudar.",
											},
										},
									},
									SIN_CUOTAS_QUE_PAGAR: {
										summary: "Nada vencido ni por vencer que ofrecer",
										value: {
											success: false,
											error: {
												codigo: "SIN_CUOTAS_QUE_PAGAR",
												mensaje:
													"No tenés cuotas pendientes de pago por ahora.",
											},
										},
									},
									PAGO_EN_PROCESO: {
										summary:
											"Ya hay un pago por link aplicándose (o uno en curso con su asesor): no se ofrecen opciones sobre una deuda que está por cambiar",
										value: {
											success: false,
											error: {
												codigo: "PAGO_EN_PROCESO",
												mensaje:
													"Ya tenés un pago en proceso. En cuanto se confirme te mandamos tu recibo.",
											},
										},
									},
									PAGO_PARCIAL_EN_CURSO: {
										summary:
											"El cliente pagó UNO de los dos links: no hay opciones nuevas — `data` trae el link pendiente y el mensaje para reenviarlo",
										value: {
											success: false,
											error: {
												codigo: "PAGO_PARCIAL_EN_CURSO",
												mensaje:
													"Ya recibimos el Pago 1 de 2. Te falta el Pago 2 de 2 por Q3,079.26.",
											},
											data: {
												codigo: "PAGO_PARCIAL_EN_CURSO",
												mensaje:
													"Ya recibimos el Pago 1 de 2. Te falta el Pago 2 de 2 por Q3,079.26.",
												pago: {
													referenciaPago:
														"9f21c4d0-7b1e-4c1a-9a6d-2f0c3e5b8d41",
													montoTotal: "6179.26",
												},
												linkPendiente: {
													tipo: "MORA_INTERES",
													titulo: "Pago 2 de 2",
													monto: "3079.26",
													url: "https://checkout.pagalo.co/…",
												},
												mensajes: {
													titulo: "💳 Te falta un pago",
													completo:
														"💳 *Te falta un pago*\n\nYa recibimos tu *Pago 1 de 2*. Para completar tu cuota pagá el *Pago 2 de 2* por Q3,079.26:\n\nhttps://checkout.pagalo.co/…\n\nTe avisamos en cuanto se confirme.",
												},
											},
										},
									},
								},
							},
						},
					},
					"500": {
						description: "Error nuestro.",
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
							"Falta configuración del servidor, o cartera no respondió.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								examples: {
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
									CARTERA_NO_DISPONIBLE: {
										summary: "Cartera no contestó: reintentar en un rato",
										value: {
											success: false,
											error: {
												codigo: "CARTERA_NO_DISPONIBLE",
												mensaje:
													"No pudimos consultar tu crédito en este momento. Intenta de nuevo en unos minutos.",
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
		"/api/bot/cobros/pago-link/crear": {
			post: {
				tags: ["Pago con link"],
				summary: "Servicio 8 · Crear los links de pago",
				description: [
					"El cliente ya eligió cuántas cuotas: se arma el pago y se devuelven **los links de Págalo**. El bot los entrega y **ahí termina la conversación** — el cliente no confirma nada; nosotros detectamos el pago y le avisamos por WhatsApp.",
					"",
					"**Son uno o dos links**, y el cliente tiene que pagar **todos**, en cualquier orden. Hay dos porque el capital y el resto de la cuota se cobran por separado; para el cliente son simplemente *Pago 1 de 2* y *Pago 2 de 2*. Cuando la selección no lleva capital (solo mora) o es solo capital, viene **un solo link**. Usá `mensajes.completo`, que ya lo explica.",
					"",
					"**El orden es fijo: primero `MORA_INTERES`, después `CAPITAL`** — el mismo orden en que se aplica el dinero. Mandalos como vienen en `links[]`; la numeración (*Pago 1 de 2*) ya viene calculada y es la misma que usa el servicio 9.",
					"",
					"**Solo se manda el `monto`** (el `opcionNMonto` de la opción que eligió el cliente): como cada opción tiene un monto distinto, con eso sabemos cuántas cuotas son. Se recalculan las opciones al momento y, si ese monto ya no está entre ellas (entró un pago, cambió la mora), responde `409 MONTO_DESACTUALIZADO`: volvé a `/pago-link/opciones` y mostrale las opciones nuevas.",
					"",
					"Si el cliente vuelve a pedir lo mismo con un pago ya en curso, se le responden **los mismos links** (o el que le falta pagar), nunca unos nuevos encima.",
					"",
					"**Los links no expiran por ahora** (`expira: null`).",
				].join("\n"),
				operationId: "crearPagoLink",
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["referencia", "numeroSifco", "monto"],
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
									monto: {
										type: "string",
										description:
											"El `opcionNMonto` de la opción que eligió el cliente, tal cual lo devolvió `/opciones` (string con dos decimales). Identifica la opción: no se manda cantidad de cuotas.",
									},
								},
							},
							example: {
								referencia: "3b530493-eff1-492d-8394-26adf5b5e211",
								numeroSifco: "01010214124000",
								monto: "6179.26",
							},
						},
					},
				},
				responses: {
					"200": {
						description:
							"Los links listos para mandar. **Un `200` también cubre el reintento**: si ya había un pago en curso con la misma selección se devuelven los mismos links, y si el cliente ya pagó uno de los dos viene solo el pendiente.",
						content: {
							"application/json": {
								examples: {
									dos_links: {
										summary: "Selección con capital y rubros: dos links",
										value: {
											success: true,
											data: {
												pago: {
													referenciaPago:
														"9f21c4d0-7b1e-4c1a-9a6d-2f0c3e5b8d41",
													montoTotal: "6179.26",
													expira: null,
												},
												links: [
													{
														tipo: "MORA_INTERES",
														titulo: "Pago 1 de 2",
														monto: "3079.26",
														url: "https://checkout.pagalo.co/…",
													},
													{
														tipo: "CAPITAL",
														titulo: "Pago 2 de 2",
														monto: "3100.00",
														url: "https://checkout.pagalo.co/…",
													},
												],
												mensajes: {
													titulo: "💳 Tus links de pago",
													completo:
														"💳 *Tus links de pago*\n\nTu pago de Q6,179.26 se divide en dos partes. Pagá *ambas*, en el orden que querás:\n\n*Pago 1 de 2* — Q3,079.26\nhttps://checkout.pagalo.co/…\n\n*Pago 2 de 2* — Q3,100.00\nhttps://checkout.pagalo.co/…\n\nEn cuanto se confirmen te mandamos tu recibo por acá. No necesitás avisarnos.",
												},
											},
										},
									},
									un_link: {
										summary: "Selección de solo mora (o solo capital): un link",
										value: {
											success: true,
											data: {
												pago: {
													referenciaPago:
														"c2a7e9b4-51d3-4f0e-8b2a-6d9f1c3e7a50",
													montoTotal: "1250.00",
													expira: null,
												},
												links: [
													{
														tipo: "MORA_INTERES",
														titulo: "Pago",
														monto: "1250.00",
														url: "https://checkout.pagalo.co/…",
													},
												],
												mensajes: {
													titulo: "💳 Tu link de pago",
													completo:
														"💳 *Tu link de pago*\n\nPagá Q1,250.00 acá:\nhttps://checkout.pagalo.co/…\n\nEn cuanto se confirme te mandamos tu recibo por acá. No necesitás avisarnos.",
												},
											},
										},
									},
								},
							},
						},
					},
					"400": {
						description:
							"Faltan datos, o `monto` no tiene el formato esperado.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								example: {
									success: false,
									error: {
										codigo: "PARAMETROS_INVALIDOS",
										mensaje: "Faltan datos para armar tu pago.",
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
						description: "El crédito no es de ese cliente.",
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
									CREDITO_SIN_DATOS: {
										summary: "El crédito está en el CRM pero no en cartera",
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
							"No se pueden generar links en este momento. Ruteá por `codigo`.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								examples: {
									MONTO_DESACTUALIZADO: {
										summary:
											"El `monto` ya no corresponde a ninguna opción vigente (cambió la deuda desde que se mostraron): volvé a `/opciones`",
										value: {
											success: false,
											error: {
												codigo: "MONTO_DESACTUALIZADO",
												mensaje:
													"El monto de tu pago cambió. Te muestro las opciones actualizadas.",
											},
										},
									},
									PAGO_EN_PROCESO: {
										summary:
											"Un pago por link ya está aplicándose, quedó en revisión, o hay uno en curso con su asesor: jamás links nuevos en esa ventana",
										value: {
											success: false,
											error: {
												codigo: "PAGO_EN_PROCESO",
												mensaje:
													"Tu pago se está aplicando. En cuanto se confirme te mandamos tu recibo.",
											},
										},
									},
								},
							},
						},
					},
					"500": {
						description: "Error nuestro.",
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
					"502": {
						description:
							"Págalo no respondió. **No queda nada a medias**: el cliente puede reintentar más tarde o subir su boleta.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								example: {
									success: false,
									error: {
										codigo: "PAGALO_NO_DISPONIBLE",
										mensaje:
											"No pudimos generar tu link de pago en este momento. Intenta más tarde o sube tu boleta.",
									},
								},
							},
						},
					},
					"503": {
						description:
							"Falta configuración del servidor, o cartera no respondió.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								examples: {
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
									CARTERA_NO_DISPONIBLE: {
										summary: "Cartera no contestó: reintentar en un rato",
										value: {
											success: false,
											error: {
												codigo: "CARTERA_NO_DISPONIBLE",
												mensaje:
													"No pudimos consultar tu crédito en este momento. Intenta de nuevo en unos minutos.",
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
		"/api/bot/cobros/pago-link/estado": {
			post: {
				tags: ["Pago con link"],
				summary: "Servicio 9 · ¿Ya pagó los links de esta conversación?",
				description: [
					"Dice si los links que el bot generó **en esta conversación** para ese crédito ya están pagados, según **nuestra base** (nosotros verificamos cada pago contra Págalo y guardamos el comprobante). Mismos parámetros que los otros dos servicios: `referencia` y `numeroSifco`.",
					"",
					"`estado` viene en tres valores: **`PAGADOS`** (todos los links pagados; ya lo estamos aplicando al crédito), **`PARCIAL`** (uno pagado, el otro no: te decimos cuál falta y te devolvemos su link para que lo reenvíes) y **`SIN_PAGO`** (ninguno pagado; te devolvemos los links activos).",
					"",
					"El mismo veredicto viene en **booleanos** para que no haya que comparar textos: `pagado`, `pagoParcial` y `sinPago`, y van dos veces — al lado de `success` y dentro de `data` — para leerlos desde donde le quede mejor al flujo. Solo uno de los tres es `true`. Cada link trae además su propio `pagado` (`link1Pagado`, `link2Pagado`, y `pagado` dentro de `links[]`).",
					"",
					"Viene plano como las opciones: `totalLinks`, `linksPagados`, `linksPendientes` y `link1Titulo`/`link1Estado`/`link1Monto`/`link1Url`, `link2…`. `linkNUrl` solo trae valor si ese link sigue pendiente. `mensajes.completo` ya lo dice todo en el tono del bot.",
					"",
					"Mismo orden que el servicio 8 —primero `MORA_INTERES`, después `CAPITAL`—, así *Pago 1 de 2* es siempre el mismo link en los dos servicios.",
					"",
					"Un pago recién hecho puede tardar unos minutos en reflejarse (lo detectamos nosotros, D-49). Si no hay links generados en esta conversación responde `409 SIN_LINKS`.",
				].join("\n"),
				operationId: "estadoPagoLink",
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
								referencia: "3f9c2a1e-6b7d-4c8e-9a0b-1c2d3e4f5a6b",
								numeroSifco: "01010214117590",
							},
						},
					},
				},
				responses: {
					"200": {
						description: "Estado de los links de la conversación.",
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										success: { type: "boolean", enum: [true] },
										pagado: {
											type: "boolean",
											description:
												'`estado === "PAGADOS"`. Mismo valor que `data.pagado`.',
										},
										pagoParcial: {
											type: "boolean",
											description: '`estado === "PARCIAL"`.',
										},
										sinPago: {
											type: "boolean",
											description: '`estado === "SIN_PAGO"`.',
										},
										data: {
											type: "object",
											properties: {
												estado: {
													type: "string",
													enum: ["PAGADOS", "PARCIAL", "SIN_PAGO"],
												},
												pagado: { type: "boolean" },
												pagoParcial: { type: "boolean" },
												sinPago: { type: "boolean" },
												numeroSifco: { type: "string" },
												referenciaPago: {
													type: "string",
													format: "uuid",
													description:
														"El mismo `pago.referenciaPago` que devolvió `/crear`.",
												},
												totalLinks: { type: "integer" },
												linksPagados: { type: "integer" },
												linksPendientes: { type: "integer" },
												link1Titulo: { type: "string" },
												link1Estado: {
													type: "string",
													enum: ["PAGADO", "PENDIENTE"],
												},
												link1Pagado: {
													type: "boolean",
													description: '`link1Estado === "PAGADO"`.',
												},
												link1Monto: { type: "string" },
												link1Url: {
													type: "string",
													nullable: true,
													description: "Solo si sigue pendiente.",
												},
												link2Titulo: { type: "string" },
												link2Estado: {
													type: "string",
													enum: ["PAGADO", "PENDIENTE"],
												},
												link2Pagado: { type: "boolean" },
												link2Monto: { type: "string" },
												link2Url: { type: "string", nullable: true },
												links: {
													type: "array",
													description: "Lo mismo, como lista.",
													items: {
														type: "object",
														properties: {
															tipo: {
																type: "string",
																enum: ["CAPITAL", "MORA_INTERES"],
															},
															titulo: { type: "string" },
															monto: { type: "string" },
															estado: {
																type: "string",
																enum: ["PAGADO", "PENDIENTE"],
															},
															pagado: { type: "boolean" },
															url: { type: "string", nullable: true },
														},
													},
												},
												mensajes: {
													type: "object",
													properties: { completo: { type: "string" } },
												},
											},
										},
									},
								},
								examples: {
									pagados: {
										summary: "Los dos links pagados",
										value: {
											success: true,
											pagado: true,
											pagoParcial: false,
											sinPago: false,
											data: {
												estado: "PAGADOS",
												pagado: true,
												pagoParcial: false,
												sinPago: false,
												numeroSifco: "01010214117590",
												referenciaPago: "9d4b2b7a-2c0a-4b1e-8a4d-5f6e7a8b9c0d",
												totalLinks: 2,
												linksPagados: 2,
												linksPendientes: 0,
												link1Titulo: "Pago 1 de 2",
												link1Estado: "PAGADO",
												link1Pagado: true,
												link1Monto: "3937.62",
												link1Url: null,
												link2Titulo: "Pago 2 de 2",
												link2Estado: "PAGADO",
												link2Pagado: true,
												link2Monto: "800.00",
												link2Url: null,
												links: [
													{
														tipo: "MORA_INTERES",
														titulo: "Pago 1 de 2",
														monto: "3937.62",
														estado: "PAGADO",
														pagado: true,
														url: null,
													},
													{
														tipo: "CAPITAL",
														titulo: "Pago 2 de 2",
														monto: "800.00",
														estado: "PAGADO",
														pagado: true,
														url: null,
													},
												],
												mensajes: {
													completo:
														"✅ Ya recibimos tus 2 pagos. Los estamos aplicando a tu crédito; en cuanto quede listo te mandamos tu recibo por WhatsApp.",
												},
											},
										},
									},
									parcial: {
										summary: "Solo uno pagado: se devuelve el que falta",
										value: {
											success: true,
											pagado: false,
											pagoParcial: true,
											sinPago: false,
											data: {
												estado: "PARCIAL",
												pagado: false,
												pagoParcial: true,
												sinPago: false,
												numeroSifco: "01010214117590",
												referenciaPago: "9d4b2b7a-2c0a-4b1e-8a4d-5f6e7a8b9c0d",
												totalLinks: 2,
												linksPagados: 1,
												linksPendientes: 1,
												link1Titulo: "Pago 1 de 2",
												link1Estado: "PENDIENTE",
												link1Pagado: false,
												link1Monto: "3937.62",
												link1Url: "https://checkout.pagalodev.com/xyz789",
												link2Titulo: "Pago 2 de 2",
												link2Estado: "PAGADO",
												link2Pagado: true,
												link2Monto: "800.00",
												link2Url: null,
												links: [
													{
														tipo: "MORA_INTERES",
														titulo: "Pago 1 de 2",
														monto: "3937.62",
														estado: "PENDIENTE",
														pagado: false,
														url: "https://checkout.pagalodev.com/xyz789",
													},
													{
														tipo: "CAPITAL",
														titulo: "Pago 2 de 2",
														monto: "800.00",
														estado: "PAGADO",
														pagado: true,
														url: null,
													},
												],
												mensajes: {
													completo:
														"Recibimos tu *Pago 2 de 2* ✅. Te falta completar:\n*Pago 1 de 2* (Q3,937.62): https://checkout.pagalodev.com/xyz789\n\nSi pagaste hace poco, puede tardar unos minutos en reflejarse.",
												},
											},
										},
									},
									sin_pago: {
										summary: "Ninguno pagado todavía",
										value: {
											success: true,
											pagado: false,
											pagoParcial: false,
											sinPago: true,
											data: {
												estado: "SIN_PAGO",
												pagado: false,
												pagoParcial: false,
												sinPago: true,
												numeroSifco: "01010214117590",
												referenciaPago: "9d4b2b7a-2c0a-4b1e-8a4d-5f6e7a8b9c0d",
												totalLinks: 2,
												linksPagados: 0,
												linksPendientes: 2,
												link1Titulo: "Pago 1 de 2",
												link1Estado: "PENDIENTE",
												link1Pagado: false,
												link1Monto: "3937.62",
												link1Url: "https://checkout.pagalodev.com/xyz789",
												link2Titulo: "Pago 2 de 2",
												link2Estado: "PENDIENTE",
												link2Pagado: false,
												link2Monto: "800.00",
												link2Url: "https://checkout.pagalodev.com/abc123",
												links: [
													{
														tipo: "MORA_INTERES",
														titulo: "Pago 1 de 2",
														monto: "3937.62",
														estado: "PENDIENTE",
														pagado: false,
														url: "https://checkout.pagalodev.com/xyz789",
													},
													{
														tipo: "CAPITAL",
														titulo: "Pago 2 de 2",
														monto: "800.00",
														estado: "PENDIENTE",
														pagado: false,
														url: "https://checkout.pagalodev.com/abc123",
													},
												],
												mensajes: {
													completo:
														"Todavía no vemos ningún pago. Tus links siguen activos:\n*Pago 1 de 2* (Q3,937.62): https://checkout.pagalodev.com/xyz789\n*Pago 2 de 2* (Q800.00): https://checkout.pagalodev.com/abc123\n\nSi pagaste hace poco, puede tardar unos minutos en reflejarse.",
												},
											},
										},
									},
								},
							},
						},
					},
					"400": {
						description: "Faltan `referencia` o `numeroSifco`.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								example: {
									success: false,
									error: {
										codigo: "PARAMETROS_INVALIDOS",
										mensaje: "Faltan datos para consultar tu pago.",
									},
								},
							},
						},
					},
					"401": {
						description:
							"La referencia no sirve o la sesión (30 min) expiró: volver al servicio 1.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								examples: {
									SESION_VENCIDA: {
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
						description: "El `numeroSifco` no es de este cliente.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								example: {
									success: false,
									error: {
										codigo: "CREDITO_NO_ENCONTRADO",
										mensaje: "No encontramos ese crédito.",
									},
								},
							},
						},
					},
					"409": {
						description:
							"En esta conversación no se generaron links de pago (o ya no queda ninguno vivo).",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/RespuestaError" },
								example: {
									success: false,
									error: {
										codigo: "SIN_LINKS",
										mensaje:
											"No encontramos links de pago en esta conversación. Si querés pagar con link, elegí esa opción en el menú.",
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
						description: "Falta configuración del servidor.",
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
