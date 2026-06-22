import { describe, expect, test } from "bun:test";
import {
	VEHICLE_ORIGIN_OPTIONS,
	VEHICLE_TYPE_OPTIONS,
	VEHICLE_USE_OPTIONS,
} from "./vehicle-form-options";

describe("vehicle form options", () => {
	test("matches quoter vehicle context values", () => {
		expect(VEHICLE_TYPE_OPTIONS.map((option) => option.value)).toEqual([
			"particular",
			"uber",
			"pickup",
			"nuevo",
			"panel",
			"camion",
			"microbus",
			"microbus_20",
			"microbus_35",
			"microbus_36plus",
		]);
		expect(VEHICLE_ORIGIN_OPTIONS.map((option) => option.value)).toEqual([
			"agencia",
			"rodado",
			"importado",
			"subasta",
			"otro",
		]);
		expect(VEHICLE_USE_OPTIONS.map((option) => option.value)).toEqual([
			"Particular",
			"Comercial",
		]);
	});
});
