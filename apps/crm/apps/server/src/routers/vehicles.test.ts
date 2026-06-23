import { describe, expect, test } from "bun:test";
import { createNewVehicleInputSchema } from "./vehicles";

const baseVehicleInput = {
	make: "Toyota",
	model: "Hilux",
	year: 2026,
	color: "Blanco",
	vehicleType: "Pickup",
};

describe("createNewVehicleInputSchema", () => {
	test("defaults omitted vehicleIsNew to true for legacy callers", () => {
		expect(
			createNewVehicleInputSchema.parse(baseVehicleInput).vehicleIsNew,
		).toBe(true);
	});

	test("keeps explicitly used vehicles as false", () => {
		expect(
			createNewVehicleInputSchema.parse({
				...baseVehicleInput,
				vehicleIsNew: false,
			}).vehicleIsNew,
		).toBe(false);
	});
});
