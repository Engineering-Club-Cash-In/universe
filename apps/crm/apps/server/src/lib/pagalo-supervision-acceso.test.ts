import { describe, expect, test } from "bun:test";
import { buscarAsesorPorEmail } from "./pagalo-supervision-acceso";

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
