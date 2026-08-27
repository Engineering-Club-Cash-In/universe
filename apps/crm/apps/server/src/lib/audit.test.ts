import { describe, expect, test } from "bun:test";
import {
	type AuditContext,
	auditSourceForPath,
	buildAuditRows,
	chunk,
	resolveOperation,
	prepareAuditInput,
	redactAuditInput,
} from "./audit";

function contextWith(overrides: Partial<AuditContext> = {}): AuditContext {
	return {
		actorId: "user-1",
		actorRole: "sales",
		source: "crm",
		operation: "crm.updateOpportunity",
		input: { id: "opp-1", title: "Crédito" },
		fallback: { entity: "opportunity", action: "update" },
		startedAt: 0,
		entries: [],
		...overrides,
	};
}

const OK = { ok: true, durationMs: 12 };
const FAILED = { ok: false, errorCode: "CONFLICT", durationMs: 12 };

describe("buildAuditRows", () => {
	test("writes nothing when a successful handler touched no entity", () => {
		// El caso del aviso por duplicado: devuelve una advertencia sin insertar.
		// Antes esto dejaba una creación que nunca ocurrió.
		expect(buildAuditRows(contextWith(), OK)).toEqual([]);
	});

	test("keeps the rejected attempt when nothing was written", () => {
		const rows = buildAuditRows(contextWith(), FAILED);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			entityType: "opportunity",
			entityId: null,
			action: "update",
			ok: false,
			errorCode: "CONFLICT",
			performedBy: "user-1",
			procedure: "crm.updateOpportunity",
		});
	});

	test("skips the attempt row when the operation declares no fallback", () => {
		expect(buildAuditRows(contextWith({ fallback: null }), FAILED)).toEqual([]);
	});

	test("writes one row per recorded entity, sharing who and where", () => {
		const rows = buildAuditRows(
			contextWith({
				operation: "crm.reassignOpportunityAndLead",
				entries: [
					{ entity: "opportunity", id: "opp-1", action: "reassign" },
					{ entity: "lead", id: "lead-1", action: "reassign" },
				],
			}),
			OK,
		);
		expect(rows.map((r) => [r.entityType, r.entityId, r.action])).toEqual([
			["opportunity", "opp-1", "reassign"],
			["lead", "lead-1", "reassign"],
		]);
		expect(rows.every((r) => r.performedBy === "user-1")).toBe(true);
		expect(rows.every((r) => r.durationMs === 12)).toBe(true);
	});

	test("lets each entry carry its own detail instead of the request body", () => {
		const [row] = buildAuditRows(
			contextWith({
				entries: [
					{
						entity: "opportunity",
						id: "opp-9",
						action: "sync_nit",
						data: { leadId: "lead-1", nit: "123" },
					},
				],
			}),
			OK,
		);
		expect(row.input).toEqual({ leadId: "lead-1", nit: "123" });
	});

	test("records a failure the handler returned instead of threw", () => {
		// enrichLeadFromRenap devuelve { success: false } en vez de lanzar: la
		// operación termina bien pero el intento tiene que quedar como fallido.
		const [row] = buildAuditRows(
			contextWith({
				entries: [
					{
						entity: "lead",
						id: "lead-1",
						action: "enrich_renap",
						ok: false,
						errorCode: "SIN_DPI",
					},
				],
			}),
			OK,
		);
		expect(row).toMatchObject({ ok: false, errorCode: "SIN_DPI" });
	});

	test("redacts the payload it stores", () => {
		const [row] = buildAuditRows(
			contextWith({
				input: { imageBase64: "AAAA", title: "Crédito" },
				entries: [{ entity: "vehicle", id: "v-1", action: "update" }],
			}),
			OK,
		);
		expect(row.input).toEqual({ imageBase64: "<omitido>", title: "Crédito" });
	});
});

describe("redactAuditInput", () => {
	test("keeps small form-like inputs intact", () => {
		const input = {
			id: "opp-1",
			title: "Crédito",
			probability: 25,
			active: true,
			tags: ["a", "b"],
			nested: { leadId: "lead-1", note: null },
		};
		expect(redactAuditInput(input)).toEqual(input);
	});

	test("hides base64 payloads and secrets by key name", () => {
		expect(
			redactAuditInput({
				vehicleId: "v-1",
				imageBase64: "AAAA",
				password: "x",
				otpCode: "123456",
			}),
		).toEqual({
			vehicleId: "v-1",
			imageBase64: "<omitido>",
			password: "<omitido>",
			otpCode: "<omitido>",
		});
	});

	test("truncates long strings even when the key looks harmless", () => {
		expect(redactAuditInput({ notes: "x".repeat(5_000) })).toEqual({
			notes: "<omitido: 5000 chars>",
		});
	});

	test("serializes dates, drops undefined and caps arrays", () => {
		const result = redactAuditInput({
			when: new Date("2026-08-27T12:00:00.000Z"),
			missing: undefined,
			items: Array.from({ length: 150 }, (_, i) => i),
		}) as Record<string, unknown>;
		expect(result.when).toBe("2026-08-27T12:00:00.000Z");
		expect("missing" in result).toBe(false);
		expect((result.items as unknown[]).length).toBe(101);
		expect((result.items as unknown[])[100]).toBe("<omitidos: 50 items>");
	});

	test("replaces binary payloads", () => {
		expect(redactAuditInput({ file: new Uint8Array([1, 2, 3]) })).toEqual({
			file: "<omitido: binario 3 bytes>",
		});
	});
});

describe("prepareAuditInput", () => {
	test("collapses to the key list when the redacted body is still too big", () => {
		const input: Record<string, string> = {};
		for (let i = 0; i < 100; i++) input[`field${i}`] = "y".repeat(1_500);
		const result = prepareAuditInput(input) as {
			_truncated: boolean;
			keys: string[];
		};
		expect(result._truncated).toBe(true);
		expect(result.keys.length).toBe(100);
	});
});

describe("auditSourceForPath", () => {
	test("derives the source from the route so nobody has to declare it", () => {
		expect(auditSourceForPath("/info/renap")).toBe("bot");
		expect(auditSourceForPath("/api/portal/lead")).toBe("portal");
		expect(auditSourceForPath("/api/public/lead")).toBe("public");
		expect(auditSourceForPath("/api/migrate/creditos")).toBe("system");
		expect(auditSourceForPath("/api/load-cars")).toBe("system");
	});
});

describe("failed requests that do not throw", () => {
	test("marks the recorded writes with the outcome of the request", () => {
		// Los handlers de Hono devuelven c.json({ error }, 400) en vez de lanzar:
		// sin mirar el estado, una escritura dentro de un rechazo quedaba como ok.
		const [row] = buildAuditRows(
			contextWith({
				source: "public",
				operation: "POST /api/public/lead",
				entries: [{ entity: "lead", id: "lead-1", action: "create" }],
			}),
			{ ok: false, errorCode: "HTTP_400", durationMs: 5 },
		);
		expect(row).toMatchObject({ ok: false, errorCode: "HTTP_400" });
	});

	test("lets an entry keep its own outcome", () => {
		const [row] = buildAuditRows(
			contextWith({
				entries: [{ entity: "lead", id: "lead-1", action: "create", ok: true }],
			}),
			{ ok: false, errorCode: "HTTP_500", durationMs: 5 },
		);
		expect(row.ok).toBe(true);
	});
});

describe("chunk", () => {
	test("splits bulk flushes so Postgres does not reject the statement", () => {
		// 13 parámetros por fila contra un tope de 65535: una limpieza o un import
		// masivo reventaría la sentencia entera y el catch se comería toda la
		// bitácora de esa operación.
		const filas = Array.from({ length: 1_250 }, (_, i) => i);
		const lotes = chunk(filas, 500);
		expect(lotes.map((l) => l.length)).toEqual([500, 500, 250]);
		expect(lotes.flat()).toEqual(filas);
	});

	test("leaves a small batch in a single statement", () => {
		expect(chunk([1, 2, 3], 500)).toEqual([[1, 2, 3]]);
		expect(chunk([], 500)).toEqual([]);
	});
});

describe("resolveOperation", () => {
	test("ignores the middleware pattern and keeps the real path", () => {
		// En un middleware montado con app.use(), routePath es el del middleware:
		// sin esto, toda ruta de Hono quedaba registrada como "POST /*".
		expect(resolveOperation("POST", "/api/public/lead", "/*")).toBe(
			"POST /api/public/lead",
		);
		expect(resolveOperation("POST", "/info/renap", "*")).toBe(
			"POST /info/renap",
		);
	});

	test("prefers the matched route once Hono resolved it", () => {
		expect(
			resolveOperation(
				"DELETE",
				"/api/migrate/cleanup",
				"/api/migrate/cleanup",
			),
		).toBe("DELETE /api/migrate/cleanup");
	});

	test("falls back to the request path when there is no route", () => {
		expect(resolveOperation("POST", "/api/load-cars")).toBe(
			"POST /api/load-cars",
		);
	});
});
