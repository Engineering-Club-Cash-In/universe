import { describe, expect, test } from "bun:test";
import {
	accionesDisponibles,
	mensajeVerificacionPagalo,
} from "./pagalo-acciones";

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

describe("mensajeVerificacionPagalo", () => {
	test("aplicado gana sobre cualquier otro dato", () => {
		expect(
			mensajeVerificacionPagalo({ aplicado: true, pagados: 2 }),
		).toMatchObject({ tipo: "success" });
	});

	test("links confirmados sin aplicar avisa que falta el resto", () => {
		const r = mensajeVerificacionPagalo({
			pagados: 1,
			statusFinal: "PARTIALLY_PAID",
		});
		expect(r.tipo).toBe("success");
		expect(r.mensaje).toContain("1 link(s) confirmados");
	});

	test("grupo en revisión es una advertencia, aunque se haya confirmado un link", () => {
		for (const pagados of [0, 1]) {
			expect(
				mensajeVerificacionPagalo({ pagados, statusFinal: "REVIEW_REQUIRED" }),
			).toMatchObject({ tipo: "warning" });
		}
	});

	test("último link confirmado pero el despacho falló: no dice que falta el resto", () => {
		const r = mensajeVerificacionPagalo({
			pagados: 1,
			statusFinal: "APPLICATION_FAILED",
		});
		expect(r.tipo).toBe("error");
		expect(r.mensaje).not.toContain("Falta el resto");
		expect(r.mensaje).toContain("cartera no pudo aplicarlo");
	});

	test("reintento de un grupo ya fallido que vuelve a fallar no se confunde con «sin pago»", () => {
		const r = mensajeVerificacionPagalo({
			pagados: 0,
			statusFinal: "APPLICATION_FAILED",
		});
		expect(r.tipo).toBe("error");
		expect(r.mensaje).not.toContain("todavía no reporta");
	});

	test("pago confirmado esperando aplicarse (despacho tomado por otro proceso)", () => {
		for (const statusFinal of ["READY_TO_APPLY", "APPLYING"]) {
			const r = mensajeVerificacionPagalo({ pagados: 1, statusFinal });
			expect(r.tipo).toBe("info");
			expect(r.mensaje).toContain("falta aplicarlo");
		}
	});

	test("una consulta o voucher fallido no se reporta como «sin pago»", () => {
		const r = mensajeVerificacionPagalo({
			pagados: 0,
			errores: 1,
			statusFinal: "PENDING_PAYMENT",
		});
		expect(r.tipo).toBe("error");
		expect(r.mensaje).toContain("No se pudo verificar");
		expect(r.mensaje).not.toContain("todavía no reporta");
	});

	test("un link confirmado y otro con error avisa de ambos", () => {
		const r = mensajeVerificacionPagalo({
			pagados: 1,
			errores: 1,
			statusFinal: "PARTIALLY_PAID",
		});
		expect(r.tipo).toBe("warning");
		expect(r.mensaje).toContain("1 link(s) confirmados");
		expect(r.mensaje).toContain("falló al verificarse");
	});

	test("el estado final sigue mandando sobre los errores", () => {
		expect(
			mensajeVerificacionPagalo({
				pagados: 1,
				errores: 1,
				statusFinal: "APPLICATION_FAILED",
			}).tipo,
		).toBe("error");
		expect(mensajeVerificacionPagalo({ aplicado: true, errores: 1 }).tipo).toBe(
			"success",
		);
	});

	test("sin pago en Págalo no se celebra nada", () => {
		for (const r of [
			undefined,
			{ pagados: 0, statusFinal: "PENDING_PAYMENT" },
		]) {
			expect(mensajeVerificacionPagalo(r)).toMatchObject({ tipo: "info" });
		}
	});
});
