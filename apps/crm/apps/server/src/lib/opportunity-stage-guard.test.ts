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
	getWonOpportunityRevokeError,
	stripUnchangedFrozenFields,
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
	const won = {
		leadId: "lead-1",
		companyId: null,
		vehicleId: "vehicle-1",
		creditType: "autocompra",
		status: "won",
	};

	test("blocks swapping the vehicle of a won opportunity", () => {
		const changes = getWonOpportunityFrozenFieldChanges(
			{ vehicleId: "vehicle-2" },
			won,
		);
		expect(changes).toEqual(["vehicleId"]);
		expect(getWonOpportunityLockError("won", "sales", changes)).toContain(
			"el vehículo",
		);
	});

	test("lets a won opportunity keep advancing to 100%", () => {
		// La opp es "won" desde el 90%: el drag del kanban manda solo stageId.
		const changes = getWonOpportunityFrozenFieldChanges({}, won);
		expect(changes).toEqual([]);
		expect(getWonOpportunityLockError("won", "sales", changes)).toBeNull();
	});

	test("blocks reopening it, which would bypass everything else", () => {
		for (const status of ["open", "lost", "on_hold"]) {
			expect(getWonOpportunityFrozenFieldChanges({ status }, won)).toEqual([
				"status",
			]);
		}
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
				won,
			),
		).toEqual([]);
	});

	test("catches clearing a relationship and filling an empty one", () => {
		expect(
			getWonOpportunityFrozenFieldChanges(
				{ vehicleId: null, companyId: "company-1" },
				won,
			),
		).toEqual(["vehicleId", "companyId"]);
	});

	test("lets admins correct a won opportunity", () => {
		expect(
			getWonOpportunityLockError("won", "admin", ["vehicleId"]),
		).toBeNull();
	});

	test("does not touch open, lost or on-hold opportunities", () => {
		for (const status of ["open", "lost", "on_hold"]) {
			expect(
				getWonOpportunityLockError(status, "sales", ["vehicleId"]),
			).toBeNull();
		}
	});
});

describe("stripUnchangedFrozenFields", () => {
	const won = {
		leadId: "lead-1",
		vehicleId: "vehicle-1",
		creditType: "autocompra",
		status: "won",
	};

	test("does not rewrite a frozen field that did not change", () => {
		// La modal reenvía el formulario entero. Si un admin corrigió el vehículo
		// entre el SELECT y el UPDATE, reescribir el valor viejo le pisa la
		// corrección: mejor no escribir lo que no cambió.
		expect(
			stripUnchangedFrozenFields(
				{ vehicleId: "vehicle-1", creditType: "autocompra", title: "x" },
				won,
			),
		).toEqual({ title: "x" });
	});

	test("keeps the fields that really change and everything non frozen", () => {
		expect(
			stripUnchangedFrozenFields(
				{ vehicleId: "vehicle-2", notes: "hola", probability: 90 },
				won,
			),
		).toEqual({ vehicleId: "vehicle-2", notes: "hola", probability: 90 });
	});

	test("leaves absent and undefined values alone", () => {
		expect(
			stripUnchangedFrozenFields({ vehicleId: undefined, title: "x" }, won),
		).toEqual({ vehicleId: undefined, title: "x" });
	});
});

describe("revocar la aprobación del detalle de crédito", () => {
	test("no se puede cancelar sobre una oportunidad ganada", () => {
		expect(getWonOpportunityRevokeError("won")).toContain(
			"el crédito ya existe en cartera",
		);
	});

	test("cubre el caso que el guard por etapa deja pasar", () => {
		// Una opp puede quedar ganada en el 85% si falla el paso a 90%, y ahí el
		// guard de closurePercentage >= 90 no la frena.
		expect(getWonOpportunityRevokeError("won")).not.toBeNull();
	});

	test("no estorba a las que siguen en proceso", () => {
		for (const status of ["open", "on_hold", "lost"]) {
			expect(getWonOpportunityRevokeError(status)).toBeNull();
		}
		expect(getWonOpportunityRevokeError(null)).toBeNull();
	});
});

describe("comparación de montos", () => {
	const wonConMontos = {
		vehicleId: "v-1",
		value: "143427.17",
		numeroCuotas: 48,
		tasaInteres: "18.00",
		status: "won",
	};

	test("no marca cambio cuando el formulario manda el mismo monto como número", () => {
		// El numeric de Postgres llega como string y el formulario manda número:
		// compararlos como texto bloquearía una edición que no toca el monto.
		expect(
			getWonOpportunityFrozenFieldChanges(
				{ value: 143427.17, numeroCuotas: 48, tasaInteres: "18" },
				wonConMontos,
			),
		).toEqual([]);
	});

	test("sí marca el cambio real de un término financiero", () => {
		expect(
			getWonOpportunityFrozenFieldChanges({ value: 150000 }, wonConMontos),
		).toEqual(["value"]);
		expect(
			getWonOpportunityFrozenFieldChanges({ numeroCuotas: 60 }, wonConMontos),
		).toContain("numeroCuotas");
	});
});
