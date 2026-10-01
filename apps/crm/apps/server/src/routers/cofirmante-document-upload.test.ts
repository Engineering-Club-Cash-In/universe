import { beforeEach, describe, expect, mock, test } from "bun:test";
import { opportunities } from "../db/schema/crm";
import { analysisChecklists, opportunityDocuments } from "../db/schema/documents";

const opportunityId = "00000000-0000-4000-8000-000000000001";
type Row = Record<string, unknown>;
const rows = new Map<unknown, Row[]>();
const writes: { table: unknown; values: Row }[] = [];
const deletedKeys: string[] = [];
const updates: unknown[] = [];
let verifiedKeys: string[] = [];

function select() {
	let table: unknown;
	const builder = {
		from(value: unknown) {
			table = value;
			return builder;
		},
		where: () => builder,
		limit: () => builder,
		// biome-ignore lint/suspicious/noThenProperty: Drizzle builders are thenable.
		then: (resolve: (value: Row[]) => unknown) =>
			Promise.resolve(rows.get(table) ?? []).then(resolve),
	};
	return builder;
}

const fakeDb = {
	select,
	update: (table: unknown) => ({
		set: () => ({
			where: async () => {
				updates.push(table);
				return [];
			},
		}),
	}),
	insert: (table: unknown) => ({
		values: (values: Row) => ({
			returning: async () => {
				writes.push({ table, values });
				const row = { id: `document-${writes.length}`, ...values };
				rows.set(table, [...(rows.get(table) ?? []), row]);
				return [row];
			},
		}),
	}),
	execute: async () => [],
	transaction: async <T>(operation: (tx: unknown) => Promise<T>) =>
		operation(fakeDb),
};

const storage = await import("../lib/storage");
const installMocks = () => {
	mock.module("../db", () => ({ db: fakeDb }));
	mock.module("../lib/storage", () => ({
		...storage,
		verifyUploadedDocumentInR2: async (input: {
			key: string;
			expectedPrefix: string;
		}) => {
			storage.assertUploadKeyMatchesPrefix(input.key, input.expectedPrefix);
			verifiedKeys.push(input.key);
			return { key: input.key, mimeType: "application/pdf", size: 100 };
		},
		deleteFileFromR2: async (key: string) => {
			deletedKeys.push(key);
		},
	}));
};
installMocks();
const { crmRouter } = await import("./crm");

type Invocable = {
	"~orpc": { handler: (options: Record<string, unknown>) => Promise<unknown> };
};
const upload = (
	documentType: string,
	userRole = "sales",
	userId = "advisor-1",
	key = `${storage.buildUploadPrefix("opportunity_document", opportunityId)}/cofirmante.pdf`,
) => {
	const procedure = crmRouter.uploadOpportunityDocument;
	return (procedure as unknown as Invocable)["~orpc"].handler({
		input: {
			opportunityId,
			documentType,
			description: "Estados de cuenta del cofirmante",
			file: { key, name: "cofirmante.pdf", type: "application/pdf", size: 100 },
		},
		context: { userRole, userId },
		path: [],
		procedure,
		errors: {},
	});
};

beforeEach(() => {
	installMocks();
	rows.clear();
	writes.length = 0;
	deletedKeys.length = 0;
	updates.length = 0;
	verifiedKeys = [];
	rows.set(opportunities, [
		{
			id: opportunityId,
			assignedTo: "advisor-1",
			vehicleId: null,
			analysisStatus: "approved",
		},
	]);
	rows.set(analysisChecklists, [{ checklistData: { sections: { documentos: { items: [1, 2, 3].map((month) => ({ documentType: `estados_cuenta_${month}`, required: true, uploaded: true, documentId: `titular-${month}` })), completed: true }, verificaciones: { items: [], completed: true } }, overallProgress: 100, canApprove: true } }]);
	rows.set(
		opportunityDocuments,
		[1, 2, 3].map((month) => ({
			id: `titular-${month}`,
			opportunityId,
			documentType: `estados_cuenta_${month}`,
			description: "Cobertura titular",
			filePath: `titular-${month}.pdf`,
		})),
	);
});

describe("API existente para evidencia manual del cofirmante", () => {
	for (const role of ["admin", "analyst", "sales_supervisor"]) {
		test(`permite rol autorizado ${role}`, async () => {
			await upload("other", role);
			expect(writes).toHaveLength(1);
		});
	}

	test("rechaza oportunidad inexistente antes de tocar R2", async () => {
		rows.set(opportunities, []);
		await expect(upload("other")).rejects.toThrow("Oportunidad no encontrada");
		expect(writes).toEqual([]);
		expect(verifiedKeys).toEqual([]);
	});

	test("permite múltiples adjuntos other con slots titular ocupados sin escribir su análisis", async () => {
		const checklistBefore = structuredClone(rows.get(analysisChecklists));
		await upload("other");
		await upload("other");
		expect(rows.get(analysisChecklists)).toEqual(checklistBefore);
		expect(
			writes.map(({ table, values }) => ({
				isDocument: table === opportunityDocuments,
				type: values.documentType,
				opportunityId: values.opportunityId,
				actor: values.uploadedBy,
			})),
		).toEqual([
			{ isDocument: true, type: "other", opportunityId, actor: "advisor-1" },
			{ isDocument: true, type: "other", opportunityId, actor: "advisor-1" },
		]);
		expect(
			rows
				.get(opportunityDocuments)
				?.slice(0, 3)
				.map((row) => row.id),
		).toEqual(["titular-1", "titular-2", "titular-3"]);
		expect(rows.get(opportunities)?.[0].analysisStatus).toBe("approved");
		expect(deletedKeys).toEqual([]);
		expect(updates).toEqual([]);
	});

	for (const type of [
		"estados_cuenta_1",
		"estados_cuenta_2",
		"estados_cuenta_3",
	]) {
		test(`mantiene conflicto de ${type} del titular`, async () => {
			await expect(upload(type)).rejects.toThrow("ya está ocupado");
			expect(writes).toEqual([]);
			expect(deletedKeys).toEqual(verifiedKeys);
		});
	}

	test("rechaza asesor de otra oportunidad antes de verificar R2 o insertar", async () => {
		await expect(upload("other", "sales", "another-advisor")).rejects.toThrow(
			"No tienes permiso",
		);
		expect(writes).toEqual([]);
		expect(verifiedKeys).toEqual([]);
	});

	for (const role of ["juridico", "contabilidad", "cobros"]) {
		test(`rechaza rol ${role}`, async () => {
			await expect(upload("other", role)).rejects.toThrow("No tienes permiso");
			expect(writes).toEqual([]);
			expect(verifiedKeys).toEqual([]);
		});
	}

	test("rechaza clave R2 de otra oportunidad", async () => {
		const key = `${storage.buildUploadPrefix("opportunity_document", "another-opportunity")}/cofirmante.pdf`;
		await expect(upload("other", "sales", "advisor-1", key)).rejects.toThrow();
		expect(writes).toEqual([]);
		expect(verifiedKeys).toEqual([]);
	});
});
