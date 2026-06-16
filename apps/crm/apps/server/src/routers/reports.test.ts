import { describe, expect, test } from "bun:test";
import { isClosedCreditReportCarteraStatusIncluded } from "./reports";

describe("isClosedCreditReportCarteraStatusIncluded", () => {
	test("only includes currently active cartera credit states", () => {
		expect(isClosedCreditReportCarteraStatusIncluded("ACTIVO")).toBe(true);
		expect(isClosedCreditReportCarteraStatusIncluded("MOROSO")).toBe(true);
		expect(isClosedCreditReportCarteraStatusIncluded("EN_CONVENIO")).toBe(true);
		expect(isClosedCreditReportCarteraStatusIncluded("CANCELADO")).toBe(false);
		expect(isClosedCreditReportCarteraStatusIncluded("INCOBRABLE")).toBe(false);
		expect(isClosedCreditReportCarteraStatusIncluded(null)).toBe(false);
	});
});
