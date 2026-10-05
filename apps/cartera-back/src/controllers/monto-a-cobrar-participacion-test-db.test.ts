import { describe, expect, test } from "bun:test";
import { parseTestDatabaseUrl } from "./monto-a-cobrar-participacion-test-db";

describe("parseTestDatabaseUrl", () => {
	test("acepta sólo la base local dedicada", () => {
		expect(
			parseTestDatabaseUrl(
				"postgresql://tester:secret@127.0.0.1:55432/cartera_reports_reconciliation_test",
			),
		).toEqual({
			host: "127.0.0.1",
			port: 55432,
			database: "cartera_reports_reconciliation_test",
			user: "tester",
			password: "secret",
			ssl: false,
		});
	});

	test("rechaza URLs que pueden redirigir o apuntar a una base no dedicada", () => {
		for (const url of [
			"postgresql://tester:secret@127.0.0.1:5432/cartera_reports_reconciliation_test?host=db.example",
			"postgresql://tester:secret@127.0.0.1:5432/cartera_reports_reconciliation_test#remote",
			"postgresql://tester:secret@127.0.0.1:5432/cartera_reports_reconciliation_test_backup",
			"postgresql://tester:secret@db.example:5432/cartera_reports_reconciliation_test",
			"postgresql://tester:secret@localhost/cartera_reports_reconciliation_test",
			"https://tester:secret@127.0.0.1:5432/cartera_reports_reconciliation_test",
		]) {
			expect(() => parseTestDatabaseUrl(url)).toThrow();
		}
	});
});
