import { describe, expect, test } from "bun:test";
import { rutaDeRetorno } from "./rutas";

const ORIGIN = "https://tracker.example";

describe("rutaDeRetorno", () => {
	test("permite la portada y los casos internos", () => {
		expect(rutaDeRetorno("/", ORIGIN)).toBe("/");
		expect(rutaDeRetorno("/caso/550e8400-e29b-41d4-a716-446655440000", ORIGIN)).toBe(
			"/caso/550e8400-e29b-41d4-a716-446655440000",
		);
	});

	test("conserva query y hash de una ruta interna válida", () => {
		expect(
			rutaDeRetorno(
				"/caso/550e8400-e29b-41d4-a716-446655440000?tab=historial#avance",
				ORIGIN,
			),
		).toBe(
			"/caso/550e8400-e29b-41d4-a716-446655440000?tab=historial#avance",
		);
	});

	test("rechaza destinos externos, protocol-relative y rutas desconocidas", () => {
		expect(rutaDeRetorno("https://attacker.example", ORIGIN)).toBe("/");
		expect(rutaDeRetorno("//attacker.example", ORIGIN)).toBe("/");
		expect(rutaDeRetorno("javascript:alert(1)", ORIGIN)).toBe("/");
		expect(rutaDeRetorno("/login", ORIGIN)).toBe("/");
		expect(rutaDeRetorno("/caso/no-es-uuid", ORIGIN)).toBe("/");
	});

	test("permite perfil, usuarios y el detalle de un usuario", () => {
		const uuid = "550e8400-e29b-41d4-a716-446655440000";
		expect(rutaDeRetorno("/perfil", ORIGIN)).toBe("/perfil");
		expect(rutaDeRetorno("/usuarios", ORIGIN)).toBe("/usuarios");
		expect(rutaDeRetorno(`/usuarios/${uuid}`, ORIGIN)).toBe(`/usuarios/${uuid}`);
	});

	test("el id de usuario es el de better-auth (32 caracteres), no un uuid", () => {
		const id = "aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1dE";
		expect(rutaDeRetorno(`/usuarios/${id}`, ORIGIN)).toBe(`/usuarios/${id}`);
	});

	test("rechaza variantes de perfil y usuarios que no existen", () => {
		expect(rutaDeRetorno("/usuarios/a/b", ORIGIN)).toBe("/");
		expect(rutaDeRetorno("/usuarios/corto", ORIGIN)).toBe("/");
		expect(rutaDeRetorno("/perfil/otro", ORIGIN)).toBe("/");
		expect(rutaDeRetorno("//attacker.example/perfil", ORIGIN)).toBe("/");
	});
});
