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
});
