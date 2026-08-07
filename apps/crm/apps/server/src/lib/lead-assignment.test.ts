import { describe, expect, test } from "bun:test";
import {
	canReceiveAutoAssignedLead,
	getSalesUserWithLeastAutoAssignedLeads,
	getStartOfTodayGT,
	resolveExistingLeadAssignee,
	resolveNewAutoLeadAssignment,
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

	test.each([
		["2026-08-07T05:59:59.999Z", "2026-08-06T06:00:00.000Z"],
		["2026-08-07T06:00:00.000Z", "2026-08-07T06:00:00.000Z"],
	])("gets the Guatemala start of day for %s", (now, expected) => {
		expect(getStartOfTodayGT(new Date(now))).toEqual(new Date(expected));
	});

	test("returns no assignee when no eligible fallback exists", () => {
		expect(
			resolveExistingLeadAssignee(
				{ id: "disabled", role: "sales", assignLeads: false, banned: false },
				null,
			),
		).toBeNull();
	});

	test("prepares new automatic leads with the selected eligible advisor", async () => {
		const assignment = await resolveNewAutoLeadAssignment(async () => ({
			id: "eligible-sales-user",
		}));

		expect(assignment).toEqual({
			success: true,
			assignedTo: "eligible-sales-user",
			createdBy: "eligible-sales-user",
			assignmentType: "auto",
		});
	});

	test("fails closed for new automatic leads when no eligible advisor exists", async () => {
		const assignment = await resolveNewAutoLeadAssignment(
			async () => null,
			"No sales user available to assign the WhatsApp lead",
		);

		expect(assignment).toEqual({
			success: false,
			message: "No sales user available to assign the WhatsApp lead",
		});
	});

	test("keeps existing lead reactivation fail-closed when no eligible fallback exists", () => {
		expect(
			resolveExistingLeadAssignee(
				{ id: "disabled", role: "sales", assignLeads: false, banned: false },
				null,
			),
		).toBeNull();
	});

	test("keeps the WhatsApp controller out of the public-lead import cycle and fixed advisor assignment", async () => {
		const botSource = await Bun.file(
			new URL("../controllers/bot.ts", import.meta.url),
		).text();

		expect(botSource).not.toContain('from "./public-lead"');
		expect(botSource).not.toContain('from "@/utils/constants"');
		expect(botSource).not.toContain("assignedTo: salesUser");
		expect(botSource).not.toContain("createdBy: salesUser");
		expect(botSource).toContain('assignmentType: "auto"');
		expect(botSource).toContain(
			"assignedUserId = newLeadAssignment.assignedTo",
		);
		expect(botSource).toContain("assignedTo: assignedUserId");

		const failClosedIndex = botSource.indexOf(
			"if (!newLeadAssignment.success)",
		);
		const leadInsertIndex = botSource.indexOf(".insert(leads)");
		expect(failClosedIndex).toBeGreaterThan(-1);
		expect(leadInsertIndex).toBeGreaterThan(-1);
		expect(failClosedIndex).toBeLessThan(leadInsertIndex);
	});
});
