import { afterEach, describe, expect, it } from "bun:test";
import { getRenapData } from "./getRenapInfo";

const originalFetch = globalThis.fetch;
const dpiSintetico = "0000000000000";
const datosRenapSinteticos = {
	dpi: dpiSintetico,
	firstName: "Persona",
	secondName: "De",
	thirdName: "",
	firstLastName: "Prueba",
	secondLastName: "Sintética",
	marriedLastName: "",
	picture: "https://funtec-uploads.s3.amazonaws.com/renap/foto.jpg",
	birthDate: "01/01/2000",
	gender: "M",
	civil_status: "S",
	nationality: "Guatemalteca",
	borned_in: "Guatemala",
	department_borned_in: "Guatemala",
	municipality_borned_in: "Guatemala",
	deathDate: "",
	ocupation: "",
	cedula_order: "",
	cedula_register: "",
	dpi_expiracy_date: "01/01/2030",
};

function responderCon(response: Response): typeof fetch {
	return Object.assign(() => Promise.resolve(response), {
		preconnect: () => undefined,
	});
}

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("getRenapData", () => {
	it("conserva el mensaje del proveedor cuando el DPI está vencido", async () => {
		globalThis.fetch = responderCon(
			new Response(
				JSON.stringify({
					success: false,
					data: null,
					status: 400,
					message: "El DPI se encuentra vencido",
					error: null,
				}),
				{
					status: 400,
					headers: { "Content-Type": "application/json" },
				},
			),
		);

		const result = await getRenapData(dpiSintetico);

		expect(result.success).toBe(false);
		expect(result.message).toBe("El DPI se encuentra vencido");
	});

	it("mantiene la normalización de foto para una respuesta exitosa", async () => {
		globalThis.fetch = responderCon(
			new Response(
				JSON.stringify({
					success: true,
					data: datosRenapSinteticos,
					status: 200,
					message: "OK",
					error: null,
				}),
				{ headers: { "Content-Type": "application/json" } },
			),
		);

		const result = await getRenapData(dpiSintetico);

		expect(result.success).toBe(true);
		expect(result.data?.picture).toBe(
			"https://d2lr9bkbpuw8hs.cloudfront.net/renap/foto.jpg",
		);
	});

	it("rechaza un success que no sea el booleano true", async () => {
		globalThis.fetch = responderCon(
			new Response(
				JSON.stringify({
					success: "false",
					data: datosRenapSinteticos,
					status: 200,
					message: "Respuesta inválida del proveedor",
					error: null,
				}),
				{ headers: { "Content-Type": "application/json" } },
			),
		);

		const result = await getRenapData(dpiSintetico);

		expect(result.success).toBe(false);
		expect(result.data).toBeNull();
	});

	it("rechaza datos exitosos dentro de una respuesta HTTP fallida", async () => {
		globalThis.fetch = responderCon(
			new Response(
				JSON.stringify({
					success: true,
					data: datosRenapSinteticos,
					status: 400,
					message: "Solicitud rechazada",
					error: null,
				}),
				{
					status: 400,
					headers: { "Content-Type": "application/json" },
				},
			),
		);

		const result = await getRenapData(dpiSintetico);

		expect(result.success).toBe(false);
		expect(result.data).toBeNull();
	});

	it("rechaza datos de identidad incompletos", async () => {
		const { firstName: _firstName, ...datosIncompletos } = datosRenapSinteticos;
		globalThis.fetch = responderCon(
			new Response(
				JSON.stringify({
					success: true,
					data: datosIncompletos,
					status: 200,
					message: "OK",
					error: null,
				}),
				{ headers: { "Content-Type": "application/json" } },
			),
		);

		const result = await getRenapData(dpiSintetico);

		expect(result.success).toBe(false);
		expect(result.data).toBeNull();
	});
});
