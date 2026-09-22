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
				z.literal(4105),
				z.literal(8388609),
				z.literal(8392705),
				z.literal(8392713),
			])
			.default(8392705),
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
			z.literal(1033),
			z.literal(4097),
			z.literal(4105),
		])
		.default(1025),
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
