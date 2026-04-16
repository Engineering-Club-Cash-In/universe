import { describe, expect, test } from "bun:test";
import {
	canAccessSalesTeamActions,
	canManageAnySalesOwnedRecord,
} from "./sales-permissions";

describe("sales permissions helpers", () => {
	test("treats sales supervisors as part of the sales team", () => {
		expect(canAccessSalesTeamActions("sales")).toBe(true);
		expect(canAccessSalesTeamActions("sales_supervisor")).toBe(true);
		expect(canAccessSalesTeamActions("admin")).toBe(true);
		expect(canAccessSalesTeamActions("analyst")).toBe(false);
	});

	test("allows admins and sales supervisors to manage any sales-owned record", () => {
		expect(canManageAnySalesOwnedRecord("sales")).toBe(false);
		expect(canManageAnySalesOwnedRecord("sales_supervisor")).toBe(true);
		expect(canManageAnySalesOwnedRecord("admin")).toBe(true);
	});
});
