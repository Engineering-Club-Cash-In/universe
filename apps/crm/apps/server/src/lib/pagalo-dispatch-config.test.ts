import { expect, test } from "bun:test";
import { isPagaloDispatchEnabled } from "./pagalo-dispatch-config";

test("dispatch Págalo requiere flag exacto", () => {
	expect(isPagaloDispatchEnabled(undefined)).toBe(false);
	expect(isPagaloDispatchEnabled("false")).toBe(false);
	expect(isPagaloDispatchEnabled("true")).toBe(true);
});
