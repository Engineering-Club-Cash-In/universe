import { describe, expect, test } from "bun:test";
import {
	buildManualValuationData,
	MANUAL_VALUATION_RESULT,
	MANUAL_VALUATION_TECHNICIAN_NAME,
} from "./manual-valuation";

describe("manual valuation helpers", () => {
	test("builds approved manual inspections for analysis-ready valuations", () => {
		const result = buildManualValuationData({
			vehicleRating: "Comercial",
			marketValue: "55000",
			suggestedCommercialValue: "55000",
			bankValue: "55000",
			currentConditionValue: "25000",
		});

		expect(result.status).toBe("approved");
		expect(result.technicianName).toBe(MANUAL_VALUATION_TECHNICIAN_NAME);
		expect(result.inspectionResult).toBe(MANUAL_VALUATION_RESULT);
	});
});
