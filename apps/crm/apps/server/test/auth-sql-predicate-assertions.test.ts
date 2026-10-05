import { describe, expect, it } from "bun:test";

type QueryRecord = {
	text: string;
	params: unknown[];
};

type PredicateAssertionsModule = {
	assertBoundPredicate: (
		query: QueryRecord,
		column: string,
		expectedValue: unknown,
		label: string,
	) => void;
};

async function loadAssertions() {
	try {
		const modulePath = "./auth-sql-predicate-assertions";
		return (await import(modulePath)) as PredicateAssertionsModule;
	} catch {
		return undefined;
	}
}

describe("compiled auth SQL predicate assertions", () => {
	it("accepts reordered placeholders when each column is bound to the expected value", async () => {
		const assertions = await loadAssertions();
		expect(assertions).toBeDefined();

		const query = {
			text: 'select * from "account" where ("account"."account_id" = $1 and "account"."provider_id" = $2)',
			params: ["user-id-1", "credential"],
		};

		expect(() =>
			assertions?.assertBoundPredicate(
				query,
				'"account"."provider_id"',
				"credential",
				"credential provider lookup",
			),
		).not.toThrow();
		expect(() =>
			assertions?.assertBoundPredicate(
				query,
				'"account"."account_id"',
				"user-id-1",
				"credential account lookup",
			),
		).not.toThrow();
	});

	it("rejects a predicate whose placeholder is bound to the wrong value", async () => {
		const assertions = await loadAssertions();
		expect(assertions).toBeDefined();

		const query = {
			text: 'select * from "account" where ("account"."provider_id" = $1 and "account"."account_id" = $2)',
			params: ["user-id-1", "credential"],
		};

		expect(() =>
			assertions?.assertBoundPredicate(
				query,
				'"account"."provider_id"',
				"credential",
				"credential provider lookup",
			),
		).toThrow("bound to an unexpected value");
	});
});
