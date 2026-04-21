import { describe, expect, test } from "bun:test";
import { leadSourceEnum } from "../db/schema/crm";
import {
	getLeadSourceBadgeClass,
	getLeadSourceLabel,
	LEAD_SOURCE_BADGE_CLASSES,
	LEAD_SOURCE_LABELS,
	LEAD_SOURCE_OPTIONS,
} from "./lead-sources";

describe("lead source labels", () => {
	test("covers every source accepted by the CRM schema", () => {
		expect(Object.keys(LEAD_SOURCE_LABELS).sort()).toEqual(
			[...leadSourceEnum.enumValues].sort(),
		);
		expect(Object.keys(LEAD_SOURCE_BADGE_CLASSES).sort()).toEqual(
			[...leadSourceEnum.enumValues].sort(),
		);
		expect(LEAD_SOURCE_OPTIONS).toEqual(
			Object.entries(LEAD_SOURCE_LABELS).map(([value, label]) => ({
				value,
				label,
			})),
		);
		expect(getLeadSourceLabel("agency")).toBe("Agencia");
		expect(getLeadSourceLabel("property")).toBe("Predio");
		expect(getLeadSourceLabel("meta")).toBe("Meta");
		expect(getLeadSourceLabel("linkedin")).toBe("LinkedIn");
		expect(getLeadSourceLabel("Whatsapp")).toBe("WhatsApp");
		expect(getLeadSourceLabel("unexpected")).toBe("unexpected");
		expect(getLeadSourceLabel(null)).toBe("Sin fuente");
		expect(getLeadSourceBadgeClass("property")).toBe(
			"bg-amber-100 text-amber-800",
		);
	});
});
