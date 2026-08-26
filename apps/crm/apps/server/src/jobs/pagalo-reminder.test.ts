import { describe, expect, test } from "bun:test";
import {
	ESTADOS_OPORTUNIDAD_CON_CREDITO,
	ESTADOS_GRUPOS_RECORDABLES,
	esPendiente,
	resolverLinksPendientes,
	resolverLinksRecordables,
	resolverTelefono,
	resolverVehiculo,
} from "./pagalo-reminder";
import { normalizePhone } from "../lib/simpletech";

type LinkFixture = Parameters<typeof esPendiente>[0];

test("fallback de oportunidad solo permite créditos ganados o migrados", () => {
	expect(ESTADOS_OPORTUNIDAD_CON_CREDITO).toEqual(["won", "migrate"]);
});

test("recordatorios solo consideran grupos con emisión de links terminada", () => {
	expect(ESTADOS_GRUPOS_RECORDABLES).toEqual([
		"PENDING_PAYMENT",
		"PARTIALLY_PAID",
	]);
});

function link(overrides: Partial<LinkFixture> = {}): LinkFixture {
	return {
		id: "link-1",
		groupId: "group-1",
		linkType: "CAPITAL",
		generation: 1,
		externalIdentifier: "ext-1",
		pagaloRequestUuid: null,
		pagaloShortUuid: null,
		paymentUrl: "https://s.pagalodev.com/x",
		apiBaseUrl: "https://api.pagalodev.com",
		status: "ACTIVE",
		requestPayload: {},
		responsePayload: null,
		httpStatus: null,
		errorCode: null,
		errorMessage: null,
		pagaloTransactionUuid: null,
		transactionStatus: null,
		transactionAmount: null,
		transactionCurrency: null,
		requestId: null,
		requestAuth: null,
		isApplicationSource: false,
		voucherSource: "NONE",
		voucherUrl: null,
		voucherStorageKey: null,
		voucherSha256: null,
		voucherGeneratedAt: null,
		expiresAt: null,
		supersedesLinkId: null,
		nextPollAt: null,
		pollClaimedAt: null,
		pollAttempts: 0,
		lastPolledAt: null,
		lastPollError: null,
		requestedBy: "user-1",
		requestedAt: new Date(),
		activatedAt: null,
		paidAt: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides,
	} as LinkFixture;
}

describe("esPendiente", () => {
	test("ACTIVE con paymentUrl y sin isApplicationSource: pendiente", () => {
		expect(
			esPendiente(
				link({
					status: "ACTIVE",
					paymentUrl: "https://x",
					isApplicationSource: false,
				}),
			),
		).toBe(true);
	});

	test("CREATING (sin URL asignada todavía): NO pendiente aunque no esté pagado", () => {
		expect(esPendiente(link({ status: "CREATING", paymentUrl: null }))).toBe(
			false,
		);
	});

	test("ACTIVE pero sin paymentUrl (dato inconsistente): NO pendiente", () => {
		expect(esPendiente(link({ status: "ACTIVE", paymentUrl: null }))).toBe(
			false,
		);
	});

	test("PAID: NO pendiente", () => {
		expect(
			esPendiente(link({ status: "PAID", isApplicationSource: true })),
		).toBe(false);
	});

	test("isApplicationSource=true (ya es la fuente de aplicación): NO pendiente aunque siga ACTIVE", () => {
		expect(
			esPendiente(link({ status: "ACTIVE", isApplicationSource: true })),
		).toBe(false);
	});

	for (const status of [
		"REJECTED",
		"CANCELLED",
		"EXPIRED",
		"REPLACED",
		"ERROR",
	] as const) {
		test(`${status}: NO pendiente`, () => {
			expect(esPendiente(link({ status }))).toBe(false);
		});
	}
});

describe("resolverLinksPendientes", () => {
	test("ambos pendientes: MORA_INTERES primero, luego CAPITAL", () => {
		const capital = link({ id: "cap", linkType: "CAPITAL" });
		const mora = link({ id: "mora", linkType: "MORA_INTERES" });
		const resultado = resolverLinksPendientes([capital, mora]);
		expect(resultado?.map((l) => l.linkType)).toEqual([
			"MORA_INTERES",
			"CAPITAL",
		]);
	});

	test("solo MORA_INTERES pendiente (capital ya pagado): manda solo mora", () => {
		const capital = link({
			id: "cap",
			linkType: "CAPITAL",
			status: "PAID",
			isApplicationSource: true,
		});
		const mora = link({ id: "mora", linkType: "MORA_INTERES" });
		const resultado = resolverLinksPendientes([capital, mora]);
		expect(resultado?.map((l) => l.linkType)).toEqual(["MORA_INTERES"]);
	});

	test("solo CAPITAL pendiente (mora ya pagada): manda solo capital, nunca antes que mora pendiente", () => {
		const capital = link({ id: "cap", linkType: "CAPITAL" });
		const mora = link({
			id: "mora",
			linkType: "MORA_INTERES",
			status: "PAID",
			isApplicationSource: true,
		});
		const resultado = resolverLinksPendientes([capital, mora]);
		expect(resultado?.map((l) => l.linkType)).toEqual(["CAPITAL"]);
	});

	test("ambos pagados: null, no manda nada", () => {
		const capital = link({
			id: "cap",
			linkType: "CAPITAL",
			status: "PAID",
			isApplicationSource: true,
		});
		const mora = link({
			id: "mora",
			linkType: "MORA_INTERES",
			status: "PAID",
			isApplicationSource: true,
		});
		expect(resolverLinksPendientes([capital, mora])).toBeNull();
	});

	test("grupo mora-only (nunca tuvo link CAPITAL, D-48): solo evalúa mora", () => {
		const mora = link({ id: "mora", linkType: "MORA_INTERES" });
		expect(resolverLinksPendientes([mora])?.map((l) => l.linkType)).toEqual([
			"MORA_INTERES",
		]);
	});

	test("sin links en absoluto: null", () => {
		expect(resolverLinksPendientes([])).toBeNull();
	});

	test("link reemplazado (REPLACED) con reemplazo ACTIVE de generation mayor: usa el vigente, ignora el viejo", () => {
		const viejo = link({
			id: "old",
			linkType: "CAPITAL",
			generation: 1,
			status: "REPLACED",
		});
		const nuevo = link({
			id: "new",
			linkType: "CAPITAL",
			generation: 2,
			status: "ACTIVE",
		});
		const resultado = resolverLinksPendientes([viejo, nuevo]);
		expect(resultado).toHaveLength(1);
		expect(resultado?.[0]?.id).toBe("new");
	});
});

test("grupo cancelado no reenvía links activos capturados antes del reemplazo", () => {
	const activo = link({ linkType: "CAPITAL", status: "ACTIVE" });

	expect(resolverLinksRecordables("CANCELLED", [activo])).toBeNull();
});

describe("resolverTelefono", () => {
	test("telefonoPrincipal válido: se usa directo", () => {
		expect(resolverTelefono("30295849", undefined)).toBe("30295849");
	});

	test("telefonoPrincipal ausente: cae a teléfono de lead", () => {
		expect(resolverTelefono(undefined, "50967386")).toBe("50967386");
	});

	test("telefonoPrincipal inválido: usa teléfono alternativo antes que lead", () => {
		expect(resolverTelefono("N/A", "50967386", "57099747")).toBe(
			"57099747",
		);
	});

	test("telefonoPrincipal inválido/basura NO bloquea el fallback válido de leads (bug corregido)", () => {
		// Antes: primerTelefono(a ?? b) evaluaba "N/A" como truthy y nunca
		// probaba leads.phone. Ahora cada fuente se prueba por separado.
		expect(resolverTelefono("N/A", "50967386")).toBe("50967386");
	});

	test("telefonoPrincipal muy corto (< 8 dígitos) NO bloquea el fallback", () => {
		expect(resolverTelefono("123", "30295849")).toBe("30295849");
	});

	test("ambos inválidos: undefined", () => {
		expect(resolverTelefono("N/A", "abc")).toBeUndefined();
	});

	test("ambos ausentes: undefined", () => {
		expect(resolverTelefono(undefined, undefined)).toBeUndefined();
	});

	test("conserva formato para que normalizePhone lo normalice", () => {
		expect(resolverTelefono("+502 3029-5849", undefined)).toBe(
			"+502 3029-5849",
		);
	});

	test("conserva código internacional explícito", () => {
		const telefono = resolverTelefono("+1 305 555 0100", undefined);

		expect(normalizePhone(telefono!)).toBe("+13055550100");
	});
});

describe("resolverVehiculo", () => {
	test("prefiere vehículo del caso cobros", () => {
		const caso = {
			marca: "TOYOTA",
			modelo: "RAV4",
			year: 2017,
			placa: "P-507GFV",
		};
		const lead = { marca: "HONDA", modelo: "CRV", year: 2020, placa: "P-000AAA" };

		expect(resolverVehiculo(caso, lead)).toEqual(caso);
	});

	test("sin vehículo del caso: cae al vehículo asociado a oportunidad", () => {
		const lead = { marca: "HONDA", modelo: "CRV", year: 2020, placa: "P-000AAA" };

		expect(resolverVehiculo(null, lead)).toEqual(lead);
	});

	test("sin datos en ambas fuentes: devuelve undefined para usar SIFCO", () => {
		expect(
			resolverVehiculo(
				{ marca: null, modelo: null, year: null, placa: null },
				null,
			),
		).toBeUndefined();
	});
});
