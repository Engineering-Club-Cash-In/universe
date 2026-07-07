import { describe, expect, test } from "bun:test";
import { getLeadSourceChannelType } from "../lib/lead-sources";
import {
	aggregateEfectividadPorTipoCanal,
	aggregateTiempoCierrePorTipoCanal,
	buildPorcentajeEfectividadFuenteRows,
	CLOSED_CREDIT_REPORT_CARTERA_STATUS_CHUNK_SIZE,
	enforceClosedCreditReportLimit,
	isClosedCreditReportCarteraStatusIncluded,
	isPorcentajeEfectividadOpportunityStatusIncluded,
	isPorcentajeEfectividadPeriodCloseIncluded,
} from "./reports";

describe("isClosedCreditReportCarteraStatusIncluded", () => {
	test("only includes currently active cartera credit states", () => {
		expect(isClosedCreditReportCarteraStatusIncluded("ACTIVO")).toBe(true);
		expect(isClosedCreditReportCarteraStatusIncluded("MOROSO")).toBe(true);
		expect(isClosedCreditReportCarteraStatusIncluded("EN_CONVENIO")).toBe(true);
		expect(isClosedCreditReportCarteraStatusIncluded("CANCELADO")).toBe(false);
		expect(isClosedCreditReportCarteraStatusIncluded("INCOBRABLE")).toBe(false);
		expect(isClosedCreditReportCarteraStatusIncluded(null)).toBe(false);
	});
});

describe("CLOSED_CREDIT_REPORT_CARTERA_STATUS_CHUNK_SIZE", () => {
	test("keeps status lookups on the GET path because bulk POST requires estado", () => {
		expect(CLOSED_CREDIT_REPORT_CARTERA_STATUS_CHUNK_SIZE).toBeLessThanOrEqual(
			50,
		);
	});
});

describe("isPorcentajeEfectividadOpportunityStatusIncluded", () => {
	test("excludes migrated opportunities from effectiveness report totals", () => {
		expect(isPorcentajeEfectividadOpportunityStatusIncluded("open")).toBe(true);
		expect(isPorcentajeEfectividadOpportunityStatusIncluded("won")).toBe(true);
		expect(isPorcentajeEfectividadOpportunityStatusIncluded("lost")).toBe(true);
		expect(isPorcentajeEfectividadOpportunityStatusIncluded("on_hold")).toBe(
			true,
		);
		expect(isPorcentajeEfectividadOpportunityStatusIncluded("migrate")).toBe(
			false,
		);
	});
});

describe("isPorcentajeEfectividadPeriodCloseIncluded", () => {
	test("includes only first closes inside the selected period and excludes migrated opportunities", () => {
		const start = new Date("2026-06-01T00:00:00.000-06:00");
		const end = new Date("2026-06-30T23:59:59.999-06:00");

		expect(
			isPorcentajeEfectividadPeriodCloseIncluded(
				"won",
				new Date("2026-06-15T10:00:00.000-06:00"),
				start,
				end,
			),
		).toBe(true);
		expect(
			isPorcentajeEfectividadPeriodCloseIncluded(
				"won",
				new Date("2026-05-31T23:59:59.999-06:00"),
				start,
				end,
			),
		).toBe(false);
		expect(
			isPorcentajeEfectividadPeriodCloseIncluded(
				"migrate",
				new Date("2026-06-15T10:00:00.000-06:00"),
				start,
				end,
			),
		).toBe(false);
	});
});

describe("buildPorcentajeEfectividadFuenteRows", () => {
	test("keeps cohort closes and period closes as separate per-source metrics", () => {
		const rows = buildPorcentajeEfectividadFuenteRows(
			[
				{
					source: "agency",
					totalOportunidades: 25,
					totalCerradas: 0,
					porcentaje: 0,
				},
				{
					source: "meta",
					totalOportunidades: 108,
					totalCerradas: 0,
					porcentaje: 0,
				},
			],
			[
				{ source: "agency", totalCierresPeriodo: 11 },
				{ source: "website", totalCierresPeriodo: 3 },
			],
		);

		expect(rows).toEqual([
			{
				source: "meta",
				totalOportunidades: 108,
				totalCerradas: 0,
				totalCierresPeriodo: 0,
				porcentaje: 0,
			},
			{
				source: "agency",
				totalOportunidades: 25,
				totalCerradas: 0,
				totalCierresPeriodo: 11,
				porcentaje: 0,
			},
			{
				source: "website",
				totalOportunidades: 0,
				totalCerradas: 0,
				totalCierresPeriodo: 3,
				porcentaje: 0,
			},
		]);
	});
});

describe("enforceClosedCreditReportLimit", () => {
	test("allows candidate ranges over 10000 when filtered rows are within the limit", () => {
		const filteredRows = Array.from({ length: 10_000 }, (_, index) => ({
			id: index,
		}));

		expect(() => enforceClosedCreditReportLimit(filteredRows)).not.toThrow();
	});

	test("rejects filtered report rows over the export limit", () => {
		const filteredRows = Array.from({ length: 10_001 }, (_, index) => ({
			id: index,
		}));

		expect(() => enforceClosedCreditReportLimit(filteredRows)).toThrow(
			"El rango seleccionado devuelve demasiados registros. Reduce el rango de fechas.",
		);
	});
});

describe("getLeadSourceChannelType", () => {
	test("groups known and unknown lead sources by channel type", () => {
		expect(getLeadSourceChannelType("property")).toBe("Físico");
		expect(getLeadSourceChannelType("agency")).toBe("Físico");
		expect(getLeadSourceChannelType("google")).toBe("Pauta Digital");
		expect(getLeadSourceChannelType("meta")).toBe("Pauta Digital");
		expect(getLeadSourceChannelType("facebook")).toBe("Pauta Digital");
		expect(getLeadSourceChannelType("instagram")).toBe("Pauta Digital");
		expect(getLeadSourceChannelType("Whatsapp")).toBe("Pauta Digital");
		expect(getLeadSourceChannelType("website")).toBe("Orgánico Digital");
		expect(getLeadSourceChannelType("social_media")).toBe("Orgánico Digital");
		expect(getLeadSourceChannelType("recurrent")).toBe("Otros");
		expect(getLeadSourceChannelType("recurrent_active")).toBe("Otros");
		expect(getLeadSourceChannelType("other")).toBe("Otros");
		expect(getLeadSourceChannelType("referral")).toBe("Otros");
		expect(getLeadSourceChannelType(null)).toBe("Otros");
		expect(getLeadSourceChannelType("unknown_source")).toBe("Otros");
	});
});

describe("aggregateEfectividadPorTipoCanal", () => {
	test("subtotals opportunities and closed counts by channel type", () => {
		expect(
			aggregateEfectividadPorTipoCanal([
				{
					source: "google",
					totalOportunidades: 3,
					totalCerradas: 1,
					porcentaje: 33.3,
				},
				{
					source: "meta",
					totalOportunidades: 7,
					totalCerradas: 4,
					porcentaje: 57.1,
				},
				{
					source: "website",
					totalOportunidades: 5,
					totalCerradas: 2,
					porcentaje: 40,
				},
				{
					source: "untracked",
					totalOportunidades: 2,
					totalCerradas: 1,
					porcentaje: 50,
				},
			]),
		).toEqual([
			{
				tipoCanal: "Pauta Digital",
				totalOportunidades: 10,
				totalCerradas: 5,
				porcentaje: 50,
			},
			{
				tipoCanal: "Orgánico Digital",
				totalOportunidades: 5,
				totalCerradas: 2,
				porcentaje: 40,
			},
			{
				tipoCanal: "Otros",
				totalOportunidades: 2,
				totalCerradas: 1,
				porcentaje: 50,
			},
		]);
	});
});

describe("aggregateTiempoCierrePorTipoCanal", () => {
	test("subtotals close-time stats by channel type", () => {
		expect(
			aggregateTiempoCierrePorTipoCanal([
				{
					source: "property",
					totalCreditos: 2,
					avgDias: 5,
					minDias: 3,
					maxDias: 7,
				},
				{
					source: "agency",
					totalCreditos: 1,
					avgDias: 11,
					minDias: 11,
					maxDias: 11,
				},
				{
					source: "social_media",
					totalCreditos: 4,
					avgDias: 8,
					minDias: 4,
					maxDias: 14,
				},
			]),
		).toEqual([
			{
				tipoCanal: "Físico",
				totalCreditos: 3,
				avgDias: 7,
				minDias: 3,
				maxDias: 11,
			},
			{
				tipoCanal: "Orgánico Digital",
				totalCreditos: 4,
				avgDias: 8,
				minDias: 4,
				maxDias: 14,
			},
		]);
	});

	test("uses raw day totals when available to avoid rounding per-source averages twice", () => {
		expect(
			aggregateTiempoCierrePorTipoCanal([
				{
					source: "property",
					totalCreditos: 2,
					avgDias: 1.3,
					totalDias: 2.5,
					minDias: 1,
					maxDias: 2,
				},
				{
					source: "agency",
					totalCreditos: 1,
					avgDias: 1.2,
					totalDias: 1.24,
					minDias: 1,
					maxDias: 2,
				},
			]),
		).toEqual([
			{
				tipoCanal: "Físico",
				totalCreditos: 3,
				avgDias: 1.2,
				minDias: 1,
				maxDias: 2,
			},
		]);
	});
});
