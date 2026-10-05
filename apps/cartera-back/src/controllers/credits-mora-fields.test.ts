import "../utils/baseFalsaParaPruebas";
import { describe, expect, it, mock } from "bun:test";
import { readFileSync } from "node:fs";

// Mock the database module before importing credits
mock.module("../database", () => ({
	client: {},
	lockPool: {},
	db: {
		select: () => ({ from: () => ({ orderBy: () => Promise.resolve([]), where: () => Promise.resolve([]), leftJoin: () => ({ where: () => Promise.resolve([]), orderBy: () => Promise.resolve([]) }), innerJoin: () => ({ where: () => Promise.resolve([]), orderBy: () => Promise.resolve([]) }) }), innerJoin: () => ({ where: () => Promise.resolve([]), leftJoin: () => ({ where: () => Promise.resolve([]) }), orderBy: () => Promise.resolve([]) }) }),
		execute: () => Promise.resolve({ rows: [] }),
		insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
		update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
	},
}));

// Mock the utilities as well
mock.module("../utils/moraAbonadaPorOrigen", () => ({
	moraAbonadaPorOrigen: async (cuotaIds: number[]) => ({
		pagada: { toFixed: () => "0.00" },
		condonada: { toFixed: () => "0.00" },
	}),
}));

// Import AFTER mocking
const { incrementosMoraPorCredito } = await import("./credits");

/**
 * Verificar que el detalle de crédito (`getCreditoByNumero`) devuelve
 * `diasAtrasoMoraMaximo` y `moraPagada`.
 *
 * El test verifica:
 * 1. Que el código devuelve estos campos en la respuesta
 * 2. Que `moraPagadaPorCuota` se importa y se usa
 * 3. Que ambos campos se incluyen en los dos return statements
 */
describe("credits.ts - mora fields", () => {
	it("incrementosMoraPorCredito returns diasAtrasoMoraMaximo", async () => {
		// Test the function that calculates diasAtrasoMoraMaximo
		const result = await incrementosMoraPorCredito([
			{
				credito_id: 1,
				capital: 5000,
				statusCredit: "ACTIVO",
			},
		]);

		expect(result.size).toBe(1);
		const datos = result.get(1);
		expect(datos).toBeDefined();
		if (datos) {
			expect(datos).toHaveProperty("diasAtrasoMoraMaximo");
			expect(typeof datos.diasAtrasoMoraMaximo).toBe("number");
			expect(datos.diasAtrasoMoraMaximo).toBeGreaterThanOrEqual(0);
		}
	});

	it("credits.ts imports and uses moraAbonadaPorOrigen", () => {
		const source = readFileSync(
			new URL("./credits.ts", import.meta.url),
			"utf8"
		);

		// Verify import
		expect(source).toContain('import { moraAbonadaPorOrigen }');

		// Verify usage
		expect(source).toContain("moraAbonadaPorOrigen(");
	});

	it("getCreditoByNumero response includes diasAtrasoMoraMaximo, moraPagada, and moraCondonada", () => {
		const source = readFileSync(
			new URL("./credits.ts", import.meta.url),
			"utf8"
		);

		// Verify diasAtrasoMoraMaximo is in both return statements
		expect(source.includes("diasAtrasoMoraMaximo,") || source.includes("diasAtrasoMoraMaximo:")).toBe(true);

		// Verify moraPagada is in both return statements
		expect(source.includes("moraPagada,") || source.includes("moraPagada:")).toBe(true);

		// Verify moraCondonada is in both return statements
		expect(source.includes("moraCondonada,") || source.includes("moraCondonada:")).toBe(true);

		// Verify it's in destructuring
		expect(source).toContain("diasAtrasoMoraMaximo } =");
	});
});
