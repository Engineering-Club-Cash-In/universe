import { describe, expect, mock, test } from "bun:test";
import { os } from "@orpc/server";

const response = {
	periodo: { inicio: "2026-06-06", fin: "2026-07-06" },
	metadata: {
		alcance: "historico" as const,
		atribucionAsesor: "actual" as const,
	},
	totales: {
		esperado: "150.00",
		cobradoEnSnapshot: "90.00",
		cobradoFueraSnapshot: "10.00",
		excedenteEnSnapshot: "0.00",
		pendiente: "60.00",
	},
	porAsesor: [
		{
			asesorId: null,
			nombre: "Sin asignar",
			esperado: "50.00",
			cobradoEnSnapshot: "20.00",
			cobradoFueraSnapshot: "0.00",
			excedenteEnSnapshot: "0.00",
			pendiente: "30.00",
		},
	],
};
const getMoraRecuperacionPorAsesor = mock(async () => response);
const procedure = os.$context<Record<string, never>>();

mock.module("@cci/email", () => ({ sendPlainEmail: mock() }));
mock.module("@repo/sms", () => ({ SMSClient: class {} }));
mock.module("../lib/orpc", () => ({
	adminProcedure: procedure,
	analystProcedure: procedure,
	closedCreditsReportProcedure: procedure,
	cobrosProcedure: procedure,
	cobrosSupervisorProcedure: procedure,
	crmCobrosOrInvestmentsProcedure: procedure,
	crmOrCobrosProcedure: procedure,
	crmProcedure: procedure,
	efectividadPorEtapaReportProcedure: procedure,
	juridicoProcedure: procedure,
	metaColocacionReportProcedure: procedure,
	protectedProcedure: procedure,
	publicProcedure: procedure,
	tallerOrCrmProcedure: procedure,
	tallerProcedure: procedure,
	tiempoCierreReportProcedure: procedure,
	vehiclesProcedure: procedure,
	viewOpportunityContractsProcedure: procedure,
}));
mock.module("../lib/simpletech", () => ({
	sendWhatsappTemplate: mock(),
	sendWhatsappTemplateBatch: mock(),
}));
mock.module("../db", () => ({
	db: {
		select: () => ({
			from: () => ({
				where: () => ({ limit: async () => [{ role: "COBROS_SUPERVISOR" }] }),
			}),
		}),
	},
}));
mock.module("../services/cartera-back-client", () => ({
	carteraBackClient: { getMoraRecuperacionPorAsesor },
}));
mock.module("../services/cartera-back-integration", () => ({
	createPagoInCarteraBack: mock(),
	getCreditoReferenceByNumeroSifco: mock(),
	isCarteraBackEnabled: () => true,
	isCarteraBackPaymentsEnabled: () => true,
}));

const { call } = await import("@orpc/server");
const { cobrosRouter } = await import("./cobros");

describe("cobrosRouter.getMoraRecuperacionPorAsesor", () => {
	test("transmite el input validado y conserva el shape de cartera-back", async () => {
		const input = {
			mes: 6,
			anio: 2026,
			asesores: [7, 8],
			emailCobrador: "cashin@example.com",
		};

		const output = await call(
			cobrosRouter.getMoraRecuperacionPorAsesor,
			input,
			{
				context: { headers: new Headers(), session: null },
			},
		);
		expect(output).toEqual(response);
		expect(getMoraRecuperacionPorAsesor).toHaveBeenCalledWith(input);
	});
});
