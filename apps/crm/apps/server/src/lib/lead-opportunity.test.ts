import { describe, expect, mock, test } from "bun:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

let whereCondition: SQL | undefined;

mock.module("../db", () => ({
	db: {
		select: (..._selectArgs: unknown[]) => ({
			from: (..._fromArgs: unknown[]) => ({
				where: (condition: SQL) => {
					whereCondition = condition;

					return {
						orderBy: (..._orderByArgs: unknown[]) => ({
							limit: (..._limitArgs: unknown[]) => Promise.resolve([]),
						}),
					};
				},
			}),
		}),
	},
}));

const { getOpenOpportunityBySource } = await import("./lead-opportunity");

describe("getOpenOpportunityBySource", () => {
	test("filters open opportunities by the requested source", async () => {
		await getOpenOpportunityBySource(
			"00000000-0000-0000-0000-000000000001",
			"Whatsapp",
		);

		expect(whereCondition).toBeDefined();
		if (!whereCondition) {
			throw new Error("Expected the helper to build a where condition");
		}
		const query = new PgDialect().sqlToQuery(whereCondition);

		expect(query.sql).toContain('"opportunities"."source" =');
		expect(query.params).toContain("Whatsapp");
	});
});
