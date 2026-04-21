import { describe, expect, test } from "bun:test";
import { getPublicLeadExistingOpportunityUpdates } from "./lead-helpers";

describe("public lead opportunity helpers", () => {
	test("updates reused opportunities with the incoming credit type", () => {
		const updates = getPublicLeadExistingOpportunityUpdates(
			{
				creditType: "autocompra",
				campaign: null,
			},
			{
				creditType: "sobre_vehiculo",
				campaign: "landing-sell",
			},
		);

		expect(updates).toEqual({
			creditType: "sobre_vehiculo",
			campaign: "landing-sell",
		});
	});
});
