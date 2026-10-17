import { describe, expect, test } from "bun:test";
import { PERMISSIONS, ROLES } from "./roles";

describe("canManageAgencies", () => {
	test("solo admin y supervisor de ventas administran agencias", () => {
		expect(PERMISSIONS.canManageAgencies(ROLES.ADMIN)).toBe(true);
		expect(PERMISSIONS.canManageAgencies(ROLES.SALES_SUPERVISOR)).toBe(true);
	});

	test("el resto de roles no, incluidos partner y valores inválidos", () => {
		const otros = Object.values(ROLES).filter(
			(r) => r !== ROLES.ADMIN && r !== ROLES.SALES_SUPERVISOR,
		);
		for (const rol of otros) {
			expect(PERMISSIONS.canManageAgencies(rol)).toBe(false);
		}
		expect(PERMISSIONS.canManageAgencies("")).toBe(false);
		expect(PERMISSIONS.canManageAgencies("desconocido")).toBe(false);
	});
});
