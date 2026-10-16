import { call } from "@orpc/server";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { user } from "../db/schema/auth";
import { partnerAccounts, partnerMembers } from "../db/schema/partners";
import { ROLES } from "../lib/roles";
import type { SocioDeAgencia } from "../lib/socios";

type Usuario = {
	id: string;
	name: string;
	email: string;
	role: string;
	banned: boolean;
};

const G = "gerente-1";
const usuarios: Record<string, Usuario> = {};
const membresiasPorUsuario: Record<
	string,
	Array<{ companyId: string; sellerId: string | null }>
> = {};
let idActual = G;
let passwordCambiada: Date | null = new Date("2026-01-01");
// Lo que el servicio de socios "tiene en la base": con TODAS las membresías.
let baseDeSocios: SocioDeAgencia[] = [];
const llamadasListar: string[][] = [];

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
					return cadena(() => [{ passwordChangedAt: passwordCambiada }]);
				throw new Error("Tabla no mockeada en tracker-usuarios.lectura.test.ts");
			},
		}),
		selectDistinctOn: () => ({
			from: () => ({ orderBy: () => ({ as: () => ({}) }) }),
		}),
	},
}));

// Solo se simula la lectura de la base; las reglas (permisos y recorte) son las reales.
const reales = await import("../lib/socios");
mock.module("../lib/socios", () => ({
	...reales,
	listarSociosDeAgencias: async (ids: string[]) => {
		llamadasListar.push([...ids]);
		return baseDeSocios.filter((s) =>
			s.membresias.some((m) => ids.includes(m.companyId)),
		);
	},
}));

const { trackerUsuariosRouter } = await import("./tracker-usuarios");
process.env.RESEND_API_KEY ??= "test-key";
process.env.EMAIL_DOMAIN ??= "example.com";
const { partnerTrackerRouter } = await import("./index");

function ctx(id: string) {
	idActual = id;
	return {
		context: {
			partnerSession: { user: { id }, session: { id: `s-${id}` } },
			headers: { get: () => null },
		},
	} as never;
}

function socio(
	id: string,
	nombre: string,
	membresias: Array<[string, string, string | null, boolean?]>,
): SocioDeAgencia {
	return {
		id,
		nombre,
		correo: `${id}@example.com`,
		cuentaSuspendida: false,
		creadoEn: new Date("2026-02-01"),
		membresias: membresias.map(([companyId, companyNombre, sellerId, activa]) => ({
			companyId,
			companyNombre,
			sellerId,
			telefono: sellerId ? "5555-0000" : null,
			activa: activa ?? true,
		})),
	};
}

function nuevoUsuario(id: string, role: string = ROLES.PARTNER) {
	usuarios[id] = {
		id,
		name: id,
		email: `${id}@example.com`,
		role,
		banned: false,
	};
}

beforeEach(() => {
	llamadasListar.length = 0;
	passwordCambiada = new Date("2026-01-01");
	for (const k of Object.keys(usuarios)) delete usuarios[k];
	nuevoUsuario(G);
	nuevoUsuario("vendedor-1");
	nuevoUsuario("vend-b");
	// G es gerente de A y vendedor en C (no es "su" agencia de gerente).
	membresiasPorUsuario[G] = [
		{ companyId: "A", sellerId: null },
		{ companyId: "C", sellerId: "vend-g" },
	];
	membresiasPorUsuario["vendedor-1"] = [{ companyId: "A", sellerId: "v1" }];
	baseDeSocios = [
		socio(G, "Gina Gerente", [
			["A", "Agencia A", null],
			["C", "Agencia C", "vend-g"],
		]),
		socio("vendedor-1", "Vera Vendedora", [["A", "Agencia A", "v1"]]),
		socio("multi", "Marta Multi", [
			["A", "Agencia A", "vm-a"],
			["B", "Agencia B", null],
		]),
		socio("cogerente", "Coco Gerente", [["A", "Agencia A", null]]),
		socio("ajeno", "Aldo Ajeno", [["B", "Agencia B", "vb-1"]]),
	];
});

describe("partnerManagerProcedure: quién entra", () => {
	test.each(["getUsuariosDeMiAgencia", "getUsuarioDeMiAgencia"] as const)(
		"%s: un usuario de agencia (solo vendedor) recibe FORBIDDEN",
		async (nombre) => {
			await expect(
				call(
					trackerUsuariosRouter[nombre] as never,
					(nombre === "getUsuarioDeMiAgencia" ? { userId: G } : undefined) as never,
					ctx("vendedor-1"),
				),
			).rejects.toMatchObject({
				code: "FORBIDDEN",
				message: "Solo el gerente de la agencia puede administrar usuarios",
			});
			expect(llamadasListar).toEqual([]);
		},
	);

	test("sin sesión de socio recibe UNAUTHORIZED", async () => {
		await expect(
			call(trackerUsuariosRouter.getUsuariosDeMiAgencia, undefined as never, {
				context: { headers: { get: () => null } },
			} as never),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});

	test("un gerente baneado recibe FORBIDDEN", async () => {
		usuarios[G].banned = true;
		await expect(
			call(trackerUsuariosRouter.getUsuariosDeMiAgencia, undefined as never, ctx(G)),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	test("un gerente que no cambió su contraseña inicial recibe FORBIDDEN", async () => {
		passwordCambiada = null;
		await expect(
			call(trackerUsuariosRouter.getUsuariosDeMiAgencia, undefined as never, ctx(G)),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	test("un gerente al que le desactivaron su agencia de gerente deja de serlo", async () => {
		// resolvePartnerScope ya no devuelve la membresía inactiva: solo queda la de vendedor.
		membresiasPorUsuario[G] = [{ companyId: "C", sellerId: "vend-g" }];
		await expect(
			call(trackerUsuariosRouter.getUsuariosDeMiAgencia, undefined as never, ctx(G)),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});
});

describe("getUsuariosDeMiAgencia", () => {
	test("pide solo las agencias donde es gerente, no donde es vendedor", async () => {
		await call(trackerUsuariosRouter.getUsuariosDeMiAgencia, undefined as never, ctx(G));
		expect(llamadasListar).toEqual([["A"]]);
	});

	test("lista usuarios y co-gerentes de su agencia, nunca a gente de otras", async () => {
		const filas = await call(
			trackerUsuariosRouter.getUsuariosDeMiAgencia,
			undefined as never,
			ctx(G),
		);
		const ids = filas.map((f) => f.id).sort();
		expect(ids).toEqual(["cogerente", "multi", "vendedor-1", G].sort());
		expect(ids).not.toContain("ajeno");
	});

	test("la respuesta nunca trae agencias fuera de las que gerencia", async () => {
		const filas = await call(
			trackerUsuariosRouter.getUsuariosDeMiAgencia,
			undefined as never,
			ctx(G),
		);
		const texto = JSON.stringify(filas);
		expect(texto).not.toContain("Agencia B");
		expect(texto).not.toContain("Agencia C");
		expect(texto).not.toContain('"B"');
		expect(texto).not.toContain('"C"');
		expect(texto).not.toContain("vm-a");
		const multi = filas.find((f) => f.id === "multi");
		expect(multi?.membresias).toEqual([
			{
				companyId: "A",
				companyNombre: "Agencia A",
				rol: "usuario",
				telefono: "5555-0000",
				activa: true,
			},
		]);
	});

	test("marca el rol por agencia y quién es el que llama", async () => {
		const filas = await call(
			trackerUsuariosRouter.getUsuariosDeMiAgencia,
			undefined as never,
			ctx(G),
		);
		expect(filas.find((f) => f.id === "cogerente")?.membresias[0].rol).toBe("gerente");
		expect(filas.find((f) => f.id === G)?.esYo).toBe(true);
		expect(filas.find((f) => f.id === "vendedor-1")?.esYo).toBe(false);
	});

	test("incluye las membresías inactivas de su agencia", async () => {
		baseDeSocios.push(socio("baja", "Beto Baja", [["A", "Agencia A", "vb", false]]));
		const filas = await call(
			trackerUsuariosRouter.getUsuariosDeMiAgencia,
			undefined as never,
			ctx(G),
		);
		expect(filas.find((f) => f.id === "baja")?.membresias[0].activa).toBe(false);
	});
});

describe("getUsuarioDeMiAgencia", () => {
	test("un usuario de otra agencia da NOT_FOUND", async () => {
		await expect(
			call(trackerUsuariosRouter.getUsuarioDeMiAgencia, { userId: "ajeno" }, ctx(G)),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "Usuario no encontrado",
		});
	});

	test("un id que no existe da NOT_FOUND, igual que uno ajeno", async () => {
		await expect(
			call(trackerUsuariosRouter.getUsuarioDeMiAgencia, { userId: "nadie" }, ctx(G)),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "Usuario no encontrado",
		});
	});

	test("rechaza un input sin userId", async () => {
		await expect(
			call(trackerUsuariosRouter.getUsuarioDeMiAgencia, {} as never, ctx(G)),
		).rejects.toThrow();
	});

	test("un vendedor solo de su agencia: todo permitido", async () => {
		const d = await call(
			trackerUsuariosRouter.getUsuarioDeMiAgencia,
			{ userId: "vendedor-1" },
			ctx(G),
		);
		expect(d.permisos.porAgencia).toEqual({
			A: { puedeActivar: true, puedeEditarTelefono: true },
		});
		expect(d.permisos.puedeEditarNombre).toBe(true);
	});

	test("vendedora en A y gerente en B: se puede activar en A pero no editar el nombre, y B no sale", async () => {
		const d = await call(
			trackerUsuariosRouter.getUsuarioDeMiAgencia,
			{ userId: "multi" },
			ctx(G),
		);
		expect(d.permisos.porAgencia).toEqual({
			A: { puedeActivar: true, puedeEditarTelefono: true },
		});
		expect(d.permisos.puedeEditarNombre).toBe(false);
		expect(d.permisos.motivoNombre).toBeTruthy();
		const texto = JSON.stringify(d);
		expect(texto).not.toContain("Agencia B");
		expect(texto).not.toContain("vm-a");
		expect(d.membresias.map((m) => m.companyId)).toEqual(["A"]);
	});

	test("un co-gerente y uno mismo se ven sin acciones", async () => {
		const co = await call(
			trackerUsuariosRouter.getUsuarioDeMiAgencia,
			{ userId: "cogerente" },
			ctx(G),
		);
		expect(co.permisos.porAgencia.A.puedeActivar).toBe(false);
		expect(co.permisos.puedeEditarNombre).toBe(false);
		const yo = await call(
			trackerUsuariosRouter.getUsuarioDeMiAgencia,
			{ userId: G },
			ctx(G),
		);
		expect(yo.esYo).toBe(true);
		expect(yo.permisos.porAgencia.A.puedeActivar).toBe(false);
		expect(yo.permisos.puedeEditarNombre).toBe(false);
		// Su otra agencia (C, donde es vendedor) tampoco se filtra.
		expect(JSON.stringify(yo)).not.toContain("Agencia C");
	});
});

describe("superficie y montaje", () => {
	test("tracker-usuarios expone exactamente sus 3 procedures", () => {
		expect(Object.keys(trackerUsuariosRouter).sort()).toEqual([
			"getMiPerfil",
			"getUsuarioDeMiAgencia",
			"getUsuariosDeMiAgencia",
		]);
	});

	test("las lecturas están montadas en partnerTrackerRouter", () => {
		expect(partnerTrackerRouter.getUsuariosDeMiAgencia).toBe(
			trackerUsuariosRouter.getUsuariosDeMiAgencia,
		);
		expect(partnerTrackerRouter.getUsuarioDeMiAgencia).toBe(
			trackerUsuariosRouter.getUsuarioDeMiAgencia,
		);
	});
});
