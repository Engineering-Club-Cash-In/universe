import { describe, expect, test } from "bun:test";
import {
	antiguedadLink,
	etiquetaEvento,
	etiquetaFuente,
	etiquetaMotivo,
	getEstadoGrupoInfo,
} from "./formato-pagalo";

describe("etiquetaEvento", () => {
	test("traduce un evento conocido", () => {
		expect(etiquetaEvento("GROUP_CREATED")).toBe("Grupo creado");
	});

	test("cae al código crudo si el evento no está catalogado", () => {
		expect(etiquetaEvento("ALGO_NUEVO_SIN_CATALOGAR")).toBe(
			"ALGO_NUEVO_SIN_CATALOGAR",
		);
	});
});

describe("etiquetaFuente", () => {
	test("traduce una fuente conocida", () => {
		expect(etiquetaFuente("PAGALO_POLLER")).toBe("Sincronización");
	});

	test("cae al código crudo si la fuente no está catalogada", () => {
		expect(etiquetaFuente("DESCONOCIDO")).toBe("DESCONOCIDO");
	});
});

describe("etiquetaMotivo", () => {
	test("traduce un código conocido", () => {
		expect(etiquetaMotivo("PAGALO_INVALID_COMMAND")).toBe(
			"Comando inválido para cartera",
		);
	});

	test("cae al código crudo si no está catalogado", () => {
		expect(etiquetaMotivo("CODIGO_RARO")).toBe("CODIGO_RARO");
	});

	test("devuelve null si no hay código", () => {
		expect(etiquetaMotivo(null)).toBeNull();
	});
});

describe("getEstadoGrupoInfo", () => {
	test("devuelve la info catalogada para un estado conocido", () => {
		expect(getEstadoGrupoInfo("REVIEW_REQUIRED").label).toBe(
			"Requiere revisión",
		);
	});

	test("cae al código crudo para un estado desconocido", () => {
		const info = getEstadoGrupoInfo("ESTADO_INEXISTENTE");
		expect(info.label).toBe("ESTADO_INEXISTENTE");
		expect(info.className).toBe("bg-muted text-muted-foreground");
	});
});

describe("antiguedadLink", () => {
	test("hoy: sin alerta", () => {
		const resultado = antiguedadLink(new Date());
		expect(resultado.dias).toBe(0);
		expect(resultado.etiqueta).toBe("hoy");
		expect(resultado.alerta).toBe(false);
	});

	test("6 días: sin alerta (bajo el umbral)", () => {
		const hace6dias = new Date(Date.now() - 6 * 86_400_000);
		const resultado = antiguedadLink(hace6dias);
		expect(resultado.dias).toBe(6);
		expect(resultado.alerta).toBe(false);
	});

	test("7 días: alerta (en el umbral)", () => {
		const hace7dias = new Date(Date.now() - 7 * 86_400_000 - 1000);
		const resultado = antiguedadLink(hace7dias);
		expect(resultado.dias).toBeGreaterThanOrEqual(7);
		expect(resultado.alerta).toBe(true);
	});

	test("fecha null: sin dato", () => {
		const resultado = antiguedadLink(null);
		expect(resultado.dias).toBeNull();
		expect(resultado.etiqueta).toBe("—");
		expect(resultado.alerta).toBe(false);
	});
});
