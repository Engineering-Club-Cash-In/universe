import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { leads } from "../db/schema/crm";

let whereCondition: SQL | undefined;
let joinedTable: unknown;
let joinCondition: SQL | undefined;

const applyWhere = (condition: SQL) => {
	whereCondition = condition;

	return {
		orderBy: (..._orderByArgs: unknown[]) => ({
			limit: (..._limitArgs: unknown[]) => Promise.resolve([]),
		}),
	};
};

mock.module("../db", () => ({
	db: {
		select: (..._selectArgs: unknown[]) => ({
			from: (..._fromArgs: unknown[]) => ({
				where: applyWhere,
				leftJoin: (table: unknown, condition: SQL) => {
					joinedTable = table;
					joinCondition = condition;

					return { where: applyWhere };
				},
			}),
		}),
	},
}));

const { getOpenOpportunityBySource } = await import("./lead-opportunity");
const dialect = new PgDialect();

function compile(condition: SQL | undefined) {
	expect(condition).toBeDefined();
	if (!condition) {
		throw new Error("Expected the helper to build a SQL condition");
	}

	return dialect.sqlToQuery(condition);
}

describe("getOpenOpportunityBySource", () => {
	beforeEach(() => {
		whereCondition = undefined;
		joinedTable = undefined;
		joinCondition = undefined;
	});

	test("filters open opportunities by the requested source", async () => {
		await getOpenOpportunityBySource(
			"00000000-0000-0000-0000-000000000001",
			"Whatsapp",
		);

		const query = compile(whereCondition);

		expect(query.sql).toContain('"opportunities"."source" =');
		expect(query.params).toContain("Whatsapp");
	});

	test("requires the lead source to match for legacy null opportunity sources", async () => {
		await getOpenOpportunityBySource(
			"00000000-0000-0000-0000-000000000001",
			"Whatsapp",
		);

		const query = compile(whereCondition);

		expect(query.sql).toContain(
			'"opportunities"."source" is null and "leads"."source" =',
		);
		expect(query.params.filter((param) => param === "Whatsapp")).toHaveLength(
			2,
		);
	});

	test("joins each opportunity to its own lead for the legacy fallback", async () => {
		await getOpenOpportunityBySource(
			"00000000-0000-0000-0000-000000000001",
			"Whatsapp",
		);

		expect(joinedTable).toBe(leads);
		expect(compile(joinCondition).sql).toBe(
			'"opportunities"."lead_id" = "leads"."id"',
		);
	});

	test("keeps open and on-hold opportunities eligible", async () => {
		await getOpenOpportunityBySource(
			"00000000-0000-0000-0000-000000000001",
			"Whatsapp",
		);

		const query = compile(whereCondition);

		expect(query.params).toContain("open");
		expect(query.params).toContain("on_hold");
	});
});
