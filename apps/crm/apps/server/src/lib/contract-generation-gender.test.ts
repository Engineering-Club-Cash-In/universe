import { describe, expect, test } from "bun:test";
import {
	LEGACY_VENDOR_GENDER_REQUIRED_MESSAGE,
	resolveLegacyContractGender,
} from "./contract-generation-gender";

describe("resolveLegacyContractGender", () => {
	test("uses the explicit vendor gender for the vendor declaration", () => {
		expect(
			resolveLegacyContractGender({
				apiContractType: "declaracion_vendedor",
				clientGender: "masculino",
				vendorGender: "female",
			}),
		).toBe("female");
	});

	test("keeps using the client gender for other contract types", () => {
		expect(
			resolveLegacyContractGender({
				apiContractType: "garantia_mobiliaria",
				clientGender: "femenino",
			}),
		).toBe("female");
	});

	test("rejects a vendor declaration without vendor gender", () => {
		expect(() =>
			resolveLegacyContractGender({
				apiContractType: "declaracion_vendedor",
			}),
		).toThrow(LEGACY_VENDOR_GENDER_REQUIRED_MESSAGE);
	});
});
