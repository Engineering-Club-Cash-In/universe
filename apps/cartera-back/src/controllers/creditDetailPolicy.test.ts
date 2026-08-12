import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import {
	canResetCreditByStatus,
	canViewCreditDetailByStatus,
	isAmbiguousOriginalPrincipalPayment,
	isCreditClosingPayment,
	isIncobrableContinuationReady,
	isOriginalPrincipalPayment,
	isValidResetCreditInput,
	mapResetCreditError,
	normalizarMontoQ,
	RESET_CREDIT_ERRORS,
	withActiveCancellation,
} from "./creditDetailPolicy";

describe("credit closing payments", () => {
	it("accepts reset status regardless of registerBy", () => {
		expect(
			isCreditClosingPayment({
				validationStatus: "reset",
				registerBy: "user",
			}),
		).toBeTrue();
		expect(
			isCreditClosingPayment({
				validationStatus: "reset",
				registerBy: null,
			}),
		).toBeTrue();
	});

	it("accepts validated status only for system resets", () => {
		expect(
			isCreditClosingPayment({
				validationStatus: "validated",
				registerBy: "system_reset",
			}),
		).toBeTrue();
	});

	it("rejects ordinary validated, pending, and capital payments", () => {
		for (const payment of [
			{ validationStatus: "validated", registerBy: "user" },
			{ validationStatus: "validated", registerBy: "other" },
			{ validationStatus: "pending", registerBy: "system_reset" },
			{ validationStatus: "capital", registerBy: "system_reset" },
			{ validationStatus: "no_required", registerBy: "system_reset" },
			{ validationStatus: "unknown", registerBy: "system_reset" },
			{ validationStatus: null, registerBy: "system_reset" },
		]) {
			expect(isCreditClosingPayment(payment)).toBeFalse();
		}
	});
});

describe("original principal payments", () => {
	it("accepts applied statuses when they are not marked false", () => {
		for (const validationStatus of [
			"validated",
			"capital_validated",
			"reset",
		]) {
			expect(
				isOriginalPrincipalPayment({
					validationStatus,
					pagado: false,
					paymentFalse: false,
				}),
			).toBeTrue();
		}
	});

	it("rejects and identifies ambiguous applied partials", () => {
		for (const validationStatus of ["validated", "capital_validated"]) {
			const payment = {
				validationStatus,
				pagado: false,
				paymentFalse: true,
			};

			expect(isOriginalPrincipalPayment(payment)).toBeFalse();
			expect(isAmbiguousOriginalPrincipalPayment(payment)).toBeTrue();
		}

		const resetPayment = {
			validationStatus: "reset",
			pagado: false,
			paymentFalse: true,
		};
		expect(isOriginalPrincipalPayment(resetPayment)).toBeFalse();
		expect(isAmbiguousOriginalPrincipalPayment(resetPayment)).toBeFalse();
		expect(
			isAmbiguousOriginalPrincipalPayment({
				validationStatus: "validated",
				pagado: true,
				paymentFalse: true,
			}),
		).toBeFalse();
	});

	it("accepts no_required only when paid and not marked false", () => {
		expect(
			isOriginalPrincipalPayment({
				validationStatus: "no_required",
				pagado: true,
				paymentFalse: null,
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
			expect(isAmbiguousOriginalPrincipalPayment(payment)).toBeFalse();
		}
	});
});

describe("credit detail visibility", () => {
	it("allows pending cancellation and only ready bad-debt continuations", () => {
		expect(canResetCreditByStatus("PENDIENTE_CANCELACION")).toBeTrue();
		expect(canResetCreditByStatus("INCOBRABLE")).toBeFalse();
		expect(canResetCreditByStatus("INCOBRABLE", true)).toBeTrue();

		for (const status of ["CANCELADO", "ACTIVO", null]) {
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

describe("credit detail contract summary wiring", () => {
	it("sums eligible principal while gating publication on closing payments", async () => {
		const source = await Bun.file(
			resolve(import.meta.dir, "credits.ts"),
		).text();
		const contractSummary = source.match(
			/const contractSummary[\s\S]*?(?=\n\s*\/\/ 2\.)/,
		)?.[0];

		expect(contractSummary).toContain("eligiblePayments.reduce(");
		expect(contractSummary).toContain("closingPayments.length > 0");
		expect(contractSummary).toContain("!hasAmbiguousPrincipalPayments");
		expect(contractSummary).not.toContain("closingPayments.reduce(");
	});
});

describe("credit closure paymentFalse wiring", () => {
	it("preserves explicit false-payment rows and keeps applied partials", async () => {
		const source = await Bun.file(
			resolve(import.meta.dir, "credits.ts"),
		).text();
		const caseExpression =
			/paymentFalse:\s*sql<boolean>`CASE\s+WHEN \$\{pagos_credito\.paymentFalse\} IS TRUE THEN TRUE\s+WHEN \$\{pagos_credito\.validationStatus\} IN \('validated', 'capital_validated'\) THEN FALSE\s+ELSE TRUE\s+END`/g;

		expect(source.match(caseExpression)).toHaveLength(2);
	});
});

describe("reset credit bad-debt continuation wiring", () => {
	it("requires matching bad-debt and credit capital without a system reset payment", async () => {
		const source = await Bun.file(
			resolve(import.meta.dir, "credits.ts"),
		).text();
		const resetCredit = source.match(
			/export async function resetCredit[\s\S]*?(?=\nexport )/,
		)?.[0];

		expect(resetCredit).toContain(
			"monto_incobrable: bad_debts.monto_incobrable",
		);
		expect(resetCredit).toContain(".from(bad_debts)");
		expect(resetCredit).toContain("pago_id: pagos_credito.pago_id");
		expect(resetCredit).toContain(
			'eq(pagos_credito.registerBy, "system_reset")',
		);
		expect(resetCredit).toMatch(
			/isIncobrableContinuationReady\(\{\s*montoIncobrable: montoIncobrableNormalizado,\s*capitalCredito: credito\.capital,\s*montoIncobrableRegistrado: badDebt\?\.monto_incobrable \?\? null,\s*tienePagoCierre: Boolean\(existingClosingPayment\),?\s*\}\)/,
		);
		expect(resetCredit).toMatch(
			/canResetCreditByStatus\(\s*credito\.statusCredit,\s*incobrableContinuationReady,?\s*\)/,
		);
	});
});

describe("reset credit router validation wiring", () => {
	it("uses the reset input guard without coercing montoIncobrable", async () => {
		const source = await Bun.file(
			resolve(import.meta.dir, "../routers/credits.ts"),
		).text();
		const route = source.match(
			/\.post\("\/resetCredit"[\s\S]*?(?=\n\s*\.get\()/,
		)?.[0];

		expect(route).toContain("isValidResetCreditInput");
		expect(route).not.toContain("Number(montoIncobrable)");
	});
});

describe("reset credit input validation", () => {
	const validInput = {
		creditId: 1,
		montoIncobrable: 10.5,
		montoBoleta: 20,
		url_boletas: ["https://example.com/boleta"],
		cuota: 0,
		banco_id: 2,
		numeroAutorizacion: "ABC-123",
	};

	it("accepts numeric and decimal-string boleta bodies", () => {
		expect(isValidResetCreditInput(validInput)).toBeTrue();
		expect(
			isValidResetCreditInput({ ...validInput, montoIncobrable: 0 }),
		).toBeTrue();
		expect(
			isValidResetCreditInput({ ...validInput, montoBoleta: " 20.50 " }),
		).toBeTrue();
	});

	it("rejects invalid credit IDs and bank IDs", () => {
		for (const value of ["1", [1], Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
			expect(
				isValidResetCreditInput({ ...validInput, creditId: value }),
			).toBeFalse();
			expect(
				isValidResetCreditInput({ ...validInput, banco_id: value }),
			).toBeFalse();
		}
	});

	it("rejects invalid bad-debt amounts", () => {
		for (const value of [
			"10",
			[10],
			Number.NaN,
			Number.POSITIVE_INFINITY,
			-1,
		]) {
			expect(
				isValidResetCreditInput({ ...validInput, montoIncobrable: value }),
			).toBeFalse();
		}
	});

	it("rejects invalid installment and boleta amounts", () => {
		expect(isValidResetCreditInput({ ...validInput, cuota: -1 })).toBeFalse();
		for (const value of [
			"",
			"   ",
			"1e2",
			Number.NaN,
			Number.POSITIVE_INFINITY,
			-1,
		]) {
			expect(
				isValidResetCreditInput({ ...validInput, montoBoleta: value }),
			).toBeFalse();
		}
	});

	it("rejects non-string URLs and authorization numbers", () => {
		expect(
			isValidResetCreditInput({ ...validInput, url_boletas: ["ok", 1] }),
		).toBeFalse();
		expect(
			isValidResetCreditInput({ ...validInput, numeroAutorizacion: 123 }),
		).toBeFalse();
	});
});

describe("normalizarMontoQ", () => {
	it("limpia el polvo de punto flotante a 2 decimales", () => {
		// Caso real crédito 365: 106488.77 - 90000 da 16488.770000000004 en JS.
		expect(normalizarMontoQ(106488.77 - 90000)).toBe("16488.77");
		expect(normalizarMontoQ(16488.770000000004)).toBe("16488.77");
		expect(normalizarMontoQ(16488.769999999997)).toBe("16488.77");
	});

	it("redondea half-up al centavo como numeric de Postgres", () => {
		expect(normalizarMontoQ("10.005")).toBe("10.01");
		expect(normalizarMontoQ("10.004")).toBe("10.00");
	});

	it("formatea siempre con 2 decimales", () => {
		expect(normalizarMontoQ(90000)).toBe("90000.00");
		expect(normalizarMontoQ("16488.77")).toBe("16488.77");
		expect(normalizarMontoQ("0.5")).toBe("0.50");
		expect(normalizarMontoQ(0)).toBe("0.00");
	});

	it("lanza con entradas no numéricas", () => {
		expect(() => normalizarMontoQ("basura")).toThrow();
		expect(() => normalizarMontoQ("")).toThrow();
	});
});

describe("isIncobrableContinuationReady", () => {
	const base = {
		montoIncobrable: 16488.77,
		capitalCredito: "16488.77" as string | number | null,
		montoIncobrableRegistrado: "16488.77" as string | number | null,
		tienePagoCierre: false,
	};

	it("acepta el monto con polvo de float del front (bug crédito 365)", () => {
		expect(
			isIncobrableContinuationReady({
				...base,
				montoIncobrable: 106488.77 - 90000,
			}),
		).toBeTrue();
	});

	it("acepta el match exacto al centavo", () => {
		expect(isIncobrableContinuationReady(base)).toBeTrue();
	});

	it("rechaza diferencias reales de un centavo o más", () => {
		expect(
			isIncobrableContinuationReady({ ...base, montoIncobrable: 16488.78 }),
		).toBeFalse();
		expect(
			isIncobrableContinuationReady({ ...base, montoIncobrable: 16488.76 }),
		).toBeFalse();
		expect(
			isIncobrableContinuationReady({ ...base, montoIncobrable: 16490 }),
		).toBeFalse();
	});

	it("rechaza sin monto o con monto no finito", () => {
		expect(
			isIncobrableContinuationReady({ ...base, montoIncobrable: undefined }),
		).toBeFalse();
		expect(
			isIncobrableContinuationReady({
				...base,
				montoIncobrable: Number.NaN,
			}),
		).toBeFalse();
		expect(
			isIncobrableContinuationReady({
				...base,
				montoIncobrable: Number.POSITIVE_INFINITY,
			}),
		).toBeFalse();
	});

	it("rechaza monto incobrable en 0 aunque todo coincida", () => {
		expect(
			isIncobrableContinuationReady({
				...base,
				montoIncobrable: 0,
				capitalCredito: "0",
				montoIncobrableRegistrado: "0",
			}),
		).toBeFalse();
	});

	it("rechaza sin registro de deuda incobrable", () => {
		expect(
			isIncobrableContinuationReady({
				...base,
				montoIncobrableRegistrado: null,
			}),
		).toBeFalse();
	});

	it("rechaza cuando ya existe pago de cierre", () => {
		expect(
			isIncobrableContinuationReady({ ...base, tienePagoCierre: true }),
		).toBeFalse();
	});

	it("rechaza capital nulo o basura sin lanzar", () => {
		expect(
			isIncobrableContinuationReady({ ...base, capitalCredito: null }),
		).toBeFalse();
		expect(
			isIncobrableContinuationReady({ ...base, capitalCredito: "basura" }),
		).toBeFalse();
		expect(
			isIncobrableContinuationReady({
				...base,
				montoIncobrableRegistrado: "basura",
			}),
		).toBeFalse();
	});
});

describe("mapResetCreditError", () => {
	it("propaga estado inválido como 409 con el mensaje real", () => {
		expect(
			mapResetCreditError(new Error(RESET_CREDIT_ERRORS.ESTADO_INVALIDO)),
		).toEqual({ status: 409, message: RESET_CREDIT_ERRORS.ESTADO_INVALIDO });
	});

	it("propaga cierre previo como 409 con el mensaje real", () => {
		expect(
			mapResetCreditError(new Error(RESET_CREDIT_ERRORS.CIERRE_PREVIO)),
		).toEqual({ status: 409, message: RESET_CREDIT_ERRORS.CIERRE_PREVIO });
	});

	it("propaga crédito no encontrado como 404", () => {
		expect(
			mapResetCreditError(
				new Error(RESET_CREDIT_ERRORS.CREDITO_NO_ENCONTRADO),
			),
		).toEqual({
			status: 404,
			message: RESET_CREDIT_ERRORS.CREDITO_NO_ENCONTRADO,
		});
	});

	it("mapea errores desconocidos al 500 genérico sin filtrar internos", () => {
		expect(mapResetCreditError(new Error("column does not exist"))).toEqual({
			status: 500,
			message: "Error reiniciando el crédito",
		});
	});

	it("tolera valores lanzados que no son Error", () => {
		expect(mapResetCreditError("boom")).toEqual({
			status: 500,
			message: "Error reiniciando el crédito",
		});
		expect(mapResetCreditError(undefined)).toEqual({
			status: 500,
			message: "Error reiniciando el crédito",
		});
	});
});

describe("reset credit monto normalization wiring", () => {
	it("resetCredit normaliza el monto incobrable y decide con el helper", async () => {
		const source = await Bun.file(
			resolve(import.meta.dir, "credits.ts"),
		).text();
		const resetCredit = source.match(
			/export async function resetCredit[\s\S]*?(?=\nexport )/,
		)?.[0];
		if (!resetCredit) throw new Error("No se encontró resetCredit");

		expect(resetCredit).toContain("normalizarMontoQ(");
		expect(resetCredit).toContain("isIncobrableContinuationReady(");
		expect(resetCredit).toContain("RESET_CREDIT_ERRORS.CREDITO_NO_ENCONTRADO");
		expect(resetCredit).toContain("RESET_CREDIT_ERRORS.ESTADO_INVALIDO");
		expect(resetCredit).toContain("RESET_CREDIT_ERRORS.CIERRE_PREVIO");
		// El monto crudo del front (con polvo de float) no debe entrar a Big ni
		// escribirse: solo su versión normalizada.
		expect(resetCredit).not.toContain("new Big(montoIncobrable)");
		expect(resetCredit).not.toContain("new Big(montoIncobrable!)");
	});

	it("actualizarEstadoCredito castiga con el monto normalizado", async () => {
		const source = await Bun.file(
			resolve(import.meta.dir, "credits.ts"),
		).text();
		const fn = source.match(
			/export async function actualizarEstadoCredito[\s\S]*?(?=\nexport )/,
		)?.[0];
		if (!fn) throw new Error("No se encontró actualizarEstadoCredito");

		expect(fn).toContain("normalizarMontoQ(monto_cancelacion");
		expect(fn).not.toContain("new Big(monto_cancelacion!)");
	});

	it("el router de resetCredit responde con el error mapeado", async () => {
		const routerSource = await Bun.file(
			resolve(import.meta.dir, "../routers/credits.ts"),
		).text();
		const handler = routerSource.match(
			/\.post\("\/resetCredit"[\s\S]*?\n  \}\)/,
		)?.[0];
		if (!handler) throw new Error("No se encontró el handler de /resetCredit");

		expect(handler).toContain("mapResetCreditError(");
		expect(handler).not.toContain('set.status = 500');
	});
});

describe("reset credit atomic closing payment wiring", () => {
	it("keeps every reset write in one transaction", async () => {
		const source = await Bun.file(
			resolve(import.meta.dir, "credits.ts"),
		).text();
		const resetCredit = source.match(
			/export async function resetCredit[\s\S]*?(?=\nexport )/,
		)?.[0];
		const transactionStart = resetCredit?.indexOf(
			"db.transaction(async (tx) => {",
		);
		const transactionEnd = resetCredit?.indexOf("\n    });", transactionStart);
		const transaction =
			resetCredit &&
			transactionStart !== undefined &&
			transactionStart >= 0 &&
			transactionEnd !== undefined &&
			transactionEnd >= 0
				? resetCredit.slice(transactionStart, transactionEnd + 7)
				: undefined;
		if (!transaction || !resetCredit || transactionStart === undefined)
			throw new Error("No se encontró la transacción de cierre");
		const beforeTransaction = resetCredit.slice(0, transactionStart);
		const lockIndex = transaction.indexOf('.for("update")');
		const orderedReads = [
			".from(moras_credito)",
			".from(bad_debts)",
			".from(pagos_credito)",
			".from(credit_cancelations)",
			".from(montos_adicionales)",
			"getPagosDelMesActual(credito.credito_id, tx)",
			".from(cuotas_credito)",
		];

		expect(transaction).toContain('.for("update")');
		expect(
			transaction.slice(0, lockIndex).match(/await\s+(?:db|tx)\s*\./g),
		).toHaveLength(1);
		expect(transaction.slice(0, lockIndex)).toMatch(
			/await\s+tx\s*\.select\(\)[\s\S]*?\.from\(creditos\)[\s\S]*?\.where\(eq\(creditos\.credito_id, creditId\)\)/,
		);
		expect(beforeTransaction).not.toMatch(
			/await\s+db\s*\.(?:select|insert|update|delete|execute|query)\b/,
		);
		for (const read of orderedReads) {
			expect(transaction.indexOf(read)).toBeGreaterThan(lockIndex);
		}
		expect(transaction).toContain(".from(pagos_credito)");
		expect(transaction).toContain(
			'eq(pagos_credito.registerBy, "system_reset")',
		);
		expect(transaction).toContain("tx.insert(pagos_credito)");
		expect(transaction).toMatch(/tx\s*\.update\(pagos_credito\)/);
		expect(transaction).toMatch(/tx\s*\.insert\(cuotas_credito\)/);
		expect(transaction).toMatch(/tx\s*\.update\(creditos_inversionistas\)/);
		expect(transaction).toContain("tx.insert(boletas)");
		expect(transaction).toContain("tx.insert(bad_debts)");
		expect(transaction).toContain("setCapitalSource(tx");
		expect(transaction).toContain("distribuirAbonoCapitalEspejo(");
		expect(transaction).toMatch(
			/distribuirAbonoCapitalEspejo\([\s\S]*?tx,?\s*\)/,
		);
		expect(transaction).toMatch(
			/insertPagosCreditoInversionistasV2\([\s\S]*?undefined,\s*tx,?\s*\)/,
		);
		expect(transaction).not.toMatch(/await db\.(?:insert|update|delete)/);
		expect(transaction).not.toContain("withCapitalContext");
		expect(transaction).toContain('statusCredit === "INCOBRABLE"');
		expect(
			transaction.lastIndexOf("return { nuevoPago, statusCredit }"),
		).toBeGreaterThan(transaction.lastIndexOf("tx.insert(bad_debts)"));
		expect(
			transaction.lastIndexOf("return { nuevoPago, statusCredit }"),
		).toBeGreaterThan(transaction.lastIndexOf(".update(creditos)"));
		expect(transaction.indexOf('.for("update")')).toBeLessThan(
			transaction.indexOf(".from(pagos_credito)"),
		);
		expect(transaction.indexOf(".from(pagos_credito)")).toBeLessThan(
			transaction.indexOf("tx.insert(pagos_credito)"),
		);
	});
});
