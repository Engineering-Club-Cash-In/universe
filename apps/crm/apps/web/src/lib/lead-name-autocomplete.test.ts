import { describe, expect, test } from "bun:test";
import { getLeadNameAutocomplete } from "./lead-name-autocomplete";

describe("getLeadNameAutocomplete", () => {
	test("maps CRM lead name fields to explicit autocomplete tokens", () => {
		expect(getLeadNameAutocomplete("firstName")).toBe(
			"section-crm-lead given-name",
		);
		expect(getLeadNameAutocomplete("middleName")).toBe(
			"section-crm-lead additional-name",
		);
		expect(getLeadNameAutocomplete("lastName")).toBe(
			"section-crm-lead family-name",
		);
		expect(getLeadNameAutocomplete("secondLastName")).toBe("off");
	});
});
