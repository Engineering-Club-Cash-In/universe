import { beforeEach, describe, expect, mock, test } from "bun:test";

type DatabaseRow = Record<string, unknown>;

let queuedSelectResults: DatabaseRow[][] = [];
let insertedRows: DatabaseRow[] = [];
let updatedRows: DatabaseRow[] = [];
let fallbackSalesUser: { id: string } | null = null;
let openOpportunity: {
	id: string;
	assignedTo: string;
} | null = null;

const nextSelectResult = () => queuedSelectResults.shift() ?? [];

const selectResult = () => {
	const result = nextSelectResult();

	return Object.assign(Promise.resolve(result), {
		limit: (..._limitArgs: unknown[]) => Promise.resolve(result),
		// `orderBy` es awaitable por sí solo: hay consultas que ordenan sin acotar.
		orderBy: (..._orderByArgs: unknown[]) =>
			Object.assign(Promise.resolve(result), {
				limit: (..._limitArgs: unknown[]) => Promise.resolve(result),
			}),
	});
};

mock.module("../db", () => ({
	db: {
		select: (..._args: unknown[]) => ({
			from: (..._fromArgs: unknown[]) => ({
				where: (..._whereArgs: unknown[]) => selectResult(),
				orderBy: (..._orderByArgs: unknown[]) => ({
					limit: (..._limitArgs: unknown[]) =>
						Promise.resolve(nextSelectResult()),
				}),
			}),
		}),
		insert: (..._insertArgs: unknown[]) => ({
			values: (values: DatabaseRow) => {
				insertedRows.push(values);
				return {
					returning: (..._returningArgs: unknown[]) =>
						Promise.resolve([{ id: "unexpected-insert-id" }]),
				};
			},
		}),
		update: (..._updateArgs: unknown[]) => ({
			set: (values: DatabaseRow) => ({
				where: (..._whereArgs: unknown[]) => {
					updatedRows.push(values);
					return Promise.resolve([]);
				},
			}),
		}),
	},
}));

mock.module("@/functions/getRenapInfo", () => ({
	getRenapData: async () => ({
		success: true,
		status: 200,
		message: "ok",
		error: null,
		data: {
			dpi: "1234567890101",
			firstName: "Nuevo",
			secondName: "",
			thirdName: "",
			firstLastName: "Whatsapp",
			secondLastName: "",
			marriedLastName: "",
			picture: "",
			birthDate: "1990-01-01",
			gender: "M",
			civil_status: "S",
			nationality: "GT",
			borned_in: "GT",
			department_borned_in: "GT",
			municipality_borned_in: "GT",
			deathDate: "",
			ocupation: "",
			cedula_order: "",
			cedula_register: "",
			dpi_expiracy_date: "2030-01-01",
		},
	}),
}));

mock.module("@/lib/lead-assignment", () => ({
	findSalesUserWithLeastAutoAssignedLeads: async () => fallbackSalesUser,
	resolveNewAutoLeadAssignment: async (
		findSalesUser: () => Promise<{ id: string } | null>,
		unavailableMessage: string,
	) => {
		const salesUser = await findSalesUser();

		if (!salesUser) {
			return {
				success: false,
				message: unavailableMessage,
			};
		}

		return {
			success: true,
			assignedTo: salesUser.id,
			createdBy: salesUser.id,
			assignmentType: "auto",
		};
	},
}));

mock.module("@/lib/lead-opportunity", () => ({
	getOpenOpportunityBySource: async () => openOpportunity,
}));

mock.module("@/lib/storage", () => ({
	generateUniqueFilename: (filename: string) => filename,
	uploadFileFromUrlToR2: async () => ({
		key: "mock-key",
		size: 0,
		mimeType: "application/pdf",
	}),
}));

mock.module("../utils/cui-validation", () => ({
	cuiValido: () => true,
	normalizarDpi: (dpi: string) => dpi.replace(/\s/g, ""),
	normalizarYValidarDpi: (dpi: string) => dpi.replace(/\s/g, ""),
	validarDpi: (dpi: string) => ({
		valid: true,
		dpiLimpio: dpi.replace(/\s/g, ""),
	}),
}));

mock.module("./otp", () => ({
	otpController: {},
}));

const { getRenapInfoController } = await import("./bot");

describe("WhatsApp RENAP lead assignment", () => {
	beforeEach(() => {
		queuedSelectResults = [[], []];
		insertedRows = [];
		updatedRows = [];
		fallbackSalesUser = null;
		openOpportunity = null;
	});

	test("fails closed before creating lead or opportunity when no eligible advisor exists", async () => {
		const result = await getRenapInfoController("1234567890101", "55555555");

		expect(result).toEqual({
			success: false,
			message: "No sales user available to assign the WhatsApp lead",
		});
		expect(
			insertedRows.filter(
				(row) => row.source === "Whatsapp" && row.status === "new",
			),
		).toEqual([]);
		expect(
			insertedRows.filter(
				(row) => row.source === "Whatsapp" && "leadId" in row,
			),
		).toEqual([]);
	});

	test("reuses the existing lead instead of creating a duplicate when the DPI was stored with spaces", async () => {
		fallbackSalesUser = { id: "new-owner" };
		queuedSelectResults = [
			[],
			// El lead migrado quedó guardado como "3460 66638 0101"; la búsqueda
			// normaliza ambos lados, por eso lo encuentra.
			[
				{
					id: "existing-lead",
					dpi: "1234 56789 0101",
					assignedTo: "old-owner",
					assignmentType: "manual",
					createdBy: "creator",
					status: "migrate",
					age: 36,
				},
			],
			[],
			[{ id: "existing-magic-url" }],
			[{ id: "stage-1", order: 1 }],
		];

		const result = await getRenapInfoController("1234 56789 0101", "55555555");

		expect(result.success).toBe(true);
		// No se dio de alta otro lead: los inserts de lead llevan source pero no leadId.
		expect(
			insertedRows.filter((row) => row.source === "Whatsapp" && !row.leadId),
		).toEqual([]);
		// La oportunidad se le colgó al lead que ya existía.
		expect(insertedRows).toContainEqual(
			expect.objectContaining({ leadId: "existing-lead" }),
		);
	});

	test("keeps the current advisor when the lead already has an active opportunity", async () => {
		fallbackSalesUser = { id: "ruleta-owner" };
		queuedSelectResults = [
			[],
			[
				{
					id: "existing-lead",
					assignedTo: "old-owner",
					assignmentType: "manual",
					createdBy: "creator",
					status: "qualified",
					age: 36,
				},
			],
			// Oportunidad activa: el lead ya lo está trabajando "old-owner".
			[{ id: "active-opportunity", assignedTo: "old-owner" }],
			[{ id: "existing-magic-url" }],
			[{ id: "stage-1", order: 1 }],
		];

		const result = await getRenapInfoController("1234567890101", "55555555");

		expect(result.success).toBe(true);
		// Ni el estado ni el asesor del lead se tocan: hay un proceso en curso.
		expect(updatedRows).not.toContainEqual(
			expect.objectContaining({ status: "new" }),
		);
		expect(updatedRows).not.toContainEqual(
			expect.objectContaining({ assignedTo: "ruleta-owner" }),
		);
		// Y la oportunidad de WhatsApp queda con el asesor que ya lo atendía.
		expect(insertedRows).toContainEqual(
			expect.objectContaining({
				source: "Whatsapp",
				leadId: "existing-lead",
				assignedTo: "old-owner",
			}),
		);
	});

	test("reuses the duplicate that holds the active process, not the oldest one", async () => {
		fallbackSalesUser = { id: "ruleta-owner" };
		queuedSelectResults = [
			[],
			// Dos leads con el mismo DPI (duplicado sin depurar): el proceso en
			// curso está en el más nuevo, no en el más antiguo.
			[
				{
					id: "lead-viejo",
					assignedTo: "old-owner",
					assignmentType: "auto",
					createdBy: "creator",
					status: "migrate",
					age: 36,
				},
				{
					id: "lead-nuevo",
					assignedTo: "asesor-actual",
					assignmentType: "auto",
					createdBy: "creator-nuevo",
					status: "new",
					age: 36,
				},
			],
			[
				{
					id: "active-opportunity",
					leadId: "lead-nuevo",
					assignedTo: "asesor-actual",
				},
			],
			[{ id: "existing-magic-url" }],
			[{ id: "stage-1", order: 1 }],
		];

		const result = await getRenapInfoController("1234567890101", "55555555");

		expect(result.success).toBe(true);
		// La oportunidad nueva va al lead que sostiene el proceso, con su asesor.
		expect(insertedRows).toContainEqual(
			expect.objectContaining({
				source: "Whatsapp",
				leadId: "lead-nuevo",
				assignedTo: "asesor-actual",
			}),
		);
		// Y no se reasignó por ruleta ni se reactivó el lead viejo.
		expect(updatedRows).not.toContainEqual(
			expect.objectContaining({ assignedTo: "ruleta-owner" }),
		);
		expect(updatedRows).not.toContainEqual(
			expect.objectContaining({ status: "new" }),
		);
	});

	test("sends the lead back to the round robin when it has no active opportunity", async () => {
		fallbackSalesUser = { id: "new-owner" };
		queuedSelectResults = [
			[],
			[
				{
					id: "existing-lead",
					assignedTo: "old-owner",
					assignmentType: "manual",
					createdBy: "creator",
					status: "migrate",
					age: 36,
				},
			],
			// Sin oportunidades open/on_hold: solo tiene créditos ganados o migrados.
			[],
			[{ id: "existing-magic-url" }],
			[{ id: "stage-1", order: 1 }],
		];

		const result = await getRenapInfoController("1234567890101", "55555555");

		expect(result.success).toBe(true);
		expect(updatedRows).toContainEqual(
			expect.objectContaining({
				assignedTo: "new-owner",
				assignmentType: "auto",
				status: "new",
			}),
		);
		expect(
			insertedRows.filter((row) => row.source === "Whatsapp" && !row.leadId),
		).toEqual([]);
	});
});
