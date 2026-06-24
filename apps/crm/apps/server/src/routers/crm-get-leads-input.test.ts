import { describe, expect, test } from "bun:test";
import { leadSourceEnum } from "../db/schema/crm";
import {
	buildCarteraMatchedClientRows,
	buildCarteraOnlyClientRow,
	getClientCreditSifcosFromCartera,
	getClientCreditsPageFromCartera,
	getCurrentClientCreditsFromCartera,
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

describe("getCurrentClientCreditsFromCartera", () => {
	test("requests active cartera credits without month/year filtering", async () => {
		const calls: Array<{ mes: number; anio: number; estado: string }> = [];
		const fetchCredits = async (params: {
			mes: number;
			anio: number;
			estado: string;
			page: number;
			perPage: number;
		}) => {
			calls.push(params);

			return {
				data: [{ creditos: { numero_credito_sifco: `${params.estado}-1` } }],
				totalPages: 1,
			};
		};

		const credits = await getCurrentClientCreditsFromCartera(fetchCredits);

		expect(credits.map((row) => row.creditos?.numero_credito_sifco)).toEqual([
			"ACTIVO-1",
			"MOROSO-1",
			"EN_CONVENIO-1",
		]);
		expect(calls.map(({ mes, anio }) => ({ mes, anio }))).toEqual([
			{ mes: 0, anio: 0 },
			{ mes: 0, anio: 0 },
			{ mes: 0, anio: 0 },
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
				{
					id: "opp-1",
					numeroSifco: "SIFCO-1",
					value: "5000.00",
					isClosed: true,
				},
				{
					id: "opp-2",
					numeroSifco: "SIFCO-2",
					value: "7000.00",
					isClosed: true,
				},
			],
			creditAnalysis: null,
			carteraCreditBySifco: new Map([
				[
					"SIFCO-1",
					{
						creditos: {
							numero_credito_sifco: "SIFCO-1",
							deudatotal: "1200.00",
						},
					},
				],
				[
					"SIFCO-2",
					{
						creditos: {
							numero_credito_sifco: "SIFCO-2",
							deudatotal: "3400.00",
						},
					},
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
				{
					id: "opp-1",
					numeroSifco: "SIFCO-1",
					value: "5000.00",
					isClosed: true,
				},
			],
			creditAnalysis: null,
			carteraCreditBySifco: new Map([
				[
					"SIFCO-1",
					{
						creditos: {
							numero_credito_sifco: "SIFCO-1",
							deudatotal: "1200.00",
						},
					},
				],
			]),
		});

		expect(row.totalClosedValue).toBe(1200);
	});

	test("includes all lead opportunities in each matched client detail row", () => {
		const rows = buildCarteraMatchedClientRows({
			lead,
			leadOpportunities: [
				{
					id: "opp-1",
					numeroSifco: "SIFCO-1",
					value: "5000.00",
					isClosed: true,
				},
				{
					id: "opp-2",
					numeroSifco: "SIFCO-2",
					value: "7000.00",
					isClosed: true,
				},
			],
			creditAnalysis: null,
			carteraCreditBySifco: new Map([
				[
					"SIFCO-1",
					{
						creditos: {
							numero_credito_sifco: "SIFCO-1",
							deudatotal: "1200.00",
						},
					},
				],
				[
					"SIFCO-2",
					{
						creditos: {
							numero_credito_sifco: "SIFCO-2",
							deudatotal: "3400.00",
						},
					},
				],
			]),
		});

		expect(rows[0].carteraCredit?.numeroSifco).toBe("SIFCO-1");
		expect(rows[0].opportunities.map((opp) => opp.id)).toEqual([
			"opp-1",
			"opp-2",
		]);
	});
});

describe("getClientCreditsPageFromCartera", () => {
	// Fetcher falso: cada estado tiene `counts[estado]` créditos y devuelve la
	// página pedida + el totalCount, igual que cartera-back.
	const buildFetcher = (counts: Record<string, number>) => {
		const calls: Array<{ estado: string; page: number; perPage: number }> = [];
		const fetchCredits = async (params: {
			estado: string;
			page: number;
			perPage: number;
		}) => {
			calls.push({
				estado: params.estado,
				page: params.page,
				perPage: params.perPage,
			});
			const count = counts[params.estado] ?? 0;
			const start = (params.page - 1) * params.perPage;
			const data = [];
			for (let i = start; i < Math.min(start + params.perPage, count); i++) {
				data.push({
					creditos: { numero_credito_sifco: `${params.estado}-${i}` },
				});
			}
			return {
				data,
				totalCount: count,
				totalPages: Math.max(1, Math.ceil(count / params.perPage)),
			};
		};
		return { fetchCredits, calls };
	};

	const sifcosDe = (
		credits: Array<{ creditos?: { numero_credito_sifco?: string | null } }>,
	) => credits.map((c) => c.creditos?.numero_credito_sifco);

	test("returns only the requested window within ACTIVO and totals all states", async () => {
		const { fetchCredits, calls } = buildFetcher({
			ACTIVO: 5,
			MOROSO: 4,
			EN_CONVENIO: 3,
		});

		const { credits, total } = await getClientCreditsPageFromCartera(
			{ offset: 0, limit: 2 },
			fetchCredits,
		);

		expect(sifcosDe(credits)).toEqual(["ACTIVO-0", "ACTIVO-1"]);
		expect(total).toBe(12);
		// ACTIVO se pide con página real; los demás solo se sondean (perPage=1).
		const moroso = calls.find((c) => c.estado === "MOROSO");
		const convenio = calls.find((c) => c.estado === "EN_CONVENIO");
		expect(moroso?.perPage).toBe(1);
		expect(convenio?.perPage).toBe(1);
	});

	test("stitches the window across the ACTIVO -> MOROSO boundary", async () => {
		const { fetchCredits } = buildFetcher({
			ACTIVO: 2,
			MOROSO: 3,
			EN_CONVENIO: 0,
		});

		const { credits, total } = await getClientCreditsPageFromCartera(
			{ offset: 1, limit: 3 },
			fetchCredits,
		);

		expect(sifcosDe(credits)).toEqual(["ACTIVO-1", "MOROSO-0", "MOROSO-1"]);
		expect(total).toBe(5);
	});

	test("passes filters through to the fetcher", async () => {
		const received: Array<{
			nombre_usuario?: string;
			numeros_credito_sifco?: string[];
		}> = [];
		const fetchCredits = async (params: {
			estado: string;
			page: number;
			perPage: number;
			nombre_usuario?: string;
			numeros_credito_sifco?: string[];
		}) => {
			received.push(params);
			return { data: [], totalCount: 0, totalPages: 1 };
		};

		await getClientCreditsPageFromCartera(
			{ offset: 0, limit: 10, nombreUsuario: "Juan", sifcos: ["X-1", "X-2"] },
			fetchCredits,
		);

		expect(received[0]?.nombre_usuario).toBe("Juan");
		expect(received[0]?.numeros_credito_sifco).toEqual(["X-1", "X-2"]);
	});
});
