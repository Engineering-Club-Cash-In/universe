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
			| "WIALON_INVALID_RESPONSE",
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
			ultimaSenalAt: z.date().nullable(),
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
