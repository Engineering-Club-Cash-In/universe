import { describe, expect, test } from "bun:test";
import { ordenarPlanDePagos, paginaInicialPlan } from "./reglas-caso";

const c = (numeroCuota: number, estadoMora: string) => ({
	numeroCuota,
	estadoMora,
});

describe("orden del plan de pagos", () => {
	test("va de la cuota 1 a la última sin importar el estado, sin la cuota 0", () => {
		const plan = [
			c(5, "en_validacion"),
			c(14, "pendiente"),
			c(0, "pagado"),
			c(13, "pagado"),
			c(1, "pagado"),
			c(15, "pendiente"),
		];
		expect(ordenarPlanDePagos(plan).map((x) => x.numeroCuota)).toEqual([
			1, 5, 13, 14, 15,
		]);
	});

	test("abre en la página de la primera cuota sin pagar", () => {
		const plan = Array.from({ length: 60 }, (_, i) =>
			c(i + 1, i < 13 ? "pagado" : "pendiente"),
		);
		expect(paginaInicialPlan(plan, 20)).toBe(1);
		const pagadasHasta45 = plan.map((x) =>
			x.numeroCuota <= 45 ? { ...x, estadoMora: "pagado" } : x,
		);
		expect(paginaInicialPlan(pagadasHasta45, 20)).toBe(3);
	});

	test("si todo está pagado abre en la última página; vacío en la 1", () => {
		const plan = Array.from({ length: 45 }, (_, i) => c(i + 1, "pagado"));
		expect(paginaInicialPlan(plan, 20)).toBe(3);
		expect(paginaInicialPlan([], 20)).toBe(1);
	});
});
