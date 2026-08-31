import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildOpportunityRelationshipPatch } from "./opportunity-relationship-patch";

const currentOpportunity = {
	lead: { id: "11111111-1111-4111-8111-111111111111" },
	company: { id: "22222222-2222-4222-8222-222222222222" },
	vehicleId: "33333333-3333-4333-8333-333333333333",
};

describe("buildOpportunityRelationshipPatch", () => {
	test("emits only changed company for a company-only edit", () => {
		expect(
			buildOpportunityRelationshipPatch({
				values: {
					leadId: currentOpportunity.lead.id,
					companyId: "44444444-4444-4444-8444-444444444444",
					vehicleId: currentOpportunity.vehicleId,
				},
				opportunity: currentOpportunity,
			}),
		).toEqual({ companyId: "44444444-4444-4444-8444-444444444444" });
	});

	test("omits unchanged lead and vehicle", () => {
		expect(
			buildOpportunityRelationshipPatch({
				values: {
					leadId: currentOpportunity.lead.id,
					companyId: currentOpportunity.company.id,
					vehicleId: currentOpportunity.vehicleId,
				},
				opportunity: currentOpportunity,
			}),
		).toEqual({});
	});

	test("emits only changed lead", () => {
		expect(
			buildOpportunityRelationshipPatch({
				values: {
					leadId: "55555555-5555-4555-8555-555555555555",
					companyId: currentOpportunity.company.id,
					vehicleId: currentOpportunity.vehicleId,
				},
				opportunity: currentOpportunity,
			}),
		).toEqual({ leadId: "55555555-5555-4555-8555-555555555555" });
	});

	test("emits null when lead is cleared", () => {
		expect(
			buildOpportunityRelationshipPatch({
				values: {
					leadId: "none",
					companyId: currentOpportunity.company.id,
					vehicleId: currentOpportunity.vehicleId,
				},
				opportunity: currentOpportunity,
			}),
		).toEqual({ leadId: null });
	});

	test("emits null when company is cleared", () => {
		expect(
			buildOpportunityRelationshipPatch({
				values: {
					leadId: currentOpportunity.lead.id,
					companyId: "",
					vehicleId: currentOpportunity.vehicleId,
				},
				opportunity: currentOpportunity,
			}),
		).toEqual({ companyId: null });
	});

	test("emits null when vehicle is cleared", () => {
		expect(
			buildOpportunityRelationshipPatch({
				values: {
					leadId: currentOpportunity.lead.id,
					companyId: currentOpportunity.company.id,
					vehicleId: null,
				},
				opportunity: currentOpportunity,
			}),
		).toEqual({ vehicleId: null });
	});

	test("emits only changed vehicle", () => {
		expect(
			buildOpportunityRelationshipPatch({
				values: {
					leadId: currentOpportunity.lead.id,
					companyId: currentOpportunity.company.id,
					vehicleId: "66666666-6666-4666-8666-666666666666",
				},
				opportunity: currentOpportunity,
			}),
		).toEqual({ vehicleId: "66666666-6666-4666-8666-666666666666" });
	});
});

describe("opportunity edit submit relationship patch", () => {
	test("spreads relationship patch instead of unconditional relationship values", () => {
		const source = readFileSync(
			join(import.meta.dir, "../routes/crm/opportunities.tsx"),
			"utf8",
		);
		const editFormStart = source.indexOf("const editOpportunityForm = useForm");
		const editSubmitStart = source.indexOf(
			"onSubmit: async ({ value }) =>",
			editFormStart,
		);
		const editSubmit = source.slice(
			editSubmitStart,
			source.indexOf("const createOpportunityMutation", editSubmitStart),
		);

		expect(editSubmit).toContain("...buildOpportunityRelationshipPatch({");
		expect(editSubmit).not.toContain('value.leadId && value.leadId !== "none"');
		expect(editSubmit).not.toContain(
			'value.companyId && value.companyId !== "none"',
		);
		expect(editSubmit).not.toContain("vehicleId: value.vehicleId || null");
	});

	test("backend accepts null lead and company relationship patches", () => {
		const source = readFileSync(
			join(import.meta.dir, "../../../server/src/routers/crm.ts"),
			"utf8",
		);
		const updateOpportunityStart = source.indexOf(
			"updateOpportunity: crmProcedure",
		);
		const inputContract = source.slice(
			updateOpportunityStart,
			source.indexOf(
				".handler(async ({ input, context }) =>",
				updateOpportunityStart,
			),
		);

		expect(inputContract).toContain(
			"leadId: z.string().uuid().nullable().optional()",
		);
		expect(inputContract).toContain(
			"companyId: z.string().uuid().nullable().optional()",
		);
	});
});
