import { describe, expect, test } from "bun:test";
import {
	canReceiveAutoAssignedLead,
	getSalesUserWithLeastAutoAssignedLeads,
	resolveExistingLeadAssignee,
} from "./lead-assignment";

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

	test("keeps an eligible existing owner", () => {
		expect(
			resolveExistingLeadAssignee(
				{ id: "current", role: "sales", assignLeads: true, banned: false },
				{ id: "fallback", role: "sales", assignLeads: true, banned: false },
			),
		).toBe("current");
	});

	test("uses the balanced fallback for an ineligible existing owner", () => {
		const fallback = {
			id: "fallback",
			role: "sales",
			assignLeads: true,
			banned: false,
		};

		for (const currentOwner of [
			{ id: "disabled", role: "sales", assignLeads: false, banned: false },
			{ id: "banned", role: "sales", assignLeads: true, banned: true },
			{
				id: "not-sales",
				role: "sales_supervisor",
				assignLeads: true,
				banned: false,
			},
		]) {
			expect(resolveExistingLeadAssignee(currentOwner, fallback)).toBe(
				"fallback",
			);
		}
	});

	test("chooses the eligible advisor with the fewest automatic leads today", () => {
		const selected = getSalesUserWithLeastAutoAssignedLeads(
			[
				{ id: "busy", role: "sales", assignLeads: true, banned: false },
				{ id: "available", role: "sales", assignLeads: true, banned: false },
			],
			new Map([
				["busy", 4],
				["available", 1],
			]),
		);

		expect(selected?.id).toBe("available");
	});

	test("balances fallback assignments after reactivating an older lead", () => {
		const selected = getSalesUserWithLeastAutoAssignedLeads(
			[
				{ id: "first", role: "sales", assignLeads: true, banned: false },
				{ id: "second", role: "sales", assignLeads: true, banned: false },
			],
			new Map(),
			new Map([["first", 1]]),
		);

		expect(selected?.id).toBe("second");
	});

	test("returns no assignee when no eligible fallback exists", () => {
		expect(
			resolveExistingLeadAssignee(
				{ id: "disabled", role: "sales", assignLeads: false, banned: false },
				null,
			),
		).toBeNull();
	});

	test("keeps the WhatsApp controller out of the public-lead import cycle", async () => {
		const botSource = await Bun.file(
			new URL("../controllers/bot.ts", import.meta.url),
		).text();

		expect(botSource).not.toContain('from "./public-lead"');
	});
});
