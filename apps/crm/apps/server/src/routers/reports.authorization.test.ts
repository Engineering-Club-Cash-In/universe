import { call } from "@orpc/server";
import { describe, expect, mock, test } from "bun:test";
import { ROLES } from "../lib/roles";

let currentRole: (typeof ROLES)[keyof typeof ROLES] = ROLES.ADMIN;

mock.module("../db", () => ({
	db: {
		select: () => ({
			from: () => ({
				where: () => ({
					limit: async () => [{ id: "test-user", role: currentRole }],
				}),
			}),
		}),
	},
}));

mock.module("../services/cartera-back-integration", () => ({
	isCarteraBackEnabled: () => true,
}));

mock.module("../services/cartera-back-client", () => ({
	carteraBackClient: {
		getMontoACobrarPeriodo: async () => [],
		getFacturacionMes: async () => ({
			cobrado: {
				interes: "0",
				membresias: "0",
				seguro_gps: "0",
				royalti: "0",
				mora: "0",
				otros: "0",
			},
			esperado: { meta_mensual: "0" },
		}),
		getFlujoCuotasInversiones: async () => ({}),
	},
}));

const contextForCurrentRole = () =>
	({
		context: { session: { user: { id: "test-user" } } },
	}) as never;

const { adminProcedure } = await import("../lib/orpc");
const { getDashboardExecutivo } = await import("./reports");
const { reportesCarteraRouter } = await import("./reportes-cartera");

describe("report authorization", () => {
	test("allows admins through the administrative middleware", async () => {
		currentRole = ROLES.ADMIN;
		const procedure = adminProcedure.handler(() => "allowed");

		await expect(call(procedure, undefined, contextForCurrentRole())).resolves.toBe(
			"allowed",
		);
	});

	test("allows a cobros supervisor only through the two Cobranza endpoints", async () => {
		currentRole = ROLES.COBROS_SUPERVISOR;

		await expect(
			call(
				reportesCarteraRouter.getMontoACobrarPeriodo,
				{ periodo: "mes", fechaInicio: "2026-07-01", fechaFin: "2026-07-31" },
				contextForCurrentRole(),
			),
		).resolves.toEqual({ data: [] });
		await expect(
			call(
				reportesCarteraRouter.getFacturacionMes,
				{ mes: 7, anio: 2026 },
				contextForCurrentRole(),
			),
		).resolves.toEqual({
			cobrado: {
				interes: "0",
				membresias: "0",
				seguro_gps: "0",
				royalti: "0",
				mora: "0",
				otros: "0",
			},
			esperado: { meta_mensual: "0" },
		});
		await expect(
			call(
				reportesCarteraRouter.getFlujoCuotasInversiones,
				{ fechaInicio: "2026-07-01", fechaFin: "2026-07-31" },
				contextForCurrentRole(),
			),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	test("rejects a cobros supervisor from the executive dashboard", async () => {
		currentRole = ROLES.COBROS_SUPERVISOR;

		await expect(
			call(getDashboardExecutivo, {}, contextForCurrentRole()),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	test("rejects non-supervisor roles from both Cobranza endpoints", async () => {
		currentRole = ROLES.ANALYST;

		await expect(
			call(
				reportesCarteraRouter.getMontoACobrarPeriodo,
				{ periodo: "mes", fechaInicio: "2026-07-01", fechaFin: "2026-07-31" },
				contextForCurrentRole(),
			),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		await expect(
			call(
				reportesCarteraRouter.getFacturacionMes,
				{ mes: 7, anio: 2026 },
				contextForCurrentRole(),
			),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});
});
