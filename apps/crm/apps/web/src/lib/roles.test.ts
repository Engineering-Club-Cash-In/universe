import { describe, expect, test } from "bun:test";
import { PERMISSIONS, ROLES } from "./roles";

describe("shared role permissions", () => {
	test("allows only admin and sales supervisor to delete opportunities", () => {
		expect(PERMISSIONS.canDeleteOpportunities(ROLES.ADMIN)).toBe(true);
		expect(PERMISSIONS.canDeleteOpportunities(ROLES.SALES_SUPERVISOR)).toBe(
			true,
		);
		expect(PERMISSIONS.canDeleteOpportunities(ROLES.SALES)).toBe(false);
	});

	test("allows admin and cobros supervisor to access closed credits report", () => {
		expect(PERMISSIONS.canAccessClosedCreditsReport(ROLES.ADMIN)).toBe(true);
		expect(
			PERMISSIONS.canAccessClosedCreditsReport(ROLES.COBROS_SUPERVISOR),
		).toBe(true);
		expect(PERMISSIONS.canAccessClosedCreditsReport(ROLES.COBROS)).toBe(false);
		expect(PERMISSIONS.canAccessClosedCreditsReport(ROLES.SALES)).toBe(false);
	});

	test("cobros registra en el buró interno; baja y reglas quedan en supervisión", () => {
		for (const rol of [ROLES.ADMIN, ROLES.COBROS, ROLES.COBROS_SUPERVISOR]) {
			expect(PERMISSIONS.canAccessBuroInterno(rol)).toBe(true);
		}
		expect(PERMISSIONS.canAccessBuroInterno(ROLES.SALES)).toBe(false);
		expect(PERMISSIONS.canAccessBuroInterno(ROLES.ANALYST)).toBe(false);

		expect(PERMISSIONS.canManageBuroInterno(ROLES.ADMIN)).toBe(true);
		expect(PERMISSIONS.canManageBuroInterno(ROLES.COBROS_SUPERVISOR)).toBe(
			true,
		);
		expect(PERMISSIONS.canManageBuroInterno(ROLES.COBROS)).toBe(false);
	});
});
