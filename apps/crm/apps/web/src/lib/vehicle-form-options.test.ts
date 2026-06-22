import { describe, expect, test } from "bun:test";
import {
	QUOTER_VEHICLE_TYPE_OPTIONS,
	VEHICLE_BODY_TYPE_OPTIONS,
	QUOTER_VEHICLE_ORIGIN_OPTIONS,
	VEHICLE_PROVENANCE_OPTIONS,
	VEHICLE_USE_OPTIONS,
} from "./vehicle-form-options";

describe("vehicle form options", () => {
	test("keeps vehicle body types separate from quoter categories", () => {
		expect(VEHICLE_BODY_TYPE_OPTIONS.map((option) => option.value)).toContain("Sedan");
		expect(VEHICLE_BODY_TYPE_OPTIONS.map((option) => option.value)).toContain("SUV");
		expect(QUOTER_VEHICLE_TYPE_OPTIONS.map((option) => option.value)).toContain("particular");
		expect(VEHICLE_PROVENANCE_OPTIONS.map((option) => option.value)).toEqual([
			"Nacional",
			"Importado",
		]);
		expect(QUOTER_VEHICLE_ORIGIN_OPTIONS.map((option) => option.value)).toEqual([
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
