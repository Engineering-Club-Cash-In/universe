export type TestDatabaseConfig = {
	host: string;
	port: number;
	database: "cartera_reports_reconciliation_test";
	user: string;
	password: string;
	ssl: false;
};

export function parseTestDatabaseUrl(url: string): TestDatabaseConfig {
	const parsed = new URL(url);
	if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
		throw new Error("TEST_DATABASE_URL must use postgres protocol");
	}
	if (parsed.search || parsed.hash) {
		throw new Error("TEST_DATABASE_URL must not include search params or a hash");
	}
	if (!new Set(["localhost", "127.0.0.1", "::1"]).has(parsed.hostname)) {
		throw new Error("TEST_DATABASE_URL must target a local PostgreSQL host");
	}
	if (!parsed.port) {
		throw new Error("TEST_DATABASE_URL must include an explicit PostgreSQL port");
	}
	if (parsed.pathname !== "/cartera_reports_reconciliation_test") {
		throw new Error("TEST_DATABASE_URL must target cartera_reports_reconciliation_test");
	}
	if (!parsed.username || !parsed.password) {
		throw new Error("TEST_DATABASE_URL must include local test credentials");
	}

	return {
		host: parsed.hostname,
		port: Number.parseInt(parsed.port, 10),
		database: "cartera_reports_reconciliation_test",
		user: decodeURIComponent(parsed.username),
		password: decodeURIComponent(parsed.password),
		ssl: false,
	};
}
