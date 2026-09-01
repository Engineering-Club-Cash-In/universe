import { describe, expect, test } from "bun:test";
import {
	buscarAsesorPorEmail,
	buscarAsesorPorId,
	nombresAsesoresPorSifco,
} from "./pagalo-supervision-acceso";

describe("buscarAsesorPorEmail", () => {
	test("normaliza correo para resolver el pool del asesor", () => {
		const asesor = buscarAsesorPorEmail(
			[
				{
					asesor_id: 7,
					nombre: "Asesora Cobros",
					email_cash_in: "asesora@clubcashin.com",
					buckets: [0, 2],
				},
			],
			" ASESORA@clubcashin.com ",
		);

		expect(asesor?.asesor_id).toBe(7);
	});
});

describe("buscarAsesorPorId", () => {
	test("resuelve asesor de pool por id", () => {
		const asesor = buscarAsesorPorId(
			[
				{
					asesor_id: 7,
					nombre: "Asesora Cobros",
					email_cash_in: null,
					buckets: [0, 2],
				},
			],
			7,
		);

		expect(asesor?.nombre).toBe("Asesora Cobros");
	});

	test("id ausente no resuelve otro asesor", () => {
		expect(buscarAsesorPorId([], 7)).toBeNull();
	});
});

describe("nombresAsesoresPorSifco", () => {
	test("asigna asesores activos cuyo scope autoritativo contiene SIFCO de página", () => {
		const nombres = nombresAsesoresPorSifco(
			[
				{
					asesor_id: 7,
					nombre: "Ana",
					email_cash_in: null,
					buckets: [1],
					sifcos: ["SIFCO-1", "SIFCO-2"],
				},
				{
					asesor_id: 8,
					nombre: "Beto",
					email_cash_in: null,
					buckets: [1],
					sifcos: ["SIFCO-1"],
				},
			],
			["SIFCO-1", "SIFCO-3"],
		);

		expect(nombres.get("SIFCO-1")).toEqual(["Ana", "Beto"]);
		expect(nombres.get("SIFCO-3")).toBeUndefined();
	});
});
