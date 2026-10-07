import { describe, expect, test } from "bun:test";
import { armarFirmantes } from "./firmantes-de-la-oportunidad";

const sociedad = {
	email: "info@sociedad.example",
	name: "SOCIEDAD DE PRUEBA, S. A.",
};
const representante = {
	email: "representante@example.com",
	name: "REPRESENTANTE DE PRUEBA",
	dpi: "1234567890101",
};
const otroCodeudor = { email: "codeudor@example.com", name: "OTRO CODEUDOR" };

describe("armarFirmantes", () => {
	test("sin la regla: el lead es titular y los codeudores cofirman", () => {
		expect(
			armarFirmantes({
				titular: sociedad,
				codeudores: [representante],
				sociedadFirmaPorSuRepresentante: false,
			}),
		).toEqual([
			{
				role: "TITULAR",
				email: "info@sociedad.example",
				name: "SOCIEDAD DE PRUEBA, S. A.",
			},
			{
				role: "COFIRMANTE",
				email: "representante@example.com",
				name: "REPRESENTANTE DE PRUEBA",
				dpi: "1234567890101",
			},
		]);
	});

	test("sociedad subida a mano: firma su representante como titular", () => {
		expect(
			armarFirmantes({
				titular: sociedad,
				codeudores: [representante, otroCodeudor],
				sociedadFirmaPorSuRepresentante: true,
			}),
		).toEqual([
			{
				role: "TITULAR",
				email: "representante@example.com",
				name: "REPRESENTANTE DE PRUEBA",
				dpi: "1234567890101",
			},
			{
				role: "COFIRMANTE",
				email: "codeudor@example.com",
				name: "OTRO CODEUDOR",
			},
		]);
	});

	test("sociedad sin codeudores: sigue firmando la sociedad", () => {
		expect(
			armarFirmantes({
				titular: sociedad,
				codeudores: [],
				sociedadFirmaPorSuRepresentante: true,
			}),
		).toEqual([
			{
				role: "TITULAR",
				email: "info@sociedad.example",
				name: "SOCIEDAD DE PRUEBA, S. A.",
			},
		]);
	});

	test("el representante sin correo corta, no se salta", () => {
		expect(() =>
			armarFirmantes({
				titular: sociedad,
				codeudores: [
					{ email: null, name: "REPRESENTANTE DE PRUEBA" },
					otroCodeudor,
				],
				sociedadFirmaPorSuRepresentante: true,
			}),
		).toThrow(
			"REPRESENTANTE DE PRUEBA firma por la sociedad y no tiene correo",
		);
	});

	test("los codeudores sin correo se omiten", () => {
		expect(
			armarFirmantes({
				titular: { email: "cliente@example.com", name: "CLIENTE" },
				codeudores: [{ email: null, name: "SIN CORREO" }, otroCodeudor],
				sociedadFirmaPorSuRepresentante: false,
			}).map((f) => f.email),
		).toEqual(["cliente@example.com", "codeudor@example.com"]);
	});
});
