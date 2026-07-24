import { describe, expect, test } from "bun:test";
import {
	getOpportunityCreditAnalysisInput,
	resolveAnalysisOpportunityId,
} from "./credit-analysis";

describe("getOpportunityCreditAnalysisInput", () => {
	test("includes the current opportunity in the lead analysis request", () => {
		expect(getOpportunityCreditAnalysisInput("lead-1", "opportunity-2")).toEqual({
			leadId: "lead-1",
			opportunityId: "opportunity-2",
		});
		expect(getOpportunityCreditAnalysisInput("lead-1", undefined)).toBeNull();
	});
});

describe("resolveAnalysisOpportunityId", () => {
	const opportunities = [{ id: "opportunity-a" }, { id: "opportunity-b" }];

	test("prefers a valid explicit selection", () => {
		expect(
			resolveAnalysisOpportunityId(
				"opportunity-b",
				"opportunity-a",
				opportunities,
			),
		).toBe("opportunity-b");
	});

	test("rejects a URL opportunity that does not belong to the current lead", () => {
		expect(
			resolveAnalysisOpportunityId(
				undefined,
				"other-lead-opportunity",
				opportunities,
			),
		).toBeUndefined();
	});

	test("automatically selects the only opportunity", () => {
		expect(
			resolveAnalysisOpportunityId(undefined, undefined, [
				{ id: "only-opportunity" },
			]),
		).toBe("only-opportunity");
	});

	test("returns undefined for multiple opportunities without a selection", () => {
		expect(
			resolveAnalysisOpportunityId(undefined, undefined, opportunities),
		).toBeUndefined();
	});
});
