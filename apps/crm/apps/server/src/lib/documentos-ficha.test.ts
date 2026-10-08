import { describe, expect, test } from "bun:test";
import { armarDocumentos, construirMensajeDocumento } from "./documentos-ficha";

describe("armarDocumentos", () => {
	test("envíos según archivo; solicitudes según pendientes", () => {
		const r = armarDocumentos({
			archivos: { "tarjeta-circulacion": true, seguro: false },
			pendientes: ["expertaje"],
		});
		expect(r.map((d) => [d.clave, d.modo, d.disponible])).toEqual([
			["tarjeta-circulacion", "enviar", true],
			["seguro", "enviar", false],
			["contrato", "solicitar", true],
			["carta-poder", "solicitar", true],
			["cambio-placas", "solicitar", true],
			["expertaje", "solicitar", false],
		]);
	});
});

describe("construirMensajeDocumento", () => {
	const vehiculo = {
		marca: "Toyota",
		modelo: "Hilux",
		year: 2020,
		placa: "P123ABC",
	};
	test("tarjeta con vehículo y asesor", () => {
		expect(
			construirMensajeDocumento("tarjeta-circulacion", "Ana", vehiculo, "S-1", {
				nombre: "Luis",
				telefono: "5555-0000",
			}),
		).toBe(
			"Ana, te compartimos la tarjeta de circulación de tu Toyota Hilux 2020, placas P123ABC en el documento adjunto. Cualquier duda, llama a tu asesor Luis al 5555-0000.",
		);
	});
	test("seguro sin nombre ni vehículo usa el crédito", () => {
		expect(
			construirMensajeDocumento(
				"seguro",
				null,
				{ marca: null, modelo: null, year: null, placa: null },
				"S-1",
			),
		).toBe(
			"Te compartimos la información del seguro del vehículo de tu crédito S-1 en el documento adjunto. Cualquier duda, comunícate con tu asesor.",
		);
	});
});
