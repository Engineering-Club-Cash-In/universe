import { describe, expect, test } from "bun:test";
import {
	agruparCasosVigentesPorSifco,
	ganaComoCasoVigente,
} from "./caso-vigente";

const VIEJO = new Date("2026-01-10T12:00:00.000Z");
const NUEVO = new Date("2026-07-20T12:00:00.000Z");

function caso(overrides: {
	id: string;
	numeroCreditoSifco?: string | null;
	activo?: boolean | null;
	updatedAt?: Date | null;
}) {
	return {
		numeroCreditoSifco: "S1",
		activo: true,
		updatedAt: NUEVO,
		...overrides,
	};
}

describe("ganaComoCasoVigente", () => {
	test("sin previo → gana siempre", () => {
		expect(ganaComoCasoVigente(caso({ id: "a" }), undefined)).toBe(true);
	});

	test("activo le gana a inactivo aunque el inactivo sea más reciente", () => {
		const activoViejo = caso({ id: "a", activo: true, updatedAt: VIEJO });
		const inactivoNuevo = caso({ id: "b", activo: false, updatedAt: NUEVO });
		expect(ganaComoCasoVigente(activoViejo, inactivoNuevo)).toBe(true);
		expect(ganaComoCasoVigente(inactivoNuevo, activoViejo)).toBe(false);
	});

	test("a igualdad de activo gana el más reciente", () => {
		const viejo = caso({ id: "a", updatedAt: VIEJO });
		const nuevo = caso({ id: "b", updatedAt: NUEVO });
		expect(ganaComoCasoVigente(nuevo, viejo)).toBe(true);
		expect(ganaComoCasoVigente(viejo, nuevo)).toBe(false);
	});

	test("dos inactivos → igual gana el más reciente", () => {
		const viejo = caso({ id: "a", activo: false, updatedAt: VIEJO });
		const nuevo = caso({ id: "b", activo: false, updatedAt: NUEVO });
		expect(ganaComoCasoVigente(nuevo, viejo)).toBe(true);
	});

	test("updatedAt null se trata como el más antiguo posible", () => {
		const sinFecha = caso({ id: "a", updatedAt: null });
		const conFecha = caso({ id: "b", updatedAt: VIEJO });
		expect(ganaComoCasoVigente(conFecha, sinFecha)).toBe(true);
		expect(ganaComoCasoVigente(sinFecha, conFecha)).toBe(false);
	});

	test("empate exacto de activo y fecha → NO reemplaza (estable, se queda el primero)", () => {
		const a = caso({ id: "a", updatedAt: NUEVO });
		const b = caso({ id: "b", updatedAt: NUEVO });
		expect(ganaComoCasoVigente(b, a)).toBe(false);
	});
});

describe("agruparCasosVigentesPorSifco", () => {
	test("un caso por sifco → se queda tal cual", () => {
		const m = agruparCasosVigentesPorSifco([caso({ id: "a" })]);
		expect(m.get("S1")?.id).toBe("a");
	});

	test("varios casos del mismo sifco → gana el activo, sin importar el orden de entrada", () => {
		const activo = caso({ id: "activo", activo: true, updatedAt: VIEJO });
		const inactivo = caso({ id: "inactivo", activo: false, updatedAt: NUEVO });

		// El bug original dependía del orden que devolviera Postgres (query sin
		// ORDER BY + .set() incondicional): el resultado debe ser el mismo en
		// ambos órdenes.
		expect(agruparCasosVigentesPorSifco([activo, inactivo]).get("S1")?.id).toBe(
			"activo",
		);
		expect(agruparCasosVigentesPorSifco([inactivo, activo]).get("S1")?.id).toBe(
			"activo",
		);
	});

	test("dos activos del mismo sifco → gana el más reciente en cualquier orden", () => {
		const viejo = caso({ id: "viejo", updatedAt: VIEJO });
		const nuevo = caso({ id: "nuevo", updatedAt: NUEVO });
		expect(agruparCasosVigentesPorSifco([viejo, nuevo]).get("S1")?.id).toBe(
			"nuevo",
		);
		expect(agruparCasosVigentesPorSifco([nuevo, viejo]).get("S1")?.id).toBe(
			"nuevo",
		);
	});

	test("sifcos distintos no se pisan", () => {
		const m = agruparCasosVigentesPorSifco([
			caso({ id: "a", numeroCreditoSifco: "S1" }),
			caso({ id: "b", numeroCreditoSifco: "S2" }),
		]);
		expect(m.size).toBe(2);
		expect(m.get("S1")?.id).toBe("a");
		expect(m.get("S2")?.id).toBe("b");
	});

	test("casos sin sifco se descartan (no hay clave con la cual asociarlos)", () => {
		const m = agruparCasosVigentesPorSifco([
			caso({ id: "sin", numeroCreditoSifco: null }),
			caso({ id: "con", numeroCreditoSifco: "S1" }),
		]);
		expect(m.size).toBe(1);
		expect(m.get("S1")?.id).toBe("con");
	});

	test("lista vacía → mapa vacío", () => {
		expect(agruparCasosVigentesPorSifco([]).size).toBe(0);
	});
});
