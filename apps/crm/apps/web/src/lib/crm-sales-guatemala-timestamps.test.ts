import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { formatGuatemalaDate, formatGuatemalaDateTime } from "./crm-formatters";

const read = (path: string) =>
	readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

describe("CRM sales Guatemala timestamp display", () => {
	test("formats UTC instants on the Guatemala calendar day", () => {
		const instant = "2026-08-27T03:20:24.268Z";

		expect(formatGuatemalaDate(instant)).toBe("26/08/2026");
		expect(formatGuatemalaDateTime(instant)).toContain("26/08/2026");
		expect(formatGuatemalaDateTime(instant)).toMatch(/09:20|21:20/);
	});

	test("maps computed getOpportunities timestamps through Drizzle timestamp decoders", () => {
		const source = read("../../../server/src/routers/crm.ts");

		expect(
			source.match(/\.mapWith\(opportunityStageHistory\.changedAt\)/g),
		).toHaveLength(2);
		expect(source).toMatch(
			/const closedAtExpression = sql<Date \| null>`coalesce[^;]+\.mapWith\(\s*opportunities\.actualCloseDate,/,
		);
		expect(source).toMatch(
			/latestStageChangedAt:\s*sql<Date>`coalesce[^;]+\.mapWith\(opportunities\.createdAt\)/,
		);
	});

	test("uses Guatemala helpers for audited Sales-visible actual timestamps", () => {
		const files = [
			"../routes/crm/opportunities.tsx",
			"../components/opportunity-detail-modal.tsx",
			"../components/crm/WhatsappLogBadge.tsx",
			"../components/notes-timeline.tsx",
			"../routes/crm/quoter.tsx",
			"../components/vehicles/VehicleDocumentUpload.tsx",
		];
		const source = files.map(read).join("\n");

		expect(source).toContain("formatGuatemalaDate(");
		expect(source).toContain("formatGuatemalaDateTime(");
		expect(source).not.toMatch(
			/new Date\((?:change\.changedAt|detalleDoc\.uploadedAt|doc\.uploadedAt|recipient\.sentAt|note\.createdAt|quotation\.createdAt)\)\.toLocale(?:DateString|String)\(/,
		);
	});
});
