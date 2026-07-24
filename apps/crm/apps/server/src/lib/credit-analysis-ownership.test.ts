import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import {
	assertOpportunityBelongsToLead,
	canWriteOpportunityCreditAnalysis,
	getCreditAnalysisOwnerCondition,
	getCreditAnalysisResourceId,
} from "./credit-analysis-ownership";

const dialect = new PgDialect();

function conditionSql(
	owner:
		| { leadId: string; opportunityId: string }
		| { coDebtorId: string },
) {
	return dialect.sqlToQuery(getCreditAnalysisOwnerCondition(owner));
}

describe("credit analysis ownership", () => {
	test("opportunity A analysis cannot satisfy opportunity B", () => {
		const opportunityA = conditionSql({
			leadId: "00000000-0000-0000-0000-000000000001",
			opportunityId: "10000000-0000-0000-0000-000000000001",
		});
		const opportunityB = conditionSql({
			leadId: "00000000-0000-0000-0000-000000000001",
			opportunityId: "10000000-0000-0000-0000-000000000002",
		});

		expect(opportunityA.sql).toContain('"credit_analysis"."opportunity_id"');
		expect(opportunityA.params).toEqual([
			"10000000-0000-0000-0000-000000000001",
		]);
		expect(opportunityB.params).toEqual([
			"10000000-0000-0000-0000-000000000002",
		]);
	});

	test("create and reset scope opportunity B without targeting A", () => {
		const opportunityB = {
			leadId: "00000000-0000-0000-0000-000000000001",
			opportunityId: "10000000-0000-0000-0000-000000000002",
		};

		expect(conditionSql(opportunityB).params).toEqual([
			opportunityB.opportunityId,
		]);
		expect(getCreditAnalysisResourceId(opportunityB)).toBe(
			opportunityB.opportunityId,
		);
	});

	test("rejects an opportunity owned by another lead", () => {
		expect(() =>
			assertOpportunityBelongsToLead(
				{ leadId: "00000000-0000-0000-0000-000000000002" },
				"00000000-0000-0000-0000-000000000001",
			),
		).toThrow("La oportunidad no pertenece al lead analizado");
	});

	test("requires sales ownership of the opportunity without restricting supervisors or admins", () => {
		const salesUserId = "00000000-0000-0000-0000-000000000001";
		const otherSalesUserId = "00000000-0000-0000-0000-000000000002";

		expect(
			canWriteOpportunityCreditAnalysis(
				"sales",
				salesUserId,
				otherSalesUserId,
			),
		).toBe(false);
		expect(
			canWriteOpportunityCreditAnalysis("sales", salesUserId, salesUserId),
		).toBe(true);
		expect(
			canWriteOpportunityCreditAnalysis(
				"sales_supervisor",
				salesUserId,
				otherSalesUserId,
			),
		).toBe(true);
		expect(
			canWriteOpportunityCreditAnalysis(
				"admin",
				salesUserId,
				otherSalesUserId,
			),
		).toBe(true);
	});

	test("checks opportunity ownership before returning opportunity analysis", () => {
		const source = readFileSync(
			join(import.meta.dir, "../routers/crm.ts"),
			"utf8",
		);
		const readHandler = source.slice(
			source.indexOf("getCreditAnalysisByLeadId: crmProcedure"),
			source.indexOf("upsertCreditAnalysis: crmProcedure"),
		);
		const assignedToIndex = readHandler.indexOf(
			"assignedTo: opportunities.assignedTo",
		);
		const permissionCheckIndex = readHandler.indexOf(
			"!canWriteOpportunityCreditAnalysis(",
		);
		const analysisReadIndex = readHandler.indexOf(".from(creditAnalysis)");

		expect(assignedToIndex).toBeGreaterThan(-1);
		expect(permissionCheckIndex).toBeGreaterThan(assignedToIndex);
		expect(analysisReadIndex).toBeGreaterThan(permissionCheckIndex);
	});

	test("authorizes reading manual analysis by opportunity owner instead of lead owner", () => {
		const source = readFileSync(
			join(import.meta.dir, "../routers/crm.ts"),
			"utf8",
		);
		const handler = source.slice(
			source.indexOf("getCreditAnalysisByLeadId: crmProcedure"),
			source.indexOf("upsertCreditAnalysis: crmProcedure"),
		);

		expect(handler).not.toContain("lead[0].assignedTo !== context.userId");
		expect(handler).toContain("opportunity.assignedTo");
	});

	test("authorizes saving manual analysis by opportunity owner instead of lead owner", () => {
		const source = readFileSync(
			join(import.meta.dir, "../routers/crm.ts"),
			"utf8",
		);
		const handler = source.slice(
			source.indexOf("upsertCreditAnalysis: crmProcedure"),
			source.indexOf("resetCreditAnalysis: crmProcedure"),
		);

		expect(handler).not.toContain("lead[0].assignedTo !== context.userId");
		expect(handler).toContain("opportunity.assignedTo");
	});

	test("checks opportunity ownership before bank analysis side effects", () => {
		const source = readFileSync(
			join(import.meta.dir, "../routers/bank-analysis.ts"),
			"utf8",
		);
		const permissionCheckIndex = source.indexOf(
			"!canWriteOpportunityCreditAnalysis(",
		);
		const uploadReadIndex = source.indexOf("verifyUploadedDocumentInR2({");
		const attemptWriteIndex = source.indexOf(".update(creditAnalysis)");
		const aiCallIndex = source.indexOf("const result = await generateObject({");

		expect(permissionCheckIndex).toBeGreaterThan(-1);
		expect(uploadReadIndex).toBeGreaterThan(permissionCheckIndex);
		expect(attemptWriteIndex).toBeGreaterThan(permissionCheckIndex);
		expect(aiCallIndex).toBeGreaterThan(permissionCheckIndex);
	});

	test("authorizes lead bank analysis by opportunity owner instead of lead owner", () => {
		const source = readFileSync(
			join(import.meta.dir, "../routers/bank-analysis.ts"),
			"utf8",
		);
		const handler = source.slice(source.indexOf("analyzeBankStatements:"));

		expect(handler).not.toContain(
			"lead[0].assignedTo !== context.userId",
		);
		expect(handler.indexOf(".from(leads)")).toBeLessThan(
			handler.indexOf(".from(opportunities)"),
		);
		expect(handler.indexOf("!canWriteOpportunityCreditAnalysis(")).toBeLessThan(
			handler.indexOf("verifyUploadedDocumentInR2({"),
		);
	});

	test("keeps co-debtor analysis scoped by coDebtorId", () => {
		const coDebtorId = "30000000-0000-0000-0000-000000000001";
		const condition = conditionSql({ coDebtorId });

		expect(condition.sql).toContain('"credit_analysis"."co_debtor_id"');
		expect(condition.params).toEqual([coDebtorId]);
		expect(getCreditAnalysisResourceId({ coDebtorId })).toBe(coDebtorId);
	});
});
