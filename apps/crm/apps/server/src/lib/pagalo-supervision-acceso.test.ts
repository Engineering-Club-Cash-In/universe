import { describe, expect, test } from "bun:test";
import {
	buscarAsesorPorEmail,
	dividirEnLotes,
	sifcosEnBucketsPermitidos,
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

describe("dividirEnLotes", () => {
	test("parte SIFCOs en lotes de 50", () => {
		const sifcos = Array.from({ length: 101 }, (_, i) => `S${i}`);

		expect(dividirEnLotes(sifcos, 50).map((lote) => lote.length)).toEqual([
			50, 50, 1,
		]);
	});
});

describe("sifcosEnBucketsPermitidos", () => {
	test("incluye B0 y excluye buckets fuera del pool", () => {
		const permitidos = sifcosEnBucketsPermitidos(
			[
				{ numeroCreditoSifco: "B0", bucketNumero: 0 },
				{ numeroCreditoSifco: "B2", bucketNumero: 2 },
				{ numeroCreditoSifco: "B4", bucketNumero: 4 },
				{ numeroCreditoSifco: "SIN_BUCKET", bucketNumero: null },
			],
			[0, 2],
		);

		expect([...permitidos]).toEqual(["B0", "B2"]);
	});
});
