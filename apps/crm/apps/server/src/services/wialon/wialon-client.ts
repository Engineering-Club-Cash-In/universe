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
	type WialonSearchItemResponse,
	type WialonSearchItemsResponse,
	type WialonSensorMeta,
	type WialonSession,
	type WialonUnitCalcLastItem,
} from "./wialon-types";

const DEFAULT_BASE_URL = "https://hst-api.wialon.com/wialon/ajax.html";
const DEFAULT_LOCATOR_URL = "https://gps.lalegion.gt/locator/index.html";
const DEFAULT_TIMEOUT_MS = 15_000;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 horas de vigencia en caché
const NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos para unidades sin sensores o errores transitorios
const MAX_SENSOR_CACHE_SIZE = 1000; // Cota máxima de entradas en memoria para evitar crecimiento indefinido

// Diccionario calibrado para los dispositivos GPS de La Legión / Club Cash-In
// Cubre valores estándar como "Encendido", "Apagado", "APAGADO (Apagado)", "Motor encendido/apagado", etc.
const IGNITION_ON_REGEX =
	/^(?:motor\s+encendido|ignici[oó]n\s+(?:on|encendida?)|encendido|encendida|on|encendido\s*\([^)]*\))$/i;
const IGNITION_OFF_REGEX =
	/^(?:motor\s+apagado|ignici[oó]n\s+(?:off|apagada?)|apagado|apagada|off|apagado\s*\([^)]*\))$/i;

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
	private sessionCache: WialonSession | null = null;
	private loginPromise: Promise<string> | null = null;
	private ignitionSensorCache = new Map<
		number,
		{ sensorId: string | null; expiresAt: number; lookupFailed?: boolean }
	>();

	constructor(config?: Partial<WialonConfig>, customFetch?: WialonFetch) {
		this.config = getWialonConfig(config);
		this.fetchFn = customFetch || globalThis.fetch.bind(globalThis);
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
	 * Envía una solicitud HTTP al endpoint base de Wialon con control de timeout
	 */
	private async requestRaw(
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
	 * Autenticación en Wialon mediante token/login.
	 * Protegido contra concurrencia compartiendo la promesa en vuelo.
	 */
	public async login(force = false): Promise<string> {
		if (!this.config.token) {
			throw new WialonClientError(
				"No se ha configurado el token de Wialon (WIALON_TOKEN)",
				"WIALON_AUTH_REQUIRED",
			);
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
				const res = (await this.requestRaw("token/login", {
					token: this.config.token,
				})) as {
					eid: string;
					user?: { id: number; nm: string };
					tm?: number;
				};

				if (!res?.eid) {
					throw new WialonClientError(
						"Respuesta de login inválida: no se recibió 'eid'",
						"WIALON_INVALID_RESPONSE",
					);
				}

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
			)) as WialonSearchItemsResponse;

			if (!data || typeof data !== "object" || !Array.isArray(data.items)) {
				throw new WialonClientError(
					"Respuesta inesperada de Wialon: se esperaba un objeto con 'items' en 'core/search_items'",
					"WIALON_INVALID_RESPONSE",
				);
			}

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
									propName: "sys_id",
									propValueMask: chunk.join(","),
									sortType: "sys_name",
								},
								force: 1,
								flags: 4099, // 1 (base: 0x1) | 2 (custom properties / prp: 0x2) | 4096 (sensors: 0x1000)
								from: 0,
								to: 0xffffffff,
							},
							sid,
						)) as {
							items?: Array<{
								id: number;
								sens?: Record<string, WialonSensorMeta>;
								prp?: Record<string, unknown>;
							}>;
						};

						const foundIds = new Set<number>();
						if (Array.isArray(metaRes?.items)) {
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
				)) as WialonUnitCalcLastItem[];

				if (Array.isArray(batch)) {
					for (const raw of batch) {
						if (raw && typeof raw.i === "number" && !rawMap.has(raw.i)) {
							rawMap.set(raw.i, raw);
						}
					}
				} else if (
					typeof (batch as Record<string, unknown>)?.error !== "number"
				) {
					throw new WialonClientError(
						"Respuesta inesperada de Wialon: se esperaba un arreglo en 'unit/calc_last'",
						"WIALON_INVALID_RESPONSE",
					);
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
			)) as WialonSearchItemResponse;

			if (
				!data ||
				typeof data !== "object" ||
				!data.item ||
				typeof data.item !== "object"
			) {
				throw new WialonClientError(
					"Respuesta inesperada de Wialon: se esperaba un objeto con 'item' en 'core/search_item'",
					"WIALON_INVALID_RESPONSE",
				);
			}

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
			const data = (await this.requestRaw("token/update", params, sid)) as {
				h: string;
				app: string;
				dur: number;
				items: number[];
			};

			if (!data?.h) {
				throw new WialonClientError(
					"Respuesta de token/update inválida: no se recibió el hash 'h'",
					"WIALON_INVALID_RESPONSE",
				);
			}

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
	 * Diagnóstico y verificación de credenciales de conexión con Wialon.
	 * Valida activamente la sesión contra la API aguas arriba para garantizar que el SID
	 * no ha sido revocado por Wialon, ejecutando auto-renovación transparente si expiró.
	 */
	public async checkHealth(force = false): Promise<{
		status: "connected";
		sid: string;
		user?: { id: number; nm: string };
	}> {
		if (force) {
			await this.login(true);
		}

		return this.executeWithSession(async (sid) => {
			await this.requestRaw(
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
			);

			return {
				status: "connected",
				sid,
				user: this.sessionCache?.user,
			};
		});
	}
}

/**
 * Instancia singleton por defecto para el servidor CRM
 */
let defaultClientInstance: WialonClient | null = null;

export function getWialonClient(): WialonClient {
	if (!defaultClientInstance) {
		defaultClientInstance = new WialonClient();
	}
	return defaultClientInstance;
}

export function setWialonClient(client: WialonClient | null): void {
	defaultClientInstance = client;
}
