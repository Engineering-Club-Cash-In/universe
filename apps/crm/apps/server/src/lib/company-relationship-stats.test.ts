import { describe, expect, test } from "bun:test";
import { mergeCompanyRelationshipStats } from "./company-relationship-stats";

describe("mergeCompanyRelationshipStats", () => {
	test("merges grouped relationship counts and excludes unassigned rows", () => {
		expect(
			mergeCompanyRelationshipStats({
				clients: [
					{ companyId: "company-a", total: 2 },
					{ companyId: null, total: 9 },
				],
				leads: [
					{ companyId: "company-a", total: 3 },
					{ companyId: "company-b", total: 1 },
				],
				opportunities: [{ companyId: "company-b", total: 4 }],
			}),
		).toEqual([
			{ companyId: "company-a", leads: 3, opportunities: 0, clients: 2 },
			{ companyId: "company-b", leads: 1, opportunities: 4, clients: 0 },
		]);
	});
});
