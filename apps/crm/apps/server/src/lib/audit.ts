import { ORPCError, os } from "@orpc/server";
import { db } from "../db";
import { crmEntityAudit } from "../db/schema/crm-entity-audit";
import type { Context } from "./context";

/**
 * Auditoría de escrituras sobre leads, oportunidades y vehículos.
 *
 * Dos vías de entrada, una sola tabla (`crm_entity_audit`):
 *
 * 1. `auditMiddleware` — para procedures ORPC. El procedure declara
 *    `.meta({ audit: { entity, action, idFrom } })` y el middleware registra
 *    quién lo llamó, con qué body (redactado) y si terminó bien o con error.
 * 2. `logEntityAudit` — llamada explícita para escrituras que no pasan por
 *    /rpc (bot de WhatsApp, portal, formularios públicos, servicios) o que
 *    tocan una entidad distinta a la del procedure (p. ej. el vehículo que
 *    queda `sold` al cerrar una oportunidad).
 */

export type AuditEntityType = "lead" | "opportunity" | "vehicle";
export type AuditSource = "crm" | "bot" | "portal" | "public" | "system";

/**
 * `idFrom` dice de dónde sacar el id de la entidad: una ruta con prefijo
 * `input.` u `output.` ("input.opportunityId", "output.id",
 * "input.vehicle.id"). Si se omite se usa `input.id`.
 */
export type AuditIdFrom = `input.${string}` | `output.${string}`;

export type AuditMeta = {
	audit?: {
		entity: AuditEntityType;
		action: string;
		idFrom?: AuditIdFrom;
		/**
		 * El handler audita su propio éxito (porque tiene ramas que terminan en
		 * acciones distintas), pero los intentos fallidos los sigue registrando el
		 * middleware: si no, esos procedures serían los únicos sin filas
		 * `ok = false`, que es justo lo que sirve para diagnosticar.
		 */
		onlyOnError?: boolean;
	};
};

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type AuditExecutor = typeof db | Transaction;

export type AuditEntry = {
	entityType: AuditEntityType;
	entityId?: string | null;
	action: string;
	procedure?: string | null;
	performedBy?: string | null;
	performedByRole?: string | null;
	source?: AuditSource;
	input?: unknown;
	ok?: boolean;
	errorCode?: string | null;
	durationMs?: number | null;
};

// Límites del body guardado. Lo único que realmente pesa en los inputs de
// estas entidades son archivos en base64 (fotos de vehículos, documentos);
// todo lo demás son formularios de pocos KB.
const MAX_STRING_LENGTH = 2_000;
const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 100;
const MAX_JSON_BYTES = 64 * 1024;
const SENSITIVE_KEY =
	/base64|password|passwd|secret|token|otp|authorization|cookie/i;

/**
 * Copia recursiva del input apta para guardar: recorta strings largos,
 * oculta claves sensibles/binarias y acota profundidad y tamaño de arrays.
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

function getByPath(value: unknown, path: string): unknown {
	let current: unknown = value;
	for (const segment of path.split(".")) {
		if (current === null || typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
}

/** Resuelve el id de la entidad según `idFrom` (ver `AuditMeta`). */
export function resolveAuditEntityId(
	idFrom: AuditIdFrom | undefined,
	input: unknown,
	output: unknown,
): string | null {
	const path = idFrom ?? "input.id";
	const [scope, ...rest] = path.split(".");
	const root = scope === "output" ? output : input;
	const found = getByPath(root, rest.join("."));
	if (typeof found === "string" && found.length > 0) return found;
	if (typeof found === "number") return String(found);
	return null;
}

/**
 * Inserta una fila de auditoría. Nunca lanza: la bitácora no puede ser la
 * causa de que falle la operación que registra.
 *
 * Si se pasa una transacción, la fila se commitea junto con el cambio (o se
 * revierte con él). Ojo: dentro de una tx un INSERT fallido aborta la tx
 * completa aunque acá se atrape el error — por eso la tabla no tiene FKs ni
 * tipos estrictos en `entity_id`; lo único que puede fallar es la conexión,
 * y eso ya tumbaba la tx de todos modos.
 */
export async function logEntityAudit(
	executor: AuditExecutor,
	entry: AuditEntry,
): Promise<void> {
	try {
		await executor.insert(crmEntityAudit).values({
			entityType: entry.entityType,
			entityId: entry.entityId ?? null,
			action: entry.action,
			procedure: entry.procedure ?? null,
			performedBy: entry.performedBy ?? null,
			performedByRole: entry.performedByRole ?? null,
			source: entry.source ?? "crm",
			input: entry.input === undefined ? null : prepareAuditInput(entry.input),
			ok: entry.ok ?? true,
			errorCode: entry.errorCode ?? null,
			durationMs: entry.durationMs ?? null,
		});
	} catch (error) {
		console.warn(
			"[crm-entity-audit] no se pudo registrar",
			{
				entityType: entry.entityType,
				entityId: entry.entityId ?? null,
				action: entry.action,
				procedure: entry.procedure ?? null,
			},
			error,
		);
	}
}

export function describeAuditError(error: unknown): string {
	if (error instanceof ORPCError) return error.code;
	if (error instanceof Error) return error.name || "Error";
	return "UNKNOWN";
}

const auditBase = os.$context<Context>().$meta<AuditMeta>({});

/**
 * Middleware base de todos los procedures. Solo actúa cuando el procedure
 * declaró `meta.audit`; para el resto es un passthrough sin costo.
 *
 * Va antes de los middlewares de rol, así también quedan registrados los
 * intentos rechazados (UNAUTHORIZED/FORBIDDEN) sobre entidades auditadas.
 */
export const auditMiddleware = auditBase.middleware(
	async ({ context, next, path, procedure }, input) => {
		const audit = procedure["~orpc"].meta.audit;
		if (!audit) return next();

		const startedAt = Date.now();
		const actor = context.session?.user;
		const base: AuditEntry = {
			entityType: audit.entity,
			action: audit.action,
			procedure: path.join("."),
			performedBy: actor?.id ?? null,
			performedByRole: actor?.role ?? null,
			source: "crm",
			input,
		};

		try {
			const result = await next();
			if (audit.onlyOnError) return result;
			await logEntityAudit(db, {
				...base,
				entityId: resolveAuditEntityId(audit.idFrom, input, result.output),
				ok: true,
				durationMs: Date.now() - startedAt,
			});
			return result;
		} catch (error) {
			await logEntityAudit(db, {
				...base,
				entityId: resolveAuditEntityId(audit.idFrom, input, undefined),
				ok: false,
				errorCode: describeAuditError(error),
				durationMs: Date.now() - startedAt,
			});
			throw error;
		}
	},
);
