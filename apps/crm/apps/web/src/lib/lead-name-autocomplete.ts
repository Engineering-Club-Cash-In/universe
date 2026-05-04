export type LeadNameField =
	| "firstName"
	| "middleName"
	| "lastName"
	| "secondLastName";

export function getLeadNameAutocomplete(field: LeadNameField): string {
	switch (field) {
		case "firstName":
			return "section-crm-lead given-name";
		case "middleName":
			return "section-crm-lead additional-name";
		case "lastName":
			return "section-crm-lead family-name";
		case "secondLastName":
			return "off";
	}
}
