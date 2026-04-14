import { describe, expect, test } from "bun:test";
import { canReceiveAutoAssignedLead } from "./lead-assignment";

describe("lead assignment helpers", () => {
	test("accepts active sales users that can receive leads", () => {
		expect(
			canReceiveAutoAssignedLead({
				role: "sales",
				assignLeads: true,
				banned: false,
			}),
		).toBe(true);
	});

	test("rejects sales users that opted out of leads", () => {
		expect(
			canReceiveAutoAssignedLead({
				role: "sales",
				assignLeads: false,
				banned: false,
			}),
		).toBe(false);
	});

	test("rejects non-sales or banned users", () => {
		expect(
			canReceiveAutoAssignedLead({
				role: "sales_supervisor",
				assignLeads: true,
				banned: false,
			}),
		).toBe(false);
		expect(
			canReceiveAutoAssignedLead({
				role: "sales",
				assignLeads: true,
				banned: true,
			}),
		).toBe(false);
		expect(canReceiveAutoAssignedLead(null)).toBe(false);
	});
});
