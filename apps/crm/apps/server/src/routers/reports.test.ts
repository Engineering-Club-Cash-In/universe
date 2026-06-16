import { describe, expect, test } from "bun:test";
import {
	CLOSED_CREDIT_REPORT_CARTERA_STATUS_CHUNK_SIZE,
	isClosedCreditReportCarteraStatusIncluded,
} from "./reports";

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

describe("CLOSED_CREDIT_REPORT_CARTERA_STATUS_CHUNK_SIZE", () => {
	test("keeps status lookups on the GET path because bulk POST requires estado", () => {
		expect(CLOSED_CREDIT_REPORT_CARTERA_STATUS_CHUNK_SIZE).toBeLessThanOrEqual(
			50,
		);
	});
});
