import { expect, test } from "bun:test";
import { isPagaloPollEnabled } from "./pagalo-poll-config";

test("poll Págalo requiere flag exacto", () => {
	expect(isPagaloPollEnabled(undefined)).toBe(false);
	expect(isPagaloPollEnabled("false")).toBe(false);
	expect(isPagaloPollEnabled("true")).toBe(true);
});
