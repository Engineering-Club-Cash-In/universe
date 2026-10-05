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

test("ignora cuando se limpia el mes proyectado", async () => {
	const source = await Bun.file(
		new URL("../../routes/admin/reports/index.tsx", import.meta.url),
	).text();
	const labelPosition = source.indexOf('aria-label="Mes proyectado"');
	const input = source.slice(
		source.lastIndexOf("<Input", labelPosition),
		source.indexOf("/>", labelPosition) + 2,
	);

	expect(labelPosition).toBeGreaterThan(-1);
	expect(input).toContain('type="month"');
	expect(input).toContain("min={projectionMonthBounds.firstMonth}");
	expect(input).toContain("max={projectionMonthBounds.lastMonth}");
	expect(input).toContain("value={projectionMonth}");
	expect(input).toMatch(
		/if \(event\.target\.value\)\s+setProjectionMonth\(event\.target\.value\);/,
	);
});
