import { describe, expect, test } from "bun:test";
import {
	CLOSED_CREDIT_REPORT_CARTERA_STATUS_CHUNK_SIZE,
	enforceClosedCreditReportLimit,
	isClosedCreditReportCarteraStatusIncluded,
	isPorcentajeEfectividadOpportunityStatusIncluded,
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
