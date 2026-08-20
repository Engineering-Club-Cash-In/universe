import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../src/db/schema/auth";
import {
	assertBoundPredicate,
	assertNoMalformedEquality,
	type QueryRecord,
} from "./auth-sql-predicate-assertions";

const queries: QueryRecord[] = [];

const client = {
	query: async (query: string | { text: string }, params?: unknown[]) => {
		queries.push({
			text: typeof query === "string" ? query : query.text,
			params: params ?? [],
		});

		return { rows: [] };
	},
};

const db = drizzle(client as never, { schema });
const adapter = drizzleAdapter(db, {
	provider: "pg",
	schema,
})({});

async function captureQuery(label: string, operation: () => Promise<unknown>) {
	const before = queries.length;
	await operation();
	const query = queries.at(-1);
	if (!query || queries.length === before) {
		throw new Error(`No SQL captured for ${label}`);
	}
	return query;
}

const userEmailQuery = await captureQuery("credential user email lookup", () =>
	adapter.findOne({
		model: "user",
		where: [{ field: "email", value: "agent-test@clubcashin.test" }],
	}),
);

const credentialAccountQuery = await captureQuery(
	"credential account lookup",
	() =>
		adapter.findOne({
			model: "account",
			where: [
				{ field: "providerId", value: "credential", connector: "AND" },
				{ field: "accountId", value: "user-id-1", connector: "AND" },
			],
		}),
);

const googleAccountQuery = await captureQuery(
	"google oauth account lookup",
	() =>
		adapter.findOne({
			model: "account",
			where: [
				{ field: "providerId", value: "google", connector: "AND" },
				{ field: "accountId", value: "google-account-1", connector: "AND" },
			],
		}),
);

assertBoundPredicate(
	userEmailQuery,
	'"user"."email"',
	"agent-test@clubcashin.test",
	"user email lookup",
);
assertBoundPredicate(
	credentialAccountQuery,
	'"account"."provider_id"',
	"credential",
	"credential provider lookup",
);
assertBoundPredicate(
	credentialAccountQuery,
	'"account"."account_id"',
	"user-id-1",
	"credential account lookup",
);
assertBoundPredicate(
	googleAccountQuery,
	'"account"."provider_id"',
	"google",
	"google provider lookup",
);
assertBoundPredicate(
	googleAccountQuery,
	'"account"."account_id"',
	"google-account-1",
	"google account lookup",
);
assertNoMalformedEquality(userEmailQuery, "user email lookup");
assertNoMalformedEquality(credentialAccountQuery, "credential account lookup");
assertNoMalformedEquality(googleAccountQuery, "google account lookup");

console.log(
	JSON.stringify({
		userEmailQuery,
		credentialAccountQuery,
		googleAccountQuery,
	}),
);
