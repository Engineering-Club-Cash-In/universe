import { describe, expect, test } from "bun:test";
import { accionesDisponibles } from "./pagalo-acciones";

describe("accionesDisponibles", () => {
	test("asesor (no supervisor) nunca ve ninguna acción, sin importar el estado", () => {
		for (const status of [
			"LINKS_PENDING",
			"REVIEW_REQUIRED",
			"APPLICATION_FAILED",
		]) {
			expect(accionesDisponibles(status, false)).toEqual({
				invalidar: false,
				regenerar: false,
				reintentar: false,
			});
		}
	});

	test("PARTIALLY_PAID: invalidar sí, regenerar no (siempre abortaría), reintentar no", () => {
		expect(accionesDisponibles("PARTIALLY_PAID", true)).toEqual({
			invalidar: true,
			regenerar: false,
			reintentar: false,
		});
	});

	test("APPLICATION_FAILED: las tres acciones disponibles", () => {
		expect(accionesDisponibles("APPLICATION_FAILED", true)).toEqual({
			invalidar: true,
			regenerar: true,
			reintentar: true,
		});
	});

	test("REVIEW_REQUIRED: invalidar y regenerar sí, reintentar no (comando determinístico)", () => {
		expect(accionesDisponibles("REVIEW_REQUIRED", true)).toEqual({
			invalidar: true,
			regenerar: true,
			reintentar: false,
		});
	});

	test("COMPLETED/CANCELLED/DRAFT/READY_TO_APPLY/APPLYING: ninguna acción", () => {
		for (const status of [
			"COMPLETED",
			"CANCELLED",
			"DRAFT",
			"READY_TO_APPLY",
			"APPLYING",
		]) {
			expect(accionesDisponibles(status, true)).toEqual({
				invalidar: false,
				regenerar: false,
				reintentar: false,
			});
		}
	});

	test("LINKS_PENDING/PENDING_PAYMENT: invalidar y regenerar sí, reintentar no", () => {
		for (const status of ["LINKS_PENDING", "PENDING_PAYMENT"]) {
			expect(accionesDisponibles(status, true)).toEqual({
				invalidar: true,
				regenerar: true,
				reintentar: false,
			});
		}
	});
});
