import { z } from "zod";

/**
 * Códigos de error estándar de Wialon Remote API
 * Ref: https://sdk.wialon.com/wiki/en/sidebar/remoteapi/apiref/errors
 */
export const WIALON_ERROR_MESSAGES: Record<number, string> = {
	1: "Sesión inválida o expirada",
	2: "Nombre de servicio o método no válido",
	3: "Resultado o respuesta vacía / inválida",
	4: "Entrada o parámetros de solicitud inválidos",
	5: "Error ejecutando la solicitud en el servidor",
	6: "Parámetros desconocidos o insuficientes",
	7: "Acceso denegado o permisos insuficientes",
	8: "Usuario o contraseña inválidos",
	9: "Límite de solicitudes o cuota excedida",
	10: "Límite de paquetes o tamaño excedido",
	11: "Servidor de base de datos no disponible",
	14: "Error de autorización en el servicio de facturación",
};

export class WialonClientError extends Error {
	constructor(
		message: string,
		readonly code:
			| "WIALON_AUTH_REQUIRED"
			| "WIALON_INVALID_SESSION"
			| "WIALON_API_ERROR"
			| "WIALON_TIMEOUT"
			| "WIALON_NETWORK_ERROR"
			| "WIALON_INVALID_RESPONSE"
			// CB-121: una escritura (svc no idempotente) falló por una causa
			// transitoria y no se sabe si Wialon llegó a aplicarla. Nunca se
			// reintenta sola — requiere verificación manual antes de repetir.
			| "WIALON_RESULTADO_INCIERTO"
			// CB-121: el circuit breaker está abierto por fallos consecutivos;
			// ni siquiera se llamó a Wialon en este intento.
			| "WIALON_NO_DISPONIBLE",
		readonly wialonErrorCode?: number,
		readonly status?: number,
	) {
		super(message);
		this.name = "WialonClientError";
	}
}

export type WialonFetch = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

// ── Trazabilidad técnica de la integración (CB-121) ───────────────────────────

/**
 * Severidad de una falla de Wialon, para decidir si abre una alerta y si el
 * error se muestra en detalle solo a roles autorizados.
 *
 * - "critical": la integración no puede operar hasta que alguien intervenga
 *   (token mal configurado, credenciales rechazadas, acceso denegado,
 *   facturación, respuesta upstream que no se pudo interpretar).
 * - "warning": probablemente transitorio (timeout, red, servidor de Wialon
 *   caído momentáneamente) — puede reintentarse si la operación es de lectura.
 * - "info": no es una falla (resultado ok) o es un reintento que sí funcionó.
 */
export type WialonFallaSeveridad = "info" | "warning" | "critical";

export interface WialonFallaClasificacion {
	severidad: WialonFallaSeveridad;
	// Si tiene sentido reintentar ESTE tipo de error (independiente de si el
	// svc es de lectura o escritura — eso lo decide requestRaw aparte).
	reintentable: boolean;
}

/**
 * Contexto de la llamada en curso: de dónde vino (qué endpoint/job del CRM)
 * y para qué caso/usuario, para que la bitácora técnica no dependa de pasar
 * estos datos por parámetro en cada método del cliente.
 */
export interface WialonLlamadaContexto {
	origen: string;
	correlationId: string;
	userId?: string | null;
	vehicleId?: string | null;
	numeroCreditoSifco?: string | null;
	gpsConsultaLogId?: string | null;
}

/** Un evento por cada intento HTTP a Wialon, éxito o error. */
export interface WialonIntentoEvento {
	contexto: WialonLlamadaContexto;
	intento: number;
	operacion: string;
	resultado: "ok" | "error" | "reintentado" | "incierto";
	errorCode?: string;
	wialonErrorCode?: number;
	httpStatus?: number;
	severidad: WialonFallaSeveridad;
	duracionMs: number;
	requestResumen?: unknown;
	responseResumen?: unknown;
}

export interface WialonConfig {
	baseUrl: string;
	locatorBaseUrl: string;
	token?: string;
	timeoutMs: number;
}

export interface WialonSession {
	eid: string;
	user?: {
		id: number;
		nm: string;
	};
	expiresAt: number;
}

// ── Diagnóstico de conexión (panel de administración) ─────────────────────────
export interface WialonDiagnostics {
	connected: boolean;
	environment: "produccion" | "hosting-wialon" | "personalizado";
	baseUrl: string;
	locatorUrl: string;
	timeoutMs: number;
	tokenConfigured: boolean;
	user: { id: number; nm: string } | null;
	sessionExpiresAt: Date | null;
	latencyMs: number | null;
	unitCount: number | null;
	checkedAt: Date;
	error: { code: string; message: string } | null;
}

// Esquema de salida explícito para getWialonDiagnostics: evita que el tipo del
// cliente (apps/web) se infiera como {} cuando TS trunca el appRouter combinado
// (TS7056, mismo motivo que en accounting.ts getReporteNoLiquidados).
export const wialonDiagnosticsOutputSchema = z.object({
	connected: z.boolean(),
	environment: z.enum(["produccion", "hosting-wialon", "personalizado"]),
	baseUrl: z.string(),
	locatorUrl: z.string(),
	timeoutMs: z.number(),
	tokenConfigured: z.boolean(),
	user: z.object({ id: z.number(), nm: z.string() }).nullable(),
	sessionExpiresAt: z.date().nullable(),
	latencyMs: z.number().nullable(),
	unitCount: z.number().nullable(),
	checkedAt: z.date(),
	error: z.object({ code: z.string(), message: z.string() }).nullable(),
});

export const testWialonConnectionOutputSchema = z.object({
	connected: z.boolean(),
	unitCount: z.number().nullable(),
});

// Solo id/nm van tipados: es lo único que consume el catálogo del panel admin
// hoy (evita el cast manual en el frontend). El resto de WialonUnitItem (pos,
// lmsg, sens, prp...) no se serializa para este endpoint; getWialonUnits sigue
// devolviendo el objeto completo sin output() explícito para quien lo necesite.
export const wialonUnitsCatalogOutputSchema = z.object({
	total: z.number(),
	from: z.number(),
	to: z.number(),
	items: z.array(
		z.object({
			id: z.number(),
			nm: z.string(),
			// Créditos del vehículo de la unidad (CB-118): "vinculado" = unidad
			// guardada en el vehículo; "placa" = deducido por núcleo de placa.
			creditos: z.array(
				z.object({
					numeroSifco: z.string(),
					origen: z.enum(["vinculado", "placa"]),
				}),
			),
		}),
	),
});

// Input reducido para getWialonUnitsCatalog: a propósito NO expone `flags`.
// El endpoint fuerza flags:1 (básico, sin prp/sens/pos) en el servicio, porque
// el catálogo solo serializa id/nm — pedir el flag pesado por defecto de
// searchUnitsInputSchema (8392707) transferiría metadata de sensores/posición
// sin uso y dispararía el pre-cacheo de sensores de ignición en cada búsqueda.
export const wialonUnitsCatalogInputSchema = z
	.object({
		filterName: z.string().trim().optional(),
		from: z.number().int().min(0).default(0),
		to: z.number().int().min(0).default(0xffffffff),
	})
	.refine((data) => data.to >= data.from, {
		message: "'to' debe ser mayor o igual que 'from'",
		path: ["to"],
	});
export type WialonUnitsCatalogInput = z.input<
	typeof wialonUnitsCatalogInputSchema
>;

// ── GPS del vehículo en la Ficha 360 (CB-118) ─────────────────────────────────

export const gpsVehiculoInputSchema = z.object({
	// El caso da el gate de acceso (asesor asignado) y el SIFCO de la bitácora;
	// el servidor verifica que vehicleId sea el vehículo de ese caso.
	casoCobroId: z.string().uuid(),
	vehicleId: z.string().uuid(),
	// La historia exige motivo obligatorio para CADA consulta de ubicación —
	// no es metadata opcional, es la condición para que el handler siquiera
	// llame a Wialon. Min 5: un motivo de una palabra suelta ("sí", "ver") no
	// deja rastro útil en la auditoría.
	motivo: z.string().trim().min(5).max(300),
});
export type GpsVehiculoInput = z.infer<typeof gpsVehiculoInputSchema>;

/**
 * Respuesta de getGpsVehiculo como unión discriminada por `estado`.
 *
 * El frontend no debe inferir nada: "no hay unidad vinculada" y "Wialon está
 * caído" se ven parecido si solo se devuelve null, pero para el asesor son
 * situaciones distintas y se muestran distinto. Por eso cada caso viaja con su
 * propio estado y su motivo.
 */
export const gpsVehiculoOutputSchema = z.discriminatedUnion("estado", [
	z.object({
		estado: z.literal("vinculado"),
		// Si la consulta quedó en la bitácora. Con ubicación siempre es true
		// (sin auditoría no se muestra ubicación).
		auditada: z.boolean(),
		unitId: z.number(),
		unitName: z.string(),
		// "persistido" = lo fijó un supervisor; "placa" = lo dedujo el sistema
		// por coincidencia de placa (en esta consulta o en una anterior, ya
		// guardado con wialon_vinculado_por = "auto:placa"). Se muestra en la
		// ficha para que el supervisor sepa si el vínculo es una deducción.
		vinculoOrigen: z.enum(["persistido", "placa"]),
		// Placa del vehículo en el CRM: precarga el buscador cuando el
		// supervisor corrige una unidad deducida ("¿No es esta la unidad?").
		placa: z.string().nullable(),
		telemetria: z.object({
			mileageKm: z.number().optional(),
			mileageFormatted: z.string().optional(),
			engineHours: z.number().optional(),
			engineHoursFormatted: z.string().optional(),
			speedKmh: z.number().optional(),
			latitude: z.number().optional(),
			longitude: z.number().optional(),
			isIgnitionOn: z.boolean().optional(),
			// Último mensaje del equipo (lmsg.t): dice que el GPS sigue vivo.
			ultimaSenalAt: z.date().nullable(),
			// Última posición (pos.t): de cuándo son latitude/longitude. La
			// frescura de la UBICACIÓN se mide con esta, no con ultimaSenalAt.
			ultimaPosicionAt: z.date().nullable(),
		}),
	}),
	z.object({
		estado: z.literal("sin_vinculo"),
		auditada: z.boolean(),
		motivo: z.enum([
			"sin_placa",
			"sin_coincidencia",
			"ambiguo",
			// La unidad que coincide con la placa ya está guardada en otro
			// vehículo (el GPS se reasignó): no se deduce, confirma un supervisor.
			"asignada_a_otro",
		]),
		placa: z.string().nullable(),
		// Solo se llenan cuando el motivo es "ambiguo": son las unidades entre las
		// que el supervisor tiene que elegir.
		candidatos: z.array(z.object({ id: z.number(), nm: z.string() })),
	}),
	z.object({
		estado: z.literal("no_disponible"),
		auditada: z.boolean(),
		error: z.object({ code: z.string(), message: z.string() }),
		// CB-121: correlationId de la bitácora técnica (gps_integracion_logs).
		// Un asesor que ve "no disponible" no puede diagnosticar nada con ese
		// mensaje genérico, pero puede darle esta referencia a soporte/admin
		// para que la busquen en /admin/gps sin tener que reproducir el fallo.
		referencia: z.string().nullable(),
	}),
]);
export type GpsVehiculoOutput = z.infer<typeof gpsVehiculoOutputSchema>;

export const vincularUnidadInputSchema = z.object({
	vehicleId: z.string().uuid(),
	unitId: z.number().int().positive(),
	unitName: z.string().trim().min(1).max(200),
});
export type VincularUnidadInput = z.infer<typeof vincularUnidadInputSchema>;

export const vincularUnidadOutputSchema = z.object({
	success: z.boolean(),
	unitId: z.number(),
	unitName: z.string(),
	vinculadoAt: z.date(),
});

// ── Bitácora de consultas GPS (CB-118) ────────────────────────────────────────
// Solo admin (D-08/D-09: /admin/gps es exclusivamente administrativo, no
// depende del rol de cobros). Un supervisor de cobros ve el motivo de SU
// PROPIA consulta en la ficha; esto es la vista global de TODOS los asesores.

export const gpsBitacoraInputSchema = z.object({
	page: z.number().int().min(1).default(1),
	perPage: z.number().int().min(1).max(100).default(25),
	// Filtro por SIFCO: el admin investiga "¿quién consultó este crédito?".
	numeroCreditoSifco: z.string().trim().optional(),
});
export type GpsBitacoraInput = z.infer<typeof gpsBitacoraInputSchema>;

export const gpsBitacoraOutputSchema = z.object({
	total: z.number(),
	page: z.number(),
	perPage: z.number(),
	items: z.array(
		z.object({
			id: z.string(),
			vehicleId: z.string(),
			numeroCreditoSifco: z.string().nullable(),
			motivo: z.string(),
			unitId: z.string().nullable(),
			unitName: z.string().nullable(),
			userId: z.string(),
			userNombre: z.string().nullable(),
			userEmail: z.string().nullable(),
			createdAt: z.date(),
		}),
	),
});
export type GpsBitacoraOutput = z.infer<typeof gpsBitacoraOutputSchema>;

// ── Bitácora técnica y alertas de la integración (CB-121) ─────────────────────
// Solo admin: es diagnóstico de infraestructura, no una vista de negocio.

export const gpsIntegracionLogsInputSchema = z.object({
	page: z.number().int().min(1).default(1),
	perPage: z.number().int().min(1).max(100).default(25),
	resultado: z.enum(["ok", "error", "reintentado", "incierto"]).optional(),
	severidad: z.enum(["info", "warning", "critical"]).optional(),
	errorCode: z.string().trim().optional(),
	operacion: z.string().trim().optional(),
	numeroCreditoSifco: z.string().trim().optional(),
	correlationId: z.string().uuid().optional(),
});
export type GpsIntegracionLogsInput = z.infer<
	typeof gpsIntegracionLogsInputSchema
>;

export const gpsIntegracionLogsOutputSchema = z.object({
	total: z.number(),
	page: z.number(),
	perPage: z.number(),
	items: z.array(
		z.object({
			id: z.string(),
			correlationId: z.string(),
			intento: z.number(),
			operacion: z.string(),
			origen: z.string(),
			resultado: z.enum(["ok", "error", "reintentado", "incierto"]),
			errorCode: z.string().nullable(),
			wialonErrorCode: z.number().nullable(),
			httpStatus: z.number().nullable(),
			severidad: z.enum(["info", "warning", "critical"]),
			duracionMs: z.number(),
			// Los resúmenes ya vienen sanitizados desde el escritor (nunca token/sid);
			// se sirven como unknown porque su forma varía por operación.
			requestResumen: z.unknown().nullable(),
			responseResumen: z.unknown().nullable(),
			userId: z.string().nullable(),
			userNombre: z.string().nullable(),
			userEmail: z.string().nullable(),
			vehicleId: z.string().nullable(),
			numeroCreditoSifco: z.string().nullable(),
			gpsConsultaLogId: z.string().nullable(),
			createdAt: z.date(),
		}),
	),
});
export type GpsIntegracionLogsOutput = z.infer<
	typeof gpsIntegracionLogsOutputSchema
>;

export const gpsIntegracionSaludOutputSchema = z.object({
	ventana: z.object({
		desde: z.date(),
		hasta: z.date(),
		totalIntentos: z.number(),
		fallos: z.number(),
		tasaError: z.number().nullable(),
		p50Ms: z.number().nullable(),
		p95Ms: z.number().nullable(),
	}),
	circuito: z.object({
		abierto: z.boolean(),
		fallosConsecutivos: z.number(),
	}),
	alertasAbiertas: z.number(),
	ultimoErrorCritico: z
		.object({
			errorCode: z.string().nullable(),
			operacion: z.string(),
			createdAt: z.date(),
		})
		.nullable(),
});
export type GpsIntegracionSaludOutput = z.infer<
	typeof gpsIntegracionSaludOutputSchema
>;

export const gpsAlertasOutputSchema = z.object({
	items: z.array(
		z.object({
			id: z.string(),
			tipo: z.enum([
				"error_critico",
				"tasa_error",
				"fallos_consecutivos",
				"latencia_sla",
			]),
			errorCode: z.string().nullable(),
			// El detalle técnico completo solo lo arma el endpoint para admin;
			// para supervisor se recorta a algo presentable sin payloads.
			detalle: z.string(),
			estado: z.enum(["abierta", "resuelta"]),
			primeraVez: z.date(),
			ultimaVez: z.date(),
			ocurrencias: z.number(),
			resueltaPor: z.string().nullable(),
			resueltaAt: z.date().nullable(),
			notaResolucion: z.string().nullable(),
		}),
	),
});
export type GpsAlertasOutput = z.infer<typeof gpsAlertasOutputSchema>;

export const resolverGpsAlertaInputSchema = z.object({
	alertaId: z.string().uuid(),
	nota: z.string().trim().min(5).max(500),
});
export type ResolverGpsAlertaInput = z.infer<
	typeof resolverGpsAlertaInputSchema
>;

// ── Búsqueda de Unidades (core/search_items) ──────────────────────────────────
export interface WialonSensorMeta {
	id: number;
	n: string;
	t: string;
	d?: string;
	m?: string;
	p?: string;
}

export const searchUnitsInputSchema = z
	.object({
		filterName: z.string().trim().optional(),
		from: z.number().int().min(0).default(0),
		to: z.number().int().min(0).default(0xffffffff),
		flags: z
			.union([
				z.literal(1),
				z.literal(4097),
				z.literal(4099),
				z.literal(4105),
				z.literal(8388609),
				z.literal(8392705),
				z.literal(8392707),
				z.literal(8392713),
			])
			.default(8392707),
	})
	.refine((data) => data.to >= data.from, {
		message: "'to' debe ser mayor o igual que 'from'",
		path: ["to"],
	});
export type SearchUnitsInput = z.input<typeof searchUnitsInputSchema>;
export type SearchUnitsParsed = z.infer<typeof searchUnitsInputSchema>;

export interface WialonUnitItem {
	id: number;
	nm: string;
	cls: number;
	mu?: number;
	uacl?: number;
	pflds?: Record<string, unknown>;
	prp?: Record<string, unknown>;
	pos?: {
		t: number;
		y: number;
		x: number;
		s: number;
		c?: number;
		z?: number;
		sc?: number;
	};
	lmsg?: {
		t: number;
		p?: Record<string, unknown>;
	};
	sens?: Record<string, WialonSensorMeta>;
}

export interface WialonSearchItemsResponse {
	totalItemsCount: number;
	indexFrom: number;
	indexTo: number;
	items: WialonUnitItem[];
}

// ── Cálculo y Telemetría en Lote (unit/calc_last) ─────────────────────────────
export const getUnitsStatusInputSchema = z.object({
	unitIds: z
		.array(z.number().int().positive())
		.min(1, "Debe especificar al menos un ID de unidad")
		.max(100, "No se pueden consultar más de 100 unidades simultáneamente"),
});
export type GetUnitsStatusInput = z.infer<typeof getUnitsStatusInputSchema>;

export interface WialonUnitCalcLastItem {
	i: number;
	mileage?: {
		value: number;
		format?: { value: string };
	};
	engine_hours?: {
		value: number;
		format?: { value: string };
	};
	pos?: {
		y: number;
		x: number;
		c?: number;
		z?: number | { value: number; format?: { value: string } };
		s?: number | { value: number; format?: { value: string } };
		sc?: number;
	};
	sensors?: Record<
		string,
		{
			value: number;
			format?: { value: string };
		}
	>;
}

export interface UnitStatusSummary {
	unitId: number;
	mileageKm?: number;
	mileageFormatted?: string;
	engineHours?: number;
	engineHoursFormatted?: string;
	speedKmh?: number;
	latitude?: number;
	longitude?: number;
	isIgnitionOn?: boolean;
	sensorsFormatted?: Record<string, string>;
}

// ── Consulta Detallada de Unidad (core/search_item) ───────────────────────────
export const getUnitDetailInputSchema = z.object({
	unitId: z.number().int().positive(),
	flags: z
		.union([
			z.literal(1),
			z.literal(1025),
			z.literal(1027),
			z.literal(1033),
			z.literal(4097),
			z.literal(4099),
			z.literal(4105),
			z.literal(5123),
		])
		.default(5123),
});
export type GetUnitDetailInput = z.infer<typeof getUnitDetailInputSchema>;

export interface WialonSearchItemResponse {
	item: {
		id: number;
		nm: string;
		cls: number;
		mu?: number;
		pos?: {
			t: number;
			f?: number;
			lc?: number;
			y: number;
			x: number;
			c?: number;
			z?: number;
			s: number;
			sc?: number;
		};
		lmsg?: {
			t: number;
			f?: number;
			tp?: string;
			lc?: number;
			rt?: number;
			pos?: {
				y: number;
				x: number;
				c?: number;
				z?: number;
				s: number;
				sc?: number;
			};
			p?: Record<string, unknown>;
		};
		prp?: Record<string, unknown>;
		sens?: Record<string, WialonSensorMeta>;
		uacl?: number;
	};
	flags: number;
}

// ── Enlace de Seguimiento en Tiempo Real / Locator (token/update & token/delete)
export const createLocatorLinkInputSchema = z.object({
	unitId: z.number().int().positive(),
	durationSeconds: z
		.number()
		.int()
		.positive()
		.max(30 * 86400, "La duración máxima permitida es de 30 días")
		.default(86400),
	note: z
		.string()
		.trim()
		.max(200, "La nota no puede exceder 200 caracteres")
		.default("Localizador de Unidad"),
	zones: z.number().int().default(1),
	tracks: z.number().int().default(1),
});
export type CreateLocatorLinkInput = z.input<
	typeof createLocatorLinkInputSchema
>;
export type CreateLocatorLinkParsed = z.infer<
	typeof createLocatorLinkInputSchema
>;

export interface LocatorLinkResult {
	hash: string;
	url: string;
	unitId: number;
	durationSeconds: number;
	expiresAt: Date;
}

export const deleteLocatorLinkInputSchema = z.object({
	hash: z.string().trim().min(1),
});
export type DeleteLocatorLinkInput = z.infer<
	typeof deleteLocatorLinkInputSchema
>;

// ── Telemetría cruda para el job de detección de eventos (CB-119) ─────────────
// Subconjunto de WialonUnitItem con solo lo que el job compara contra el
// snapshot (gps_unidad_estado): posición/velocidad de `pos`, y de `lmsg.p`
// el voltaje de energía externa (`pwr_ext`) y el I/O de ignición (`io_1`),
// más el timestamp del último mensaje para detectar "sin reportar".
export interface WialonTelemetriaUnidad {
	unitId: number;
	ultimoMensajeAt: Date | null;
	pwrExt: number | null;
	ignicionOn: boolean | null;
	lat: number | null;
	lon: number | null;
	velocidadKmh: number | null;
}

// ── Geocerca (resource/get_zone_data, CB-119) ──────────────────────────────
// Solo se tipa lo que el job necesita para punto-en-polígono: nombre, tipo
// (2 = polígono, el único que usa "Perimetro cash") y sus vértices. El resto
// de la forma de Wialon (boundary, color, íconos) se ignora.
export interface WialonZonaPunto {
	x: number; // longitud
	y: number; // latitud
}

export interface WialonZona {
	id: number;
	n: string; // nombre
	t: number; // tipo (1 = línea, 2 = polígono, 3 = círculo)
	p: WialonZonaPunto[];
}

// ── Historial de eventos GPS en la Ficha 360 (CB-119) ──────────────────────
export const gpsEventosCasoInputSchema = z.object({
	casoCobroId: z.string().uuid(),
	limit: z.number().int().min(1).max(100).default(20),
});
export type GpsEventosCasoInput = z.infer<typeof gpsEventosCasoInputSchema>;

export const gpsEventosCasoOutputSchema = z.array(
	z.object({
		id: z.string(),
		tipo: z.enum([
			"desconexion_energia",
			"ignicion",
			"sin_reportar",
			"salida_geocerca",
		]),
		wialonUnitId: z.number(),
		ocurridoAt: z.date(),
		lat: z.number().nullable(),
		lon: z.number().nullable(),
		velocidadKmh: z.number().nullable(),
		notificado: z.boolean(),
	}),
);
export type GpsEventosCasoOutput = z.infer<typeof gpsEventosCasoOutputSchema>;
