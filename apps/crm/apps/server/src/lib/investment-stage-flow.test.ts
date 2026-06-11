import { describe, expect, test } from "bun:test";
import {
	getNextInvestmentStage,
	getPreviousInvestmentStage,
} from "./investment-stage-flow";

describe("investment stage flow helpers", () => {
	test("returns the previous stage for a valid active stage", () => {
		expect(getPreviousInvestmentStage("model_presentation")).toBe(
			"profiling_and_qualification",
		);
	});

	test("returns null when the stage is the first one", () => {
		expect(getPreviousInvestmentStage("data_collection")).toBeNull();
	});

	test("returns null for lost or unknown stages", () => {
		expect(getPreviousInvestmentStage("lost")).toBeNull();
		expect(getPreviousInvestmentStage("unknown_stage")).toBeNull();
	});

	test("returns the next stage for a valid active stage", () => {
		expect(getNextInvestmentStage("active_follow_up")).toBe(
			"verbal_commitment_contract_sent",
		);
	});

	test("returns null when the stage is the last active one", () => {
		expect(
			getNextInvestmentStage("initial_onboarding_senior_handoff"),
		).toBeNull();
	});
});
