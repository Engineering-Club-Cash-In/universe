import { describe, expect, it } from "bun:test";
import { PERMISSIONS, ROLES } from "./roles";

describe("taller role permissions", () => {
	it("allows taller roles to access vehicles and taller", () => {
		expect(PERMISSIONS.canAccessVehicles(ROLES.VEHICLE_VERIFIER)).toBe(true);
		expect(PERMISSIONS.canAccessTaller(ROLES.VEHICLE_VERIFIER)).toBe(true);
		expect(PERMISSIONS.canAccessTaller(ROLES.SERVICE_CENTER_MANAGER)).toBe(
			true,
		);
	});
});
