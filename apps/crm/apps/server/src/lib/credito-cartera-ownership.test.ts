import { beforeEach, describe, expect, it, mock } from "bun:test";
import { ROLES } from "./roles";

// El cliente de cartera se fakea para poder mirar CÓMO se lo llama: lo que se
// prueba abajo no es solo la regla sino que la lectura de autorización vaya
// SIN cache (review de Codex).
const llamadas: { numeroSifco: string; useCache: unknown }[] = [];
let emailAsesorDeCartera: string | null = "asesor@clubcashin.com";

mock.module("../services/cartera-back-client", () => ({
	carteraBackClient: {
		getCredito: async (numeroSifco: string, useCache?: boolean) => {
			llamadas.push({ numeroSifco, useCache });
			return { asesor: { emailCashIn: emailAsesorDeCartera } };
		},
	},
}));

const {
	assertCreditoAsignadoEnCartera,
	assertCreditoAsignadoEnCarteraPorSifco,
} = await import("./credito-cartera-ownership");

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

describe("assertCreditoAsignadoEnCarteraPorSifco", () => {
	beforeEach(() => {
		llamadas.length = 0;
		emailAsesorDeCartera = "asesor@clubcashin.com";
	});

	it("lee el crédito SIN cache: la autorización no puede salir de una foto vieja", async () => {
		await assertCreditoAsignadoEnCarteraPorSifco({
			numeroSifco: "01010214118950",
			emailUsuario: "asesor@clubcashin.com",
			userRole: ROLES.COBROS,
			accion: "hacer esto",
		});
		expect(llamadas).toHaveLength(1);
		// `getCredito` cachea por DEFECTO; con la foto cacheada el asesor viejo
		// seguía pasando y el nuevo quedaba afuera hasta que expirara.
		expect(llamadas[0].useCache).toBe(false);
	});

	it("bloquea cuando cartera dice que el crédito es de otro", async () => {
		emailAsesorDeCartera = "otro@clubcashin.com";
		await expect(
			assertCreditoAsignadoEnCarteraPorSifco({
				numeroSifco: "01010214118950",
				emailUsuario: "asesor@clubcashin.com",
				userRole: ROLES.COBROS,
				accion: "hacer esto",
			}),
		).rejects.toThrow(/no está asignado a vos/);
	});

	it("supervisor y admin no llegan ni a consultar cartera", async () => {
		for (const rol of [ROLES.ADMIN, ROLES.COBROS_SUPERVISOR]) {
			await assertCreditoAsignadoEnCarteraPorSifco({
				numeroSifco: "01010214118950",
				emailUsuario: "quien.sea@clubcashin.com",
				userRole: rol,
				accion: "hacer esto",
			});
		}
		expect(llamadas).toHaveLength(0);
	});
});
