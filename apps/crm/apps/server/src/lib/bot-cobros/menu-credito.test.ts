/**
 * Vigencia de la referencia en el menú del crédito.
 *
 * El resto de `obtenerInfoCredito` —que el código esté canjeado y que el
 * crédito sea del cliente— necesita base de datos y se probó contra dev; acá va
 * la regla del tiempo, que decide cuándo hay que volver a identificarse.
 */

import { describe, expect, test } from "bun:test";
import { rutaInexistente } from "../../services/cartera-back-client";
import { sesionVigente } from "./menu-credito";

const CANJE = new Date("2026-08-18T15:00:00.000Z");
const enMinutos = (m: number) => new Date(CANJE.getTime() + m * 60 * 1000);

describe("sesionVigente", () => {
	test("recién canjeado: vale", () => {
		expect(sesionVigente(CANJE, CANJE)).toBe(true);
	});

	test("a los 29 minutos todavía vale", () => {
		expect(sesionVigente(CANJE, enMinutos(29))).toBe(true);
	});

	test("justo a los 30 vale: el borde no expulsa", () => {
		expect(sesionVigente(CANJE, enMinutos(30))).toBe(true);
	});

	test("a los 31 ya no", () => {
		expect(sesionVigente(CANJE, enMinutos(31))).toBe(false);
	});

	test("un día después, menos", () => {
		expect(sesionVigente(CANJE, enMinutos(60 * 24))).toBe(false);
	});

	// Reloj torcido o dato manipulado: no puede volverse una sesión eterna.
	test("un canje en el futuro NO vale", () => {
		expect(sesionVigente(CANJE, enMinutos(-5))).toBe(false);
	});
});

describe("un 404 de cartera no siempre significa lo mismo", () => {
	// El caso que costó media hora de logs: el CRM apuntaba a una instancia de
	// cartera construida desde `develop`, que no tiene `/credito/resumen`. Elysia
	// respondía su 404 por defecto y el bot lo convertía en un `500 ERROR_INTERNO`
	// con el stack crudo — sin decir en ningún lado qué ruta faltaba.
	test("el 404 pelado de Elysia es una ruta que no existe", () => {
		expect(rutaInexistente(404, { error: "NOT_FOUND" })).toBe(true);
	});

	// Los 404 de negocio mandan `codigo` a propósito, justamente para esto.
	test("un 404 con codigo es un dato que no existe, no una ruta", () => {
		expect(
			rutaInexistente(404, {
				message: "Crédito no encontrado",
				codigo: "CREDITO_NO_ENCONTRADO",
			}),
		).toBe(false);

		expect(rutaInexistente(404, { codigo: "SIN_MOVIMIENTOS" })).toBe(false);
	});

	test("nada que no sea un 404 cuenta", () => {
		expect(rutaInexistente(500, { error: "NOT_FOUND" })).toBe(false);
		expect(rutaInexistente(404, {})).toBe(false);
	});
});
