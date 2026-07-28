import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import {
	canResetCreditByStatus,
	canViewCreditDetailByStatus,
	isCreditClosingPayment,
	isOriginalPrincipalPayment,
	withActiveCancellation,
} from "./creditDetailPolicy";

describe("credit closing payments", () => {
	it("accepts system resets with reset or validated status only", () => {
		expect(
			isCreditClosingPayment({
				validationStatus: "reset",
				registerBy: "system_reset",
			}),
		).toBeTrue();
		expect(
			isCreditClosingPayment({
				validationStatus: "validated",
				registerBy: "system_reset",
			}),
		).toBeTrue();
	});

	it("rejects ordinary validated, other registerBy, pending, and capital payments", () => {
		for (const payment of [
			{ validationStatus: "validated", registerBy: "user" },
			{ validationStatus: "validated", registerBy: "other" },
			{ validationStatus: "pending", registerBy: "system_reset" },
			{ validationStatus: "capital", registerBy: "system_reset" },
		]) {
			expect(isCreditClosingPayment(payment)).toBeFalse();
		}
	});
});

describe("original principal payments", () => {
	it("accepts reversal-aware validation statuses regardless of payment flags", () => {
		for (const validationStatus of [
			"validated",
			"capital_validated",
			"reset",
		]) {
			expect(
				isOriginalPrincipalPayment({
					validationStatus,
					pagado: false,
					paymentFalse: true,
				}),
			).toBeTrue();
		}
	});

	it("accepts no_required only when paid and not marked false", () => {
		expect(
			isOriginalPrincipalPayment({
				validationStatus: "no_required",
				pagado: true,
				paymentFalse: false,
			}),
		).toBeTrue();

		for (const payment of [
			{ validationStatus: "no_required", pagado: false, paymentFalse: false },
			{ validationStatus: "no_required", pagado: true, paymentFalse: true },
		]) {
			expect(isOriginalPrincipalPayment(payment)).toBeFalse();
		}
	});

	it("rejects pending, capital, null, and unknown statuses", () => {
		for (const payment of [
			{ validationStatus: "pending", pagado: true, paymentFalse: false },
			{ validationStatus: "capital", pagado: true, paymentFalse: false },
			{ validationStatus: null, pagado: null, paymentFalse: null },
			{ validationStatus: "unknown", pagado: true, paymentFalse: false },
		]) {
			expect(isOriginalPrincipalPayment(payment)).toBeFalse();
		}
	});
});

describe("credit detail visibility", () => {
	it("only allows resetting credits pending cancellation", () => {
		expect(canResetCreditByStatus("PENDIENTE_CANCELACION")).toBeTrue();

		for (const status of [
			"CANCELADO",
			"INCOBRABLE",
			"ACTIVO",
			null,
			undefined,
		]) {
			expect(canResetCreditByStatus(status)).toBeFalse();
		}
	});

	it("permite consultar créditos cancelados desde el historial de cobros", () => {
		expect(canViewCreditDetailByStatus("CANCELADO")).toBeTrue();
	});

	it("conserva visibles los estados operativos soportados por el detalle", () => {
		for (const status of [
			"ACTIVO",
			"PENDIENTE_CANCELACION",
			"MOROSO",
			"EN_CONVENIO",
			"INCOBRABLE",
		]) {
			expect(canViewCreditDetailByStatus(status)).toBeTrue();
		}
	});

	it("no habilita estados fuera del flujo de detalle", () => {
		expect(canViewCreditDetailByStatus("CAIDO")).toBeFalse();
		expect(canViewCreditDetailByStatus(null)).toBeFalse();
		expect(canViewCreditDetailByStatus(undefined)).toBeFalse();
	});
});

describe("cancelled credit detail", () => {
	it("combina la cancelación activa con el detalle normal", () => {
		const cuotasPagadas = [{ numero_cuota: 1 }];
		const cuotasPendientes = [{ numero_cuota: 2 }];
		const cuotasAtrasadas = [{ numero_cuota: 3 }];
		const detail = {
			flujo: "ACTIVO",
			cuotasPagadas,
			cuotasPendientes,
			cuotasAtrasadas,
			moraActual: "125.00",
		};
		const cancelacion = { id: 7, activo: true };

		const result = withActiveCancellation(
			detail,
			cancelacion,
			"PENDIENTE_CANCELACION",
		);

		expect(result).toHaveProperty("cuotasPagadas", cuotasPagadas);
		expect(result).toHaveProperty("cuotasPendientes", cuotasPendientes);
		expect(result).toHaveProperty("cuotasAtrasadas", cuotasAtrasadas);
		expect(result).toHaveProperty("moraActual", "125.00");
		expect(result).toHaveProperty("flujo", "CANCELADO");
		expect(result).toHaveProperty("cancelacion", cancelacion);
	});

	it("marca como cancelado el detalle sin cancelación activa", () => {
		const detail = { flujo: "ACTIVO", cuotasPagadas: [] };

		expect(withActiveCancellation(detail, undefined, "CANCELADO")).toEqual({
			...detail,
			flujo: "CANCELADO",
		});
	});
});

describe("credit detail no-current-installment branch", () => {
	it("loads and returns active mora before the terminal branch", async () => {
		const source = await Bun.file(
			resolve(import.meta.dir, "credits.ts"),
		).text();
		const moraQueryIndex = source.indexOf("const moraActual = await db");
		const noCurrentBranchIndex = source.indexOf("if (!cuotaActualDataResult");
		const branch = source.match(
			/if \(!cuotaActualDataResult[\s\S]*?(?=\n\s*const cuotaActualData)/,
		)?.[0];

		expect(moraQueryIndex).toBeGreaterThan(-1);
		expect(moraQueryIndex).toBeLessThan(noCurrentBranchIndex);
		expect(branch).toContain(
			"moraActual: moraActual.length > 0 ? moraActual[0].monto_mora : 0,",
		);
		expect(branch).toContain(
			"mora: moraActual.length > 0 ? moraActual[0] : null,",
		);
	});

	it("maps the advisor in the no-current-installment return", async () => {
		const source = await Bun.file(
			resolve(import.meta.dir, "credits.ts"),
		).text();
		const branch = source.match(
			/if \(!cuotaActualDataResult[\s\S]*?(?=\n\s*const cuotaActualData)/,
		)?.[0];

		expect(branch).toContain("asesor: currentCredit.asesores,");
	});
});
