import { describe, expect, test } from "bun:test";
import {
	looksLikeCorporation,
	parseOpportunityInvestors,
	resolveEntityType,
	selectPrimaryInvestor,
} from "./contract-entity";

/** Forma real del JSON en la oportunidad 717c9882-311f-4c34-921f-76a51ff04c30. */
const inversionistasReales = JSON.stringify([
	{
		inversionista_id: 86,
		nombre: "Cube Investments S.A.",
		porcentaje_participacion: 100,
		monto_aportado: 57961.7,
	},
]);

describe("parseOpportunityInvestors", () => {
	test("lee el JSON de la oportunidad", () => {
		const investors = parseOpportunityInvestors(inversionistasReales);

		expect(investors).toHaveLength(1);
		expect(investors[0].nombre).toBe("Cube Investments S.A.");
	});

	test.each([
		null,
		undefined,
		"",
		"no-es-json",
		"{}",
		"[]",
		'"texto"',
	])("devuelve lista vacía para %p en vez de reventar", (raw) => {
		expect(parseOpportunityInvestors(raw as string | null)).toEqual([]);
	});

	test("descarta entradas sin nombre usable", () => {
		const raw = JSON.stringify([
			{ inversionista_id: 1, nombre: "   " },
			{ inversionista_id: 2 },
			{ inversionista_id: 3, nombre: "Válido" },
		]);

		expect(parseOpportunityInvestors(raw)).toEqual([
			{ inversionista_id: 3, nombre: "Válido" },
		]);
	});
});

describe("selectPrimaryInvestor", () => {
	test("sin inversionistas devuelve null", () => {
		expect(selectPrimaryInvestor([])).toBeNull();
	});

	test("con uno solo devuelve ese", () => {
		const investors = parseOpportunityInvestors(inversionistasReales);

		expect(selectPrimaryInvestor(investors)?.nombre).toBe(
			"Cube Investments S.A.",
		);
	});

	test("elige al de mayor participación", () => {
		const elegido = selectPrimaryInvestor([
			{
				inversionista_id: 1,
				nombre: "Minoritario",
				porcentaje_participacion: 30,
			},
			{
				inversionista_id: 2,
				nombre: "Mayoritario",
				porcentaje_participacion: 70,
			},
		]);

		expect(elegido?.nombre).toBe("Mayoritario");
	});

	test("empatados en participación, desempata el monto aportado", () => {
		const elegido = selectPrimaryInvestor([
			{
				inversionista_id: 1,
				nombre: "Aporta menos",
				porcentaje_participacion: 50,
				monto_aportado: 1000,
			},
			{
				inversionista_id: 2,
				nombre: "Aporta más",
				porcentaje_participacion: 50,
				monto_aportado: 9000,
			},
		]);

		expect(elegido?.nombre).toBe("Aporta más");
	});

	test("sin porcentajes se queda con el primero de forma estable", () => {
		const elegido = selectPrimaryInvestor([
			{ inversionista_id: 1, nombre: "Primero" },
			{ inversionista_id: 2, nombre: "Segundo" },
		]);

		expect(elegido?.nombre).toBe("Primero");
	});
});

describe("looksLikeCorporation", () => {
	test.each([
		"Cube Investments S.A.",
		"RDBE S.A.",
		"Avinsa  S.A",
		"INVERSIONES DELFINA , S.A.",
		"Jac Guatemala, S. A.",
		"CREACION E IMAGEN SOCIEDAD ANONIMA",
		"Inversiones CASCAI  Sociedad Anonima",
		// El paréntesis con el representante no debe estorbar al sufijo
		"Finsolar S.A. (Escondrillas)",
		"SCIMMIA Investment S.A. (Fernando Ramírez)",
	])("reconoce %p como sociedad", (nombre) => {
		expect(looksLikeCorporation(nombre)).toBe(true);
	});

	test.each([
		// Personas cuyo apellido termina parecido a "s.a": no deben confundirse
		"Adriana Bahaia",
		"Jose Andres Asensio",
		"Oscar Massis",
		"Ana Lucia Salvatierra",
		"Werner Oswaldo Osoy Trejo",
	])("no confunde a %p con una sociedad", (nombre) => {
		expect(looksLikeCorporation(nombre)).toBe(false);
	});
});

describe("resolveEntityType", () => {
	test("el tipo explícito del catálogo manda sobre el nombre", () => {
		expect(resolveEntityType("individual", "Cube Investments S.A.")).toBe(
			"la persona",
		);
		expect(resolveEntityType("empresa_individual", "Lo que sea")).toBe(
			"la empresa",
		);
		expect(resolveEntityType("sociedad_anonima", "Juan Pérez")).toBe(
			"la entidad",
		);
	});

	test("sin tipo explícito lo deduce del nombre", () => {
		// Es el caso real: ninguna fila de `investors` tiene el enlace poblado
		expect(resolveEntityType(null, "Cube Investments S.A.")).toBe("la entidad");
		expect(resolveEntityType(undefined, "Adriana Bahaia")).toBe("la persona");
	});

	test("nunca devuelve vacío", () => {
		for (const nombre of [
			"Cube Investments S.A.",
			"Adriana Bahaia",
			"MENFER",
		]) {
			expect(resolveEntityType(null, nombre).length).toBeGreaterThan(0);
		}
	});
});
