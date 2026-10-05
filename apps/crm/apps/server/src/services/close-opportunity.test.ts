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
	idealPaymentDateAdjustment: "1424.12",
	idealPaymentDateAdjustmentReferenceDate: "2026-09-16",
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

mock.module("../db", () => ({
	db: {
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

describe("cartera-back credit mapping", () => {
	test("preserva la referencia y el rollover hasta el payload HTTP", async () => {
		const { buildCreateCreditoInput } = await import("./cartera-back-integration");
		const input = buildCreateCreditoInput({
			opportunityId: "11111111-1111-4111-8111-111111111111",
			userId: "22222222-2222-4222-8222-222222222222",
			usuario_id: "Cliente prueba",
			numero_credito_sifco: "TEST-001",
			capital: 88419.27,
			porcentaje_interes: 1.5,
			plazo: 60,
			cuota: 3341.6,
			fecha_referencia_calendario: "2026-09-16T12:00:00.000Z",
			desplazar_primera_cuota_un_mes: true,
		});

		expect(input.fecha_referencia_calendario).toBe(
			"2026-09-16T12:00:00.000Z",
		);
		expect(input.desplazar_primera_cuota_un_mes).toBe(true);
		expect(input.ajuste_fecha_ideal).toBeUndefined();
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
		expect(quotation?.idealPaymentDateAdjustmentReferenceDate).toBe("2026-09-16");
	});
});
