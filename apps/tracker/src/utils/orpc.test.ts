import { ORPCError } from "@orpc/client";
import { describe, expect, test } from "bun:test";
import { esErrorDeAcceso, esForbidden } from "./orpc";

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
