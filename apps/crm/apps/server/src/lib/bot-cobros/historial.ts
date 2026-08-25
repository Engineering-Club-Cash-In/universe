/**
 * El historial de interacciones del bot (CB-110): qué hizo cada cliente en el
 * bot, para enseñarlo en la Ficha 360 agrupado por referencia.
 *
 * Contrato: docs/features/bot-whatsapp-cobros/06-historial-interacciones.md
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REGLA GENERAL (D-41): TODO SERVICIO DEL BOT NACE DENTRO DEL HISTORIAL.
 *
 * El middleware se monta comodín sobre `/api/bot/cobros/*`, así que un endpoint
 * nuevo queda registrado sin que nadie haga nada. Lo excepcional es lo
 * contrario: quedar fuera exige una entrada en `RUTAS_SIN_HISTORIAL`, con
 * nombre y motivo. Al crear un servicio nuevo, lo único opcional es su curador
 * (D-42): sin él se registra igual —acción, éxito, `codigo`— con `detalle`
 * vacío. Seguro por defecto: lo que no está en una allowlist no se escribe.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Las reglas duras (espíritu de D-28):
 *   1. El INSERT va sin `await`, con try/catch y log: el bot nunca espera al
 *      historial ni ve un 500 por su culpa.
 *   2. Se lee un CLON de la respuesta; la que viaja al bot no se toca.
 *   3. El contrato con SimpleTech no cambia en nada — por eso el Swagger no se
 *      toca y `openapi.test.ts` sigue en verde sin cambios.
 */

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "../../db";
import { botCobrosInteracciones } from "../../db/schema/bot-cobros-interacciones";
import { coDebtors, opportunities } from "../../db/schema/crm";
import { otps } from "../../db/schema/otp";

/**
 * Lo montado bajo `/api/bot/cobros/` que NO es una interacción del cliente.
 * Cada entrada nueva acá tiene la molestia de escribirse y justificarse —
 * mismo patrón que `RUTAS_QUE_NO_SON_DE_SIMPLETECH` en el candado del Swagger.
 */
export const RUTAS_SIN_HISTORIAL = new Set([
	// Documentación para SimpleTech: la abre un navegador, no un cliente.
	"/api/bot/cobros/docs",
	"/api/bot/cobros/openapi.json",
	// El circuito de vuelta: lo llama CARTERA (D-39), no el cliente.
	"/api/bot/cobros/pagos/evento",
]);

/** Las rutas conocidas, con su nombre de acción para la ficha. */
const ACCIONES: Record<string, string> = {
	"/api/bot/cobros/buscar-cliente": "buscar_cliente",
	"/api/bot/cobros/creditos": "listar_creditos",
	"/api/bot/cobros/credito/info": "menu_credito",
	"/api/bot/cobros/credito/estado-cuenta": "estado_cuenta",
	"/api/bot/cobros/boleta/leer": "boleta_leer",
	"/api/bot/cobros/boleta/confirmar": "boleta_confirmar",
	"/api/bot/cobros/pago-link/opciones": "pago_link_opciones",
	"/api/bot/cobros/pago-link/crear": "pago_link_crear",
};

/**
 * Una ruta futura sin entrada en `ACCIONES` se registra igual, con la acción
 * derivada de la ruta (`/pago/link` → `pago_link`): la regla general.
 */
export function accionDeRuta(ruta: string): string {
	const conocida = ACCIONES[ruta];
	if (conocida) return conocida;

	return ruta
		.replace(/^\/api\/bot\/cobros\//, "")
		.replace(/[^a-zA-Z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
}

const ES_UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Los códigos que emite la AUTENTICACIÓN (auth.ts), no el cliente (Codex,
 * PR #1411). El middleware comodín envuelve también a `autenticarBotCobros`:
 * sin este descarte, una petición rechazada por API key mala —pero con una
 * `referencia` real en el body— se colgaría de la sesión del cliente como si
 * él hubiera hecho algo, ensuciando la línea de tiempo que ve el asesor.
 */
const CODIGOS_DE_AUTENTICACION = new Set([
	"NO_AUTORIZADO",
	"SERVICIO_NO_DISPONIBLE",
]);

/**
 * La llave de PERSONA que sobrevive a los borrados (Codex, PR #1411, 4ª
 * ronda): sha256 del DPI sin espacios (misma normalización que `eqDpi`).
 *
 * El vínculo del codeudor multi-lead con las fichas se resolvía por su fila
 * de `co_debtors` — pero borrar esa fila limpia el FK vía SET NULL y la
 * sesión desaparecía de todas las fichas menos la del `lead_id` guardado. El
 * hash identifica a la persona sin importar qué filas sigan vivas, y va
 * HASHEADO y no en claro porque esta tabla no guarda PII (D-42, alineado con
 * la propuesta de D-14). Null cuando la identificación no fue por DPI
 * (placa/NIT del titular): esos flujos no necesitan el cruce por persona.
 */
export function hashPersona(dpi: string): string {
	return createHash("sha256").update(dpi.replace(/\s/g, "")).digest("hex");
}

/**
 * Deja visibles solo los últimos 4 caracteres: suficiente para que el asesor
 * reconozca el dato, inútil para reconstruirlo (D-42).
 */
export function enmascarar(valor: string): string {
	const limpio = valor.trim();
	if (limpio.length <= 4) return "*".repeat(limpio.length);
	return "*".repeat(limpio.length - 4) + limpio.slice(-4);
}

type Json = Record<string, unknown>;

const texto = (valor: unknown): string | null =>
	typeof valor === "string" && valor.trim() !== "" ? valor.trim() : null;

const numero = (valor: unknown): number | null =>
	typeof valor === "number" && Number.isFinite(valor) ? valor : null;

/** Mete el campo solo si tiene valor: un detalle sin nulls de relleno. */
function conValor(detalle: Json): Json {
	const limpio: Json = {};
	for (const [llave, valor] of Object.entries(detalle)) {
		if (valor !== null && valor !== undefined) limpio[llave] = valor;
	}
	return limpio;
}

/**
 * La allowlist por acción (D-42): de cada request/respuesta se copian SOLO los
 * campos nombrados acá. El código OTP, los teléfonos completos, el
 * identificador crudo y las URLs de imagen no tienen curador que los copie, y
 * por eso no pueden llegar a la tabla.
 */
const CURADORES: Record<
	string,
	(cuerpo: Json, data: Json, exito: boolean) => Json
> = {
	buscar_cliente: (cuerpo, data) =>
		conValor({
			tipoBusqueda: texto(data.tipoBusqueda),
			busqueda: texto(String(cuerpo.search ?? ""))
				? enmascarar(String(cuerpo.search))
				: null,
			celEnCrm: typeof data.celEnCrm === "boolean" ? data.celEnCrm : null,
			// Ya viene enmascarado del endpoint; acá no se toca ningún teléfono.
			otpEnviadoA: texto(data.otpEnviadoA),
			otpSimulado: data.otpSimulado === true ? true : null,
		}),

	// El mismo curador sirve para el acceso fallido: solo cambia la acción.
	acceso_fallido: (cuerpo, data) =>
		conValor({
			busqueda: texto(String(cuerpo.search ?? ""))
				? enmascarar(String(cuerpo.search))
				: null,
			reintentarEnSegundos: numero(data.reintentarEnSegundos),
		}),

	listar_creditos: (_cuerpo, data, exito) =>
		conValor({
			creditos: exito ? numero(data.cantidadCreditos) : null,
			intentosRestantes: numero(data.intentosRestantes),
		}),

	// El crédito consultado va en la columna `numero_sifco`; nada más que decir.
	menu_credito: () => ({}),
	estado_cuenta: () => ({}),

	boleta_leer: (_cuerpo, data, exito) => {
		const lectura = (data.lectura ?? {}) as Json;
		const banco = (lectura.banco ?? {}) as Json;
		return conValor({
			boletaId: texto(data.boletaId),
			intento: numero(data.intento),
			monto: exito ? texto(lectura.monto) : null,
			banco: exito ? texto(banco.nombre) : null,
			confianza: texto(data.confianza),
		});
	},

	boleta_confirmar: (cuerpo, data, exito) =>
		conValor({
			boletaId: texto(String(cuerpo.boletaId ?? "")),
			pagos: exito && Array.isArray(data.pagoIds) ? data.pagoIds.length : null,
			cuotas:
				exito && Array.isArray(data.cuotasCubiertas)
					? data.cuotasCubiertas.length
					: null,
			monto: exito ? texto(data.monto) : null,
			banco: exito ? texto(data.banco) : null,
		}),

	// Pago con link (CB-105, §4.4 del contrato): cuántas opciones se ofrecieron
	// y con qué atraso. Nada de URLs de pago.
	pago_link_opciones: (_cuerpo, data, exito) => {
		const resumen = (data.resumen ?? {}) as Json;
		return conValor({
			opciones: exito ? numero(data.cantidadOpciones) : null,
			cuotasAtrasadas: exito ? numero(resumen.cuotasAtrasadas) : null,
			mora: exito ? texto(resumen.mora) : null,
		});
	},

	// El monto elegido, cuántos links salieron y el id del grupo (para soporte).
	// La URL de Págalo JAMÁS: es un link cobrable.
	pago_link_crear: (cuerpo, data, exito) => {
		const pago = (data.pago ?? {}) as Json;
		return conValor({
			monto: texto(String(cuerpo.monto ?? "")),
			links: exito && Array.isArray(data.links) ? data.links.length : null,
			referenciaPago: exito ? texto(pago.referenciaPago) : null,
		});
	},
};

/**
 * Identidad que el handler resolvió y el body no trae (D-43): sin esto, los
 * intentos de `buscar-cliente` donde el OTP nunca se emitió no tendrían ficha.
 * Va en un WeakMap sobre el Request y no en `c.set` para no tocar el tipado
 * de la app entera por un dato interno del historial.
 */
export type IdentidadBot = {
	leadId: string | null;
	coDebtorId: string | null;
	/** DPI de quien se identificó, si lo hubo: de acá sale `persona_hash`. */
	dpi?: string | null;
};

const identidadesAnotadas = new WeakMap<Request, IdentidadBot>();

export function anotarIdentidadBot(c: Context, identidad: IdentidadBot): void {
	identidadesAnotadas.set(c.req.raw, identidad);
}

/**
 * Las requests cuya API key ya se verificó (Codex, PR #1411, 2ª ronda).
 *
 * Filtrar los códigos de autenticación no prueba que la autenticación CORRIÓ:
 * un GET a una ruta POST-only, o una ruta futura no montada, terminan en el
 * 404/405 pelado de Hono —sin pasar por `autenticarBotCobros`— y un body con
 * una referencia real se habría registrado sin ninguna llave válida. La marca
 * la pone el propio `autenticarBotCobros` justo antes de su `next()`, y sin
 * ella el historial no escribe: solo se registra tráfico autenticado.
 *
 * Consecuencia deliberada para rutas futuras: un servicio del bot que no use
 * `autenticarBotCobros` no deja historial — y un servicio del bot sin esa
 * autenticación es un bug de todos modos (D-18).
 */
const requestsAutenticadas = new WeakSet<Request>();

export function marcarBotAutenticado(c: Context): void {
	requestsAutenticadas.add(c.req.raw);
}

export type InteraccionParaGuardar = {
	accion: string;
	exito: boolean;
	codigo: string | null;
	referencia: string | null;
	numeroSifco: string | null;
	detalle: Json;
	identidad: IdentidadBot | null;
};

/**
 * Arma la fila a partir de lo que ya pasó por el cable. Pura a propósito: es
 * lo que prueban los tests, sin base de datos.
 *
 * Devuelve `null` cuando no hay nada que registrar: ruta excluida, o una
 * petición sin sesión NI identidad conocida (un `CLIENTE_NO_ENCONTRADO` de un
 * desconocido no tiene ficha donde mostrarse, D-43).
 */
export function armarInteraccion(entrada: {
	ruta: string;
	cuerpo: Json;
	estado: number;
	respuesta: Json;
	identidad: IdentidadBot | null;
}): InteraccionParaGuardar | null {
	if (RUTAS_SIN_HISTORIAL.has(entrada.ruta)) return null;

	const exito = entrada.estado < 400;
	const error = (entrada.respuesta.error ?? {}) as Json;
	const data = (entrada.respuesta.data ?? {}) as Json;
	const codigo = exito ? null : texto(error.codigo);

	// Un rechazo de la autenticación no es una interacción del cliente.
	if (codigo && CODIGOS_DE_AUTENTICACION.has(codigo)) return null;

	// La referencia viaja en el body — salvo en buscar-cliente, donde nace en
	// la respuesta. Se valida la forma: con basura no hay sesión que buscar.
	const referenciaCruda =
		texto(entrada.cuerpo.referencia) ?? texto(data.referencia);
	const referencia =
		referenciaCruda && ES_UUID.test(referenciaCruda) ? referenciaCruda : null;

	if (!referencia && !entrada.identidad) return null;

	let accion = accionDeRuta(entrada.ruta);

	// Encontró al cliente pero el OTP nunca salió (D-43): es la única acción
	// que no se deduce de la ruta sola.
	if (accion === "buscar_cliente" && !exito) {
		accion = "acceso_fallido";
	}

	// En los errores, el `data` del sobre trae los extras (reintentarEnSegundos,
	// intentosRestantes…) además de mensaje y codigo: el curador elige de ahí.
	const curador = CURADORES[accion];
	const detalle = curador ? curador(entrada.cuerpo, data, exito) : {};

	return {
		accion,
		exito,
		codigo,
		referencia,
		numeroSifco: texto(entrada.cuerpo.numeroSifco),
		detalle,
		identidad: entrada.identidad,
	};
}

/**
 * Resuelve la identidad y escribe la fila. Corre DESPUÉS de responder, sin que
 * nadie la espere; sus errores se los traga el llamador.
 *
 * Si la referencia no corresponde a un OTP de cobros y tampoco hay identidad
 * anotada, no se escribe nada: una fila sin dueño no se puede mostrar en
 * ninguna ficha.
 */
export async function persistirInteraccion(
	interaccion: InteraccionParaGuardar,
	// El instante se captura SÍNCRONO en el middleware (Codex, PR #1411, 2ª
	// ronda): el INSERT corre en background tras una o dos consultas de
	// identidad, y con el DEFAULT now() dos peticiones seguidas del bot podían
	// quedar invertidas en la línea de tiempo (y con ellas, el correlativo de
	// "Referencia N").
	registradaEn: Date,
): Promise<void> {
	let otpId: string | null = null;
	let leadId = interaccion.identidad?.leadId ?? null;
	let coDebtorId = interaccion.identidad?.coDebtorId ?? null;
	let dpi = interaccion.identidad?.dpi ?? null;

	if (interaccion.referencia) {
		const [otp] = await db
			.select({
				id: otps.id,
				leadId: otps.leadId,
				coDebtorId: otps.coDebtorId,
				dpi: otps.dpi,
			})
			.from(otps)
			.where(
				and(eq(otps.id, interaccion.referencia), eq(otps.origen, "cobros")),
			)
			.limit(1);

		if (otp) {
			otpId = otp.id;
			leadId = leadId ?? otp.leadId;
			coDebtorId = coDebtorId ?? otp.coDebtorId;
			dpi = dpi ?? otp.dpi;
		}
	}

	// La fila del OTP de un codeudor no trae lead; el titular se resuelve por
	// su oportunidad para que la consulta de la ficha sea un WHERE plano.
	if (coDebtorId && !leadId) {
		const [fila] = await db
			.select({ leadId: opportunities.leadId })
			.from(coDebtors)
			.innerJoin(opportunities, eq(opportunities.id, coDebtors.opportunityId))
			.where(eq(coDebtors.id, coDebtorId))
			.limit(1);

		leadId = fila?.leadId ?? null;
	}

	if (!otpId && !leadId && !coDebtorId) return;

	await db.insert(botCobrosInteracciones).values({
		otpId,
		// La copia SIN FK: es la llave de agrupado de la ficha y sobrevive a la
		// purga del OTP, que a otp_id se lo lleva por SET NULL.
		sesionId: otpId,
		leadId,
		coDebtorId,
		// Grabado, no deducido: si la fila del codeudor se borra después, el
		// SET NULL limpia co_debtor_id y la deducción lo volvería "titular".
		operadoPor: coDebtorId ? "codeudor" : "titular",
		// La llave de persona que sobrevive a los borrados (sin PII: hasheada).
		personaHash: dpi ? hashPersona(dpi) : null,
		accion: interaccion.accion,
		exito: interaccion.exito,
		codigo: interaccion.codigo,
		numeroSifco: interaccion.numeroSifco,
		detalle: interaccion.detalle,
		creadoEn: registradaEn,
	});
}

/** Lee un JSON sin dejar que un body raro tumbe nada. */
async function jsonSeguro(leer: () => Promise<unknown>): Promise<Json> {
	try {
		const valor = await leer();
		return valor && typeof valor === "object" ? (valor as Json) : {};
	} catch {
		return {};
	}
}

/**
 * El middleware. Se monta ANTES de las rutas del bot, comodín:
 *
 *   app.use("/api/bot/cobros/*", historialBotCobros);
 *
 * Corre después del handler (`await next()` primero) y jamás altera la
 * respuesta: todo lo suyo va en try/catch y el INSERT ni se espera.
 */
export async function historialBotCobros(
	c: Context,
	next: () => Promise<void>,
): Promise<void> {
	// El instante de la interacción se captura ANTES del handler (Codex,
	// PR #1411, 3ª ronda): la línea de tiempo ordena por cuándo el cliente
	// ACTUÓ, no por qué handler terminó primero — una lectura de boleta lenta
	// que empezó antes que un menú rápido tiene que aparecer antes.
	const registradaEn = new Date();

	await next();

	try {
		if (RUTAS_SIN_HISTORIAL.has(c.req.path)) return;

		// Solo tráfico AUTENTICADO deja historial: sin la marca de
		// `autenticarBotCobros` (llave rechazada, o un 404/405 de Hono que ni
		// pasó por la autenticación), acá no se escribe nada.
		if (!requestsAutenticadas.has(c.req.raw)) return;

		// `c.req.json()` reusa el cache del handler; el clon deja intacta la
		// respuesta que viaja al bot.
		const cuerpo = await jsonSeguro(() => c.req.json());
		const respuesta = await jsonSeguro(() => c.res.clone().json());

		const interaccion = armarInteraccion({
			ruta: c.req.path,
			cuerpo,
			estado: c.res.status,
			respuesta,
			identidad: identidadesAnotadas.get(c.req.raw) ?? null,
		});

		if (!interaccion) return;

		// Sin await (D-41): si la escritura falla se pierde una fila de
		// historial, no una conversación.
		void persistirInteraccion(interaccion, registradaEn).catch((err) =>
			console.error("[BotCobros] No se pudo guardar la interacción:", err),
		);
	} catch (err) {
		console.error("[BotCobros] Historial:", err);
	}
}
