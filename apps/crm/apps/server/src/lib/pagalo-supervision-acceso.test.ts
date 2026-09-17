import { describe, expect, test } from "bun:test";
import {
	asesoresConBucketsCompatibles,
	buscarAsesorPorEmail,
	buscarAsesorPorId,
} from "./pagalo-supervision-acceso";

describe("asesoresConBucketsCompatibles", () => {
	test("acepta respuesta legacy sin activo y excluye inactivos explícitos", () => {
		const asesores = asesoresConBucketsCompatibles([
			{
				asesor_id: 7,
				nombre: "Legacy",
				email_cash_in: null,
				buckets: [1],
			},
			{
				asesor_id: 8,
				nombre: "Inactiva",
				email_cash_in: null,
				activo: false,
				buckets: [1],
			},
			{
				asesor_id: 9,
				nombre: "Sin estado",
				email_cash_in: null,
				activo: null,
				buckets: [1],
			},
		]);

		expect(asesores.map((asesor) => asesor.asesor_id)).toEqual([7]);
	});
});

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
