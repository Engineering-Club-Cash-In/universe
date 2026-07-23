import { describe, expect, test } from "bun:test";
import { createTableRelationsHelpers } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import {
	creditAnalysis,
	creditAnalysisRelations,
	opportunities,
	opportunitiesRelations,
} from "./crm";

describe("credit_analysis opportunity linkage", () => {
	test("declares a nullable opportunity FK that preserves historical analyses", () => {
		const foreignKeys = getTableConfig(creditAnalysis).foreignKeys;
		const opportunityForeignKey = foreignKeys.find(
			(foreignKey) =>
				foreignKey.reference().foreignTable === opportunities,
		);

		expect(creditAnalysis.opportunityId.notNull).toBe(false);
		expect(opportunityForeignKey?.onDelete).toBe("set null");
	});

	test("declares one non-null analysis per opportunity", () => {
		const indexes = getTableConfig(creditAnalysis).indexes;
		const opportunityIndex = indexes.find(
			(index) => index.config.name === "credit_analysis_opportunity_id_unique",
		);

		expect(opportunityIndex?.config.unique).toBe(true);
		expect(opportunityIndex?.config.columns).toMatchObject([
			{ name: creditAnalysis.opportunityId.name },
		]);
		if (!opportunityIndex?.config.where) {
			throw new Error("El índice debe tener un predicado parcial");
		}
		expect(
			new PgDialect().sqlToQuery(opportunityIndex.config.where).sql,
		).toBe('"credit_analysis"."opportunity_id" IS NOT NULL');
	});

	test("maps the opportunity relation in both directions", () => {
		const creditAnalysisRelationsConfig = creditAnalysisRelations.config(
			createTableRelationsHelpers(creditAnalysis),
		);
		const opportunitiesRelationsConfig = opportunitiesRelations.config(
			createTableRelationsHelpers(opportunities),
		);

		expect(creditAnalysisRelationsConfig.opportunity.referencedTable).toBe(
			opportunities,
		);
		expect(creditAnalysisRelationsConfig.opportunity.config).toMatchObject({
			fields: [creditAnalysis.opportunityId],
			references: [opportunities.id],
		});
		expect(
			opportunitiesRelationsConfig.creditAnalyses.referencedTable,
		).toBe(creditAnalysis);
		expect(
			opportunitiesRelationsConfig.creditAnalyses.constructor.name,
		).toBe("One");
	});
});
