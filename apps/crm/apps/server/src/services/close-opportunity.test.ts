import { describe, expect, mock, test } from "bun:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { resolveMembershipForCartera } from "./membership-cartera";

const acceptedQuotation = {
	status: "accepted",
	createdAt: new Date("2026-08-01T12:00:00.000Z"),
	vehicleTransferCost: "400.00",
	leasingContractCost: "0.00",
	mobileGuaranteeCost: "100.00",
	interestCost: "0.00",
	extraMembershipCost: "0.00",
	appointmentCost: "150.00",
	keyCopyDiffCost: "0.00",
	extraInsuranceCost: "0.00",
	extraAdminCost: "600.00",
	insuredAmount: "120000.00",
	value: "125000.00",
	monthlyPayment: "3500.00",
	membershipCost: "875.50",
	isInterno: false,
	insuranceProvider: "gyt",
};

const newerInternalDraft = {
	...acceptedQuotation,
	status: "draft",
	createdAt: new Date("2026-08-02T12:00:00.000Z"),
	membershipCost: "0.00",
	isInterno: true,
	insuranceProvider: "universales",
};

const dialect = new PgDialect();
let orderBy: SQL[] = [];
const createCredito = mock(async (input: Record<string, unknown>) => ({
	credito_id: 123,
	numero_credito_sifco: input.numero_credito_sifco,
}));

mock.module("./cartera-back-client", () => ({
	carteraBackClient: { createCredito },
}));

mock.module("../db", () => ({
	db: {
		insert: () => ({ values: () => Promise.resolve() }),
		select: () => ({
			from: () => ({
				where: () => ({
					orderBy: (...ordering: SQL[]) => {
						orderBy = ordering;
						const orderingSql = ordering
							.map((part) => dialect.sqlToQuery(part).sql)
							.join(", ");
						return {
							limit: async () => [
								orderingSql.includes('"quotations"."status" = $1 desc')
									? acceptedQuotation
									: newerInternalDraft,
							],
						};
					},
				}),
			}),
		}),
	},
}));

describe("createCreditoInCarteraBack", () => {
	test("envía siempre el día original para que cartera use la cuota 1 efectiva", async () => {
		const previous = process.env.ENABLE_CARTERA_BACK_INTEGRATION;
		process.env.ENABLE_CARTERA_BACK_INTEGRATION = "true";
		try {
			const { createCreditoInCarteraBack } = await import(
				"./cartera-back-integration"
			);
			await createCreditoInCarteraBack({
				opportunityId: "opportunity-1",
				userId: "user-1",
				usuario_id: "Cliente prueba",
				numero_credito_sifco: "TEST-ROLLOVER",
				capital: 1000,
				porcentaje_interes: 10,
				plazo: 1,
				cuota: 1120,
				dia_pago_mensual: 31,
				dia_pago_original_sistema: 30,
				fecha_referencia_primera_cuota: "2026-01-31T23:59:59.000Z",
			});

			expect(createCredito).toHaveBeenCalledWith(
				expect.objectContaining({
					dia_pago_mensual: 31,
					dia_pago_original_sistema: 30,
					fecha_referencia_primera_cuota:
						"2026-01-31T23:59:59.000Z",
				}),
			);
		} finally {
			if (previous === undefined) {
				delete process.env.ENABLE_CARTERA_BACK_INTEGRATION;
			} else {
				process.env.ENABLE_CARTERA_BACK_INTEGRATION = previous;
			}
		}
	});
});

describe("getLatestApprovedQuotation", () => {
	test("prefers an older accepted quotation over a newer internal draft", async () => {
		const { getLatestApprovedQuotation } = await import("./close-opportunity");
		const quotation = await getLatestApprovedQuotation(
			"11111111-1111-4111-8111-111111111111",
		);
		const orderingSql = orderBy
			.map((ordering) => dialect.sqlToQuery(ordering).sql)
			.join(", ");

		expect(orderingSql).toContain('"quotations"."status" = $1 desc');
		expect(orderingSql).toContain('"quotations"."created_at" desc');
		expect(
			resolveMembershipForCartera(
				quotation?.membershipCost,
				"700.00",
				quotation?.isInterno,
			),
		).toBe(875.5);
	});
});
