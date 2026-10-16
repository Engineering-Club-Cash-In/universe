import { describe, expect, test } from "bun:test";
import { nivelAlertaReferencias } from "./permiso-alerta-referencias";
import { PERMISSIONS, USER_ROLE_VALUES } from "./roles";

const propia = { userId: "u-1", assignedTo: "u-1" };
const ajena = { userId: "u-1", assignedTo: "u-2" };

describe("nivelAlertaReferencias", () => {
	test.each([
		"admin",
		"analyst",
		"sales_supervisor",
	])("%s ve el detalle, sea o no su oportunidad", (userRole) => {
		expect(nivelAlertaReferencias({ userRole, ...propia })).toBe("detalle");
		expect(nivelAlertaReferencias({ userRole, ...ajena })).toBe("detalle");
	});

	test("ventas: aviso sin detalle en su oportunidad; nada en una ajena", () => {
		expect(nivelAlertaReferencias({ userRole: "sales", ...propia })).toBe(
			"aviso",
		);
		expect(nivelAlertaReferencias({ userRole: "sales", ...ajena })).toBe(
			"ninguno",
		);
	});

	test.each([
		"cobros",
		"cobros_supervisor",
		"accounting",
		"juridico",
	])("%s recibe solo el aviso", (userRole) => {
		expect(nivelAlertaReferencias({ userRole, ...propia })).toBe("aviso");
		expect(nivelAlertaReferencias({ userRole, ...ajena })).toBe("aviso");
	});

	test("solo quien ve el detalle del buró ve el detalle de la alerta", () => {
		for (const userRole of USER_ROLE_VALUES) {
			expect(nivelAlertaReferencias({ userRole, ...ajena }) === "detalle").toBe(
				PERMISSIONS.canAccessAnalysis(userRole),
			);
		}
	});
});
