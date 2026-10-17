import { ORPCError } from "@orpc/client";
import { describe, expect, test } from "bun:test";
import {
	esErrorDeAcceso,
	esForbidden,
	estadoDeConsulta,
	silenciaAvisoGlobal,
	sinRepetirSiFalla,
} from "./orpc";

describe("esErrorDeAcceso", () => {
	test("bloquea caché para respuestas 401 y 403", () => {
		expect(esErrorDeAcceso(new ORPCError("UNAUTHORIZED"))).toBe(true);
		expect(esErrorDeAcceso(new ORPCError("FORBIDDEN"))).toBe(true);
	});

	test("conserva caché ante errores transitorios", () => {
		expect(esErrorDeAcceso(new ORPCError("INTERNAL_SERVER_ERROR"))).toBe(false);
		expect(esErrorDeAcceso(new Error("Error de red"))).toBe(false);
	});
});

describe("esForbidden", () => {
	test("solo 403, no 401 ni errores transitorios", () => {
		expect(esForbidden(new ORPCError("FORBIDDEN"))).toBe(true);
		expect(esForbidden(new ORPCError("UNAUTHORIZED"))).toBe(false);
		expect(esForbidden(new ORPCError("INTERNAL_SERVER_ERROR"))).toBe(false);
		expect(esForbidden(new Error("Error de red"))).toBe(false);
	});
});

describe("silenciaAvisoGlobal", () => {
	test("solo calla el 403 de una consulta que lo pidió", () => {
		const meta = { sinAvisoDeAcceso: true };
		expect(silenciaAvisoGlobal(new ORPCError("FORBIDDEN"), meta)).toBe(true);
		expect(silenciaAvisoGlobal(new ORPCError("FORBIDDEN"), undefined)).toBe(false);
		expect(silenciaAvisoGlobal(new ORPCError("FORBIDDEN"), {})).toBe(false);
		expect(silenciaAvisoGlobal(new ORPCError("INTERNAL_SERVER_ERROR"), meta)).toBe(false);
		expect(silenciaAvisoGlobal(new ORPCError("UNAUTHORIZED"), meta)).toBe(false);
	});
});

describe("sinAvisoDeError", () => {
	const meta = { sinAvisoDeError: true };
	test("calla 403, 404 y fallos de red de una consulta con tarjeta propia", () => {
		expect(silenciaAvisoGlobal(new ORPCError("FORBIDDEN"), meta)).toBe(true);
		expect(silenciaAvisoGlobal(new ORPCError("NOT_FOUND"), meta)).toBe(true);
		expect(silenciaAvisoGlobal(new Error("Error de red"), meta)).toBe(true);
	});
	test("la sesión expirada nunca se calla, ni sin la bandera", () => {
		expect(silenciaAvisoGlobal(new ORPCError("UNAUTHORIZED"), meta)).toBe(false);
		expect(silenciaAvisoGlobal(new ORPCError("NOT_FOUND"), undefined)).toBe(false);
	});
});

describe("sinRepetirSiFalla", () => {
	test("el refresco automático se apaga cuando la consulta está en error", () => {
		expect(sinRepetirSiFalla.refetchInterval({ state: { status: "error" } })).toBe(false);
		expect(sinRepetirSiFalla.refetchInterval({ state: { status: "success" } })).toBe(60_000);
	});
	test("403 y 404 no se reintentan; un fallo transitorio se reintenta una vez", () => {
		expect(sinRepetirSiFalla.retry(0, new ORPCError("NOT_FOUND"))).toBe(false);
		expect(sinRepetirSiFalla.retry(0, new ORPCError("FORBIDDEN"))).toBe(false);
		expect(sinRepetirSiFalla.retry(0, new Error("red"))).toBe(true);
		expect(sinRepetirSiFalla.retry(1, new Error("red"))).toBe(false);
	});
});

describe("estadoDeConsulta", () => {
	const datos = { id: "u1" };
	test("sin error son datos", () => {
		expect(estadoDeConsulta({ data: datos, isError: false, error: null })).toBe("datos");
	});
	test("401 y 403 son sin acceso, aunque quede algo en caché", () => {
		for (const code of ["UNAUTHORIZED", "FORBIDDEN"] as const) {
			const error = new ORPCError(code);
			expect(estadoDeConsulta({ data: undefined, isError: true, error })).toBe("sin-acceso");
			expect(estadoDeConsulta({ data: datos, isError: true, error })).toBe("sin-acceso");
		}
	});
	test("NOT_FOUND (404) es no encontrado", () => {
		const error = new ORPCError("NOT_FOUND");
		expect(estadoDeConsulta({ data: undefined, isError: true, error })).toBe("no-encontrado");
	});
	test("otro error sin datos es fallo", () => {
		expect(
			estadoDeConsulta({
				data: undefined,
				isError: true,
				error: new ORPCError("INTERNAL_SERVER_ERROR"),
			}),
		).toBe("fallo");
		expect(
			estadoDeConsulta({ data: undefined, isError: true, error: new Error("red") }),
		).toBe("fallo");
	});
	test("un error pasajero con datos en caché sigue mostrando los datos", () => {
		expect(
			estadoDeConsulta({ data: datos, isError: true, error: new Error("red") }),
		).toBe("datos");
		expect(
			estadoDeConsulta({
				data: datos,
				isError: true,
				error: new ORPCError("INTERNAL_SERVER_ERROR"),
			}),
		).toBe("datos");
	});
});
