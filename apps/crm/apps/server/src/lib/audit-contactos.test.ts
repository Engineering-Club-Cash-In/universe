import { describe, expect, test } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import {
	condicionAuditManual,
	payloadCambioEstado,
	payloadEdicionManual,
} from "./audit-contactos";

/** Fila representativa de contactos_cobros, como la devuelve un SELECT. */
function filaContacto(
	overrides: Partial<Record<string, unknown>> = {},
): Parameters<typeof payloadEdicionManual>[0] {
	return {
		id: "c-1",
		casoCobroId: "caso-1",
		fechaContacto: new Date("2026-08-10T15:00:00.000Z"),
		metodoContacto: "llamada",
		estadoContacto: "promesa_pago",
		duracionLlamada: 120,
		comentarios: "Prometió pagar el 20",
		acuerdosAlcanzados: null,
		compromisosPago: null,
		cuotaInicio: 3,
		cuotaFin: 4,
		incluyeMora: true,
		estadoPromesa: "pendiente",
		montoComprometido: "1500.00",
		requiereSeguimiento: true,
		fechaProximoContacto: new Date("2026-08-20T06:00:00.000Z"),
		fechaAlerta: new Date("2026-08-19T06:00:00.000Z"),
		proximoPaso: "Confirmar depósito",
		realizadoPor: "user-1",
		bucketSnapshot: 2,
		createdAt: new Date("2026-08-10T15:00:01.000Z"),
		updatedAt: null,
		...overrides,
		// biome-ignore lint/suspicious/noExplicitAny: fixture de test, el tipo real
		// lo aporta el schema de drizzle en producción.
	} as any;
}

describe("payloadEdicionManual", () => {
	test("conserva los campos que el UPDATE de CB-029 pisa", () => {
		const payload = payloadEdicionManual(filaContacto());

		// Estos son los que se pierden sin auditoría — el AC-6 vive o muere acá.
		expect(payload.cuotaInicio).toBe(3);
		expect(payload.cuotaFin).toBe(4);
		expect(payload.incluyeMora).toBe(true);
		expect(payload.montoComprometido).toBe("1500.00");
		expect(payload.fechaProximoContacto).toEqual(
			new Date("2026-08-20T06:00:00.000Z"),
		);
		expect(payload.fechaAlerta).toEqual(new Date("2026-08-19T06:00:00.000Z"));
		expect(payload.comentarios).toBe("Prometió pagar el 20");
		expect(payload.proximoPaso).toBe("Confirmar depósito");
		expect(payload.estadoPromesa).toBe("pendiente");
	});

	test("omite los inmutables que ya viven en columnas del audit", () => {
		const payload = payloadEdicionManual(filaContacto());

		expect(payload).not.toHaveProperty("id");
		expect(payload).not.toHaveProperty("casoCobroId");
		expect(payload).not.toHaveProperty("createdAt");
	});

	test("conserva bucketSnapshot — el UPDATE de promesa no lo toca, pero el snapshot del momento es parte del registro histórico", () => {
		expect(payloadEdicionManual(filaContacto()).bucketSnapshot).toBe(2);
	});

	test("preserva los nulls en vez de omitirlos: 'no tenía valor' es distinto de 'no se guardó'", () => {
		const payload = payloadEdicionManual(
			filaContacto({ acuerdosAlcanzados: null, proximoPaso: null }),
		);

		expect(payload).toHaveProperty("acuerdosAlcanzados");
		expect(payload.acuerdosAlcanzados).toBeNull();
		expect(payload).toHaveProperty("proximoPaso");
		expect(payload.proximoPaso).toBeNull();
	});

	test("sobrevive el round-trip por JSON (la columna es jsonb)", () => {
		const payload = payloadEdicionManual(filaContacto());
		const roundTrip = JSON.parse(JSON.stringify(payload));

		expect(roundTrip.cuotaInicio).toBe(3);
		expect(roundTrip.comentarios).toBe("Prometió pagar el 20");
		// Las fechas se serializan a ISO — al leer el audit hay que re-parsearlas.
		expect(roundTrip.fechaProximoContacto).toBe("2026-08-20T06:00:00.000Z");
	});
});

describe("payloadCambioEstado", () => {
	test("guarda solo la transición, no la fila entera", () => {
		expect(payloadCambioEstado("pendiente", "cumplida")).toEqual({
			de: "pendiente",
			a: "cumplida",
		});
	});

	test("acepta null en 'de' — la promesa nunca se había evaluado", () => {
		expect(payloadCambioEstado(null, "pendiente")).toEqual({
			de: null,
			a: "pendiente",
		});
	});

	test("es mucho más chico que el snapshot manual (esa es la razón de existir)", () => {
		const sistema = JSON.stringify(
			payloadCambioEstado("pendiente", "cumplida"),
		);
		const manual = JSON.stringify(payloadEdicionManual(filaContacto()));

		expect(sistema.length).toBeLessThan(manual.length / 4);
	});
});

describe("condicionAuditManual", () => {
	// La marca de "editado" que ve el usuario sale de acá y NO de `updated_at`:
	// esa columna la tocan también los recálculos de sistema, así que usarla
	// mostraría como editada cualquier promesa que el job pasó a revisar.
	const dialect = new PgDialect();

	test("filtra por origen manual", () => {
		const query = dialect.sqlToQuery(condicionAuditManual());

		expect(query.sql.toLowerCase()).toContain("origen");
		expect(query.params).toContain("manual");
	});

	test("no menciona updated_at — esa columna no marca edición", () => {
		const query = dialect.sqlToQuery(condicionAuditManual());

		expect(query.sql.toLowerCase()).not.toContain("updated_at");
	});
});
