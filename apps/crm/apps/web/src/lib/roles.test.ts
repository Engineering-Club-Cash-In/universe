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
});
