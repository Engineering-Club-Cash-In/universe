import { describe, expect, test } from "bun:test";
import { getReportTabs } from "./-tabs";

describe("getReportTabs", () => {
	test("keeps the supervisor on authorized reports only", () => {
		expect(
			getReportTabs({
				canAccessClosedCreditsReport: true,
				canAccessCobranzaReport: true,
				isAdmin: false,
			}),
		).toEqual({ tabs: ["creditos", "cobranza"], defaultTab: "creditos" });
	});

	test("keeps every existing report tab for admin", () => {
		expect(
			getReportTabs({
				canAccessClosedCreditsReport: true,
				canAccessCobranzaReport: true,
				isAdmin: true,
			}),
		).toEqual({
			tabs: [
				"creditos",
				"cobranza",
				"inversiones",
				"colocacion",
				"proyeccion-liquidaciones",
			],
			defaultTab: "creditos",
		});
	});
});
