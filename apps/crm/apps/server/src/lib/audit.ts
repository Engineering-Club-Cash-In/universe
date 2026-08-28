import { AsyncLocalStorage } from "node:async_hooks";
import { ORPCError, os } from "@orpc/server";
import type { Context as HonoContext, MiddlewareHandler } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { crmEntityAudit } from "../db/schema/crm-entity-audit";
import type { Context } from "./context";

/**
 * Bitácora de escrituras sobre leads, oportunidades y vehículos.
 *
 * Un solo lugar escribe en `crm_entity_audit`: el flush al final de la
 * request. Los handlers no conocen la tabla ni la conexión — solo anotan qué
 * entidad tocaron con `auditRecord`, que es un push en memoria.
 *
 *     Handlers: auditRecord({ entity: "lead", id, action: "create" })
 *     ORPC:     el middleware abre el contexto para todo procedure
 *     Hono:     app.use(auditRequest()) lo abre para todo lo demás
 *
 * De ahí salen dos garantías que la versión anterior no tenía:
 *
 * - **No hay filas de más.** Si el handler no anotó nada, no se escribe nada.
 *   Una rama que devuelve un aviso sin tocar la base no deja rastro de una
 *   creación que nunca ocurrió.
 * - **No hay filas que mientan.** La acción sale de la rama que realmente
 *   corrió, no de una etiqueta estática declarada arriba del procedure.
 */

export type AuditEntityType = "lead" | "opportunity" | "vehicle";
export type AuditSource = "crm" | "bot" | "portal" | "public" | "system";

/** Lo que anota un handler: qué tocó y cómo. Nada de quién ni desde dónde. */
export type AuditEntry = {
	entity: AuditEntityType;
	/** `null` sólo si la entidad no llegó a existir. */
	id?: string | null;
	/** create | update | delete | reassign | sync_nit | mark_sold | … */
	action: string;
	/** Detalle de ESTA escritura. Si se omite se guarda el input de la request. */
	data?: unknown;
	/** El intento se registró pero no prosperó (fallos devueltos como valor). */
	ok?: boolean;
	errorCode?: string | null;
};

export type AuditContext = {
	/** Quién responde por la escritura. Bajo suplantación, el admin que la inició. */
	actorId: string | null;
	actorRole: string | null;
	/** Identidad suplantada, cuando la sesión es una suplantación. */
	impersonatedFor?: { usuario: string | null; rol: string | null } | null;
	source: AuditSource;
	/** `crm.updateOpportunity` o `POST /api/public/lead`. */
	operation: string;
	input: unknown;
	/** Identidad de la fila de fallo, cuando no se llegó a anotar nada. */
	fallback: { entity: AuditEntityType; action: string } | null;
	startedAt: number;
	entries: AuditEntry[];
};

const storage = new AsyncLocalStorage<AuditContext>();

/**
 * Anota una escritura. No toca la base ni espera nada: se acumula y el flush
 * la persiste con el actor, el origen y la duración ya resueltos.
 *
 * Fuera de una request auditada no hace nada (jobs, scripts, tests).
 */
export function auditRecord(entry: AuditEntry): void {
	const context = storage.getStore();
	if (!context) {
		if (process.env.NODE_ENV !== "production") {
			console.warn(
				"[crm-entity-audit] auditRecord fuera de contexto, se descarta",
				{ entity: entry.entity, action: entry.action },
			);
		}
		return;
	}
	context.entries.push(entry);
}

/**
 * Marca cuántas anotaciones lleva la request, para poder descartar las que
 * vengan después si algo se revierte. Ver `auditRollback`.
 */
export function auditMark(): number {
	return storage.getStore()?.entries.length ?? 0;
}

/**
 * Descarta las anotaciones hechas desde `marca`.
 *
 * Hace falta donde una transacción puede revertirse y el error se atrapa sin
 * volver a lanzarlo: ahí la request termina bien y esas anotaciones se
 * persistirían como escrituras exitosas de filas que el rollback borró.
 *
 * Cuando el error SÍ se propaga no es necesario: el flush marca todo con
 * `ok = false`, que es una descripción honesta de lo que pasó.
 */
export function auditRollback(marca: number): void {
	const context = storage.getStore();
	if (context) context.entries.length = marca;
}

/** Precisa el nombre de la operación una vez que se conoce. */
export function setAuditOperation(operation: string): void {
	const context = storage.getStore();
	if (context) context.operation = operation;
}

/** Cuántas escrituras lleva anotadas la request (para chequeos internos). */
export function auditedSoFar(): number {
	return storage.getStore()?.entries.length ?? 0;
}

// --- Redacción del payload -------------------------------------------------

const MAX_STRING_LENGTH = 2_000;
const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 100;
const MAX_JSON_BYTES = 64 * 1024;
const SENSITIVE_KEY =
	/base64|password|passwd|secret|token|otp|authorization|cookie/i;

/**
 * Copia recursiva apta para guardar: recorta strings largos, oculta claves
 * sensibles o binarias y acota profundidad y tamaño de arrays.
 */
export function redactAuditInput(value: unknown, depth = 0): unknown {
	if (value === null || value === undefined) return null;
	if (typeof value === "string") {
		return value.length > MAX_STRING_LENGTH
			? `<omitido: ${value.length} chars>`
			: value;
	}
	if (typeof value === "number" || typeof value === "boolean") return value;
	if (typeof value === "bigint") return value.toString();
	if (typeof value === "function" || typeof value === "symbol") return null;
	if (value instanceof Date) return value.toISOString();
	if (value instanceof Uint8Array) {
		return `<omitido: binario ${value.byteLength} bytes>`;
	}
	if (typeof Blob !== "undefined" && value instanceof Blob) {
		return `<omitido: archivo ${value.size} bytes>`;
	}
	if (depth >= MAX_DEPTH) return "<omitido: profundidad>";
	if (Array.isArray(value)) {
		const items = value
			.slice(0, MAX_ARRAY_ITEMS)
			.map((item) => redactAuditInput(item, depth + 1));
		if (value.length > MAX_ARRAY_ITEMS) {
			items.push(`<omitidos: ${value.length - MAX_ARRAY_ITEMS} items>`);
		}
		return items;
	}
	if (typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(
			value as Record<string, unknown>,
		)) {
			if (item === undefined) continue;
			out[key] = SENSITIVE_KEY.test(key)
				? "<omitido>"
				: redactAuditInput(item, depth + 1);
		}
		return out;
	}
	return String(value);
}

/** Redacta y, si aun así el JSON pasa el tope, deja solo las claves. */
export function prepareAuditInput(value: unknown): unknown {
	const redacted = redactAuditInput(value);
	const serialized = JSON.stringify(redacted);
	if (serialized === undefined || serialized.length <= MAX_JSON_BYTES) {
		return redacted;
	}
	return {
		_truncated: true,
		bytes: serialized.length,
		keys:
			redacted && typeof redacted === "object" && !Array.isArray(redacted)
				? Object.keys(redacted)
				: [],
	};
}

export function describeAuditError(error: unknown): string {
	if (error instanceof ORPCError) return error.code;
	if (error instanceof Error) return error.name || "Error";
	return "UNKNOWN";
}

// --- Flush -----------------------------------------------------------------

/**
 * Filas que corresponden a un contexto ya terminado. Exportada aparte de la
 * escritura para poder probar la forma de la bitácora sin base de datos.
 */
export function buildAuditRows(
	context: AuditContext,
	outcome: { ok: boolean; errorCode?: string | null; durationMs: number },
) {
	const common = {
		procedure: context.operation,
		performedBy: context.actorId,
		performedByRole: context.actorRole,
		source: context.source,
		durationMs: outcome.durationMs,
	};

	// Bajo suplantación `performed_by` es el admin que la inició — si no, la
	// bitácora diría que el cambio lo hizo el usuario suplantado, que es
	// exactamente lo que no hay que perder de vista.
	const conActor = (payload: unknown) =>
		context.impersonatedFor
			? { _ejecutadoComo: context.impersonatedFor, payload }
			: payload;

	if (context.entries.length > 0) {
		return context.entries.map((entry) => ({
			...common,
			entityType: entry.entity,
			entityId: entry.id ?? null,
			action: entry.action,
			input: prepareAuditInput(conActor(entry.data ?? context.input)),
			ok: entry.ok ?? outcome.ok,
			errorCode: entry.errorCode ?? outcome.errorCode ?? null,
		}));
	}

	// Nada anotado. Si terminó bien no se escribe: no hubo escritura que
	// registrar. Si falló queda el intento, que es lo que sirve para
	// diagnosticar quién quiso hacer qué.
	if (outcome.ok || !context.fallback) return [];
	return [
		{
			...common,
			entityType: context.fallback.entity,
			entityId: null,
			action: context.fallback.action,
			input: prepareAuditInput(conActor(context.input)),
			ok: false,
			errorCode: outcome.errorCode ?? null,
		},
	];
}

/**
 * Un INSERT de varias filas manda 13 parámetros por fila y Postgres admite
 * 65535 en total, así que un import o una limpieza masiva reventaría la
 * sentencia entera. Se parte en lotes: si uno falla, los demás igual entran.
 */
export const AUDIT_CHUNK_SIZE = 500;

export function chunk<T>(items: T[], size = AUDIT_CHUNK_SIZE): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) {
		out.push(items.slice(i, i + size));
	}
	return out;
}

/** Nunca lanza: la bitácora no puede tumbar la operación que registra. */
async function flush(
	context: AuditContext,
	outcome: { ok: boolean; errorCode?: string | null },
): Promise<void> {
	const rows = buildAuditRows(context, {
		...outcome,
		durationMs: Date.now() - context.startedAt,
	});
	if (rows.length === 0) return;
	for (const lote of chunk(rows)) {
		try {
			await db.insert(crmEntityAudit).values(lote);
		} catch (error) {
			console.warn(
				"[crm-entity-audit] no se pudo registrar un lote",
				{ operation: context.operation, rows: lote.length },
				error,
			);
		}
	}
}

type RunOptions = Omit<AuditContext, "startedAt" | "entries">;

/**
 * Abre el contexto, corre la operación y persiste lo anotado.
 *
 * `resolveOutcome` existe porque no todo fallo se lanza: los handlers de Hono
 * devuelven `c.json({ error }, 400)` y eso resuelve normal. Sin consultarlo, un
 * rechazo se registraría como éxito.
 */
export async function runWithAudit<T>(
	options: RunOptions,
	run: () => Promise<T>,
	resolveOutcome?: () => { ok: boolean; errorCode?: string | null },
): Promise<T> {
	const context: AuditContext = {
		...options,
		startedAt: Date.now(),
		entries: [],
	};
	return storage.run(context, async () => {
		try {
			const result = await run();
			await flush(context, resolveOutcome?.() ?? { ok: true });
			return result;
		} catch (error) {
			await flush(context, { ok: false, errorCode: describeAuditError(error) });
			throw error;
		}
	});
}

// --- Enganches -------------------------------------------------------------

export type AuditMeta = {
	/**
	 * Identidad de la fila de fallo cuando el handler no llegó a anotar nada.
	 * Es OPCIONAL: el contexto se abre igual para todos los procedures, así que
	 * olvidarlo nunca hace que se pierda una anotación — solo que un intento
	 * rechazado que no escribió nada no deje rastro.
	 */
	audit?: { entity: AuditEntityType; action: string };
};

/** Rol del usuario que inició la suplantación. `null` si no se puede resolver. */
async function resolveUserRole(userId: string): Promise<string | null> {
	try {
		const [fila] = await db
			.select({ role: user.role })
			.from(user)
			.where(eq(user.id, userId))
			.limit(1);
		return fila?.role ?? null;
	} catch (error) {
		console.warn(
			"[crm-entity-audit] no se pudo resolver el rol",
			userId,
			error,
		);
		return null;
	}
}

const auditBase = os.$context<Context>().$meta<AuditMeta>({});

/**
 * Middleware de ORPC. Abre el contexto para TODOS los procedures: si solo lo
 * abriera para los que declaran `meta.audit`, un `auditRecord` en un handler
 * sin meta se descartaría en silencio. Sin anotaciones no escribe nada, así
 * que abrirlo de más no cuesta una fila.
 */
export const auditMiddleware = auditBase.middleware(
	async ({ context, next, path, procedure }, input) => {
		const audit = procedure["~orpc"].meta.audit;
		const actor = context.session?.user;
		// Better Auth deja al admin que inició la suplantación en la sesión, no en
		// el usuario: sin esto, todo lo hecho suplantando se le atribuiría al
		// suplantado (ver `impersonatedBy` en lib/auth.ts).
		const impersonatedBy = context.session?.session?.impersonatedBy ?? null;
		// El rol tiene que ser el de quien responde por el cambio: dejar el del
		// suplantado produciría filas con un id de admin y rol "sales". La consulta
		// solo corre en sesiones suplantadas, que son excepcionales.
		const rolIniciador = impersonatedBy
			? await resolveUserRole(impersonatedBy)
			: null;
		return runWithAudit(
			{
				actorId: impersonatedBy ?? actor?.id ?? null,
				actorRole: impersonatedBy ? rolIniciador : (actor?.role ?? null),
				impersonatedFor: impersonatedBy
					? { usuario: actor?.id ?? null, rol: actor?.role ?? null }
					: null,
				source: "crm",
				operation: path.join("."),
				input,
				fallback: audit ?? null,
			},
			async () => next(),
		);
	},
);

/**
 * Nombre de la operación para una request de Hono.
 *
 * `routePath` sirve solo si ya se resolvió la ruta concreta: en un middleware
 * montado con `app.use()` vale el patrón del propio middleware (`/*`), y todas
 * las rutas terminarían registradas como `POST /*`.
 */
export function resolveOperation(
	method: string,
	path: string,
	routePath?: string,
): string {
	const usable = routePath && !routePath.includes("*") ? routePath : path;
	return `${method} ${usable}`;
}

/**
 * Identidad de la fila de fallo para las rutas de Hono que escriben entidades
 * auditadas. Sin esto, un rechazo temprano (por ejemplo un 400 por campos
 * faltantes en `/api/public/lead`) no deja rastro: el handler nunca llegó a
 * anotar nada y no hay de dónde sacar la entidad.
 *
 * Solo se declaran las rutas que escriben; para el resto un 4xx no tiene por
 * qué ensuciar la bitácora.
 */
const FALLBACK_POR_RUTA: Record<
	string,
	{ entity: AuditEntityType; action: string }
> = {
	"/api/public/lead": { entity: "lead", action: "create" },
	"/api/portal/lead": { entity: "lead", action: "create" },
	"/api/portal/lead/update": { entity: "lead", action: "update" },
	"/info/renap": { entity: "lead", action: "create" },
	"/info/lead-opportunity": { entity: "lead", action: "update" },
	"/info/check-liveness": { entity: "lead", action: "liveness_validated" },
	"/api/load-cars": { entity: "vehicle", action: "import_upsert" },
	"/api/migrate/creditos": { entity: "opportunity", action: "create" },
	"/api/migrate/actualizar-value": {
		entity: "opportunity",
		action: "update_value",
	},
	"/api/migrate/cleanup": { entity: "opportunity", action: "delete" },
};

export function auditFallbackForPath(path: string) {
	return FALLBACK_POR_RUTA[path] ?? null;
}

/** El `source` sale de la ruta: no hay que acordarse de declararlo. */
export function auditSourceForPath(path: string): AuditSource {
	if (path.startsWith("/info/")) return "bot";
	if (path.startsWith("/api/portal/")) return "portal";
	if (path.startsWith("/api/public/")) return "public";
	return "system";
}

/**
 * Middleware de Hono, montado una sola vez para toda la app. Abre el contexto
 * de cualquier request que no pase por ORPC (que tiene el suyo) para que un
 * `auditRecord` en un controller nunca caiga al vacío por haberse olvidado de
 * enganchar la ruta.
 */
export function auditRequest(): MiddlewareHandler {
	return async (c: HonoContext, next) => {
		const path = c.req.path;
		if (path.startsWith("/rpc")) return next();

		return runWithAudit(
			{
				actorId: null,
				actorRole: null,
				source: auditSourceForPath(path),
				operation: resolveOperation(c.req.method, path),
				input: await readRequestBody(c),
				fallback: auditFallbackForPath(path),
			},
			async () => {
				await next();
				// Recién acá Hono resolvió la ruta concreta; antes de `next()` el
				// `routePath` es el del propio middleware.
				setAuditOperation(
					resolveOperation(c.req.method, path, c.req.routePath),
				);
			},
			// Los handlers de Hono devuelven el error en la respuesta en vez de
			// lanzarlo, así que el estado es la única señal de que falló.
			() =>
				c.res.status >= 400
					? { ok: false, errorCode: `HTTP_${c.res.status}` }
					: { ok: true },
		);
	};
}

/**
 * El body ya viene consumido por el handler; leerlo acá no puede romperlo.
 *
 * Se mira el content-type ANTES de clonar: clonar tee-ea el stream, así que en
 * una subida multipart grande (`/api/upload-vehicle-video`) la rama clonada que
 * nadie lee se va llenando en memoria sin contrapresión mientras el handler
 * consume el archivo.
 */
async function readRequestBody(c: HonoContext): Promise<unknown> {
	const type = c.req.raw.headers.get("content-type") ?? "";
	if (!type.includes("application/json")) return null;
	try {
		return await c.req.raw.clone().json();
	} catch {
		return null;
	}
}
