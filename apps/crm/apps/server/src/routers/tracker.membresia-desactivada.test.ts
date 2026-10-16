import { call } from "@orpc/server";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { user } from "../db/schema/auth";
import { companies, opportunities } from "../db/schema/crm";
import { partnerAccounts, partnerMembers } from "../db/schema/partners";
import { ROLES } from "../lib/roles";

type Membresia = {
	companyId: string;
	sellerId: string | null;
	desactivadoAt: Date | null;
};

let membresiasEnBase: Membresia[] = [];
let filasOportunidad: Array<Record<string, unknown>> = [];
// Último WHERE (ya renderizado a SQL) que recibió cada tabla.
const dondeDe: { oportunidades: { sql: string; params: unknown[] } | null } = {
	oportunidades: null,
};

const dialecto = new PgDialect();
function renderizar(condicion: unknown) {
	const { sql, params } = dialecto.sqlToQuery(condicion as never);
	return { sql, params };
}

// La base de verdad: si el WHERE de la membresía no pide `desactivado_at IS
// NULL`, la "base" devuelve también las inactivas, como haría Postgres.
function nodoMembresias() {
	let filas = membresiasEnBase;
	const nodo = {
		from: () => nodo,
		where: (condicion: unknown) => {
			const { sql } = renderizar(condicion);
			if (sql.includes('"desactivado_at" is null')) {
				filas = membresiasEnBase.filter((m) => m.desactivadoAt === null);
			}
			return nodo;
		},
		then: (resolve: (f: Membresia[]) => void) => resolve(filas),
	};
	return nodo;
}

function nodoOportunidades() {
	const nodo = {
		from: () => nodo,
		innerJoin: () => nodo,
		leftJoin: () => nodo,
		where: (condicion: unknown) => {
			dondeDe.oportunidades = renderizar(condicion);
			return nodo;
		},
		orderBy: () => nodo,
		limit: () => nodo,
		then: (resolve: (f: unknown[]) => void) => resolve(filasOportunidad),
	};
	return nodo;
}

function nodoFijo<T>(filas: () => T[]) {
	const nodo = {
		from: () => nodo,
		innerJoin: () => nodo,
		leftJoin: () => nodo,
		where: () => nodo,
		orderBy: () => nodo,
		limit: () => nodo,
		then: (resolve: (f: T[]) => void) => resolve(filas()),
	};
	return nodo;
}

mock.module("../lib/partner-auth", () => ({
	PARTNER_AUTH_BASE_PATH: "/api/partner-auth",
	PARTNER_CHANGE_PASSWORD_PATH: "/api/partner-auth/change-password",
	partnerAuth: { api: { changePassword: async () => ({}) } },
}));

mock.module("../db", () => ({
	db: {
		select: () => ({
			from: (tabla: unknown) => {
				if (tabla === user)
					return nodoFijo(() => [
						{ id: "socio-1", email: "s@example.com", role: ROLES.PARTNER, banned: false },
					]);
				if (tabla === partnerMembers) return nodoMembresias();
				if (tabla === partnerAccounts)
					return nodoFijo(() => [{ passwordChangedAt: new Date("2026-01-01") }]);
				if (tabla === opportunities) return nodoOportunidades();
				if (tabla === companies) return nodoFijo(() => []);
				return nodoFijo(() => []);
			},
		}),
		selectDistinctOn: () => ({
			from: () => ({ orderBy: () => ({ as: () => ({}) }) }),
		}),
	},
}));

const { trackerRouter } = await import("./tracker");

const contexto = {
	context: {
		partnerSession: { user: { id: "socio-1" }, session: { id: "sesion-1" } },
		headers: { get: () => null },
	},
} as never;

const ID_CASO = "11111111-1111-4111-8111-111111111111";

function caso(companyId: string) {
	return {
		id: "caso-1",
		status: "open",
		createdAt: new Date("2026-01-01"),
		updatedAt: new Date("2026-02-01"),
		closurePercentage: 50,
		agenciaNombre: "Agencia",
		leadFirstName: "Juan",
		leadLastName: "Pérez",
		companyId,
		sellerId: null,
	};
}

const ACTIVA_B: Membresia = { companyId: "agencia-B", sellerId: null, desactivadoAt: null };
const INACTIVA_A: Membresia = {
	companyId: "agencia-A",
	sellerId: null,
	desactivadoAt: new Date("2026-10-01"),
};

beforeEach(() => {
	membresiasEnBase = [];
	filasOportunidad = [];
	dondeDe.oportunidades = null;
});

describe("membresía desactivada: el alcance del tracker la ignora", () => {
	test("getCasoById de una agencia desactivada da FORBIDDEN aunque el socio siga activo en otra", async () => {
		membresiasEnBase = [INACTIVA_A, ACTIVA_B];
		filasOportunidad = [caso("agencia-A")];

		await expect(
			call(trackerRouter.getCasoById, { id: ID_CASO }, contexto),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
			message: "Este caso no pertenece a tu agencia",
		});
	});

	test("getCasoById de la agencia que sigue activa funciona", async () => {
		membresiasEnBase = [INACTIVA_A, ACTIVA_B];
		filasOportunidad = [caso("agencia-B")];

		const resultado = await call(trackerRouter.getCasoById, { id: ID_CASO }, contexto);

		expect(resultado.id).toBe("caso-1");
	});

	test("getCasos no pide casos de la agencia desactivada", async () => {
		membresiasEnBase = [INACTIVA_A, ACTIVA_B];

		await call(trackerRouter.getCasos, {}, contexto);

		const donde = dondeDe.oportunidades;
		expect(donde).not.toBeNull();
		expect(donde?.params).toContain("agencia-B");
		expect(donde?.params).not.toContain("agencia-A");
	});

	test("si todas las membresías están desactivadas, partnerProcedure da FORBIDDEN con el mensaje de siempre", async () => {
		membresiasEnBase = [INACTIVA_A];

		await expect(call(trackerRouter.getCasos, {}, contexto)).rejects.toMatchObject({
			code: "FORBIDDEN",
			message: "El usuario no tiene ninguna agencia asignada",
		});
		await expect(
			call(trackerRouter.getCasoById, { id: ID_CASO }, contexto),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});
});
