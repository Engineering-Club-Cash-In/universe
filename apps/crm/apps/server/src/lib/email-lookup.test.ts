/**
 * El portal resuelve la ficha de quien entra por su correo, y ese correo lo
 * normaliza el registro (`decidirLeadDelPortal`) antes de compararlo. La
 * búsqueda en base tiene que normalizar IGUAL: si compara exacto, una cuenta
 * que se registró con éxito como "Ana@Ejemplo.com" no encuentra después su
 * propio lead "ana@ejemplo.com" y se queda sin perfil, documentos, contratos
 * ni créditos.
 */

import { describe, expect, it } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { leads } from "../db/schema/crm";
import { eqEmail, normalizarCorreo } from "./email-lookup";

const render = (email: string) =>
	new PgDialect().sqlToQuery(eqEmail(leads.email, email));

describe("normalizarCorreo", () => {
	it("quita espacios de los extremos y baja a minúsculas", () => {
		expect(normalizarCorreo("  Ana@Ejemplo.COM  ")).toBe("ana@ejemplo.com");
	});

	it("trata la ausencia de correo como cadena vacía", () => {
		expect(normalizarCorreo(null)).toBe("");
		expect(normalizarCorreo(undefined)).toBe("");
	});
});

describe("eqEmail", () => {
	it("normaliza el valor que se busca", () => {
		expect(render("  Ana@Ejemplo.COM  ").params).toEqual(["ana@ejemplo.com"]);
	});

	it("normaliza también la columna, que es donde quedaron los correos viejos", () => {
		// Sin esto la mitad del problema sigue viva: el lead que ventas guardó
		// como "Ana@Ejemplo.com " nunca casaría con la sesión ya normalizada.
		const { sql } = render("ana@ejemplo.com");

		expect(sql).toContain('lower(btrim("leads"."email"))');
	});

	it("no usa LIKE/ILIKE: `_` y `%` serían comodines aunque el valor vaya parametrizado", () => {
		const { sql } = render("a_b%c@ejemplo.com");

		expect(sql.toLowerCase()).not.toContain("like");
	});
});
