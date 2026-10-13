import { describe, expect, test } from "bun:test";
import { nivelPorBuckets } from "./nivel-asesor";

describe("nivelPorBuckets", () => {
	test("B0–B1 es junior", () => {
		expect(nivelPorBuckets([0])).toBe("junior");
		expect(nivelPorBuckets([0, 1])).toBe("junior");
	});

	test("B2–B4 es senior", () => {
		expect(nivelPorBuckets([2])).toBe("senior");
		expect(nivelPorBuckets([2, 3, 4])).toBe("senior");
		expect(nivelPorBuckets([4])).toBe("senior");
	});

	test("B5 es especial", () => {
		expect(nivelPorBuckets([5])).toBe("especial");
	});

	test("con varios niveles manda el más alto", () => {
		expect(nivelPorBuckets([1, 2])).toBe("senior");
		expect(nivelPorBuckets([1, 5])).toBe("especial");
		expect(nivelPorBuckets([3, 5])).toBe("especial");
	});

	test("sin buckets no hay nivel", () => {
		expect(nivelPorBuckets([])).toBeNull();
		expect(nivelPorBuckets(null)).toBeNull();
		expect(nivelPorBuckets(undefined)).toBeNull();
	});
});
