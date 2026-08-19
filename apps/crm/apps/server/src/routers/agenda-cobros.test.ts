import { describe, expect, mock, test } from "bun:test";
import { PERMISSIONS, ROLES } from "../lib/roles";

const supervisorProcedure = {
	input() {
		return this;
	},
	handler() {
		return { guard: "cobros-supervisor" };
	},
};

const cobrosProcedure = {
	input() {
		return this;
	},
	handler() {
		return { guard: "cobros" };
	},
};

mock.module("../lib/orpc", () => ({
	cobrosSupervisorProcedure: supervisorProcedure,
	cobrosProcedure,
}));

describe("agendaCobrosRouter permisos", () => {
	test("todos los endpoints usan guard supervisor y roles permitidos son admin/supervisor", async () => {
		const { agendaCobrosRouter } = await import("./agenda-cobros");

		expect(agendaCobrosRouter.getCumplimientoAgendaResumen as unknown).toEqual({
			guard: "cobros-supervisor",
		});
		expect(agendaCobrosRouter.getCumplimientoAgendaDetalle as unknown).toEqual({
			guard: "cobros-supervisor",
		});
		// getAsesoresConAgenda es el catálogo liviano del selector (sin filtro
		// de estado) — mismo gate que el resumen/detalle: es información de
		// agenda de cobros, solo para supervisor/admin.
		expect(agendaCobrosRouter.getAsesoresConAgenda as unknown).toEqual({
			guard: "cobros-supervisor",
		});
		expect(PERMISSIONS.canAssignCobros(ROLES.ADMIN)).toBe(true);
		expect(PERMISSIONS.canAssignCobros(ROLES.COBROS_SUPERVISOR)).toBe(true);
		expect(PERMISSIONS.canAssignCobros(ROLES.COBROS)).toBe(false);
	});
});
