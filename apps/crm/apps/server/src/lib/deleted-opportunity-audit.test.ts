import { describe, expect, test } from "bun:test";
import { buildDeletedOpportunitySnapshot } from "./deleted-opportunity-audit";

describe("buildDeletedOpportunitySnapshot", () => {
	test("keeps the essential opportunity, customer, vehicle and related record context", () => {
		const createdAt = new Date("2026-05-18T12:00:00.000Z");
		const updatedAt = new Date("2026-05-18T13:00:00.000Z");

		expect(
			buildDeletedOpportunitySnapshot({
				opportunity: {
					id: "opp-1",
					title: "Crédito vehículo",
					value: "100000.00",
					status: "open",
					creditType: "autocompra",
					source: "facebook",
					campaign: "mayo",
					loanPurpose: "personal",
					probability: 10,
					expectedCloseDate: null,
					actualCloseDate: null,
					notes: "Cliente interesado",
					numeroCuotas: 48,
					tasaInteres: "18.00",
					cuotaMensual: "3000.00",
					fechaInicio: null,
					diaPagoMensual: 15,
					numeroSifco: "12345",
					nit: "1234567-8",
					createdAt,
					updatedAt,
					createdBy: "creator-1",
				},
				stage: { id: "stage-1", name: "Prospecto", closurePercentage: 10 },
				lead: {
					id: "lead-1",
					firstName: "Ana",
					lastName: "Pérez",
					email: "ana@example.com",
					phone: "5555",
				},
				company: { id: "company-1", name: "Empresa, S.A." },
				vehicle: {
					id: "vehicle-1",
					make: "Toyota",
					model: "Hilux",
					year: 2022,
					licensePlate: "P123ABC",
				},
				assignedUser: {
					id: "sales-1",
					name: "Luis",
					email: "luis@example.com",
				},
				client: {
					id: "client-1",
					contactPerson: "Ana Pérez",
					status: "active",
				},
				relatedCounts: {
					documents: 2,
					coDebtors: 1,
					forms: 1,
					stageHistory: 3,
				},
			}),
		).toMatchObject({
			opportunity: {
				id: "opp-1",
				title: "Crédito vehículo",
				creditTerms: {
					numeroCuotas: 48,
					tasaInteres: "18.00",
					cuotaMensual: "3000.00",
					diaPagoMensual: 15,
				},
			},
			stage: { name: "Prospecto", closurePercentage: 10 },
			lead: { id: "lead-1", fullName: "Ana Pérez" },
			company: { id: "company-1", name: "Empresa, S.A." },
			vehicle: { id: "vehicle-1", licensePlate: "P123ABC" },
			client: { id: "client-1", status: "active" },
			relatedCounts: { documents: 2, coDebtors: 1, forms: 1, stageHistory: 3 },
		});
	});
});
