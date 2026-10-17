import { call } from "@orpc/server";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { user } from "../db/schema/auth";
import { carteraBackReferences } from "../db/schema/cartera-back";
import { companies } from "../db/schema/crm";
import { partnerAccounts, partnerMembers } from "../db/schema/partners";
import { ROLES } from "../lib/roles";

type Usuario = {
	id: string;
	name: string;
	email: string;
	role: string;
	banned: boolean;
};

// Base simulada con dos socios: el contexto de uno nunca debe traer datos del otro.
const usuarios: Record<string, Usuario> = {
	"socio-A": {
		id: "socio-A",
		name: "Ana Gerente",
		email: "ana@example.com",
		role: ROLES.PARTNER,
		banned: false,
	},
	"socio-B": {
		id: "socio-B",
		name: "Beto Vendedor",
		email: "beto@example.com",
		role: ROLES.PARTNER,
		banned: false,
	},
};
const membresiasPorUsuario: Record<
	string,
	Array<{ companyId: string; sellerId: string | null }>
> = {};
const agencias = [
	{ id: "ag-1", name: "Agencia Uno" },
	{ id: "ag-2", name: "Agencia Dos" },
	{ id: "ag-3", name: "Agencia Tres" },
];
let idActual = "socio-A";

function cadena<T>(obtener: () => T[]) {
	const nodo = {
		from: () => nodo,
		innerJoin: () => nodo,
		leftJoin: () => nodo,
		where: () => nodo,
		orderBy: () => nodo,
		limit: () => nodo,
		then: (resolve: (f: T[]) => void) => resolve(obtener()),
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
				if (tabla === user) return cadena(() => [usuarios[idActual]]);
				if (tabla === partnerMembers)
					return cadena(() => membresiasPorUsuario[idActual] ?? []);
				if (tabla === partnerAccounts)
					return cadena(() => [{ passwordChangedAt: new Date("2026-01-01") }]);
				// El WHERE no se simula: devuelve todas y el handler debe quedarse
				// solo con las agencias del contexto del que llama.
				if (tabla === companies) return cadena(() => agencias);
				// carta-poder.ts arma una subconsulta al cargar el módulo (la prueba de
				// montaje importa todos los routers del handler); aquí solo debe existir.
				if (tabla === carteraBackReferences) return { as: () => ({}) };
				throw new Error("Tabla no mockeada en tracker-usuarios.test.ts");
			},
		}),
		selectDistinctOn: () => ({
			from: () => ({ orderBy: () => ({ as: () => ({}) }) }),
		}),
	},
}));

const { trackerUsuariosRouter } = await import("./tracker-usuarios");
const { trackerRouter } = await import("./tracker");
// index.ts arrastra todo el CRM; el paquete de correo exige esta variable al cargar.
process.env.RESEND_API_KEY ??= "test-key";
process.env.EMAIL_DOMAIN ??= "example.com";
const { partnerTrackerRouter } = await import("./index");
const { routersDelHandler } = await import("./handler-routers");

function ctx(id: string) {
	idActual = id;
	return {
		context: {
			partnerSession: { user: { id }, session: { id: `s-${id}` } },
			headers: { get: () => null },
		},
	} as never;
}

beforeEach(() => {
	usuarios["socio-A"].banned = false;
	usuarios["socio-B"].banned = false;
	membresiasPorUsuario["socio-A"] = [
		{ companyId: "ag-1", sellerId: null },
		{ companyId: "ag-2", sellerId: "vend-9" },
	];
	membresiasPorUsuario["socio-B"] = [{ companyId: "ag-3", sellerId: "vend-3" }];
});

describe("getMiPerfil", () => {
	test("devuelve nombre, correo y el rol correcto por agencia", async () => {
		const perfil = await call(
			trackerUsuariosRouter.getMiPerfil,
			{},
			ctx("socio-A"),
		);
		expect(perfil).toEqual({
			nombre: "Ana Gerente",
			correo: "ana@example.com",
			agencias: [
				{ id: "ag-1", nombre: "Agencia Uno", rol: "gerente" },
				{ id: "ag-2", nombre: "Agencia Dos", rol: "usuario" },
			],
		});
	});

	test("solo devuelve al que llama: el contexto de A nunca trae datos de B", async () => {
		const deA = await call(trackerUsuariosRouter.getMiPerfil, {}, ctx("socio-A"));
		const deB = await call(trackerUsuariosRouter.getMiPerfil, {}, ctx("socio-B"));
		const textoA = JSON.stringify(deA);
		expect(textoA).not.toContain("Beto");
		expect(textoA).not.toContain("beto@example.com");
		expect(textoA).not.toContain("ag-3");
		expect(deB.nombre).toBe("Beto Vendedor");
		expect(deB.agencias).toEqual([
			{ id: "ag-3", nombre: "Agencia Tres", rol: "usuario" },
		]);
		expect(JSON.stringify(deB)).not.toContain("Ana");
	});

	test("rechaza un userId en el input (input vacío estricto)", async () => {
		await expect(
			call(
				trackerUsuariosRouter.getMiPerfil,
				{ userId: "socio-B" } as never,
				ctx("socio-A"),
			),
		).rejects.toThrow();
	});

	test("un socio baneado recibe FORBIDDEN", async () => {
		usuarios["socio-A"].banned = true;
		await expect(
			call(trackerUsuariosRouter.getMiPerfil, {}, ctx("socio-A")),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	test("sin sesión de socio recibe UNAUTHORIZED", async () => {
		await expect(
			call(trackerUsuariosRouter.getMiPerfil, {}, {
				context: { headers: { get: () => null } },
			} as never),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});

	test("sin ninguna agencia activa recibe FORBIDDEN", async () => {
		membresiasPorUsuario["socio-A"] = [];
		await expect(
			call(trackerUsuariosRouter.getMiPerfil, {}, ctx("socio-A")),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});
});

describe("montaje en partnerTrackerRouter", () => {
	test("getMiPerfil está montado", () => {
		expect(partnerTrackerRouter.getMiPerfil).toBe(
			trackerUsuariosRouter.getMiPerfil,
		);
	});

	test("sin claves repetidas entre los routers que lo forman", () => {
		const delTracker = Object.keys(trackerRouter);
		const deUsuarios = Object.keys(trackerUsuariosRouter);
		const compartidas = deUsuarios.filter((k) => delTracker.includes(k));
		expect(compartidas).toEqual([]);
		// Cada clave de ambos routers llega al montaje: ninguna se pierde.
		const montadas = Object.keys(partnerTrackerRouter);
		for (const k of deUsuarios) expect(montadas).toContain(k);
	});

	test("ninguna procedure de tracker-usuarios se repite en otro router del handler", () => {
		// El handler mezcla los routers con Object.assign plano: un nombre repetido
		// lo pisa el último, en silencio. Se recorre la MISMA lista que monta el
		// servidor, así que un router nuevo queda cubierto sin tocar la prueba.
		const deUsuarios = Object.keys(trackerUsuariosRouter);
		for (const router of routersDelHandler) {
			if (router === partnerTrackerRouter) continue;
			const repetidas = Object.keys(router).filter((k) =>
				deUsuarios.includes(k),
			);
			expect(repetidas).toEqual([]);
		}
		// Y en la mezcla final cada nombre sigue apuntando a la procedure del socio.
		const mezcla = Object.assign({}, ...routersDelHandler);
		for (const k of deUsuarios) {
			expect(mezcla[k]).toBe(
				(trackerUsuariosRouter as Record<string, unknown>)[k],
			);
		}
	});

	test("la superficie de tracker-usuarios es exactamente getMiPerfil", () => {
		expect(Object.keys(trackerUsuariosRouter).sort()).toEqual(["getMiPerfil"]);
	});
});
