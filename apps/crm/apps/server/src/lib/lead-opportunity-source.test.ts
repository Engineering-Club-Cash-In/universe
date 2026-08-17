import { describe, expect, test } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import {
	buildOpenOpportunityBySourceCondition,
	isOpportunityFromSource,
	type LeadSource,
} from "./lead-opportunity-source";

const dialect = new PgDialect();
const LEAD_ID = "00000000-0000-0000-0000-000000000001";

function compile(source: LeadSource, leadSource: LeadSource) {
	const condition = buildOpenOpportunityBySourceCondition(
		LEAD_ID,
		source,
		leadSource,
	);

	expect(condition).toBeDefined();
	if (!condition) {
		throw new Error("Expected the helper to build a SQL condition");
	}

	return dialect.sqlToQuery(condition);
}

describe("buildOpenOpportunityBySourceCondition", () => {
	test("filters open opportunities by the requested source", () => {
		const query = compile("Whatsapp", "Whatsapp");

		expect(query.sql).toContain('"opportunities"."source" =');
		expect(query.params).toContain("Whatsapp");
	});

	test("includes legacy null-source opportunities when the lead belongs to the requested source", () => {
		expect(compile("Whatsapp", "Whatsapp").sql).toContain(
			'"opportunities"."source" is null',
		);
	});

	test("excludes legacy null-source opportunities when the lead came from another channel", () => {
		expect(compile("Whatsapp", "agency").sql).not.toContain(
			'"opportunities"."source" is null',
		);
	});

	// El source del lead llega por parámetro justamente para no leerlo de la DB:
	// hay flujos que lo actualizan al canal recién pedido dentro del mismo
	// request, así que consultarlo haría pasar cualquier oportunidad legacy de
	// otro canal por una del canal correcto.
	test("never resolves the lead source from the leads table", () => {
		expect(compile("Whatsapp", "Whatsapp").sql).not.toContain('"leads"');
	});

	test("keeps open and on-hold opportunities eligible", () => {
		const query = compile("Whatsapp", "Whatsapp");

		expect(query.params).toContain("open");
		expect(query.params).toContain("on_hold");
	});
});

// Gemela en memoria de la condición de arriba: con leads duplicados cada
// oportunidad legacy se clasifica con el canal de su propio lead, y eso una
// sola condición SQL no lo puede expresar.
describe("isOpportunityFromSource", () => {
	test("matches an opportunity tagged with the requested source", () => {
		expect(isOpportunityFromSource("Whatsapp", "Whatsapp", "agency")).toBe(
			true,
		);
	});

	test("rejects an opportunity from another channel", () => {
		expect(isOpportunityFromSource("agency", "Whatsapp", "Whatsapp")).toBe(
			false,
		);
	});

	test("treats legacy null-source opportunities as their lead's channel", () => {
		expect(isOpportunityFromSource(null, "Whatsapp", "Whatsapp")).toBe(true);
		expect(isOpportunityFromSource(null, "Whatsapp", "agency")).toBe(false);
	});
});
