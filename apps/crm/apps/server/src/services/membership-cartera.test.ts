import { describe, expect, test } from "bun:test";
import { resolveMembershipForCartera } from "./membership-cartera";

describe("resolveMembershipForCartera", () => {
	test("prioritizes the quotation membership and rounds it to two decimals", () => {
		expect(resolveMembershipForCartera("100.90", "75.00")).toBe(100.9);
		expect(resolveMembershipForCartera("100.906", "75.00")).toBe(100.91);
		expect(resolveMembershipForCartera("1.005", "75.00")).toBe(1.01);
		expect(resolveMembershipForCartera("10.075", "75.00")).toBe(10.08);
	});

	test("falls back to the opportunity for legacy quotations", () => {
		expect(resolveMembershipForCartera(null, "75.25")).toBe(75.25);
	});

	test("forces zero for internal credits", () => {
		expect(resolveMembershipForCartera("100.90", "75.25", true)).toBe(0);
	});

	test("returns undefined when no valid membership exists", () => {
		expect(resolveMembershipForCartera(null, null)).toBeUndefined();
		expect(
			resolveMembershipForCartera("invalid", "also-invalid"),
		).toBeUndefined();
	});
});
