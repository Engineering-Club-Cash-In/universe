import "../utils/baseFalsaParaPruebas";
import { describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { pagoDelEventoSql } from "./moraRecuperacion";

/**
 * De qué pago viene cada evento del historial de mora — columna primero.
 *
 * El reporte de recuperación empareja cada restitución con SU decremento
 * usando el número de pago. Hasta la migración 0044 ese número solo existía
 * como una marca de TEXTO dentro de `motivo`, sacada con una expresión
 * regular; un evento sin la marca caía a la bolsa anónima y se tragaba la
 * restitución de OTRO pago, borrándole al asesor una oportunidad real.
 *
 * Desde la 0044 hay una COLUMNA `pago_id`. La consulta tiene que preferirla y
 * caer al texto solo para el historial viejo, que no la tiene llena.
 *
 * ── Por qué se prueba el SQL generado y no el reporte ───────────────────────
 * `pagoDelEventoSql` no calcula nada: ARMA un fragmento de SQL. Las pruebas del
 * reporte ejercen el plegado en TypeScript, que recibe el `pagoId` ya resuelto
 * y nunca ve esta consulta — por eso cambiarla no ponía ninguna roja. Lo único
 * que esta función promete es el ORDEN dentro del `COALESCE`, que decide quién
 * gana: el primer argumento no nulo. Eso es lo que se afirma acá.
 */
const dialecto = new PgDialect();
const renderizar = () =>
	dialecto.sqlToQuery(
		sql`${pagoDelEventoSql(sql.raw("h.pago_id"), sql.raw("h.motivo"))}`,
	).sql;

describe("pagoDelEventoSql: la columna gana, el texto es respaldo", () => {
	it("usa la columna pago_id", () => {
		expect(renderizar()).toContain("h.pago_id");
	});

	it("la columna va PRIMERO dentro del COALESCE — es la que gana si viene llena", () => {
		const q = renderizar();
		const columna = q.indexOf("h.pago_id");
		const texto = q.indexOf("SUBSTRING");
		expect(columna).toBeGreaterThan(-1);
		expect(texto).toBeGreaterThan(-1);
		expect(columna).toBeLessThan(texto);
	});

	it("la columna se castea a text, igual que lo que devuelve el respaldo", () => {
		// El resto del reporte usa el pago como string (la bolsa anónima es "").
		// Sin el cast, el COALESCE mezclaría integer con text y Postgres lo rechaza.
		expect(renderizar()).toMatch(/h\.pago_id\s*::text/);
	});

	it("el respaldo de TEXTO sigue ahí: el historial viejo solo tiene la marca en el motivo", () => {
		// Sin este respaldo, cuatro meses de historial caerían de golpe a la
		// bolsa anónima, porque la columna nació vacía para ellos.
		const q = renderizar();
		expect(q).toContain("SUBSTRING");
		expect(q).toContain("h.motivo");
	});
});
