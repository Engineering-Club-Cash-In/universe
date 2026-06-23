import { describe, expect, test } from "bun:test";
import {
	createNewVehicleInputSchema,
	isValidVehicleConditionOrigin,
	mergeVehicleConditionOrigin,
} from "./vehicles";

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

describe("isValidVehicleConditionOrigin", () => {
	test("allows used rodado vehicles but rejects new imported or rodado vehicles", () => {
		expect(isValidVehicleConditionOrigin(false, "Rodado")).toBe(true);
		expect(isValidVehicleConditionOrigin(true, "Rodado")).toBe(false);
		expect(isValidVehicleConditionOrigin(true, "Importado")).toBe(false);
		expect(isValidVehicleConditionOrigin(true, "Nacional")).toBe(true);
	});
});

describe("mergeVehicleConditionOrigin", () => {
	test("validates partial condition updates against stored values", () => {
		const newRodado = mergeVehicleConditionOrigin(
			{ isNew: false, origin: "Rodado" },
			{ isNew: true },
		);
		const newImportado = mergeVehicleConditionOrigin(
			{ isNew: true, origin: "Nacional" },
			{ origin: "Importado" },
		);

		expect(newRodado).toEqual({ isNew: true, origin: "Rodado" });
		expect(
			isValidVehicleConditionOrigin(newRodado.isNew, newRodado.origin),
		).toBe(false);
		expect(
			isValidVehicleConditionOrigin(newImportado.isNew, newImportado.origin),
		).toBe(false);
	});
});
