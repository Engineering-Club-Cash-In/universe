import { describe, expect, it } from "bun:test";
import { PERMISSIONS, ROLES } from "./roles";

describe("taller role permissions", () => {
	it("allows taller roles to access vehicles and taller", () => {
		expect(PERMISSIONS.canAccessVehicles(ROLES.VEHICLE_VERIFIER)).toBe(true);
		expect(PERMISSIONS.canAccessVehicles(ROLES.SERVICE_CENTER_MANAGER)).toBe(
			true,
		);
		expect(PERMISSIONS.canAccessTaller(ROLES.VEHICLE_VERIFIER)).toBe(true);
		expect(PERMISSIONS.canAccessTaller(ROLES.SERVICE_CENTER_MANAGER)).toBe(
			true,
		);
	});

	it("keeps vehicle navigation aligned with backend vehicle guards", () => {
		expect(PERMISSIONS.canAccessVehicles(ROLES.ADMIN)).toBe(true);
		expect(PERMISSIONS.canAccessVehicles(ROLES.SALES)).toBe(true);
		expect(PERMISSIONS.canAccessVehicles(ROLES.ANALYST)).toBe(true);
		expect(PERMISSIONS.canAccessVehicles(ROLES.COBROS)).toBe(true);
		expect(PERMISSIONS.canAccessVehicles(ROLES.COBROS_SUPERVISOR)).toBe(true);
		expect(PERMISSIONS.canAccessVehicles(ROLES.ACCOUNTING)).toBe(false);
		expect(PERMISSIONS.canAccessVehicles(ROLES.INVESTMENT_MANAGER)).toBe(false);
	});
});
