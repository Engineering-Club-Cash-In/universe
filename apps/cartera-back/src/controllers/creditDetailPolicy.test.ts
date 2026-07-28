import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import {
	canViewCreditDetailByStatus,
	withActiveCancellation,
} from "./creditDetailPolicy";

describe("credit detail visibility", () => {
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

		expect(withActiveCancellation(detail, cancelacion)).toEqual({
			...detail,
			flujo: "CANCELADO",
			cancelacion,
		});
	});
});

describe("credit detail no-current-installment branch", () => {
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
