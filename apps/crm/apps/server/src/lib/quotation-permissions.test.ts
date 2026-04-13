import { describe, expect, test } from "bun:test";
import {
	canManageAnyQuotation,
	canManageQuotations,
} from "./quotation-permissions";

describe("quotation permissions", () => {
	test("allows sales, sales supervisors and admins to manage quotations", () => {
		expect(canManageQuotations("sales")).toBe(true);
		expect(canManageQuotations("sales_supervisor")).toBe(true);
		expect(canManageQuotations("admin")).toBe(true);
		expect(canManageQuotations("accounting")).toBe(false);
	});

	test("allows admins and sales supervisors to manage any quotation", () => {
		expect(canManageAnyQuotation("sales")).toBe(false);
		expect(canManageAnyQuotation("sales_supervisor")).toBe(true);
		expect(canManageAnyQuotation("admin")).toBe(true);
	});
});
