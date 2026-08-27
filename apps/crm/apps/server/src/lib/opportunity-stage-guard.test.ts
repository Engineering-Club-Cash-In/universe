import { describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { opportunities } from "../db/schema";
import {
	buildOpportunityRelationshipInvariantCondition,
	getStageLeadRequirementError,
	getStageVehicleRequirementError,
	getWonOpportunityLockError,
	WON_OPPORTUNITY_LOCKED_ERROR,
} from "./opportunity-stage-guard";

describe("opportunity stage vehicle guard", () => {
	test("requires a vehicle when moving from 30% to a later stage", () => {
		expect(getStageVehicleRequirementError(30, 40, null)).toBe(
			"Para avanzar a esta etapa, la oportunidad debe tener un vehículo asignado.",
		);
	});

	test("keeps the existing requirement when moving from 20% to 30%", () => {
		expect(getStageVehicleRequirementError(20, 30, undefined)).toBe(
			"Para avanzar a esta etapa, la oportunidad debe tener un vehículo asignado.",
		);
	});

	test("allows stage changes when a vehicle is assigned", () => {
		expect(getStageVehicleRequirementError(30, 40, "vehicle-id")).toBeNull();
	});
});

describe("opportunity stage lead guard", () => {
	test("rejects clearing the lead from an opportunity already in contractual workflow", () => {
		expect(getStageLeadRequirementError(85, null)).toBe(
			"La oportunidad debe conservar un cliente asignado desde la etapa jurídica (80%).",
		);
	});

	test("requires an effective lead when entering contractual workflow", () => {
		expect(getStageLeadRequirementError(80, null)).toBe(
			"La oportunidad debe conservar un cliente asignado desde la etapa jurídica (80%).",
		);
	});

	test("allows clearing the lead before contractual workflow", () => {
		expect(getStageLeadRequirementError(79, null)).toBeNull();
	});

	test("allows advanced-stage edits when a lead remains assigned", () => {
		expect(getStageLeadRequirementError(90, "lead-id")).toBeNull();
	});
});

describe("opportunity update concurrency guard", () => {
	test("parenthesizes the lead-stage invariant inside authorization predicates", () => {
		const database = drizzle.mock();
		const query = database
			.update(opportunities)
			.set({ notes: "updated" })
			.where(
				and(
					eq(opportunities.id, "11111111-1111-4111-8111-111111111111"),
					eq(opportunities.assignedTo, "sales-user"),
					buildOpportunityRelationshipInvariantCondition({}),
				),
			)
			.toSQL()
			.sql.replace(/\s+/g, " ")
			.toLowerCase();

		expect(query).toContain('and ( coalesce(( select "sales_stages"');
		expect(query).toContain('or "opportunities"."lead_id" is not null ))');
	});
});

describe("won opportunity lock", () => {
	test("blocks edits on won opportunities for non-admin roles", () => {
		expect(getWonOpportunityLockError("won", "sales")).toBe(
			WON_OPPORTUNITY_LOCKED_ERROR,
		);
		expect(getWonOpportunityLockError("won", "sales_supervisor")).toBe(
			WON_OPPORTUNITY_LOCKED_ERROR,
		);
		expect(getWonOpportunityLockError("won", null)).toBe(
			WON_OPPORTUNITY_LOCKED_ERROR,
		);
	});

	test("lets admins correct a won opportunity", () => {
		expect(getWonOpportunityLockError("won", "admin")).toBeNull();
	});

	test("does not touch open, lost or on-hold opportunities", () => {
		expect(getWonOpportunityLockError("open", "sales")).toBeNull();
		expect(getWonOpportunityLockError("lost", "sales")).toBeNull();
		expect(getWonOpportunityLockError("on_hold", "sales")).toBeNull();
	});
});
