import { beforeEach, describe, expect, mock, test } from "bun:test";
import { opportunities } from "../db/schema/crm";
import {
	opportunityCloseQuotations,
	quotations,
} from "../db/schema/quotations";

const QUOTATION_ID = "00000000-0000-4000-8000-0000000000aa";
const OPPORTUNITY_ID = "00000000-0000-4000-8000-0000000000bb";
type Row = Record<string, unknown>;
const rows = new Map<unknown, Row[]>();
const borradas: unknown[] = [];
const bloqueadas: unknown[] = [];
const eventos: string[] = [];

function select() {
	let tabla: unknown;
	const builder = {
		from(valor: unknown) {
			tabla = valor;
			return builder;
		},
		where: () => builder,
		limit: () => builder,
		for: (modo: string) => {
			bloqueadas.push({ tabla, modo });
			eventos.push(`for ${modo}`);
			return builder;
		},
		// biome-ignore lint/suspicious/noThenProperty: los builders de Drizzle son thenables.
		then: (resolve: (valor: Row[]) => unknown) =>
			Promise.resolve(rows.get(tabla) ?? []).then(resolve),
	};
	return builder;
}

const fakeDb = {
	select,
	execute: async () => {
		eventos.push("candado");
		return [];
	},
	delete: (tabla: unknown) => ({
		where: async () => {
			borradas.push(tabla);
			eventos.push("delete");
		},
	}),
	transaction: async <T>(operacion: (tx: unknown) => Promise<T>) =>
		operacion(fakeDb),
};

mock.module("../db", () => ({ db: fakeDb }));
const { quotationsRouter } = await import("./quotations");

type Invocable = {
	"~orpc": { handler: (opciones: Record<string, unknown>) => Promise<unknown> };
};
const borrar = (userRole = "admin", userId = "admin-1") => {
	const procedure = quotationsRouter.deleteQuotation;
	return (procedure as unknown as Invocable)["~orpc"].handler({
		input: { quotationId: QUOTATION_ID },
		context: { userRole, userId },
		path: [],
		procedure,
		errors: {},
	});
};

beforeEach(() => {
	mock.module("../db", () => ({ db: fakeDb }));
	rows.clear();
	borradas.length = 0;
	bloqueadas.length = 0;
	eventos.length = 0;
	rows.set(quotations, [
		{ id: QUOTATION_ID, opportunityId: OPPORTUNITY_ID, salesUserId: "admin-1" },
	]);
	rows.set(opportunities, [{ status: "open" }]);
});

describe("deleteQuotation", () => {
	test("con la oportunidad ganada no borra y responde CONFLICT", async () => {
		rows.set(opportunities, [{ status: "won" }]);
		await expect(borrar()).rejects.toMatchObject({
			code: "CONFLICT",
			message: "No se puede eliminar una cotización de una oportunidad ganada",
		});
		expect(borradas).toHaveLength(0);
	});

	test("la cotización del cierre no se borra", async () => {
		rows.set(opportunityCloseQuotations, [{ quotationId: QUOTATION_ID }]);
		await expect(borrar()).rejects.toMatchObject({ code: "CONFLICT" });
		expect(borradas).toHaveLength(0);
	});

	test("en una oportunidad abierta se borra, con la oportunidad bloqueada mientras decide", async () => {
		expect(await borrar()).toEqual({ success: true });
		expect(borradas).toEqual([quotations]);
		expect(bloqueadas).toEqual([{ tabla: opportunities, modo: "share" }]);
	});

	test("toma el candado de la confirmación de contratos antes de decidir", async () => {
		await borrar();
		expect(eventos).toEqual(["candado", "for share", "delete"]);
	});

	test("una cotización sin oportunidad se sigue pudiendo borrar", async () => {
		rows.set(quotations, [
			{ id: QUOTATION_ID, opportunityId: null, salesUserId: "admin-1" },
		]);
		expect(await borrar()).toEqual({ success: true });
		expect(borradas).toEqual([quotations]);
		expect(eventos).not.toContain("candado");
	});

	test("un asesor no borra la cotización de otro (como antes)", async () => {
		await expect(borrar("sales", "otro-asesor")).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
		expect(borradas).toHaveLength(0);
	});
});
