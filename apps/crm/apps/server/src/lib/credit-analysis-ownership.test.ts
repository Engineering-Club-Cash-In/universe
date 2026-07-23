import { describe, expect, test } from "bun:test";
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

	test("keeps co-debtor analysis scoped by coDebtorId", () => {
		const coDebtorId = "30000000-0000-0000-0000-000000000001";
		const condition = conditionSql({ coDebtorId });

		expect(condition.sql).toContain('"credit_analysis"."co_debtor_id"');
		expect(condition.params).toEqual([coDebtorId]);
		expect(getCreditAnalysisResourceId({ coDebtorId })).toBe(coDebtorId);
	});
});
