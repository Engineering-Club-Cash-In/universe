import { describe, expect, it } from "bun:test";
import { hasVehicleIdentityConflict } from "./vehicle-identity";

describe("hasVehicleIdentityConflict", () => {
	it("rejects a stale Mazda id paired with Outlander identity", () => {
		expect(
			hasVehicleIdentityConflict(
				{ licensePlate: "P0-444KSW", vinNumber: "3MZBM1T71GM299403" },
				{ licensePlate: "P0-364LGN", vinNumber: "JA4AP3AUXJZ022516" },
			),
		).toBe(true);
	});

	it("accepts formatting differences for the same identity", () => {
		expect(
			hasVehicleIdentityConflict(
				{ licensePlate: "P0-444KSW", vinNumber: "3MZ BM1T71 GM299403" },
				{ licensePlate: "p0444ksw", vinNumber: "3mzbm1t71gm299403" },
			),
		).toBe(false);
	});

	it("allows an inspection to fill an identifier missing from the existing vehicle", () => {
		expect(
			hasVehicleIdentityConflict(
				{ licensePlate: "P0-444KSW", vinNumber: null },
				{ licensePlate: "P0-444KSW", vinNumber: "3MZBM1T71GM299403" },
			),
		).toBe(false);
	});

	it("rejects a different VIN even when the plate matches", () => {
		expect(
			hasVehicleIdentityConflict(
				{ licensePlate: "P0-444KSW", vinNumber: "VIN-ANTERIOR" },
				{ licensePlate: "P0444KSW", vinNumber: "VIN-CORREGIDO" },
			),
		).toBe(true);
	});

	it("rejects a different plate even when the VIN matches", () => {
		expect(
			hasVehicleIdentityConflict(
				{ licensePlate: "P0-444KSW", vinNumber: "3MZBM1T71GM299403" },
				{ licensePlate: "P0-364LGN", vinNumber: "3MZBM1T71GM299403" },
			),
		).toBe(true);
	});
});
