import { beforeEach, describe, expect, mock, test } from "bun:test";
import { user } from "../db/schema/auth";
import { companies } from "../db/schema/crm";
import { partnerMembers } from "../db/schema/partners";
import { vehicleVendors } from "../db/schema/vehicles";
import { ROLES } from "./roles";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
let rolDelUsuario: string | null = ROLES.PARTNER;
let agenciasQueExisten = [A, B];
let membresiasActuales: Array<Record<string, unknown>> = [];
let insertados: Array<Record<string, unknown>> = [];
let ligadosAVendedores: Array<{ userId: string; sellerId: string }> = [];
const VENDEDOR = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

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
	select: (seleccion: Record<string, unknown>) => ({
		from: (tabla: unknown) => {
			if (tabla === vehicleVendors)
				return nodo(() => [
					{ id: VENDEDOR, vendorType: "agencia", companyId: A },
				]);
			if (tabla === partnerMembers && "sellerId" in seleccion)
				return nodo(() => ligadosAVendedores);
			if (tabla === user)
				return nodo(() => (rolDelUsuario ? [{ role: rolDelUsuario }] : []));
			if (tabla === companies)
				return nodo(() => agenciasQueExisten.map((id) => ({ id })));
			if (tabla === partnerMembers) return nodo(() => membresiasActuales);
			return nodo(() => []);
		},
	}),
	delete: () => ({ where: async () => { membresiasActuales = []; } }),
	insert: () => ({
		values: async (v: Array<Record<string, unknown>>) => { insertados = v; },
	}),
};

mock.module("../db", () => ({
	db: { transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) },
}));

const { asignarAgencias, reemplazarAgencias } = await import("./socios");

beforeEach(() => {
	rolDelUsuario = ROLES.PARTNER;
	agenciasQueExisten = [A, B];
	membresiasActuales = [];
	insertados = [];
	ligadosAVendedores = [];
});

describe("asignarAgencias", () => {
	test("deja al socio con las agencias pedidas", async () => {
		agenciasQueExisten = [A];
		await asignarAgencias("socio-1", [{ companyId: A, sellerId: null }]);
		expect(insertados).toHaveLength(1);
		expect(insertados[0]?.companyId).toBe(A);
	});

	test("usuario inexistente da NOT_FOUND", async () => {
		rolDelUsuario = null;
		await expect(
			asignarAgencias("x", [{ companyId: A, sellerId: null }]),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(insertados).toHaveLength(0);
	});

	test("un usuario que no es socio no recibe agencias", async () => {
		rolDelUsuario = ROLES.ADMIN;
		agenciasQueExisten = [A];
		await expect(
			asignarAgencias("x", [{ companyId: A, sellerId: null }]),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(insertados).toHaveLength(0);
	});

	test("una agencia que ya no existe da BAD_REQUEST", async () => {
		agenciasQueExisten = [A];
		await expect(
			asignarAgencias("x", [
				{ companyId: A, sellerId: null },
				{ companyId: B, sellerId: null },
			]),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(insertados).toHaveLength(0);
	});

	test("repetir la misma agencia con y sin vendedor da BAD_REQUEST", async () => {
		agenciasQueExisten = [A];
		await expect(
			asignarAgencias("x", [
				{ companyId: A, sellerId: null },
				{ companyId: A, sellerId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
			]),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});
});

describe("exclusividad del vendedor", () => {
	test("un vendedor ligado a otro usuario da CONFLICT y no borra ni inserta", async () => {
		agenciasQueExisten = [A];
		ligadosAVendedores = [{ userId: "otro", sellerId: VENDEDOR }];
		await expect(
			asignarAgencias("socio-1", [{ companyId: A, sellerId: VENDEDOR }]),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message: "Ese vendedor ya está ligado a otra cuenta",
		});
		expect(insertados).toHaveLength(0);
	});

	test("reasignarle al mismo usuario su propio vendedor pasa", async () => {
		agenciasQueExisten = [A];
		ligadosAVendedores = [{ userId: "socio-1", sellerId: VENDEDOR }];
		await asignarAgencias("socio-1", [{ companyId: A, sellerId: VENDEDOR }]);
		expect(insertados[0]).toMatchObject({ companyId: A, sellerId: VENDEDOR });
	});
});

describe("reemplazarAgencias", () => {
	test("conserva la desactivación de la agencia que se mantiene", async () => {
		const fecha = new Date("2026-10-01T12:00:00Z");
		membresiasActuales = [
			{ companyId: A, desactivadoAt: fecha, desactivadoPor: "g-9" },
		];
		await reemplazarAgencias(tx as never, "socio-1", [
			{ companyId: A, sellerId: null },
			{ companyId: B, sellerId: null },
		]);
		expect(insertados.find((i) => i.companyId === A)?.desactivadoAt).toEqual(fecha);
		expect(insertados.find((i) => i.companyId === B)?.desactivadoAt).toBeNull();
	});
});
