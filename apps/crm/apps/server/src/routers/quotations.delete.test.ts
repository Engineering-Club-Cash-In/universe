import { beforeEach, describe, expect, mock, test } from "bun:test";
import { opportunities } from "../db/schema/crm";
import {
	opportunityCloseQuotations,
	quotations,
} from "../db/schema/quotations";

const quotationId = "00000000-0000-4000-8000-000000000010";
type Row = Record<string, unknown>;
const rows = new Map<unknown, Row[]>();
const eventos: string[] = [];

function select() {
	let table: unknown;
	const builder = {
		from(value: unknown) {
			table = value;
			return builder;
		},
		leftJoin: () => builder,
		where: () => builder,
		limit: () => builder,
		for(modo: string) {
			eventos.push(`${modo}:${table === quotations ? "quotations" : "otra"}`);
			return builder;
		},
		// biome-ignore lint/suspicious/noThenProperty: Drizzle builders are thenable.
		then: (resolve: (value: Row[]) => unknown) =>
			Promise.resolve(rows.get(table) ?? []).then(resolve),
	};
	return builder;
}

const fakeDb = {
	select,
	delete: (table: unknown) => ({
		where: async () => {
			eventos.push(`delete:${table === quotations ? "quotations" : "otra"}`);
			return [];
		},
	}),
	transaction: async <T>(operation: (tx: unknown) => Promise<T>) =>
		operation(fakeDb),
};

mock.module("../db", () => ({ db: fakeDb }));
const { quotationsRouter } = await import("./quotations");

type Invocable = {
	"~orpc": { handler: (options: Record<string, unknown>) => Promise<unknown> };
};
const borrar = () => {
	const procedure = quotationsRouter.deleteQuotation;
	return (procedure as unknown as Invocable)["~orpc"].handler({
		input: { quotationId },
		context: { userRole: "admin", userId: "admin-1" },
		path: [],
		procedure,
		errors: {},
	});
};

beforeEach(() => {
	mock.module("../db", () => ({ db: fakeDb }));
	rows.clear();
	eventos.length = 0;
	rows.set(quotations, [
		{
			id: quotationId,
			salesUserId: "admin-1",
			opportunityId: "opp-1",
			createdAt: new Date("2026-08-01"),
		},
	]);
});

describe("deleteQuotation y la cotización del cierre", () => {
	test("una cotización que no cerró un crédito se borra, con la fila bloqueada antes", async () => {
		await expect(borrar()).resolves.toEqual({ success: true });
		expect(eventos).toEqual(["update:quotations", "delete:quotations"]);
	});

	test("la cotización con la que se cerró el crédito no se borra", async () => {
		rows.set(opportunityCloseQuotations, [{ opportunityId: "opp-1" }]);
		await expect(borrar()).rejects.toMatchObject({ code: "CONFLICT" });
		expect(eventos).toEqual(["update:quotations"]);
	});

	test("un cierre anterior al registro: no se borran las cotizaciones que existían al cerrar", async () => {
		rows.set(opportunities, [{ cerradaAt: new Date("2026-09-01") }]);
		await expect(borrar()).rejects.toMatchObject({ code: "CONFLICT" });
		expect(eventos).toEqual(["update:quotations"]);
	});

	test("en ese mismo cierre, una cotización creada después sí se borra", async () => {
		rows.set(opportunities, [{ cerradaAt: new Date("2026-07-01") }]);
		await expect(borrar()).resolves.toEqual({ success: true });
	});
});
