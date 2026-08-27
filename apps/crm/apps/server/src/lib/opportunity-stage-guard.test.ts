import { describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { opportunities } from "../db/schema";
import {
	buildOpportunityRelationshipInvariantCondition,
	getStageLeadRequirementError,
	getStageVehicleRequirementError,
	getWonOpportunityFrozenFieldChanges,
	getWonOpportunityLockError,
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

describe("won opportunity frozen fields", () => {
	const wonOpportunity = {
		leadId: "lead-1",
		companyId: null,
		vehicleId: "vehicle-1",
		creditType: "autocompra",
	};

	test("detects a vehicle swap on a won opportunity", () => {
		const changes = getWonOpportunityFrozenFieldChanges(
			{ vehicleId: "vehicle-2" },
			wonOpportunity,
		);
		expect(changes).toEqual(["vehicleId"]);
		expect(getWonOpportunityLockError("won", "sales", changes)).toContain(
			"el vehículo",
		);
	});

	test("lets a won opportunity keep advancing to 100%", () => {
		// El drag del kanban manda solo { id, stageId }: no toca campos congelados.
		const changes = getWonOpportunityFrozenFieldChanges({}, wonOpportunity);
		expect(changes).toEqual([]);
		expect(getWonOpportunityLockError("won", "sales", changes)).toBeNull();
	});

	test("ignores a form that resends the same relationships", () => {
		expect(
			getWonOpportunityFrozenFieldChanges(
				{
					leadId: "lead-1",
					companyId: null,
					vehicleId: "vehicle-1",
					creditType: "autocompra",
				},
				wonOpportunity,
			),
		).toEqual([]);
	});

	test("catches clearing a relationship and filling an empty one", () => {
		expect(
			getWonOpportunityFrozenFieldChanges(
				{ vehicleId: null, companyId: "company-1" },
				wonOpportunity,
			),
		).toEqual(["vehicleId", "companyId"]);
	});

	test("ignores undefined values", () => {
		expect(
			getWonOpportunityFrozenFieldChanges(
				{ vehicleId: undefined },
				wonOpportunity,
			),
		).toEqual([]);
	});

	test("lets admins correct a won opportunity", () => {
		expect(getWonOpportunityLockError("won", "admin", ["vehicleId"])).toBeNull();
	});

	test("does not touch open, lost or on-hold opportunities", () => {
		for (const status of ["open", "lost", "on_hold"]) {
			expect(getWonOpportunityLockError(status, "sales", ["vehicleId"])).toBeNull();
		}
	});

	test("names every frozen field it blocks", () => {
		const message = getWonOpportunityLockError("won", "sales", [
			"leadId",
			"vehicleId",
		]);
		expect(message).toContain("el cliente");
		expect(message).toContain("el vehículo");
	});
});
