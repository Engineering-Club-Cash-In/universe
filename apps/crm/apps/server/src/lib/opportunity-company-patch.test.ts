import { describe, expect, test } from "bun:test";
import { buildOpportunityCompanyPatch } from "./opportunity-company-patch";

describe("buildOpportunityCompanyPatch", () => {
	test("preserves the current company when companyId is omitted", () => {
		expect(buildOpportunityCompanyPatch(undefined)).toEqual({});
	});

	test("unlinks the company when companyId is null", () => {
		expect(buildOpportunityCompanyPatch(null)).toEqual({ companyId: null });
	});

	test("assigns agencia or predio without depending on vehicle type", () => {
		expect(
			buildOpportunityCompanyPatch("44444444-4444-4444-8444-444444444444"),
		).toEqual({
			companyId: "44444444-4444-4444-8444-444444444444",
		});
	});
});
