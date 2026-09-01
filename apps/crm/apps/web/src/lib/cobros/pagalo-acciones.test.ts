import { describe, expect, test } from "bun:test";
import { accionesDisponibles } from "./pagalo-acciones";

describe("accionesDisponibles", () => {
	test("asesor (no supervisor) no ve ninguna acción de supervisor", () => {
		for (const status of [
			"LINKS_PENDING",
			"REVIEW_REQUIRED",
			"APPLICATION_FAILED",
		]) {
			expect(accionesDisponibles(status, false)).toMatchObject({
				invalidar: false,
				regenerar: false,
				reintentar: false,
			});
		}
	});

	test("pero SÍ puede verificar: es una consulta sobre un grupo que ya ve", () => {
		for (const status of [
			"LINKS_PENDING",
			"PENDING_PAYMENT",
			"PARTIALLY_PAID",
			"REVIEW_REQUIRED",
			"READY_TO_APPLY",
			"APPLICATION_FAILED",
			"APPLYING",
		]) {
			expect(accionesDisponibles(status, false).verificar).toBe(true);
		}
	});

	test("un grupo cerrado no se verifica: no hay nada que consultar", () => {
		for (const status of ["COMPLETED", "CANCELLED"]) {
			expect(accionesDisponibles(status, true, true).verificar).toBe(false);
		}
	});

	test("PARTIALLY_PAID: siempre tiene un link PAID adentro, ninguna acción salvo reintentar (que tampoco aplica acá)", () => {
		expect(accionesDisponibles("PARTIALLY_PAID", true)).toMatchObject({
			invalidar: false,
			regenerar: false,
			reintentar: false,
		});
	});

	test("APPLICATION_FAILED: solo reintentar (invalidar/regenerar siempre abortarían — un link ya está PAID)", () => {
		expect(accionesDisponibles("APPLICATION_FAILED", true)).toMatchObject({
			invalidar: false,
			regenerar: false,
			reintentar: true,
		});
	});

	test("REVIEW_REQUIRED: invalidar y regenerar sí, reintentar no (comando determinístico)", () => {
		expect(accionesDisponibles("REVIEW_REQUIRED", true)).toMatchObject({
			invalidar: true,
			regenerar: true,
			reintentar: false,
		});
	});

	test("COMPLETED/CANCELLED/DRAFT/APPLYING: ninguna acción para el supervisor", () => {
		for (const status of ["COMPLETED", "CANCELLED", "DRAFT", "APPLYING"]) {
			expect(accionesDisponibles(status, true)).toMatchObject({
				invalidar: false,
				regenerar: false,
				reintentar: false,
			});
		}
	});

	test("READY_TO_APPLY: reintentar sí — el server siempre lo aceptó", () => {
		// Un grupo con los dos links pagados esperando al dispatcher no tenía
		// botón para empujarlo, aunque reintentarDispatchPagalo lo permite.
		expect(accionesDisponibles("READY_TO_APPLY", true)).toMatchObject({
			reintentar: true,
		});
	});

	test("LINKS_PENDING/PENDING_PAYMENT: invalidar y regenerar sí, reintentar no", () => {
		for (const status of ["LINKS_PENDING", "PENDING_PAYMENT"]) {
			expect(accionesDisponibles(status, true)).toMatchObject({
				invalidar: true,
				regenerar: true,
				reintentar: false,
			});
		}
	});

	describe("forzar la aplicación (solo admin)", () => {
		test("REVIEW_REQUIRED y APPLYING: el admin sí puede reintentar", () => {
			for (const status of ["REVIEW_REQUIRED", "APPLYING"]) {
				expect(accionesDisponibles(status, true, true)).toMatchObject({
					reintentar: true,
				});
			}
		});

		test("un supervisor sin admin no los ve", () => {
			for (const status of ["REVIEW_REQUIRED", "APPLYING"]) {
				expect(accionesDisponibles(status, true, false)).toMatchObject({
					reintentar: false,
				});
			}
		});

		test("ni siquiera el admin lo ve en un grupo cerrado o sin pago", () => {
			// COMPLETED/CANCELLED no se tocan, y los estados sin evidencia
			// completa harían fallar el armado del comando y mandarían un grupo
			// sano a APPLICATION_FAILED.
			for (const status of [
				"COMPLETED",
				"CANCELLED",
				"DRAFT",
				"LINKS_PENDING",
				"PENDING_PAYMENT",
				"PARTIALLY_PAID",
			]) {
				expect(accionesDisponibles(status, true, true)).toMatchObject({
					reintentar: false,
				});
			}
		});

		test("el asesor no gana nada aunque le pasen esAdmin", () => {
			expect(accionesDisponibles("REVIEW_REQUIRED", false, true)).toMatchObject(
				{
					invalidar: false,
					regenerar: false,
					reintentar: false,
				},
			);
		});
	});
});
