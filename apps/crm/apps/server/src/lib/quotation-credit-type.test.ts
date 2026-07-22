import { describe, expect, test } from "bun:test";
import { resolveQuotationCreditType } from "./quotation-credit-type";

describe("resolveQuotationCreditType", () => {
	test("preserves the joined value and falls back when the opportunity is missing", () => {
		expect(resolveQuotationCreditType("sobre_vehiculo")).toBe("sobre_vehiculo");
		expect(resolveQuotationCreditType(null)).toBe("autocompra");
	});
});
