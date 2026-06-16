import { describe, expect, test } from "bun:test";
import { isClosedCreditReportContractStateIncluded } from "./reports";

describe("isClosedCreditReportContractStateIncluded", () => {
	test("only includes credits with an active contract state", () => {
		expect(isClosedCreditReportContractStateIncluded("activo")).toBe(true);
		expect(isClosedCreditReportContractStateIncluded("completado")).toBe(false);
		expect(isClosedCreditReportContractStateIncluded("incobrable")).toBe(false);
		expect(isClosedCreditReportContractStateIncluded("recuperado")).toBe(false);
		expect(isClosedCreditReportContractStateIncluded(null)).toBe(false);
	});
});
