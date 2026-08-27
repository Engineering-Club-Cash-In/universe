import { AsyncLocalStorage } from "node:async_hooks";
import { ORPCError, os } from "@orpc/server";
import type { Context as HonoContext, MiddlewareHandler } from "hono";
import { db } from "../db";
import { crmEntityAudit } from "../db/schema/crm-entity-audit";
import type { Context } from "./context";

/**
 * Bitácora de escrituras sobre leads, oportunidades y vehículos.
 *
 * Un solo lugar escribe en `crm_entity_audit`: el flush al final de la
 * request. Los handlers no conocen la tabla ni la conexión — solo anotan qué
 * entidad tocaron con `auditRecord`, que es un push en memoria.
 *
 *     ORPC:  publicProcedure.meta({ audit: { entity, action } })
 *     Hono:  app.post("/api/public/lead", auditRoute("public"), handler)
 *     Ambos: auditRecord({ entity: "lead", id, action: "create" })
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
	actorId: string | null;
	actorRole: string | null;
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
		for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
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

	if (context.entries.length > 0) {
		return context.entries.map((entry) => ({
			...common,
			entityType: entry.entity,
			entityId: entry.id ?? null,
			action: entry.action,
			input: prepareAuditInput(entry.data ?? context.input),
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
			input: prepareAuditInput(context.input),
			ok: false,
			errorCode: outcome.errorCode ?? null,
		},
	];
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
	try {
		await db.insert(crmEntityAudit).values(rows);
	} catch (error) {
		console.warn(
			"[crm-entity-audit] no se pudo registrar",
			{ operation: context.operation, rows: rows.length },
			error,
		);
	}
}

type RunOptions = Omit<AuditContext, "startedAt" | "entries">;

/** Abre el contexto, corre la operación y persiste lo anotado. */
export async function runWithAudit<T>(
	options: RunOptions,
	run: () => Promise<T>,
): Promise<T> {
	const context: AuditContext = {
		...options,
		startedAt: Date.now(),
		entries: [],
	};
	return storage.run(context, async () => {
		try {
			const result = await run();
			await flush(context, { ok: true });
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
	 * Declara que el procedure escribe entidades auditadas. `entity` y `action`
	 * identifican la fila de fallo; las de éxito salen de lo que anote el
	 * handler.
	 */
	audit?: { entity: AuditEntityType; action: string };
};

const auditBase = os.$context<Context>().$meta<AuditMeta>({});

/** Middleware de ORPC. Passthrough para los procedures sin `meta.audit`. */
export const auditMiddleware = auditBase.middleware(
	async ({ context, next, path, procedure }, input) => {
		const audit = procedure["~orpc"].meta.audit;
		if (!audit) return next();

		const actor = context.session?.user;
		return runWithAudit(
			{
				actorId: actor?.id ?? null,
				actorRole: actor?.role ?? null,
				source: "crm",
				operation: path.join("."),
				input,
				fallback: audit,
			},
			async () => next(),
		);
	},
);

/**
 * Middleware de Hono para lo que no pasa por ORPC (bot, portal, formulario
 * público, imports). El `source` sale de la ruta, no de quien la escribe.
 */
export function auditRoute(
	source: AuditSource,
	fallback: { entity: AuditEntityType; action: string } | null = null,
): MiddlewareHandler {
	return async (c: HonoContext, next) => {
		return runWithAudit(
			{
				actorId: null,
				actorRole: null,
				source,
				operation: `${c.req.method} ${c.req.routePath ?? c.req.path}`,
				input: await readRequestBody(c),
				fallback,
			},
			async () => {
				await next();
			},
		);
	};
}

/** El body ya viene consumido por el handler; leerlo acá no puede romperlo. */
async function readRequestBody(c: HonoContext): Promise<unknown> {
	try {
		const cloned = c.req.raw.clone();
		const type = cloned.headers.get("content-type") ?? "";
		if (!type.includes("application/json")) return null;
		return await cloned.json();
	} catch {
		return null;
	}
}
