import { describe, expect, test } from "bun:test";
import {
	armarCorreoFacturaSeguro,
	clasificarErrorResend,
} from "./correo-factura-seguro";

const datos = {
	referencia: "9CB91550",
	cliente: "RDBE, S.A.",
	vehiculo: "Toyota Hilux 2024",
	vin: "ABC123",
	tipoVehiculo: "Pick Up",
	montoAsegurado: 330000,
	cuotaMensual: 1047.82,
	aseguradora: "gyt" as const,
};

describe("armarCorreoFacturaSeguro", () => {
	test("sigue el correo que hoy se manda a mano", () => {
		const { asunto, html } = armarCorreoFacturaSeguro(
			datos,
			new Date("2026-09-29T20:00:00Z"), // 14:00 en Guatemala
		);
		expect(asunto).toBe("Nuevo crédito autorizado: RDBE, S.A. (9CB91550)");
		expect(html).toContain("Estimados, buenas tardes:");
		expect(html).toContain("la garantía va al Cliente RDBE, S.A.");
		expect(html).toContain("TIPO: Pick Up");
		expect(html).toContain("Monto por el que se asegura Q 330,000.00");
		expect(html).toContain("Cuota Mensual Q 1,047.82");
		expect(html).toContain("endoso a Cube Investments, S.A.");
		expect(html).toContain("Vehículo: Toyota Hilux 2024 · VIN ABC123");
	});

	test("el saludo sigue la hora de Guatemala", () => {
		expect(
			armarCorreoFacturaSeguro(datos, new Date("2026-09-29T15:00:00Z")).html,
		).toContain("buenos días");
		expect(
			armarCorreoFacturaSeguro(datos, new Date("2026-09-30T02:00:00Z")).html,
		).toContain("buenas noches");
	});

	test("escapa lo que viene de la base y tolera datos faltantes", () => {
		const { html } = armarCorreoFacturaSeguro({
			...datos,
			cliente: "<b>Pérez</b>",
			vehiculo: null,
			vin: null,
			tipoVehiculo: null,
			montoAsegurado: null,
			cuotaMensual: null,
		});
		expect(html).toContain("&lt;b&gt;Pérez&lt;/b&gt;");
		expect(html).not.toContain("Vehículo:");
		expect(html).toContain("TIPO: —");
		expect(html).toContain("Monto por el que se asegura —");
	});
});

describe("clasificarErrorResend", () => {
	test("un 4xx es un rechazo: el correo no salió", () => {
		expect(
			clasificarErrorResend({ statusCode: 401, name: "validation_error" }),
		).toBe("rechazado");
		expect(
			clasificarErrorResend({
				statusCode: 422,
				name: "missing_required_field",
			}),
		).toBe("rechazado");
		expect(
			clasificarErrorResend({ statusCode: 429, name: "rate_limit_exceeded" }),
		).toBe("rechazado");
	});

	test("red caída, 5xx o llave ya usada: resultado incierto", () => {
		// Así reporta el SDK una respuesta perdida: sin statusCode.
		expect(
			clasificarErrorResend({
				name: "application_error",
				message: "Unable to fetch data. The request could not be resolved.",
			}),
		).toBe("incierto");
		expect(
			clasificarErrorResend({ statusCode: 500, name: "internal_server_error" }),
		).toBe("incierto");
		expect(
			clasificarErrorResend({
				statusCode: 409,
				name: "invalid_idempotent_request",
			}),
		).toBe("incierto");
		expect(clasificarErrorResend(new Error("socket hang up"))).toBe("incierto");
		expect(clasificarErrorResend(undefined)).toBe("incierto");
	});

	test("la misma llave en proceso: en curso", () => {
		expect(
			clasificarErrorResend({
				statusCode: 409,
				name: "concurrent_idempotent_requests",
			}),
		).toBe("en_curso");
	});
});
