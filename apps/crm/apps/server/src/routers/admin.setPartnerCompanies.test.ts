import { call } from "@orpc/server";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { user } from "../db/schema/auth";
import { companies } from "../db/schema/crm";
import { partnerMembers } from "../db/schema/partners";
import { ROLES } from "../lib/roles";

type Existente = {
	companyId: string;
	desactivadoAt: Date | null;
	desactivadoPor: string | null;
};

let membresiasActuales: Existente[] = [];
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
let agenciasQueExisten = [A, B];
let insertados: Array<Record<string, unknown>> = [];

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
			if (tabla === user) return nodo(() => [{ role: ROLES.PARTNER }]);
			if (tabla === companies)
				return nodo(() => agenciasQueExisten.map((id) => ({ id })));
			if (tabla === partnerMembers) return nodo(() => membresiasActuales);
			return nodo(() => []);
		},
	}),
	delete: () => ({
		where: async () => {
			membresiasActuales = [];
		},
	}),
	insert: () => ({
		values: async (valores: Array<Record<string, unknown>>) => {
			insertados = valores;
		},
	}),
};

mock.module("../db", () => ({
	db: {
		// requireAdmin lee el rol del usuario con db.select(); setPartnerCompanies
		// escribe dentro de db.transaction().
		select: () => ({
			from: () => nodo(() => [{ id: "admin-1", role: ROLES.ADMIN }]),
		}),
		transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
	},
}));

const { adminRouter } = await import("./admin");

const contextoAdmin = {
	context: { session: { user: { id: "admin-1" } }, headers: new Headers() },
} as never;

const FECHA_DESACTIVADO = new Date("2026-10-01T12:00:00Z");

beforeEach(() => {
	agenciasQueExisten = [A, B];
	membresiasActuales = [];
	insertados = [];
});

describe("setPartnerCompanies conserva la desactivación por agencia", () => {
	test("la membresía que se mantiene sigue desactivada, con quién y cuándo", async () => {
		membresiasActuales = [
			{ companyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", desactivadoAt: FECHA_DESACTIVADO, desactivadoPor: "gerente-9" },
			{ companyId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", desactivadoAt: null, desactivadoPor: null },
		];

		await call(
			adminRouter.setPartnerCompanies,
			{
				userId: "socio-1",
				memberships: [
					{ companyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", sellerId: null },
					{ companyId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", sellerId: null },
				],
			},
			contextoAdmin,
		);

		const A = insertados.find((i) => i.companyId === "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
		const B = insertados.find((i) => i.companyId === "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
		expect(A?.desactivadoAt).toEqual(FECHA_DESACTIVADO);
		expect(A?.desactivadoPor).toBe("gerente-9");
		expect(B?.desactivadoAt ?? null).toBeNull();
		expect(B?.desactivadoPor ?? null).toBeNull();
	});

	test("una agencia nueva entra activa y la que se quita no reaparece", async () => {
		agenciasQueExisten = [B];
		membresiasActuales = [
			{ companyId: A, desactivadoAt: FECHA_DESACTIVADO, desactivadoPor: "gerente-9" },
		];

		await call(
			adminRouter.setPartnerCompanies,
			{ userId: "socio-1", memberships: [{ companyId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", sellerId: null }] },
			contextoAdmin,
		);

		expect(insertados).toHaveLength(1);
		expect(insertados[0]?.companyId).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
		expect(insertados[0]?.desactivadoAt ?? null).toBeNull();
	});
});
