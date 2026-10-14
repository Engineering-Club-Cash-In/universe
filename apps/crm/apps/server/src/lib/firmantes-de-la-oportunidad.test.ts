import { describe, expect, test } from "bun:test";
import { armarFirmantes } from "./firmantes-de-la-oportunidad";

const sociedad = {
	email: "info@sociedad.example",
	name: "SOCIEDAD DE PRUEBA, S. A.",
};
const representante = {
	id: "representante",
	esRepresentanteLegal: false,
	email: "representante@example.com",
	name: "REPRESENTANTE DE PRUEBA",
	dpi: "1234567890101",
};
const otroCodeudor = {
	id: "otro",
	esRepresentanteLegal: false,
	email: "codeudor@example.com",
	name: "OTRO CODEUDOR",
};

describe("armarFirmantes", () => {
	test("sin la regla: el lead es titular y los codeudores cofirman", () => {
		expect(
			armarFirmantes({
				titular: sociedad,
				codeudores: [representante],
				clientType: "empresa",
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

	test("sociedad subida a mano: firma su representante marcado como titular", () => {
		expect(
			armarFirmantes({
				titular: sociedad,
				codeudores: [
					otroCodeudor,
					{ ...representante, esRepresentanteLegal: true },
				],
				clientType: "empresa",
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

	test("empresa con un solo codeudor sin marcar: ése firma por la sociedad", () => {
		expect(
			armarFirmantes({
				titular: sociedad,
				codeudores: [representante],
				clientType: "empresa",
				sociedadFirmaPorSuRepresentante: true,
			}).map((f) => [f.role, f.email]),
		).toEqual([["TITULAR", "representante@example.com"]]);
	});

	test("lead individual con un representante marcado: también firma él", () => {
		expect(
			armarFirmantes({
				titular: sociedad,
				codeudores: [{ ...representante, esRepresentanteLegal: true }],
				clientType: "individual",
				sociedadFirmaPorSuRepresentante: true,
			}).map((f) => [f.role, f.email]),
		).toEqual([["TITULAR", "representante@example.com"]]);
	});

	test("empresa con varios codeudores y ninguno marcado: corta", () => {
		expect(() =>
			armarFirmantes({
				titular: sociedad,
				codeudores: [representante, otroCodeudor],
				clientType: "empresa",
				sociedadFirmaPorSuRepresentante: true,
			}),
		).toThrow("no se sabe quién es su representante legal");
	});

	test("sociedad sin codeudores: sigue firmando la sociedad", () => {
		expect(
			armarFirmantes({
				titular: sociedad,
				codeudores: [],
				clientType: "empresa",
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

	test("individual sin representante marcado: la regla no cambia nada", () => {
		expect(
			armarFirmantes({
				titular: { email: "cliente@example.com", name: "CLIENTE" },
				codeudores: [otroCodeudor],
				clientType: "individual",
				sociedadFirmaPorSuRepresentante: true,
			}).map((f) => [f.role, f.email]),
		).toEqual([
			["TITULAR", "cliente@example.com"],
			["COFIRMANTE", "codeudor@example.com"],
		]);
	});

	test("el representante sin correo corta, no se salta", () => {
		expect(() =>
			armarFirmantes({
				titular: sociedad,
				codeudores: [
					{
						...representante,
						esRepresentanteLegal: true,
						email: null,
					},
					otroCodeudor,
				],
				clientType: "empresa",
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
				codeudores: [
					{
						id: "sin-correo",
						esRepresentanteLegal: false,
						email: null,
						name: "SIN CORREO",
					},
					otroCodeudor,
				],
				clientType: "individual",
				sociedadFirmaPorSuRepresentante: false,
			}).map((f) => f.email),
		).toEqual(["cliente@example.com", "codeudor@example.com"]);
	});
});
