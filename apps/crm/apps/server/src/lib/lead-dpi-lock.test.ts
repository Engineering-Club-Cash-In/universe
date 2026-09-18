import { describe, expect, test } from "bun:test";
import {
	dpiCambia,
	MENSAJE_CANDADO_DPI_PORTAL,
	type OportunidadParaCandadoDpi,
	resolverCandadoDpi,
} from "./lead-dpi-lock";

const DPI_ACTUAL = "1234567890101";
const DPI_NUEVO = "2345678901202";

function oportunidad(
	closurePercentage: number,
	status = "open",
	stageName = "Análisis de Crédito",
): OportunidadParaCandadoDpi {
	return { closurePercentage, status, stageName };
}

describe("dpiCambia", () => {
	test("el mismo DPI con espacios no cuenta como cambio", () => {
		expect(dpiCambia("1234 56789 0101", DPI_ACTUAL)).toBe(false);
	});

	test("un DPI distinto cuenta como cambio", () => {
		expect(dpiCambia(DPI_ACTUAL, DPI_NUEVO)).toBe(true);
	});

	test("no cuenta como cambio si el campo no vino", () => {
		expect(dpiCambia(DPI_ACTUAL, undefined)).toBe(false);
		expect(dpiCambia(DPI_ACTUAL, null)).toBe(false);
	});

	test("borrar el DPI cuenta como cambio", () => {
		expect(dpiCambia(DPI_ACTUAL, "")).toBe(true);
		expect(dpiCambia(DPI_ACTUAL, "   ")).toBe(true);
	});

	test("no cuenta como cambio si el registro no tenía DPI", () => {
		expect(dpiCambia(null, DPI_NUEVO)).toBe(false);
		expect(dpiCambia("", DPI_NUEVO)).toBe(false);
	});
});

describe("resolverCandadoDpi", () => {
	test("no bloquea si el DPI no cambia, aunque la solicitud esté avanzada", () => {
		expect(
			resolverCandadoDpi({
				dpiActual: DPI_ACTUAL,
				dpiNuevo: "1234 56789 0101",
				oportunidades: [oportunidad(80)],
				sujeto: "lead",
			}),
		).toEqual({ bloqueado: false });
	});

	test("bloquea si el DPI cambia y hay una oportunidad al 40%", () => {
		const resultado = resolverCandadoDpi({
			dpiActual: DPI_ACTUAL,
			dpiNuevo: DPI_NUEVO,
			oportunidades: [oportunidad(40, "open", "Análisis de Crédito")],
			sujeto: "lead",
		});

		expect(resultado.bloqueado).toBe(true);
		expect(resultado.message).toContain("Análisis de Crédito (40%)");
		expect(resultado.message).toContain("administrador");
	});

	test("no bloquea si la única oportunidad avanzada está perdida", () => {
		expect(
			resolverCandadoDpi({
				dpiActual: DPI_ACTUAL,
				dpiNuevo: DPI_NUEVO,
				oportunidades: [oportunidad(80, "lost")],
				sujeto: "lead",
			}),
		).toEqual({ bloqueado: false });
	});

	test("no bloquea con una oportunidad justo en el 30%", () => {
		expect(
			resolverCandadoDpi({
				dpiActual: DPI_ACTUAL,
				dpiNuevo: DPI_NUEVO,
				oportunidades: [oportunidad(30)],
				sujeto: "lead",
			}),
		).toEqual({ bloqueado: false });
	});

	test("basta una oportunidad viva avanzada entre varias", () => {
		const resultado = resolverCandadoDpi({
			dpiActual: DPI_ACTUAL,
			dpiNuevo: DPI_NUEVO,
			oportunidades: [
				oportunidad(10, "open", "Contacto"),
				oportunidad(90, "lost", "Jurídico"),
				oportunidad(40, "open", "Análisis de Crédito"),
			],
			sujeto: "lead",
		});

		expect(resultado.bloqueado).toBe(true);
		expect(resultado.message).toContain("Análisis de Crédito (40%)");
	});

	test("el mensaje del co-deudor dice que el DPI es del co-deudor", () => {
		const resultado = resolverCandadoDpi({
			dpiActual: DPI_ACTUAL,
			dpiNuevo: DPI_NUEVO,
			oportunidades: [oportunidad(40)],
			sujeto: "codeudor",
		});

		expect(resultado.bloqueado).toBe(true);
		expect(resultado.message).toContain("el DPI del co-deudor");
	});

	test("el admin sí puede cambiar el DPI en el CRM", () => {
		expect(
			resolverCandadoDpi({
				dpiActual: DPI_ACTUAL,
				dpiNuevo: DPI_NUEVO,
				oportunidades: [oportunidad(90)],
				sujeto: "lead",
				esAdmin: true,
			}),
		).toEqual({ bloqueado: false });
		expect(
			resolverCandadoDpi({
				dpiActual: DPI_ACTUAL,
				dpiNuevo: DPI_NUEVO,
				oportunidades: [oportunidad(90)],
				sujeto: "codeudor",
				esAdmin: true,
			}),
		).toEqual({ bloqueado: false });
	});

	test("el portal nunca deja cambiar el DPI, ni siquiera como admin", () => {
		expect(
			resolverCandadoDpi({
				dpiActual: DPI_ACTUAL,
				dpiNuevo: DPI_NUEVO,
				oportunidades: [oportunidad(40)],
				sujeto: "portal",
				esAdmin: true,
			}),
		).toEqual({ bloqueado: true, message: MENSAJE_CANDADO_DPI_PORTAL });
	});

	test("bloquea el borrado del DPI sobre una oportunidad al 40%", () => {
		const resultado = resolverCandadoDpi({
			dpiActual: DPI_ACTUAL,
			dpiNuevo: "",
			oportunidades: [oportunidad(40)],
			sujeto: "lead",
		});

		expect(resultado.bloqueado).toBe(true);
	});

	test("regresión: el bypass de dos pasos (borrar y luego escribir otro DPI)", () => {
		const oportunidades = [oportunidad(40)];

		// Paso 1: borrar el DPI. Si esto pasara, el guardado quedaría vacío y el
		// paso 2 entraría por la puerta de "no había DPI que cambiar".
		const paso1 = resolverCandadoDpi({
			dpiActual: DPI_ACTUAL,
			dpiNuevo: "",
			oportunidades,
			sujeto: "portal",
		});
		expect(paso1.bloqueado).toBe(true);

		const paso2 = resolverCandadoDpi({
			dpiActual: DPI_ACTUAL,
			dpiNuevo: DPI_NUEVO,
			oportunidades,
			sujeto: "portal",
		});
		expect(paso2.bloqueado).toBe(true);
	});

	test("el mensaje del portal no menciona roles internos", () => {
		expect(MENSAJE_CANDADO_DPI_PORTAL).not.toContain("administrador");
	});
});
