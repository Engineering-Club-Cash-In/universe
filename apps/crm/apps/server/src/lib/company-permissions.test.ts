import { describe, expect, test } from "bun:test";
import { PERMISSIONS } from "./roles";

describe("company permissions", () => {
	test("allows admins and sales supervisors to manage the complete directory", () => {
		expect(PERMISSIONS.canManageAllCompanies("admin")).toBe(true);
		expect(PERMISSIONS.canManageAllCompanies("sales_supervisor")).toBe(true);
		expect(PERMISSIONS.canManageAllCompanies("sales")).toBe(false);
		expect(PERMISSIONS.canManageAllCompanies("analyst")).toBe(false);
	});
});
