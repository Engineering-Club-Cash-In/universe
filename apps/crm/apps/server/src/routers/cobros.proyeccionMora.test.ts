import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { os } from "@orpc/server";

const proyeccion = {
	mes: "2026-10",
	hoy: "2026-10-30",
	cargoDiario: "3.73",
	moraInicioMes: "18.67",
	moraHoy: "70.00",
	moraFinMes: "77.07",
	dias: [],
};
const getProyeccionMora = mock(async () => proyeccion);
let carteraHabilitada = true;
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
mock.module("../db", () => ({ db: {} }));
// `mock.module` es global al proceso: se conserva el módulo real y solo se
// pisa el singleton (ver cobros.moraRecuperacion.test.ts).
const moduloCarteraBackClient = await import("../services/cartera-back-client");
mock.module("../services/cartera-back-client", () => ({
	...moduloCarteraBackClient,
	carteraBackClient: { getProyeccionMora },
}));
mock.module("../services/cartera-back-integration", () => ({
	createPagoInCarteraBack: mock(),
	getCreditoReferenceByNumeroSifco: mock(),
	isCarteraBackEnabled: () => carteraHabilitada,
	isCarteraBackPaymentsEnabled: () => true,
}));

const { call } = await import("@orpc/server");
const { cobrosRouter } = await import("./cobros");
const contexto = { context: { headers: new Headers(), session: null } };

describe("cobrosRouter.getProyeccionMoraCarteraBack", () => {
	test("pasa el número SIFCO y devuelve la proyección tal cual", async () => {
		const salida = await call(
			cobrosRouter.getProyeccionMoraCarteraBack,
			{ numeroSifco: "0102030" },
			contexto,
		);
		expect(salida).toEqual(proyeccion);
		expect(getProyeccionMora).toHaveBeenCalledWith("0102030");
	});

	test("rechaza un número vacío sin llamar a cartera-back", async () => {
		getProyeccionMora.mockClear();
		await expect(
			call(
				cobrosRouter.getProyeccionMoraCarteraBack,
				{ numeroSifco: "" },
				contexto,
			),
		).rejects.toThrow();
		expect(getProyeccionMora).not.toHaveBeenCalled();
	});

	test("con la integración apagada no consulta", async () => {
		carteraHabilitada = false;
		getProyeccionMora.mockClear();
		await expect(
			call(
				cobrosRouter.getProyeccionMoraCarteraBack,
				{ numeroSifco: "0102030" },
				contexto,
			),
		).rejects.toThrow("Integración con Cartera-Back no está habilitada");
		expect(getProyeccionMora).not.toHaveBeenCalled();
		carteraHabilitada = true;
	});

	test("usa el mismo guard que el detalle del crédito y está en el router de la app", () => {
		const fuente = readFileSync(
			new URL("./cobros.ts", import.meta.url),
			"utf8",
		);
		expect(fuente).toContain("getProyeccionMoraCarteraBack: cobrosProcedure");
		expect(fuente).toContain("getDetallesCreditoCarteraBack: cobrosProcedure");
		expect(
			readFileSync(new URL("./index.ts", import.meta.url), "utf8"),
		).toContain(
			"getProyeccionMoraCarteraBack: cobrosRouter.getProyeccionMoraCarteraBack,",
		);
	});
});
