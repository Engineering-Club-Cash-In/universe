import { describe, expect, it } from "bun:test";
import { assertCreditoAsignadoEnCartera } from "./credito-cartera-ownership";
import { ROLES } from "./roles";

/**
 * La regla que decide si un crédito "es" de quien lo pide. Vivía copiada dentro
 * de crearConvenioDesdeFicha; se extrajo cuando hizo falta la tercera copia
 * (recuperación de vehículo y contratos legales, review de Codex PR #1591).
 */
describe("assertCreditoAsignadoEnCartera", () => {
	const base = {
		emailAsesorCredito: "asesor@clubcashin.com",
		emailUsuario: "asesor@clubcashin.com",
		userRole: ROLES.COBROS,
		accion: "hacer esto",
	};

	it("deja pasar al asesor dueño del crédito", () => {
		expect(() => assertCreditoAsignadoEnCartera(base)).not.toThrow();
	});

	it("normaliza espacios y mayúsculas de ambos lados", () => {
		expect(() =>
			assertCreditoAsignadoEnCartera({
				...base,
				emailAsesorCredito: "  Asesor@ClubCashin.com ",
				emailUsuario: "ASESOR@clubcashin.COM",
			}),
		).not.toThrow();
	});

	it("bloquea el crédito de otro asesor", () => {
		expect(() =>
			assertCreditoAsignadoEnCartera({
				...base,
				emailAsesorCredito: "otro@clubcashin.com",
			}),
		).toThrow(/no está asignado a vos/);
	});

	it("el mensaje dice qué se estaba intentando hacer", () => {
		expect(() =>
			assertCreditoAsignadoEnCartera({
				...base,
				emailAsesorCredito: "otro@clubcashin.com",
				accion: "mandarlo a recuperación de vehículo",
			}),
		).toThrow(/mandarlo a recuperación de vehículo/);
	});

	it("un crédito SIN asesor en cartera no autoriza a nadie", () => {
		for (const vacio of [null, undefined, "", "   "]) {
			expect(() =>
				assertCreditoAsignadoEnCartera({ ...base, emailAsesorCredito: vacio }),
			).toThrow(/no está asignado a vos/);
		}
	});

	it("una sesión sin correo no autoriza aunque el crédito tenga asesor", () => {
		expect(() =>
			assertCreditoAsignadoEnCartera({ ...base, emailUsuario: undefined }),
		).toThrow(/no está asignado a vos/);
	});

	it("admin y supervisor de cobros pasan sobre cualquier crédito", () => {
		for (const rol of [ROLES.ADMIN, ROLES.COBROS_SUPERVISOR]) {
			expect(() =>
				assertCreditoAsignadoEnCartera({
					...base,
					userRole: rol,
					emailAsesorCredito: "otro@clubcashin.com",
				}),
			).not.toThrow();
		}
	});

	it("un rol desconocido NO se cuela por la puerta de supervisor", () => {
		expect(() =>
			assertCreditoAsignadoEnCartera({
				...base,
				userRole: "rol_inventado",
				emailAsesorCredito: "otro@clubcashin.com",
			}),
		).toThrow(/no está asignado a vos/);
	});
});
