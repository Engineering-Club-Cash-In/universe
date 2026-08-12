import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

type DatabaseRow = Record<string, unknown>;

const dialect = new PgDialect();
// El mock no filtra por el `where`, solo devuelve lo encolado, así que las
// condiciones se guardan para poder afirmar sobre el SQL que se construyó.
let capturedWhere: SQL[] = [];

const captureWhere = (args: unknown[]) => {
	const [condition] = args;
	if (condition) {
		capturedWhere.push(condition as SQL);
	}
};

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
				where: (...whereArgs: unknown[]) => {
					captureWhere(whereArgs);
					return selectResult();
				},
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

const { getRenapInfoController, updateLeadAndCreateOpportunity } = await import(
	"./bot"
);

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

describe("WhatsApp follow-up step", () => {
	beforeEach(() => {
		queuedSelectResults = [[], []];
		insertedRows = [];
		updatedRows = [];
		fallbackSalesUser = null;
		openOpportunity = null;
	});

	// El paso de RENAP dejó de resetear el estado del lead cuando hay un proceso
	// en curso, así que este handler ya no puede exigir `status = 'new'`: si lo
	// hiciera, los ingresos y documentos del cliente se perderían en silencio.
	test("saves the data for an active lead that is no longer in the new status", async () => {
		capturedWhere = [];
		queuedSelectResults = [
			[
				{
					id: "lead-activo",
					dpi: "1234567890101",
					assignedTo: "asesor-actual",
					createdBy: "creator",
					status: "qualified",
				},
			],
			[
				{
					id: "active-opportunity",
					leadId: "lead-activo",
					assignedTo: "asesor-actual",
				},
			],
			[{ id: "existing-magic-url" }],
		];

		const result = await updateLeadAndCreateOpportunity("1234567890101", {
			monthlyIncome: "5000",
		});

		// La búsqueda del lead no debe acotarse por estado.
		expect(dialect.sqlToQuery(capturedWhere[0]).sql).not.toContain(
			'"leads"."status"',
		);
		expect(result.success).not.toBe(false);
		expect(updatedRows).toContainEqual(
			expect.objectContaining({ monthlyIncome: "5000" }),
		);
	});

	// Los documentos se adjuntan sobre el lead que ya se eligió. Si el helper
	// vuelve a resolver el DPI por su cuenta puede caer en otro duplicado y
	// dejarlos colgados del proceso equivocado.
	test("attaches the documents to the already selected lead without looking the DPI up again", async () => {
		capturedWhere = [];
		queuedSelectResults = [
			// Dos leads con el mismo DPI; el proceso activo está en el más nuevo.
			[
				{
					id: "lead-viejo",
					dpi: "1234567890101",
					assignedTo: "otro-asesor",
					createdBy: "creator",
					status: "migrate",
				},
				{
					id: "lead-activo",
					dpi: "1234567890101",
					assignedTo: "asesor-actual",
					createdBy: "creator",
					status: "qualified",
				},
			],
			[
				{
					id: "active-opportunity",
					leadId: "lead-activo",
					assignedTo: "asesor-actual",
				},
			],
			// Oportunidades abiertas del lead elegido.
			[{ id: "opp-del-lead-activo" }],
			// Sin documento previo de ese tipo.
			[],
			[{ id: "existing-magic-url" }],
		];

		await updateLeadAndCreateOpportunity("1234567890101", {
			electricityBill: "https://archivos/recibo.pdf",
		});

		// Una sola resolución por DPI en todo el flujo.
		const busquedasPorDpi = capturedWhere.filter((condition) =>
			dialect.sqlToQuery(condition).sql.includes('"leads"."dpi"'),
		);
		expect(busquedasPorDpi).toHaveLength(1);

		// Y el documento quedó en la oportunidad del lead con proceso activo.
		expect(insertedRows).toContainEqual(
			expect.objectContaining({
				opportunityId: "opp-del-lead-activo",
				documentType: "recibo_luz",
			}),
		);
	});

	// El lead se elige por tener un proceso activo, y `on_hold` cuenta como tal.
	// Si los documentos se buscaran solo entre las `open`, habría leads elegidos
	// a los que nunca se les podría adjuntar nada.
	test("uses the same active-status predicate to pick the lead and to place the documents", async () => {
		capturedWhere = [];
		queuedSelectResults = [
			[
				{
					id: "lead-activo",
					dpi: "1234567890101",
					assignedTo: "asesor-actual",
					createdBy: "creator",
					status: "qualified",
				},
			],
			[
				{
					id: "on-hold-opportunity",
					leadId: "lead-activo",
					assignedTo: "asesor-actual",
				},
			],
			[{ id: "opp-en-espera" }],
			[],
			[{ id: "existing-magic-url" }],
		];

		await updateLeadAndCreateOpportunity("1234567890101", {
			electricityBill: "https://archivos/recibo.pdf",
		});

		const filtrosPorEstado = capturedWhere
			.map((condition) => dialect.sqlToQuery(condition))
			.filter((query) => query.sql.includes('"opportunities"."status"'));

		// Uno al elegir el lead y otro al buscar dónde dejar los documentos.
		expect(filtrosPorEstado.length).toBeGreaterThanOrEqual(2);
		for (const query of filtrosPorEstado) {
			expect(query.params).toContain("open");
			expect(query.params).toContain("on_hold");
		}
	});
});
