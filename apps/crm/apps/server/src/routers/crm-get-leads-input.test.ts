import { describe, expect, test } from "bun:test";
import { leadSourceEnum } from "../db/schema/crm";
import { getLeadsInputSchema } from "./crm";

describe("getLeadsInputSchema", () => {
	test("accepts every configured lead source as a filter", () => {
		for (const source of leadSourceEnum.enumValues) {
			expect(getLeadsInputSchema.parse({ source }).source).toBe(source);
		}
	});

	test("rejects unknown lead source filters", () => {
		expect(() =>
			getLeadsInputSchema.parse({ source: "unknown-source" }),
		).toThrow();
	});
});
