import { describe, expect, it } from "bun:test";
import { buildLeadDuplicateConflict } from "./lead-duplicate-conflict";

const leads = [
	{
		id: "lead-antiguo",
		firstName: "Ana",
		middleName: null,
		lastName: "López",
		secondLastName: null,
		assignedTo: "asesor-ana",
		assignedToName: "Ana Asesora",
	},
	{
		id: "lead-activo",
		firstName: "Luis",
		middleName: "Fernando",
		lastName: "Pérez",
		secondLastName: "Díaz",
		assignedTo: "asesor-luis",
		assignedToName: "Luis Asesor",
	},
];

describe("buildLeadDuplicateConflict", () => {
	it("reporta el lead de la oportunidad activa y que pertenece a otro asesor", () => {
		expect(
			buildLeadDuplicateConflict(leads, { leadId: "lead-activo" }, "asesor-ana"),
		).toEqual({
			reason: "DUPLICATE_DPI",
			leadId: "lead-activo",
			leadName: "Luis Fernando Pérez Díaz",
			isActive: true,
			assignedToName: "Luis Asesor",
			assignedToCurrentUser: false,
		});
	});

	it("reporta como inactivo el lead histórico y conserva su asesor", () => {
		expect(buildLeadDuplicateConflict(leads, null, "asesor-ana")).toEqual({
			reason: "DUPLICATE_DPI",
			leadId: "lead-antiguo",
			leadName: "Ana López",
			isActive: false,
			assignedToName: "Ana Asesora",
			assignedToCurrentUser: true,
		});
	});
});
