import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client, type ClientConfig } from "pg";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const migrationFile = new URL(
	"./0027_add_credit_analysis_opportunity.sql",
	import.meta.url,
);

export function createSafeTestDatabaseConfig(databaseUrl: string): ClientConfig {
	const url = new URL(databaseUrl);
	const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

	if (
		!loopbackHosts.has(url.hostname) ||
		url.pathname !== "/crm_credit_analysis_test" ||
		url.search ||
		url.hash
	) {
		throw new Error(
			"TEST_DATABASE_URL debe apuntar a un host loopback y a crm_credit_analysis_test",
		);
	}

	return {
		host: url.hostname,
		port: url.port ? Number(url.port) : 5432,
		user: decodeURIComponent(url.username),
		password: decodeURIComponent(url.password),
		database: "crm_credit_analysis_test",
	};
}

test("rejects a query host override before any migration client can connect", () => {
	expect(() =>
		createSafeTestDatabaseConfig(
			"postgres://postgres:postgres@localhost/crm_credit_analysis_test?host=203.0.113.1",
		),
	).toThrow(
		"TEST_DATABASE_URL debe apuntar a un host loopback y a crm_credit_analysis_test",
	);
});

test("rejects direct non-loopback hosts and wrong database names", () => {
	for (const databaseUrl of [
		"postgres://postgres:postgres@203.0.113.1/crm_credit_analysis_test",
		"postgres://postgres:postgres@localhost/crm_credit_analysis_other",
	]) {
		expect(() => createSafeTestDatabaseConfig(databaseUrl)).toThrow(
			"TEST_DATABASE_URL debe apuntar a un host loopback y a crm_credit_analysis_test",
		);
	}
});

if (!testDatabaseUrl) {
	describe.skip("0027_add_credit_analysis_opportunity migration", () => {
		test("requires TEST_DATABASE_URL", () => {});
	});
} else {
	const clientConfig = createSafeTestDatabaseConfig(testDatabaseUrl);

	describe("0027_add_credit_analysis_opportunity migration", () => {
		const client = new Client(clientConfig);

		beforeAll(async () => {
			const migration = await Bun.file(migrationFile).text();
			await client.connect();
			await client.query('DROP TABLE IF EXISTS "credit_analysis"');
			await client.query('DROP TABLE IF EXISTS "opportunities"');
			await client.query('DROP TABLE IF EXISTS "leads"');
			await client.query('CREATE TABLE "leads" ("id" uuid PRIMARY KEY)');
			await client.query(
				'CREATE TABLE "opportunities" ("id" uuid PRIMARY KEY, "lead_id" uuid)',
			);
			await client.query(`
				CREATE TABLE "credit_analysis" (
					"id" uuid PRIMARY KEY,
					"lead_id" uuid,
					"co_debtor_id" uuid,
					"monthly_fixed_income" numeric(12, 2),
					"full_analysis" text,
					CONSTRAINT "credit_analysis_lead_id_unique" UNIQUE("lead_id")
				)
			`);
			await client.query(`
				INSERT INTO "leads" ("id") VALUES
					('00000000-0000-0000-0000-000000000001'),
					('00000000-0000-0000-0000-000000000002'),
					('00000000-0000-0000-0000-000000000003'),
					('00000000-0000-0000-0000-000000000004')
			`);
			await client.query(`
				INSERT INTO "opportunities" ("id", "lead_id") VALUES
					('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001'),
					('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002'),
					('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002'),
					('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000004')
			`);
			await client.query(`
				INSERT INTO "credit_analysis" ("id", "lead_id", "co_debtor_id", "monthly_fixed_income", "full_analysis") VALUES
					('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', NULL, 1250.50, '{"preserve":true}'),
					('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', NULL, 800.00, '{"ambiguous":true}'),
					('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000003', NULL, 700.00, '{"zero":true}'),
					('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000001', 900.00, '{"coDebtor":true}')
			`);
			await client.query(migration);
		});

		afterAll(async () => {
			await client.query('DROP TABLE IF EXISTS "credit_analysis"');
			await client.query('DROP TABLE IF EXISTS "opportunities"');
			await client.query('DROP TABLE IF EXISTS "leads"');
			await client.end();
		});

		test("preserves rows and only backfills an unambiguous lead analysis", async () => {
			const result = await client.query<{
				id: string;
				lead_id: string | null;
				co_debtor_id: string | null;
				opportunity_id: string | null;
				monthly_fixed_income: string;
				full_analysis: string;
			}>(`
				SELECT "id", "lead_id", "co_debtor_id", "opportunity_id", "monthly_fixed_income", "full_analysis"
				FROM "credit_analysis"
				ORDER BY "id"
			`);

			expect(result.rows).toEqual([
				{
					id: "20000000-0000-0000-0000-000000000001",
					lead_id: "00000000-0000-0000-0000-000000000001",
					co_debtor_id: null,
					opportunity_id: "10000000-0000-0000-0000-000000000001",
					monthly_fixed_income: "1250.50",
					full_analysis: '{"preserve":true}',
				},
				{
					id: "20000000-0000-0000-0000-000000000002",
					lead_id: "00000000-0000-0000-0000-000000000002",
					co_debtor_id: null,
					opportunity_id: null,
					monthly_fixed_income: "800.00",
					full_analysis: '{"ambiguous":true}',
				},
				{
					id: "20000000-0000-0000-0000-000000000003",
					lead_id: "00000000-0000-0000-0000-000000000003",
					co_debtor_id: null,
					opportunity_id: null,
					monthly_fixed_income: "700.00",
					full_analysis: '{"zero":true}',
				},
				{
					id: "20000000-0000-0000-0000-000000000004",
					lead_id: "00000000-0000-0000-0000-000000000004",
					co_debtor_id: "30000000-0000-0000-0000-000000000001",
					opportunity_id: null,
					monthly_fixed_income: "900.00",
					full_analysis: '{"coDebtor":true}',
				},
			]);
		});

		test("removes the legacy lead constraint and allows separate opportunity analyses", async () => {
			await client.query(`
				INSERT INTO "credit_analysis" ("id", "lead_id", "opportunity_id") VALUES
					('20000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000002', NULL),
					('20000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002'),
					('20000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003')
			`);

			const result = await client.query<{ count: string }>(
				`SELECT count(*) FROM "credit_analysis" WHERE "lead_id" = '00000000-0000-0000-0000-000000000002'`,
			);
			expect(result.rows[0]?.count).toBe("4");
		});

		test("rejects duplicate and unknown opportunities and nulls history on opportunity deletion", async () => {
			await expect(
				client.query(`
					INSERT INTO "credit_analysis" ("id", "opportunity_id")
					VALUES ('20000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000002')
				`),
			).rejects.toThrow();
			await expect(
				client.query(`
					INSERT INTO "credit_analysis" ("id", "opportunity_id")
					VALUES ('20000000-0000-0000-0000-000000000009', '99999999-0000-0000-0000-000000000009')
				`),
			).rejects.toThrow();

			await client.query(
				`DELETE FROM "opportunities" WHERE "id" = '10000000-0000-0000-0000-000000000001'`,
			);
			const result = await client.query<{ opportunity_id: string | null }>(
				`SELECT "opportunity_id" FROM "credit_analysis" WHERE "id" = '20000000-0000-0000-0000-000000000001'`,
			);
			expect(result.rows[0]?.opportunity_id).toBeNull();
		});
	});
}
