import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

describe("Companies page contracts", () => {
	test("uses scoped relationship statistics instead of invalid oversized list requests", async () => {
		const source = await Bun.file(
			resolve(import.meta.dir, "../../../web/src/routes/crm/companies.tsx"),
		).text();

		expect(source).toContain("orpc.getCompanyRelationshipStats.queryOptions()");
		expect(source).not.toContain(
			"getClients.queryOptions({ input: { limit: 1000",
		);
		expect(source).not.toContain("orpc.getLeads.queryOptions");
		expect(source).not.toContain("orpc.getOpportunities.queryOptions");
	});

	test("grants sales supervisors global company visibility and updates", async () => {
		const source = await Bun.file(
			resolve(import.meta.dir, "../routers/crm.ts"),
		).text();
		const companiesSection = source.slice(
			source.indexOf("// Companies"),
			source.indexOf("// Leads"),
		);

		expect(companiesSection).toContain(
			"PERMISSIONS.canManageAllCompanies(context.userRole)",
		);
		expect(companiesSection).toContain("getCompanyRelationshipStats");
		expect(companiesSection).not.toContain('context.userRole === "admin"');
	});
});
