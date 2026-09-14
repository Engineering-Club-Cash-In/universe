import { expect, test } from "bun:test";
import { getInvestmentProjectionMonthBounds } from "./investment-projection-period";

test("calcula el siguiente mes desde la fecha vigente en Guatemala", () => {
	const bounds = getInvestmentProjectionMonthBounds(
		new Date("2026-10-01T05:30:00.000Z"),
	);

	expect(bounds).toEqual({
		defaultMonth: "2026-10",
		firstMonth: "2026-10",
		lastMonth: "2027-09",
	});
});
