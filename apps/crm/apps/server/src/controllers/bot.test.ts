import { beforeEach, describe, expect, mock, test } from "bun:test";

type DatabaseRow = Record<string, unknown>;

let queuedSelectResults: DatabaseRow[][] = [];
let insertedRows: DatabaseRow[] = [];
let updatedRows: DatabaseRow[] = [];
let currentOwnerEligible = false;
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
	findSalesUserWithLeastAutoAssignedLeads: async () => null,
	resolveExistingLeadAssigneeFromDatabase: async (currentOwnerId: string) =>
		currentOwnerEligible ? currentOwnerId : fallbackSalesUser?.id,
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
	validarDpi: () => ({ valid: true }),
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
		currentOwnerEligible = false;
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

	test("reassigns a reused opportunity with its reactivated lead", async () => {
		currentOwnerEligible = false;
		fallbackSalesUser = { id: "new-owner" };
		openOpportunity = {
			id: "existing-opportunity",
			assignedTo: "old-owner",
		};
		queuedSelectResults = [
			[],
			[
				{
					id: "existing-lead",
					assignedTo: "old-owner",
					assignmentType: "manual",
					createdBy: "creator",
					age: 36,
				},
			],
			[{ id: "existing-magic-url" }],
		];

		const result = await getRenapInfoController("1234567890101", "55555555");

		expect(result.success).toBe(true);
		expect(updatedRows).toContainEqual(
			expect.objectContaining({
				assignedTo: "new-owner",
				assignmentType: "auto",
			}),
		);
		expect(updatedRows).toContainEqual({
			assignedTo: "new-owner",
			updatedAt: expect.any(Date),
		});
		expect(
			insertedRows.filter(
				(row) => row.source === "Whatsapp" && "leadId" in row,
			),
		).toEqual([]);
	});
});
