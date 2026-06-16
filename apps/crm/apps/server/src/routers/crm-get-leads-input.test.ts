import { describe, expect, test } from "bun:test";
import { leadSourceEnum } from "../db/schema/crm";
import {
	buildCarteraMatchedClientRows,
	buildCarteraOnlyClientRow,
	calculateCarteraClientStats,
	getClientCreditSifcosFromCartera,
	getLeadsInputSchema,
} from "./crm";

describe("getLeadsInputSchema", () => {
	test("accepts every configured lead source as a filter", () => {
		for (const source of leadSourceEnum.enumValues) {
			expect(getLeadsInputSchema.parse({ source }).source).toBe(source);
		}
	});

	test("rejects unknown lead source filters", () => {
		expect(() =>
			getLeadsInputSchema.parse({ source: "unknown-source" }),
		).toThrow();
	});
});

describe("getClientCreditSifcosFromCartera", () => {
	test("returns unique SIFCOs from active, overdue, and agreement credits", async () => {
		const calls: Array<{ estado?: string; page?: number; perPage?: number }> =
			[];
		const fetchCredits = async (params: {
			estado?: string;
			page?: number;
			perPage?: number;
		}) => {
			calls.push(params);

			if (params.estado === "ACTIVO") {
				return {
					data: [
						{ creditos: { numero_credito_sifco: "A-1" } },
						{ creditos: { numero_credito_sifco: "DUP" } },
					],
					totalPages: 1,
				};
			}

			if (params.estado === "MOROSO") {
				return {
					data: [{ creditos: { numero_credito_sifco: "M-1" } }],
					totalPages: 1,
				};
			}

			return {
				data: [
					{ creditos: { numero_credito_sifco: "C-1" } },
					{ creditos: { numero_credito_sifco: "DUP" } },
				],
				totalPages: 1,
			};
		};

		const sifcos = await getClientCreditSifcosFromCartera(fetchCredits, {
			mes: 6,
			anio: 2026,
		});

		expect(sifcos).toEqual(["A-1", "DUP", "M-1", "C-1"]);
		expect(calls.map((call) => call.estado)).toEqual([
			"ACTIVO",
			"MOROSO",
			"EN_CONVENIO",
		]);
	});
});

describe("buildCarteraOnlyClientRow", () => {
	test("builds a client row for a cartera credit without CRM match", () => {
		const row = buildCarteraOnlyClientRow({
			creditos: {
				numero_credito_sifco: "01010101001170",
				statusCredit: "MOROSO",
				capital: "10000.00",
				deudatotal: "12500.00",
				cuota: "950.00",
				fecha_creacion: "2026-01-15T00:00:00.000Z",
				tipoCredito: "Sobre Vehículo",
			},
			usuarios: {
				nombre: "María López",
				nit: "1234567-8",
			},
			asesores: { nombre: "Asesor Cartera" },
		});

		expect(row.id).toBe("cartera-01010101001170");
		expect(row.firstName).toBe("María");
		expect(row.lastName).toBe("López");
		expect(row.crmMatchStatus).toBe("missing");
		expect(row.carteraCredit?.statusCredit).toBe("MOROSO");
		expect(row.opportunities).toEqual([]);
		expect(row.closedOpportunitiesCount).toBe(0);
		expect(row.totalClosedValue).toBe(12500);
	});
});

describe("buildCarteraMatchedClientRows", () => {
	const lead = {
		id: "lead-1",
		firstName: "Ana",
		lastName: "Pérez",
		email: "ana@example.com",
		phone: "5555-0000",
		dpi: "1234567890101",
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		updatedAt: new Date("2026-01-02T00:00:00.000Z"),
	};

	test("builds one matched row per current cartera credit for the same lead", () => {
		const rows = buildCarteraMatchedClientRows({
			lead,
			leadOpportunities: [
				{ id: "opp-1", numeroSifco: "SIFCO-1", value: "5000.00", isClosed: true },
				{ id: "opp-2", numeroSifco: "SIFCO-2", value: "7000.00", isClosed: true },
			],
			creditAnalysis: null,
			carteraCreditBySifco: new Map([
				[
					"SIFCO-1",
					{ creditos: { numero_credito_sifco: "SIFCO-1", deudatotal: "1200.00" } },
				],
				[
					"SIFCO-2",
					{ creditos: { numero_credito_sifco: "SIFCO-2", deudatotal: "3400.00" } },
				],
			]),
		});

		expect(rows).toHaveLength(2);
		expect(rows.map((row) => row.carteraCredit?.numeroSifco)).toEqual([
			"SIFCO-1",
			"SIFCO-2",
		]);
	});

	test("uses cartera debt instead of opportunity value for matched rows", () => {
		const [row] = buildCarteraMatchedClientRows({
			lead,
			leadOpportunities: [
				{ id: "opp-1", numeroSifco: "SIFCO-1", value: "5000.00", isClosed: true },
			],
			creditAnalysis: null,
			carteraCreditBySifco: new Map([
				[
					"SIFCO-1",
					{ creditos: { numero_credito_sifco: "SIFCO-1", deudatotal: "1200.00" } },
				],
			]),
		});

		expect(row.totalClosedValue).toBe(1200);
	});
});

describe("calculateCarteraClientStats", () => {
	test("scopes sales total value to matched assigned SIFCOs", () => {
		const stats = calculateCarteraClientStats({
			carteraCredits: [
				{ creditos: { numero_credito_sifco: "A-1", deudatotal: "100.00" } },
				{ creditos: { numero_credito_sifco: "B-1", deudatotal: "900.00" } },
			],
			matchedSifcos: new Set(["A-1"]),
			uniqueLeadCount: 1,
			scopedOpportunityCount: 1,
			userRole: "sales",
		});

		expect(stats.totalClients).toBe(1);
		expect(stats.totalClosedOpportunities).toBe(1);
		expect(stats.totalValue).toBe(100);
		expect(stats.missingCrmCount).toBe(0);
	});

	test("counts sales clients by matched cartera credits", () => {
		const stats = calculateCarteraClientStats({
			carteraCredits: [
				{ creditos: { numero_credito_sifco: "A-1", deudatotal: "100.00" } },
				{ creditos: { numero_credito_sifco: "A-2", deudatotal: "200.00" } },
			],
			matchedSifcos: new Set(["A-1", "A-2"]),
			uniqueLeadCount: 1,
			scopedOpportunityCount: 2,
			userRole: "sales",
		});

		expect(stats.totalClients).toBe(2);
	});

	test("uses full cartera totals for non-sales users", () => {
		const stats = calculateCarteraClientStats({
			carteraCredits: [
				{ creditos: { numero_credito_sifco: "A-1", deudatotal: "100.00" } },
				{ creditos: { numero_credito_sifco: "B-1", capital: "900.00" } },
			],
			matchedSifcos: new Set(["A-1"]),
			uniqueLeadCount: 1,
			scopedOpportunityCount: 1,
			userRole: "admin",
		});

		expect(stats.totalClients).toBe(2);
		expect(stats.totalValue).toBe(1000);
		expect(stats.missingCrmCount).toBe(1);
	});
});
