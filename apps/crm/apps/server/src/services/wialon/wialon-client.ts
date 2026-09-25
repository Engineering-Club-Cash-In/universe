import {
	clasificarFallaWialon,
	esOperacionIdempotente,
} from "./wialon-clasificacion";
import { contextoGpsActual } from "./wialon-contexto";
import {
	type CreateLocatorLinkInput,
	createLocatorLinkInputSchema,
	type LocatorLinkResult,
	type SearchUnitsInput,
	searchUnitsInputSchema,
	type UnitStatusSummary,
	WIALON_ERROR_MESSAGES,
	WialonClientError,
	type WialonConfig,
	type WialonFetch,
	type WialonIntentoEvento,
	type WialonMensajeCrudo,
	type WialonMensajePosicion,
	type WialonSearchItemResponse,
	type WialonSearchItemsResponse,
	type WialonSensorMeta,
	type WialonSession,
	type WialonTelemetriaUnidad,
	type WialonUnitCalcLastItem,
	type WialonUnitItem,
} from "./wialon-types";

const DEFAULT_BASE_URL = "https://hst-api.wialon.com/wialon/ajax.html";
const DEFAULT_LOCATOR_URL = "https://gps.lalegion.gt/locator/index.html";
const DEFAULT_TIMEOUT_MS = 15_000;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 horas de vigencia en caché
const NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos para unidades sin sensores o errores transitorios
const MAX_SENSOR_CACHE_SIZE = 1000; // Cota máxima de entradas en memoria para evitar crecimiento indefinido

// ── Política de reintentos y circuit breaker (CB-121) ─────────────────────────
// Solo operaciones de LECTURA (ver WIALON_SVC_IDEMPOTENTES) se reintentan de
// forma transparente ante una falla clasificada como transitoria. Las
// escrituras (crear/borrar link, futuros comandos de CB-120) nunca se
// reintentan automáticamente: si su resultado queda incierto, se propaga tal
// cual para que quien las llamó decida — nunca se ejecuta una acción
// ambigua sin que alguien lo confirme.
const MAX_REINTENTOS_LECTURA = 2; // hasta 3 intentos en total
const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 1500;

// Circuito abierto tras N fallos reintentables consecutivos: mientras está
// abierto, las lecturas ni siquiera llaman a Wialon (fail fast) y responden
// de inmediato con WIALON_NO_DISPONIBLE, dejando que la UI ofrezca la
// contingencia manual en vez de acumular más timeouts.
const CIRCUITO_UMBRAL_FALLOS = 5;
const CIRCUITO_ABIERTO_MS = 60 * 1000;

function esperar(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function exigirItems(mensaje: string): (data: unknown) => void {
	return (data) => {
		if (
			!data ||
			typeof data !== "object" ||
			!Array.isArray((data as { items?: unknown }).items)
		) {
			throw new WialonClientError(mensaje, "WIALON_INVALID_RESPONSE");
		}
	};
}

// Diccionario calibrado para los dispositivos GPS de La Legión / Club Cash-In
// Cubre valores estándar como "Encendido", "Apagado", "APAGADO (Apagado)", "Motor encendido/apagado", etc.
const IGNITION_ON_REGEX =
	/^(?:motor\s+encendido|ignici[oó]n\s+(?:on|encendida?)|encendido|encendida|on|encendido\s*\([^)]*\))$/i;
const IGNITION_OFF_REGEX =
	/^(?:motor\s+apagado|ignici[oó]n\s+(?:off|apagada?)|apagado|apagada|off|apagado\s*\([^)]*\))$/i;

/**
 * Deriva el ambiente lógico a partir del host de baseUrl, para mostrar en diagnósticos
 * sin exponer la URL completa como único indicador.
 */
export function resolveWialonEnvironment(
	baseUrl: string,
): "produccion" | "hosting-wialon" | "personalizado" {
	try {
		const host = new URL(baseUrl).hostname.toLowerCase();
		if (host === "lalegion.gt" || host.endsWith(".lalegion.gt")) {
			return "produccion";
		}
		if (host === "wialon.com" || host.endsWith(".wialon.com")) {
			return "hosting-wialon";
		}
		return "personalizado";
	} catch {
		return "personalizado";
	}
}

export function findIgnitionSensorId(
	sens?: Record<string, WialonSensorMeta>,
	prp?: Record<string, unknown>,
): string | null {
	// 1. Prioridad máxima: Sensor configurado explícitamente en las propiedades de la unidad (prp.monitoring_sensor_id)
	const monitoringSensorId = prp?.monitoring_sensor_id;
	if (
		(typeof monitoringSensorId === "string" ||
			typeof monitoringSensorId === "number") &&
		monitoringSensorId !== "" &&
		monitoringSensorId !== 0 &&
		monitoringSensorId !== "0"
	) {
		const targetId = String(monitoringSensorId);
		// Si la lista de sensores está presente, validar que el ID exista como clave o propiedad id
		if (
			!sens ||
			sens[targetId] ||
			Object.values(sens).some((s) => String(s?.id) === targetId)
		) {
			return targetId;
		}
	}

	if (!sens || typeof sens !== "object") return null;

	// 2. Tipo estándar de Wialon para ignición / operación de motor
	for (const [id, s] of Object.entries(sens)) {
		if (s?.t?.toLowerCase() === "engine operation") {
			return String(s.id ?? id);
		}
	}

	// 3. Nombre o medición con "ignición" o "encendido"
	for (const [id, s] of Object.entries(sens)) {
		const name = s?.n?.toLowerCase() || "";
		const measurement = s?.m?.toLowerCase() || "";
		if (
			name.includes("ignici") ||
			name.includes("encendido") ||
			measurement.includes("encendido/apagado")
		) {
			return String(s.id ?? id);
		}
	}

	return null;
}

/**
 * Núcleo de una placa guatemalteca: 3 dígitos + 3 letras ("720GVH").
 *
 * Es lo único estable entre cómo se escribe la placa en el CRM y cómo se llama
 * la unidad en Wialon. El prefijo varía ("P-", "C-", sin prefijo, y ~10% de las
 * placas del CRM vienen como "P0-720GVH", con un cero tipeado de más) y los
 * separadores también ("P - 278KJQ" vs "P-278KJQ SIN APAGADO").
 *
 * Para la placa del CRM la forma se valida COMPLETA (anclada): un valor mal
 * cargado como "P-1720GVH" o "P-720GVHX" no tiene núcleo, en vez de reducirse
 * a "720GVH" y vincular sola la unidad P-720GVH de otro cliente. Contra las
 * 1376 placas de la base de desarrollo, anclar no deja afuera ninguna placa
 * válida.
 */
const PLACA_CRM = /^\s*(?:[A-Z]{1,2}0?\s*-?\s*)?(\d{3})\s*-?\s*([A-Z]{3})\s*$/;

/**
 * En el NOMBRE de una unidad la placa viene con texto alrededor ("Bidgar Yatz
 * - C-629BNC", "P-720GVH SIN APAGADO"): se busca dentro, pero con bordes (sin
 * dígito antes ni letra/dígito después) por el mismo motivo.
 */
const PLACA_EN_NOMBRE = /(?:^|[^0-9])(\d{3})[\s-]*([A-Z]{3})(?![A-Z0-9])/;

/**
 * Extrae el núcleo de una placa del CRM, o null si no tiene forma de placa.
 * Los valores de relleno que existen en el CRM ("NUEVO", "N/A", "EJEMPLO",
 * "0") y las placas mal cargadas no tienen núcleo: se tratan como "sin placa"
 * en vez de buscarlos en el catálogo.
 */
export function extraerNucleoPlaca(
	valor: string | null | undefined,
): { digitos: string; letras: string } | null {
	const match = (valor ?? "").toUpperCase().match(PLACA_CRM);
	if (!match?.[1] || !match[2]) return null;
	return { digitos: match[1], letras: match[2] };
}

/** Núcleo de placa dentro del nombre de una unidad de Wialon, o null. */
export function extraerNucleoDeNombreUnidad(
	nombre: string | null | undefined,
): { digitos: string; letras: string } | null {
	const match = (nombre ?? "").toUpperCase().match(PLACA_EN_NOMBRE);
	if (!match?.[1] || !match[2]) return null;
	return { digitos: match[1], letras: match[2] };
}

/**
 * Resuelve qué unidad de Wialon corresponde a una placa, buscando su núcleo
 * dentro del nombre de la unidad ("Bidgar Yatz - C-629BNC" → 629BNC).
 *
 * El núcleo tiene que aparecer COMPLETO y con bordes: sin un dígito antes ni
 * una letra/dígito después. Con una subcadena suelta, una placa incompleta
 * ("P-123A") o un núcleo más largo ("1720GVH") elegían una unidad ajena, y
 * como la deducción se guarda, el error quedaba fijado hasta que alguien lo
 * notara. El prefijo se ignora a propósito: si P-720GVH y C-720GVH existen
 * las dos, el resultado es "ambiguo" y decide un supervisor.
 *
 * Devuelve null cuando hay CERO o MÁS DE UNA coincidencia: una unidad llamada
 * "A-04" no trae placa y no se puede adivinar, y si dos unidades comparten la
 * placa elegir cualquiera mandaría al gestor de campo al vehículo equivocado.
 * En ambos casos decide un supervisor desde la ficha.
 */
export function matchUnidadPorPlaca<T extends { id: number; nm: string }>(
	placa: string,
	items: T[],
): {
	unidad: T | null;
	motivo: "ok" | "sin_placa" | "sin_coincidencia" | "ambiguo";
	// Las unidades que coincidieron: con "ambiguo" son las opciones entre las
	// que elige el supervisor (el catálogo de entrada puede traer más, porque
	// la búsqueda en Wialon se prefiltra solo por los dígitos de la placa).
	coincidencias: T[];
} {
	const nucleo = extraerNucleoPlaca(placa);
	if (!nucleo) {
		return { unidad: null, motivo: "sin_placa", coincidencias: [] };
	}

	const patron = new RegExp(
		`(^|[^0-9])${nucleo.digitos}[\\s-]*${nucleo.letras}([^A-Z0-9]|$)`,
	);
	const coincidencias = items.filter((item) =>
		patron.test((item?.nm ?? "").toUpperCase()),
	);

	if (coincidencias.length === 0) {
		return { unidad: null, motivo: "sin_coincidencia", coincidencias };
	}
	if (coincidencias.length > 1) {
		return { unidad: null, motivo: "ambiguo", coincidencias };
	}
	return { unidad: coincidencias[0], motivo: "ok", coincidencias };
}

/**
 * Extrae la fecha del último paquete recibido de una respuesta de
 * `core/search_item`. Wialon entrega epoch en SEGUNDOS (no milisegundos):
 * pasarlo directo a `new Date()` daría 1970.
 *
 * Prefiere `lmsg.t` (el mensaje en sí) sobre `pos.t` (la posición dentro del
 * mensaje); normalmente coinciden, pero una unidad puede reportar sin fix de
 * GPS y entonces solo hay lmsg.
 */
export function extraerUltimaSenal(detail: {
	item?: { pos?: { t?: number }; lmsg?: { t?: number } };
}): Date | null {
	// Cada candidato se valida por separado: con `lmsg.t ?? pos.t`, un lmsg con
	// t: 0 (o basura) tapaba un pos.t válido, porque 0 no es null/undefined.
	const valido = (t: unknown): number | null =>
		typeof t === "number" && Number.isFinite(t) && t > 0 ? t : null;
	const epochSegundos =
		valido(detail?.item?.lmsg?.t) ?? valido(detail?.item?.pos?.t);
	if (epochSegundos == null) return null;

	const fecha = new Date(epochSegundos * 1000);
	return Number.isNaN(fecha.getTime()) ? null : fecha;
}

/**
 * Fechas del último MENSAJE (`lmsg.t`) y de la última POSICIÓN (`pos.t`) de
 * una unidad, por separado. No son lo mismo: un rastreador puede seguir
 * mandando mensajes sin fix de GPS, y entonces lmsg.t es reciente mientras
 * las coordenadas (pos) son viejas. Para decir qué tan confiable es la
 * UBICACIÓN que se muestra hay que usar pos.t; lmsg.t solo dice que el equipo
 * sigue vivo. Epoch en segundos, igual que extraerUltimaSenal.
 */
export function extraerFechasUnidad(detail: {
	item?: { pos?: { t?: number } | null; lmsg?: { t?: number } | null };
}): { ultimoMensajeAt: Date | null; ultimaPosicionAt: Date | null } {
	const aFecha = (t: unknown): Date | null =>
		typeof t === "number" && Number.isFinite(t) && t > 0
			? new Date(t * 1000)
			: null;
	return {
		ultimoMensajeAt: aFecha(detail?.item?.lmsg?.t),
		ultimaPosicionAt: aFecha(detail?.item?.pos?.t),
	};
}

function parsePositiveInt(val: unknown, fallback: number): number {
	const num =
		typeof val === "number" ? val : Number.parseInt(String(val ?? ""), 10);
	return Number.isFinite(num) && num > 0 ? num : fallback;
}

export function getWialonConfig(
	overrides?: Partial<WialonConfig>,
): WialonConfig {
	const has = (key: keyof WialonConfig) =>
		Boolean(overrides && Object.hasOwn(overrides, key));

	return {
		baseUrl: has("baseUrl")
			? (overrides?.baseUrl ?? DEFAULT_BASE_URL)
			: process.env.WIALON_BASE_URL || DEFAULT_BASE_URL,
		locatorBaseUrl: has("locatorBaseUrl")
			? (overrides?.locatorBaseUrl ?? DEFAULT_LOCATOR_URL)
			: process.env.WIALON_LOCATOR_URL || DEFAULT_LOCATOR_URL,
		token: has("token") ? overrides?.token : process.env.WIALON_TOKEN,
		timeoutMs: has("timeoutMs")
			? parsePositiveInt(overrides?.timeoutMs, DEFAULT_TIMEOUT_MS)
			: parsePositiveInt(process.env.WIALON_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
	};
}

export class WialonClient {
	private readonly config: WialonConfig;
	private readonly fetchFn: WialonFetch;
	private readonly onIntento?: (evento: WialonIntentoEvento) => void;
	private sessionCache: WialonSession | null = null;
	private loginPromise: Promise<string> | null = null;
	private ignitionSensorCache = new Map<
		number,
		{ sensorId: string | null; expiresAt: number; lookupFailed?: boolean }
	>();

	// Circuit breaker en memoria (CB-121): cuenta fallos reintentables
	// consecutivos de operaciones idempotentes. No distingue por svc a
	// propósito — si Wialon está caído, lo está para todo el cliente.
	private fallosConsecutivos = 0;
	private circuitoAbiertoHasta: number | null = null;

	constructor(
		config?: Partial<WialonConfig>,
		customFetch?: WialonFetch,
		onIntento?: (evento: WialonIntentoEvento) => void,
	) {
		this.config = getWialonConfig(config);
		this.fetchFn = customFetch || globalThis.fetch.bind(globalThis);
		this.onIntento = onIntento;
	}

	/**
	 * Limpia la sesión de autenticación en caché manualmente.
	 * Si se proporciona failingSid, solo invalida si la sesión en caché coincide con el SID fallido,
	 * preservando una sesión que ya fue renovada por otra petición concurrente.
	 */
	public clearSession(failingSid?: string): void {
		if (!failingSid || this.sessionCache?.eid === failingSid) {
			this.sessionCache = null;
		}
	}

	/**
	 * Limpia la caché de metadatos de sensores manualmente
	 */
	public clearSensorCache(): void {
		this.ignitionSensorCache.clear();
	}

	/**
	 * Almacena o actualiza metadatos de sensor en caché con cota de tamaño (LRU/TTL).
	 * Si la caché alcanza MAX_SENSOR_CACHE_SIZE, purga expirados o descarta el más antiguo.
	 */
	private setSensorCache(
		unitId: number,
		sensorId: string | null,
		expiresAt: number,
		lookupFailed = false,
	): void {
		if (this.ignitionSensorCache.size >= MAX_SENSOR_CACHE_SIZE) {
			const now = Date.now();
			for (const [id, val] of this.ignitionSensorCache) {
				if (val.expiresAt <= now) {
					this.ignitionSensorCache.delete(id);
				}
			}
			if (this.ignitionSensorCache.size >= MAX_SENSOR_CACHE_SIZE) {
				const oldestKey = this.ignitionSensorCache.keys().next().value;
				if (oldestKey !== undefined) {
					this.ignitionSensorCache.delete(oldestKey);
				}
			}
		}
		this.ignitionSensorCache.set(unitId, { sensorId, expiresAt, lookupFailed });
	}

	/**
	 * Pre-carga o registra manualmente el ID del sensor de ignición para una unidad
	 */
	public setUnitIgnitionSensor(unitId: number, sensorId: string | null): void {
		this.setSensorCache(unitId, sensorId, Date.now() + SESSION_TTL_MS);
	}

	/**
	 * Retorna la sesión actual en memoria (si no ha expirado)
	 */
	public getCachedSession(): WialonSession | null {
		if (this.sessionCache && this.sessionCache.expiresAt > Date.now()) {
			return this.sessionCache;
		}
		return null;
	}

	/**
	 * Configuración efectiva del cliente, sin datos sensibles (nunca incluye el token).
	 * Pensada para paneles de diagnóstico/administración.
	 */
	public getPublicConfig(): {
		baseUrl: string;
		locatorUrl: string;
		timeoutMs: number;
		tokenConfigured: boolean;
	} {
		return {
			baseUrl: this.config.baseUrl,
			locatorUrl: this.config.locatorBaseUrl,
			timeoutMs: this.config.timeoutMs,
			tokenConfigured: Boolean(this.config.token),
		};
	}

	/**
	 * Envía una solicitud HTTP al endpoint base de Wialon con control de timeout.
	 * Es UN SOLO intento, sin reintento — eso lo maneja `requestRaw`, que
	 * envuelve esta función con la política de reintentos/circuito y emite
	 * los eventos de bitácora técnica (CB-121).
	 */
	private async requestRawUnaVez(
		svc: string,
		params: Record<string, unknown>,
		sid?: string,
	): Promise<unknown> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

		const formData = new URLSearchParams();
		formData.append("svc", svc);
		formData.append("params", JSON.stringify(params));
		if (sid) {
			formData.append("sid", sid);
		}

		try {
			const response = await this.fetchFn(this.config.baseUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body: formData.toString(),
				signal: controller.signal,
			});

			if (!response.ok) {
				throw new WialonClientError(
					`Wialon HTTP Error: ${response.status} ${response.statusText}`,
					"WIALON_NETWORK_ERROR",
					undefined,
					response.status,
				);
			}

			let data: Record<string, unknown>;
			try {
				data = (await response.json()) as Record<string, unknown>;
			} catch {
				throw new WialonClientError(
					`Respuesta upstream inválida (no es JSON) tras llamar a ${svc} (status ${response.status})`,
					"WIALON_INVALID_RESPONSE",
					undefined,
					response.status,
				);
			}

			// Wialon reporta errores con la propiedad "error": <number> (donde error > 0 es un código de fallo)
			if (typeof data?.error === "number" && data.error > 0) {
				const errorCode = data.error;
				const message =
					WIALON_ERROR_MESSAGES[errorCode] ||
					`Error de Wialon con código: ${errorCode}`;

				if (errorCode === 1) {
					throw new WialonClientError(
						message,
						"WIALON_INVALID_SESSION",
						errorCode,
					);
				}

				throw new WialonClientError(message, "WIALON_API_ERROR", errorCode);
			}

			return data;
		} catch (error: unknown) {
			if (error instanceof WialonClientError) {
				throw error;
			}
			if (error instanceof Error && error.name === "AbortError") {
				throw new WialonClientError(
					`Wialon API timeout tras ${this.config.timeoutMs}ms`,
					"WIALON_TIMEOUT",
				);
			}
			throw new WialonClientError(
				error instanceof Error
					? error.message
					: "Error de red al conectar con Wialon",
				"WIALON_NETWORK_ERROR",
			);
		} finally {
			clearTimeout(timer);
		}
	}

	/**
	 * Estado del circuit breaker de ESTA instancia (CB-121), para el panel de
	 * salud admin. No consulta Date.now() contra circuitoAbiertoHasta con la
	 * lógica de expiración de circuitoSigueAbierto() a propósito: leer el
	 * estado no debe tener el efecto secundario de "medio-abrir" el circuito.
	 */
	public getEstadoCircuito(): { abierto: boolean; fallosConsecutivos: number } {
		return {
			abierto:
				this.circuitoAbiertoHasta !== null &&
				Date.now() < this.circuitoAbiertoHasta,
			fallosConsecutivos: this.fallosConsecutivos,
		};
	}

	/** Si el circuito sigue abierto, en microsegundos; null si está cerrado o ya expiró. */
	private circuitoSigueAbierto(): boolean {
		if (this.circuitoAbiertoHasta === null) return false;
		if (Date.now() >= this.circuitoAbiertoHasta) {
			// Expiró: pasa a "half-open" — se deja pasar el próximo intento para
			// probar si Wialon ya respondió, sin resetear el contador todavía
			// (eso solo pasa si ese intento de prueba tiene éxito).
			this.circuitoAbiertoHasta = null;
			return false;
		}
		return true;
	}

	private registrarExitoCircuito(): void {
		this.fallosConsecutivos = 0;
		this.circuitoAbiertoHasta = null;
	}

	// Solo los fallos transitorios (timeout, red, 5xx) cuentan, de lecturas o
	// escrituras. Un error de contrato o de negocio no dice que Wialon se
	// recuperó, así que tampoco cierra el circuito ni reinicia el contador.
	private registrarFalloCircuito(): void {
		this.fallosConsecutivos += 1;
		if (this.fallosConsecutivos >= CIRCUITO_UMBRAL_FALLOS) {
			this.circuitoAbiertoHasta = Date.now() + CIRCUITO_ABIERTO_MS;
		}
	}

	private emitirEvento(evento: Omit<WialonIntentoEvento, "contexto">): void {
		if (!this.onIntento) return;
		try {
			this.onIntento({ ...evento, contexto: contextoGpsActual() });
		} catch {
			// El hook nunca debe romper una llamada real a Wialon.
		}
	}

	/**
	 * Envuelve `requestRawUnaVez` con: circuit breaker (fail-fast si la
	 * integración lleva varios fallos consecutivos), reintento automático
	 * SOLO para svc de lectura ante una falla clasificada como transitoria, y
	 * emisión de un evento por intento para la bitácora técnica (CB-121).
	 *
	 * Las escrituras (svc no idempotente) nunca se reintentan acá: si fallan
	 * por timeout/red, no hay forma de saber si Wialon sí llegó a aplicar el
	 * cambio, así que se marca "incierto" y se propaga tal cual — reintentar
	 * solo sería repetir una acción que quizás ya ocurrió.
	 */
	private async requestRaw(
		svc: string,
		params: Record<string, unknown>,
		sid?: string,
		// Valida la forma de la respuesta ANTES de registrar el intento como
		// exitoso: un contrato roto (ej. login sin eid) debe quedar como error
		// crítico en la bitácora, no como ok.
		validar?: (data: unknown) => void,
	): Promise<unknown> {
		const idempotente = esOperacionIdempotente(svc);

		// Las escrituras también: con Wialon caído terminarían en timeout y
		// quedarían como resultado incierto. Fallar antes deja claro que no se
		// aplicaron y no obliga a verificarlas a mano.
		if (this.circuitoSigueAbierto()) {
			this.emitirEvento({
				intento: 1,
				operacion: svc,
				resultado: "error",
				errorCode: "WIALON_NO_DISPONIBLE",
				severidad: "warning",
				duracionMs: 0,
			});
			throw new WialonClientError(
				"La integración con Wialon está temporalmente deshabilitada por fallos repetidos; use la contingencia manual.",
				"WIALON_NO_DISPONIBLE",
			);
		}

		const maxIntentos = idempotente ? MAX_REINTENTOS_LECTURA + 1 : 1;
		let ultimoError: unknown;

		for (let intento = 1; intento <= maxIntentos; intento++) {
			const inicio = Date.now();
			let dataRecibida: unknown;
			try {
				const data = await this.requestRawUnaVez(svc, params, sid);
				dataRecibida = data;
				validar?.(data);
				const duracionMs = Date.now() - inicio;
				this.registrarExitoCircuito();
				this.emitirEvento({
					intento,
					operacion: svc,
					resultado: intento > 1 ? "reintentado" : "ok",
					severidad: "info",
					duracionMs,
					requestResumen: params,
					responseResumen: data,
				});
				return data;
			} catch (error) {
				const duracionMs = Date.now() - inicio;
				ultimoError = error;
				const { severidad, reintentable } = clasificarFallaWialon(error, svc);
				const codigo =
					error instanceof WialonClientError ? error.code : undefined;
				const wialonErrorCode =
					error instanceof WialonClientError
						? error.wialonErrorCode
						: undefined;
				const httpStatus =
					error instanceof WialonClientError ? error.status : undefined;

				const quedanIntentos =
					idempotente && reintentable && intento < maxIntentos;
				// Cuenta cualquier falla transitoria, también de escrituras: aunque
				// no se reintenten solas, un timeout dice igual que Wialon no responde.
				if (reintentable) this.registrarFalloCircuito();

				// Se registra el desenlace final, no un "error" genérico:
				// - escritura con falla transitoria → "incierto" (pide verificar a mano).
				// - sesión vencida → "reintentado": executeWithSession re-autentica
				//   y repite la operación; no es una falla de la integración.
				const resultado = quedanIntentos
					? "reintentado"
					: codigo === "WIALON_INVALID_SESSION"
						? "reintentado"
						: !idempotente && reintentable
							? "incierto"
							: "error";

				this.emitirEvento({
					intento,
					operacion: svc,
					resultado,
					errorCode: codigo,
					wialonErrorCode,
					httpStatus,
					severidad,
					duracionMs,
					requestResumen: params,
					...(dataRecibida !== undefined
						? { responseResumen: dataRecibida }
						: {}),
				});

				if (!quedanIntentos) break;

				const backoff = Math.min(
					BACKOFF_BASE_MS * 2 ** (intento - 1),
					BACKOFF_MAX_MS,
				);
				await esperar(backoff + Math.random() * 200);
			}
		}

		// Escritura (no idempotente) que falló por una causa transitoria: no
		// sabemos si Wialon sí llegó a aplicar el cambio antes de que la
		// conexión se cortara. Se marca "incierto" en vez de "error" para que
		// quien llamó NUNCA la reintente sola — que un humano verifique antes
		// de repetir la acción (CB-121: no ejecutar acciones ambiguas).
		if (!idempotente && ultimoError instanceof WialonClientError) {
			const { reintentable } = clasificarFallaWialon(ultimoError, svc);
			if (reintentable) {
				throw new WialonClientError(
					`No se pudo confirmar si "${svc}" se aplicó en Wialon (${ultimoError.message}). Verifique manualmente antes de repetir la acción.`,
					"WIALON_RESULTADO_INCIERTO",
					ultimoError.wialonErrorCode,
					ultimoError.status,
				);
			}
		}

		throw ultimoError;
	}

	/**
	 * Autenticación en Wialon mediante token/login.
	 * Protegido contra concurrencia compartiendo la promesa en vuelo.
	 */
	public async login(force = false): Promise<string> {
		if (!this.config.token) {
			const error = new WialonClientError(
				"No se ha configurado el token de Wialon (WIALON_TOKEN)",
				"WIALON_AUTH_REQUIRED",
			);
			// Falla antes de requestRaw: sin este evento no quedaría en la
			// bitácora ni abriría la alerta crítica, y toda consulta GPS fallaría
			// sin que nadie se entere.
			this.emitirEvento({
				intento: 1,
				operacion: "token/login",
				resultado: "error",
				errorCode: error.code,
				severidad: clasificarFallaWialon(error).severidad,
				duracionMs: 0,
			});
			throw error;
		}

		if (!force) {
			if (this.sessionCache && this.sessionCache.expiresAt > Date.now()) {
				return this.sessionCache.eid;
			}

			if (this.loginPromise) {
				return this.loginPromise;
			}
		} else {
			if (this.loginPromise) {
				try {
					await this.loginPromise;
				} catch {
					// Ignora error previo si se está forzando re-autenticación
				}
			}
			this.sessionCache = null;
		}

		// Dedup en vuelo: peticiones concurrentes comparten la misma promesa para evitar
		// saturar a Wialon con múltiples token/login. Si la petición falla, ambas reciben
		// el mismo error transitorio; la promesa se limpia en 'finally' solo si sigue siendo
		// la promesa actual, evitando pisar una re-autenticación forzada concurrente.
		let p: Promise<string> | null = null;
		p = (async () => {
			try {
				const res = (await this.requestRaw(
					"token/login",
					{ token: this.config.token },
					undefined,
					(data) => {
						if (!(data as { eid?: unknown } | null)?.eid) {
							throw new WialonClientError(
								"Respuesta de login inválida: no se recibió 'eid'",
								"WIALON_INVALID_RESPONSE",
							);
						}
					},
				)) as {
					eid: string;
					user?: { id: number; nm: string };
					tm?: number;
				};

				this.sessionCache = {
					eid: res.eid,
					user: res.user,
					expiresAt: Date.now() + SESSION_TTL_MS,
				};
				return res.eid;
			} finally {
				if (this.loginPromise === p) {
					this.loginPromise = null;
				}
			}
		})();

		this.loginPromise = p;
		return p;
	}

	/**
	 * Ejecuta una operación garantizando sesión válida y auto-renovación silenciosa
	 * si Wialon devuelve error de sesión (error: 1).
	 * Protegido contra bucles con reintento único explícito.
	 */
	private async executeWithSession<T>(
		operation: (sid: string) => Promise<T>,
		isRetry = false,
	): Promise<T> {
		const sid = await this.login();
		try {
			return await operation(sid);
		} catch (error) {
			if (
				!isRetry &&
				error instanceof WialonClientError &&
				error.code === "WIALON_INVALID_SESSION"
			) {
				// Sesión expirada en Wialon (código 1): invalidamos solo si el SID fallido sigue siendo el actual
				// para no descartar una sesión ya renovada por otra petición concurrente.
				this.clearSession(sid);
				return await this.executeWithSession(operation, true);
			}
			throw error;
		}
	}

	/**
	 * Lista y busca unidades asociadas al usuario (svc: core/search_items)
	 */
	public async searchUnits(
		input?: SearchUnitsInput,
	): Promise<WialonSearchItemsResponse> {
		const parsed = searchUnitsInputSchema.parse(input ?? {});
		const cleanFilter = parsed.filterName?.replace(/[*?]/g, "").trim();
		const filterMask = cleanFilter ? `*${cleanFilter}*` : "*";

		const params = {
			spec: {
				itemsType: "avl_unit",
				propName: "sys_name",
				propValueMask: filterMask,
				sortType: "sys_name",
			},
			force: 1,
			flags: parsed.flags,
			from: parsed.from,
			to: parsed.to,
		};

		return this.executeWithSession(async (sid) => {
			const data = (await this.requestRaw(
				"core/search_items",
				params,
				sid,
				exigirItems(
					"Respuesta inesperada de Wialon: se esperaba un objeto con 'items' en 'core/search_items'",
				),
			)) as WialonSearchItemsResponse;

			// Pre-cargar caché de sensores de ignición para unidades devueltas solo si
			// la consulta incluyó tanto propiedades (prp) como sensores (sens) para garantizar autoritatividad
			const hasPrpFlag = (parsed.flags & 2) !== 0;
			const hasSensFlag = (parsed.flags & 4096) !== 0;
			if (hasPrpFlag && hasSensFlag) {
				for (const item of data.items) {
					if (item.sens || item.prp) {
						const sensorId = findIgnitionSensorId(item.sens, item.prp);
						this.setSensorCache(
							item.id,
							sensorId,
							Date.now() + (sensorId ? SESSION_TTL_MS : NEGATIVE_CACHE_TTL_MS),
						);
					}
				}
			}

			return data;
		});
	}

	/**
	 * Consulta el estado y telemetría consolidada de una o varias unidades (svc: unit/calc_last)
	 */
	public async getUnitsStatus(unitIds: number[]): Promise<UnitStatusSummary[]> {
		if (!unitIds.length) return [];

		const uniqueIds = Array.from(new Set(unitIds));

		return this.executeWithSession(async (sid) => {
			// Intentar resolver metadatos de sensores de ignición para unidades no cacheadas
			const now = Date.now();
			const missingIds = uniqueIds.filter((id) => {
				const cached = this.ignitionSensorCache.get(id);
				return !cached || cached.expiresAt <= now;
			});

			if (missingIds.length > 0) {
				const METADATA_CHUNK_SIZE = 100;
				for (let i = 0; i < missingIds.length; i += METADATA_CHUNK_SIZE) {
					const chunk = missingIds.slice(i, i + METADATA_CHUNK_SIZE);
					try {
						const metaRes = (await this.requestRaw(
							"core/search_items",
							{
								spec: {
									itemsType: "avl_unit",
									propName: chunk.map(() => "sys_id").join(","),
									propValueMask: chunk.join(","),
									propType: chunk.map(() => "property").join(","),
									sortType: "sys_name",
									or_logic: 1,
								},
								force: 1,
								flags: 4099, // 1 (base: 0x1) | 2 (custom properties / prp: 0x2) | 4096 (sensors: 0x1000)
								from: 0,
								to: 0xffffffff,
							},
							sid,
							exigirItems(
								"Respuesta inesperada de Wialon: se esperaba un objeto con 'items' en 'core/search_items'",
							),
						)) as {
							items: Array<{
								id: number;
								sens?: Record<string, WialonSensorMeta>;
								prp?: Record<string, unknown>;
							}>;
						};

						const foundIds = new Set<number>();
						for (const item of metaRes.items) {
							foundIds.add(item.id);
							const sensorId = findIgnitionSensorId(item.sens, item.prp);
							this.setSensorCache(
								item.id,
								sensorId,
								Date.now() +
									(sensorId ? SESSION_TTL_MS : NEGATIVE_CACHE_TTL_MS),
							);
						}

						// Negative caching: si Wialon no devuelve item para una unidad consultada,
						// guardar sensorId: null con TTL corto (5 min) para evitar bucles repetitivos en polling
						for (const id of chunk) {
							if (!foundIds.has(id)) {
								this.setSensorCache(
									id,
									null,
									Date.now() + NEGATIVE_CACHE_TTL_MS,
								);
							}
						}
					} catch (error) {
						// Si la sesión expiró upstream (error 1 / WIALON_INVALID_SESSION), relanzar
						// para que executeWithSession renueve el SID y reintente la operación limpia
						// sin contaminar el caché con entradas negativas (null).
						if (
							error instanceof WialonClientError &&
							error.code === "WIALON_INVALID_SESSION"
						) {
							throw error;
						}

						// Fallback si upstream falla por otros motivos (timeout, 502, error de red).
						// Advertir en logs y aplicar negative cache temporal para evitar sobrecargar a Wialon en cada tick
						console.warn("WIALON_SENSOR_METADATA_FETCH_FAILED", {
							missingIds: chunk,
							error: error instanceof Error ? error.message : String(error),
						});
						for (const id of chunk) {
							const cached = this.ignitionSensorCache.get(id);
							if (!cached || cached.expiresAt <= Date.now()) {
								this.setSensorCache(
									id,
									null,
									Date.now() + NEGATIVE_CACHE_TTL_MS,
									true,
								);
							}
						}
					}
				}
			}

			const CALC_CHUNK_SIZE = 100;
			const rawMap = new Map<number, WialonUnitCalcLastItem>();

			for (let i = 0; i < uniqueIds.length; i += CALC_CHUNK_SIZE) {
				const chunk = uniqueIds.slice(i, i + CALC_CHUNK_SIZE);
				const batch = (await this.requestRaw(
					"unit/calc_last",
					{ itemIds: chunk },
					sid,
					(data) => {
						if (
							!Array.isArray(data) &&
							typeof (data as Record<string, unknown> | null)?.error !==
								"number"
						) {
							throw new WialonClientError(
								"Respuesta inesperada de Wialon: se esperaba un arreglo en 'unit/calc_last'",
								"WIALON_INVALID_RESPONSE",
							);
						}
					},
				)) as WialonUnitCalcLastItem[];

				if (Array.isArray(batch)) {
					for (const raw of batch) {
						if (raw && typeof raw.i === "number" && !rawMap.has(raw.i)) {
							rawMap.set(raw.i, raw);
						}
					}
				}
			}

			const result: UnitStatusSummary[] = [];
			for (const id of uniqueIds) {
				const raw = rawMap.get(id);
				if (raw) {
					result.push(this.formatUnitStatus(raw));
				}
			}

			return result;
		});
	}

	private formatUnitStatus(raw: WialonUnitCalcLastItem): UnitStatusSummary {
		const speedValue =
			typeof raw.pos?.s === "number" ? raw.pos.s : raw.pos?.s?.value;

		// Formatear sensores y verificar encendido/apagado
		const formattedSensors: Record<string, string> = {};
		let isIgnitionOn: boolean | undefined;

		if (raw.sensors && typeof raw.sensors === "object") {
			for (const [id, sens] of Object.entries(raw.sensors)) {
				formattedSensors[id] = sens.format?.value || "";
			}

			const cached = this.ignitionSensorCache.get(raw.i);
			const isCacheValid = Boolean(cached && cached.expiresAt > Date.now());

			if (isCacheValid && cached?.lookupFailed) {
				// La búsqueda de metadatos aguas arriba falló (timeout, red o error de API).
				// Preservar la ignición como desconocida (undefined) durante el periodo de backoff
				// para evitar que el fallback heurístico reporte un sensor binario no relacionado como ignición.
			} else if (isCacheValid && cached?.sensorId) {
				// 1. Si identificamos el sensor de ignición por metadatos (tipo 'engine operation' o nombre explícito),
				// evaluamos EXCLUSIVAMENTE ese sensor para evitar que sensores de alarma o GPS alteren el estado.
				const targetSens = raw.sensors[cached.sensorId];
				if (targetSens) {
					const text = targetSens.format?.value?.trim() || "";
					if (IGNITION_ON_REGEX.test(text)) {
						isIgnitionOn = true;
					} else if (IGNITION_OFF_REGEX.test(text)) {
						isIgnitionOn = false;
					} else if (typeof targetSens.value === "number") {
						// Para un sensor de ignición confirmado sin formato de texto: 1 = encendido, 0 = apagado
						if (targetSens.value === 1) isIgnitionOn = true;
						else if (targetSens.value === 0) isIgnitionOn = false;
					}
				}
				// Si el sensor identificado está ausente en la lectura actual o no reporta un estado reconocido,
				// el estado permanece indefinido (desconocido) para evitar que otros sensores (puertas, alarma) alteren el estado.
			} else {
				// 2. Fallback heurístico estricto: solo si no hay metadatos conocidos para la unidad,
				// buscamos patrones inequívocos de ignición sin aceptar vocabulario genérico
				// como 'Conectado', 'Alarma desconectado' o 'GPS off'.
				// Si algún sensor indica encendido, priorizamos encendido (true) para evitar falsos apagados.
				let hasOn = false;
				let hasOff = false;
				for (const sens of Object.values(raw.sensors)) {
					const formatText = sens.format?.value || "";
					const trimmed = formatText.trim();
					if (IGNITION_ON_REGEX.test(trimmed)) {
						hasOn = true;
						break; // Máxima prioridad: el motor está en marcha
					}
					if (IGNITION_OFF_REGEX.test(trimmed)) {
						hasOff = true;
					}
				}
				if (hasOn) {
					isIgnitionOn = true;
				} else if (hasOff) {
					isIgnitionOn = false;
				}
			}
		}

		return {
			unitId: raw.i,
			mileageKm: raw.mileage?.value,
			mileageFormatted: raw.mileage?.format?.value,
			engineHours: raw.engine_hours?.value,
			engineHoursFormatted: raw.engine_hours?.format?.value,
			speedKmh: speedValue,
			latitude: raw.pos?.y,
			longitude: raw.pos?.x,
			isIgnitionOn,
			sensorsFormatted: formattedSensors,
		};
	}

	/**
	 * Fecha y hora del último paquete telemático recibido de una unidad.
	 *
	 * `unit/calc_last` (la fuente de getUnitsStatus) entrega la telemetría ya
	 * calculada pero NO cuándo se recibió, y para cobros ese dato es la mitad de
	 * la historia: una posición de hace tres días no dice dónde está el vehículo,
	 * dice que el GPS dejó de reportar. Se lee de `core/search_item`, que sí trae
	 * `pos.t` / `lmsg.t`.
	 */
	public async getUnitLastSignal(unitId: number): Promise<Date | null> {
		return (await this.getUnitLastTimes(unitId)).ultimoMensajeAt;
	}

	/**
	 * Último mensaje y última posición de la unidad, por separado (ver
	 * extraerFechasUnidad): la frescura de la ubicación se mide con la posición.
	 */
	public async getUnitLastTimes(
		unitId: number,
	): Promise<{ ultimoMensajeAt: Date | null; ultimaPosicionAt: Date | null }> {
		// flags 1025 = datos básicos + último mensaje y posición; es lo que la
		// colección de La Legión usa para leer lmsg, y evita pedir sensores y
		// propiedades que aquí no se ocupan.
		const detail = await this.getUnitDetail(unitId, 1025);
		const fechas = extraerFechasUnidad(detail);
		// Mismo criterio que extraerUltimaSenal para el mensaje: sin lmsg, la
		// posición es lo último que se sabe del equipo.
		return {
			ultimoMensajeAt: fechas.ultimoMensajeAt ?? fechas.ultimaPosicionAt,
			ultimaPosicionAt: fechas.ultimaPosicionAt,
		};
	}

	/**
	 * Consulta detallada de una unidad individual (svc: core/search_item)
	 */
	public async getUnitDetail(
		unitId: number,
		flags = 5123,
	): Promise<WialonSearchItemResponse> {
		return this.executeWithSession(async (sid) => {
			const data = (await this.requestRaw(
				"core/search_item",
				{ id: unitId, flags },
				sid,
				(respuesta) => {
					const item = (respuesta as { item?: unknown } | null)?.item;
					if (!item || typeof item !== "object") {
						throw new WialonClientError(
							"Respuesta inesperada de Wialon: se esperaba un objeto con 'item' en 'core/search_item'",
							"WIALON_INVALID_RESPONSE",
						);
					}
				},
			)) as WialonSearchItemResponse;

			// Pre-cargar caché de sensores solo si la consulta incluyó metadatos completos (prp y sens)
			const hasPrp = (flags & 2) !== 0;
			const hasSens = (flags & 4096) !== 0;
			if (hasPrp && hasSens && (data.item.sens || data.item.prp)) {
				const sensorId = findIgnitionSensorId(data.item.sens, data.item.prp);
				this.setSensorCache(
					data.item.id,
					sensorId,
					Date.now() + (sensorId ? SESSION_TTL_MS : NEGATIVE_CACHE_TTL_MS),
				);
			}

			return data;
		});
	}

	/**
	 * Genera un enlace público temporal de rastreo en tiempo real (svc: token/update)
	 */
	public async createLocatorLink(
		input: CreateLocatorLinkInput,
	): Promise<LocatorLinkResult> {
		const parsed = createLocatorLinkInputSchema.parse(input);
		const duration = parsed.durationSeconds;

		const params = {
			callMode: "create",
			app: "locator",
			at: 0,
			dur: duration,
			fl: 131072,
			p: JSON.stringify({
				note: parsed.note,
				zones: parsed.zones,
				tracks: parsed.tracks,
			}),
			items: [parsed.unitId],
		};

		return this.executeWithSession(async (sid) => {
			const data = (await this.requestRaw(
				"token/update",
				params,
				sid,
				(respuesta) => {
					if (!(respuesta as { h?: unknown } | null)?.h) {
						throw new WialonClientError(
							"Respuesta de token/update inválida: no se recibió el hash 'h'",
							"WIALON_INVALID_RESPONSE",
						);
					}
				},
			)) as {
				h: string;
				app: string;
				dur: number;
				items: number[];
			};

			const fullUrl = `${this.config.locatorBaseUrl}?t=${data.h}`;
			return {
				hash: data.h,
				url: fullUrl,
				unitId: parsed.unitId,
				durationSeconds: duration,
				expiresAt: new Date(Date.now() + duration * 1000),
			};
		});
	}

	/**
	 * Revoca o elimina un enlace de rastreo previamente generado (svc: token/update con callMode: delete)
	 */
	public async deleteLocatorLink(hash: string): Promise<{ success: boolean }> {
		return this.executeWithSession(async (sid) => {
			await this.requestRaw(
				"token/update",
				{ callMode: "delete", h: hash },
				sid,
			);
			return { success: true };
		});
	}

	/**
	 * Telemetría cruda en batch para el job de detección de eventos (CB-119).
	 *
	 * Se apoya en `getUnitsStatus` (ya usado en producción para ignición y
	 * velocidad, resuelve el sensor real en vez de asumir un I/O fijo) y
	 * suma una segunda llamada batch con `core/search_items` (flags 1025 =
	 * base + lmsg, mismo valor que usa la Ficha 360 para telemetría cruda,
	 * ver D-04 en docs/features/cobros-02/09-integracion-gps-wialon.md) para
	 * el voltaje de energía externa (`lmsg.p.pwr_ext`) y el timestamp del
	 * último mensaje — ninguno de los dos viene en `unit/calc_last`.
	 */
	public async getTelemetriaUnidades(
		unitIds: number[],
	): Promise<WialonTelemetriaUnidad[]> {
		if (!unitIds.length) return [];
		const uniqueIds = Array.from(new Set(unitIds));

		const [estados, crudos] = await Promise.all([
			this.getUnitsStatus(uniqueIds),
			this.buscarLmsgPorId(uniqueIds),
		]);

		const estadoPorId = new Map(estados.map((e) => [e.unitId, e]));

		// Si Wialon omite un id en AMBAS respuestas (link viejo, unidad
		// eliminada o sin acceso), no se fabrica una fila con
		// `ultimoMensajeAt: null` — el job de polling interpreta ausencia de
		// última señal como "sin reportar" y generaría una alerta falsa (y
		// guardaría ese estado falso) en la primera corrida que vea esa
		// unidad, en vez de simplemente no tener datos de ella.
		const resultado: WialonTelemetriaUnidad[] = [];
		for (const unitId of uniqueIds) {
			const estado = estadoPorId.get(unitId);
			const crudo = crudos.get(unitId);
			if (!estado && !crudo) continue;

			const pwrExtRaw = crudo?.lmsg?.p?.pwr_ext;
			resultado.push({
				unitId,
				// extraerUltimaSenal (no lmsg.t directo): un lmsg con t ausente o
				// en 0 no debe tapar un pos.t válido — mismo criterio que ya usa
				// el resto del cliente para "última señal" de una unidad.
				ultimoMensajeAt: extraerUltimaSenal({ item: crudo }),
				pwrExt: typeof pwrExtRaw === "number" ? pwrExtRaw : null,
				ignicionOn: estado?.isIgnitionOn ?? null,
				lat: estado?.latitude ?? null,
				lon: estado?.longitude ?? null,
				velocidadKmh: estado?.speedKmh ?? null,
			});
		}
		return resultado;
	}

	private async buscarLmsgPorId(
		unitIds: number[],
	): Promise<Map<number, WialonUnitItem>> {
		return this.executeWithSession(async (sid) => {
			const mapa = new Map<number, WialonUnitItem>();
			const CHUNK_SIZE = 100;

			for (let i = 0; i < unitIds.length; i += CHUNK_SIZE) {
				const chunk = unitIds.slice(i, i + CHUNK_SIZE);
				const data = (await this.requestRaw(
					"core/search_items",
					{
						spec: {
							itemsType: "avl_unit",
							propName: chunk.map(() => "sys_id").join(","),
							propValueMask: chunk.join(","),
							propType: chunk.map(() => "property").join(","),
							sortType: "sys_name",
							or_logic: 1,
						},
						force: 1,
						flags: 1025, // base (0x1) + último mensaje / lmsg (0x400)
						from: 0,
						to: 0xffffffff,
					},
					sid,
					exigirItems(
						"Respuesta inesperada de Wialon: se esperaba un objeto con 'items' en 'core/search_items'",
					),
				)) as { items: WialonUnitItem[] };

				for (const item of data.items) {
					mapa.set(item.id, item);
				}
			}

			return mapa;
		});
	}

	/**
	 * Historial de posiciones de una unidad en un rango de tiempo
	 * (messages/load_interval, CB-119 D-15), para el cálculo de "ubicaciones
	 * clave". El CRM no guarda este historial — Wialon es la fuente de
	 * verdad, se pide sobre demanda cada vez que el job nocturno recalcula.
	 *
	 * Se pagina en tramos de 7 días: pedir 60 días de una sola vez puede
	 * exceder límites de respuesta del proveedor para una unidad con mucho
	 * tráfico de mensajes, y un tramo que falla no debe tumbar los demás
	 * (se degrada a "sin datos para ese tramo", no lanza).
	 *
	 * `messages/unload` en `finally` de cada tramo: Wialon carga los mensajes
	 * en una "capa" del lado servidor al pedir `load_interval`, y esa capa
	 * cuenta contra un límite de la cuenta — sin liberarla, corridas
	 * sucesivas del job (una por unidad, cada noche) podrían agotarlo.
	 */
	public async getHistorialPosiciones(
		unitId: number,
		desde: Date,
		hasta: Date,
	): Promise<WialonMensajePosicion[]> {
		const TRAMO_MS = 7 * 24 * 60 * 60 * 1000;
		const mensajes: WialonMensajePosicion[] = [];

		for (
			let inicioTramo = desde.getTime();
			inicioTramo < hasta.getTime();
			inicioTramo += TRAMO_MS
		) {
			const finTramo = Math.min(inicioTramo + TRAMO_MS, hasta.getTime());

			try {
				const delTramo = await this.executeWithSession(async (sid) => {
					try {
						const data = (await this.requestRaw(
							"messages/load_interval",
							{
								itemId: unitId,
								timeFrom: Math.floor(inicioTramo / 1000),
								timeTo: Math.floor(finTramo / 1000),
								// flags 0 + flagsMask 0: sin filtrar por tipo de mensaje,
								// se quiere todo lo que traiga posición.
								flags: 0,
								flagsMask: 0xff00,
								loadCount: 0xffffffff,
							},
							sid,
						)) as { messages?: WialonMensajeCrudo[] } | unknown;

						const crudos = Array.isArray(
							(data as { messages?: unknown })?.messages,
						)
							? ((data as { messages: WialonMensajeCrudo[] }).messages ?? [])
							: [];

						return crudos
							.filter(
								(
									m,
								): m is WialonMensajeCrudo & {
									pos: NonNullable<WialonMensajeCrudo["pos"]>;
								} =>
									m.pos != null &&
									typeof m.pos.y === "number" &&
									typeof m.pos.x === "number",
							)
							.map((m) => ({
								t: m.t,
								lat: m.pos.y,
								lon: m.pos.x,
								velocidadKmh: typeof m.pos.s === "number" ? m.pos.s : null,
							}));
					} finally {
						// Best-effort: liberar la capa no debe tumbar el resultado ya
						// obtenido si Wialon falla al descargarla.
						await this.requestRaw("messages/unload", {}, sid).catch(() => {});
					}
				});

				mensajes.push(...delTramo);
			} catch (error) {
				console.warn(
					`[WialonClient] No se pudo traer historial de posiciones de la unidad ${unitId} entre ${new Date(inicioTramo).toISOString()} y ${new Date(finTramo).toISOString()}:`,
					error instanceof Error ? error.message : String(error),
				);
			}
		}

		return mensajes;
	}

	/**
	 * Diagnóstico y verificación de credenciales de conexión con Wialon.
	 * Valida activamente la sesión contra la API aguas arriba para garantizar que el SID
	 * no ha sido revocado por Wialon, ejecutando auto-renovación transparente si expiró.
	 */
	public async checkHealth(force = false): Promise<{
		status: "connected";
		sid: string;
		user?: { id: number; nm: string };
		unitCount?: number;
	}> {
		if (force) {
			await this.login(true);
		}

		return this.executeWithSession(async (sid) => {
			const res = (await this.requestRaw(
				"core/search_items",
				{
					spec: {
						itemsType: "avl_unit",
						propName: "sys_name",
						propValueMask: "*",
						sortType: "sys_name",
					},
					force: 1,
					flags: 1,
					from: 0,
					to: 0,
				},
				sid,
				exigirItems(
					"Respuesta inesperada de Wialon durante health check: se esperaba un objeto con 'items' en 'core/search_items'",
				),
			)) as { items: unknown[]; totalItemsCount?: unknown };

			return {
				status: "connected",
				sid,
				user: this.sessionCache?.user,
				unitCount:
					typeof res.totalItemsCount === "number"
						? res.totalItemsCount
						: undefined,
			};
		});
	}
}

/**
 * Instancia singleton por defecto para el servidor CRM
 */
let defaultClientInstance: WialonClient | null = null;

// Hook de bitácora técnica (CB-121), inyectado por `configurarBitacoraWialon`
// desde el router en vez de importarse acá arriba: wialon-client.ts no debe
// depender de `db` (Drizzle) para que se pueda instanciar en tests con solo
// un `customFetch` fake, sin levantar ninguna conexión a la base de datos.
let hookBitacoraWialon: ((evento: WialonIntentoEvento) => void) | undefined;

export function configurarBitacoraWialon(
	hook: (evento: WialonIntentoEvento) => void,
): void {
	hookBitacoraWialon = hook;
	if (defaultClientInstance) {
		// El cliente por defecto ya se había creado (p. ej. otro módulo llamó
		// getWialonClient() antes de que el router configurara el hook): se
		// re-crea para que quede instrumentado, preservando la sesión en
		// caché no tiene sentido acá porque WialonClient no expone forma de
		// migrarla, así que simplemente se reemplaza — el próximo login es
		// transparente para quien llama.
		defaultClientInstance = new WialonClient(undefined, undefined, hook);
	}
}

export function getWialonClient(): WialonClient {
	if (!defaultClientInstance) {
		defaultClientInstance = new WialonClient(
			undefined,
			undefined,
			hookBitacoraWialon,
		);
	}
	return defaultClientInstance;
}

export function setWialonClient(client: WialonClient | null): void {
	defaultClientInstance = client;
}
