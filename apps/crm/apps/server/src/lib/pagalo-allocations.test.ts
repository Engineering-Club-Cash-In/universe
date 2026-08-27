import { describe, expect, test } from "bun:test";
import { buildPagaloAllocations } from "./pagalo-allocations";

describe("Págalo allocations", () => {
	test("separa capital, mora y rubros facturables en centavos", () => {
		const result = buildPagaloAllocations({
			mora: "12.34",
			installments: [
				{
					cuotaId: 7,
					numeroCuota: 3,
					capital: "100",
					interes: "20.5",
					iva: "2.46",
				},
			],
		});
		expect(result).toMatchObject({
			capitalTotal: "100.00",
			facturableTotal: "35.30",
			totalAmount: "135.30",
		});
		expect(result.allocations[0]).toMatchObject({
			rubro: "MORA",
			facturable: true,
		});
		expect(result.allocations.find((a) => a.rubro === "CAPITAL")).toMatchObject(
			{
				link_type: "CAPITAL",
				facturable: false,
			},
		);
	});

	test("no crea componente Q0", () => {
		const result = buildPagaloAllocations({
			mora: "0",
			installments: [{ cuotaId: 7, numeroCuota: 3, interes: "25" }],
		});
		expect(result.capitalTotal).toBe("0.00");
		expect(
			result.allocations.every((a) => a.link_type === "MORA_INTERES"),
		).toBe(true);
	});

	test("mora sola genera solo componente MORA_INTERES", () => {
		const result = buildPagaloAllocations({
			mora: "75.25",
			installments: [{ cuotaId: 7, numeroCuota: 3 }],
		});
		expect(result).toMatchObject({
			capitalTotal: "0.00",
			facturableTotal: "75.25",
			totalAmount: "75.25",
		});
		expect(result.allocations).toEqual([
			expect.objectContaining({ link_type: "MORA_INTERES", rubro: "MORA" }),
		]);
	});

	test("preserva centavos en montos numeric(18,2)", () => {
		const result = buildPagaloAllocations({
			installments: [
				{ cuotaId: 7, numeroCuota: 1, capital: "9999999999999999.99" },
			],
			mora: "0.00",
		});

		expect(result.capitalTotal).toBe("9999999999999999.99");
	});

	test("agrega Otros solo al link de mora e intereses", () => {
		const result = buildPagaloAllocations({
			installments: [
				{ cuotaId: 7, numeroCuota: 3, capital: "100.00", interes: "10.00" },
			],
			mora: "2.00",
			otros: "12.34",
		});

		expect(result).toMatchObject({
			capitalTotal: "100.00",
			facturableTotal: "24.34",
			totalAmount: "124.34",
			otrosTotal: "12.34",
		});
		expect(result.allocations).toContainEqual(
			expect.objectContaining({
				link_type: "MORA_INTERES",
				rubro: "OTROS",
				amount: "12.34",
				facturable: true,
			}),
		);
	});

	test("Otros es opcional y se normaliza a cero", () => {
		const result = buildPagaloAllocations({
			installments: [{ cuotaId: 7, numeroCuota: 3, interes: "25.00" }],
			mora: "0.00",
		});

		expect(result.otrosTotal).toBe("0.00");
		expect(
			result.allocations.some((allocation) => allocation.rubro === "OTROS"),
		).toBe(false);
	});
});
