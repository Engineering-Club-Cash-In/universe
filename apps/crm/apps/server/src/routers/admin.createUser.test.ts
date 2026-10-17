import { call } from "@orpc/server";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { companies } from "../db/schema/crm";
import { ROLES } from "../lib/roles";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const llamadas: Array<Record<string, unknown>> = [];
let insertadas: Array<Record<string, unknown>> = [];

function nodo<T>(filas: () => T[]) {
	const n = {
		from: () => n,
		where: () => n,
		for: () => n,
		limit: () => n,
		then: (resolve: (f: T[]) => void) => resolve(filas()),
	};
	return n;
}

const tx = {
	select: () => ({
		from: (tabla: unknown) => {
			if (tabla === companies) return nodo(() => [{ id: A }]);
			return nodo(() => [{ role: ROLES.PARTNER }]);
		},
	}),
	delete: () => ({ where: async () => {} }),
	insert: () => ({
		values: async (v: Array<Record<string, unknown>>) => {
			insertadas = v;
		},
	}),
};

mock.module("../db", () => ({
	db: {
		select: () => ({
			from: () => nodo(() => [{ id: "admin-1", role: ROLES.ADMIN }]),
		}),
		transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
		delete: () => ({ where: async () => {} }),
	},
}));

mock.module("../lib/auth", () => ({
	auth: {
		api: {
			createUser: async (args: { body: Record<string, unknown> }) => {
				llamadas.push(args.body);
				return {
					user: { id: "u-1", name: args.body.name, email: args.body.email },
				};
			},
		},
	},
}));

const { adminRouter } = await import("./admin");

const contextoAdmin = {
	context: { session: { user: { id: "admin-1" } }, headers: new Headers() },
} as never;

beforeEach(() => {
	llamadas.length = 0;
	insertadas = [];
});

describe("admin.createUser (comportamiento que no cambia)", () => {
	test("un socio con correo @clubcashin.com sigue permitido para el admin", async () => {
		await call(
			adminRouter.createUser,
			{
				name: "Socio",
				email: "socio@clubcashin.com",
				password: "12345678",
				role: ROLES.PARTNER,
				memberships: [{ companyId: A, sellerId: null }],
			},
			contextoAdmin,
		);
		expect(llamadas[0]).toMatchObject({ role: ROLES.PARTNER });
		expect(insertadas[0]).toMatchObject({ userId: "u-1", companyId: A });
	});

	test("un socio sin agencias sigue rechazado", async () => {
		await expect(
			call(
				adminRouter.createUser,
				{ name: "S", email: "s@x.com", password: "12345678", role: ROLES.PARTNER },
				contextoAdmin,
			),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(llamadas).toHaveLength(0);
	});

	test("un interno con correo ajeno sigue rechazado", async () => {
		await expect(
			call(
				adminRouter.createUser,
				{ name: "I", email: "i@x.com", password: "12345678", role: ROLES.SALES },
				contextoAdmin,
			),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(llamadas).toHaveLength(0);
	});

	test("un interno @clubcashin.com se crea directo", async () => {
		await call(
			adminRouter.createUser,
			{ name: "I", email: "i@clubcashin.com", password: "12345678", role: ROLES.SALES },
			contextoAdmin,
		);
		expect(llamadas[0]).toMatchObject({ role: ROLES.SALES });
		expect(insertadas).toHaveLength(0);
	});
});
