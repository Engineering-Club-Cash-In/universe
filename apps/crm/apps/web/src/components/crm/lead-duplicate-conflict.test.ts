import { describe, expect, it } from "bun:test";
import { ORPCError } from "@orpc/client";
import {
	getDuplicateLeadSearch,
	getLeadDuplicateConflict,
	getLeadDuplicatePresentation,
} from "./lead-duplicate-conflict";

const activeConflict = {
	reason: "DUPLICATE_DPI" as const,
	leadId: "lead-1",
	leadName: "Luis Pérez",
	isActive: true,
	assignedToName: "María García",
	assignedToCurrentUser: false,
};

describe("getLeadDuplicateConflict", () => {
	it("acepta únicamente el conflicto estructurado de DPI", () => {
		expect(
			getLeadDuplicateConflict(
				new ORPCError("CONFLICT", { data: activeConflict }),
			),
		).toEqual(activeConflict);
		expect(
			getLeadDuplicateConflict({ code: "CONFLICT", data: { reason: "OTHER" } }),
		).toBeNull();
	});
});

describe("getLeadDuplicatePresentation", () => {
	// El nombre del dueño NO se afirma acá a propósito: lo renderiza el diálogo
	// (`lead-duplicate-dialog.tsx`), no este texto. Ver el comentario en
	// `getLeadDuplicatePresentation`.
	it("explica que está activo y dice qué hacer, sin repetir el nombre del dueño", () => {
		const presentacion = getLeadDuplicatePresentation(activeConflict);

		expect(presentacion).toEqual({
			status: "Activo",
			assignment: "Pedile a tu supervisor que te lo reasigne.",
			canViewLead: false,
		});
		expect(presentacion.assignment).not.toContain("María García");
	});

	it("explica que está inactivo y asignado al usuario actual", () => {
		expect(
			getLeadDuplicatePresentation({
				...activeConflict,
				isActive: false,
				assignedToCurrentUser: true,
			}),
		).toEqual({
			status: "Inactivo",
			assignment: "Este lead está asignado a ti.",
			canViewLead: true,
		});
	});
});

describe("getDuplicateLeadSearch", () => {
	it("reemplaza el flujo de empresa por la ruta del lead existente", () => {
		expect(getDuplicateLeadSearch("lead-1")).toEqual({ leadId: "lead-1" });
	});
});
