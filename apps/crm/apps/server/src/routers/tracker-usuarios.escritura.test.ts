import { call } from "@orpc/server";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { user } from "../db/schema/auth";
import { partnerAccounts, partnerMembers } from "../db/schema/partners";
import { ROLES } from "../lib/roles";
import type { MembresiaRevalidable, SocioDeAgencia } from "../lib/socios";

type Usuario = {
	id: string;
	name: string;
	email: string;
	role: string;
	banned: boolean;
};

const G = "gerente-1";
const AG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AG_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const usuarios: Record<string, Usuario> = {};
const membresiasPorUsuario: Record<
	string,
	Array<{ companyId: string; sellerId: string | null }>
> = {};
let idActual = G;
let baseDeSocios: SocioDeAgencia[] = [];

// Lo que el router le pide al servicio de socios y a la bitácora.
const llamadasCrear: Array<Record<string, unknown>> = [];
const llamadasDatos: Array<unknown[]> = [];
const llamadasEstado: Array<unknown[]> = [];
const auditorias: Array<Record<string, unknown>> = [];
let correoRepetido = false;
// Lo que devuelve cambiarEstadoMembresia: true = la fila cambió de estado.
let estadoCambio = true;
// Membresías que el objetivo tiene "dentro de la transacción" (releídas tras el
// FOR UPDATE). Si no se fija, coinciden con las que vio el router.
let membresiasEnTransaccion: MembresiaRevalidable[] | null = null;

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
				throw new Error("Tabla no mockeada en tracker-usuarios.escritura.test.ts");
			},
		}),
		selectDistinctOn: () => ({
			from: () => ({ orderBy: () => ({ as: () => ({}) }) }),
		}),
	},
}));

// Solo se simula la escritura en la base; las reglas de permisos son las reales.
const reales = await import("../lib/socios");
mock.module("../lib/socios", () => ({
	...reales,
	listarSociosDeAgencias: async (ids: string[]) =>
		baseDeSocios.filter((s) => s.membresias.some((m) => ids.includes(m.companyId))),
	crearSocio: async (input: Record<string, unknown>) => {
		llamadasCrear.push(input);
		if (correoRepetido) {
			const { ORPCError } = await import("@orpc/server");
			throw new ORPCError("CONFLICT", { message: "Ese correo ya tiene una cuenta" });
		}
		return { id: "nuevo-1", name: String(input.nombre), email: String(input.correo) };
	},
	// Como la transacción real: `revalidar` corre con las membresías releídas y,
	// si lanza, no se escribe nada.
	actualizarDatosSocio: async (...args: unknown[]) => {
		const revalidar = args[3] as ((m: MembresiaRevalidable[]) => void) | undefined;
		revalidar?.(membresiasEnTransaccion ?? membresiasDe(String(args[0])));
		llamadasDatos.push(args.slice(0, 3));
	},
	cambiarEstadoMembresia: async (...args: unknown[]) => {
		const revalidar = args[4] as ((m: MembresiaRevalidable[]) => void) | undefined;
		revalidar?.(membresiasEnTransaccion ?? membresiasDe(String(args[0])));
		llamadasEstado.push(args.slice(0, 4));
		return estadoCambio;
	},
}));

const auditReal = await import("../lib/audit");
mock.module("../lib/audit", () => ({
	...auditReal,
	auditRecord: (e: Record<string, unknown>) => {
		auditorias.push(e);
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

function membresiasDe(userId: string): MembresiaRevalidable[] {
	return (baseDeSocios.find((s) => s.id === userId)?.membresias ?? []).map((m) => ({
		companyId: m.companyId,
		sellerId: m.sellerId,
		activa: m.activa,
	}));
}

function nuevoUsuario(id: string) {
	usuarios[id] = {
		id,
		name: id,
		email: `${id}@example.com`,
		role: ROLES.PARTNER,
		banned: false,
	};
}

beforeEach(() => {
	llamadasCrear.length = 0;
	llamadasDatos.length = 0;
	llamadasEstado.length = 0;
	auditorias.length = 0;
	correoRepetido = false;
	estadoCambio = true;
	membresiasEnTransaccion = null;
	for (const k of Object.keys(usuarios)) delete usuarios[k];
	nuevoUsuario(G);
	nuevoUsuario("vendedor-1");
	// G es gerente de A y vendedor en C.
	membresiasPorUsuario[G] = [
		{ companyId: AG_A, sellerId: null },
		{ companyId: AG_C, sellerId: "vend-g" },
	];
	membresiasPorUsuario["vendedor-1"] = [{ companyId: AG_A, sellerId: "v1" }];
	baseDeSocios = [
		socio(G, "Gina Gerente", [
			[AG_A, "Agencia A", null],
			[AG_C, "Agencia C", "vend-g"],
		]),
		socio("vendedor-1", "Vera Vendedora", [[AG_A, "Agencia A", "v1"]]),
		socio("multi", "Marta Multi", [
			[AG_A, "Agencia A", "vm-a"],
			[AG_B, "Agencia B", null],
		]),
		socio("cogerente", "Coco Gerente", [[AG_A, "Agencia A", null]]),
		socio("ajeno", "Aldo Ajeno", [[AG_B, "Agencia B", "vb-1"]]),
	];
});

const nuevo = {
	agenciaId: AG_A,
	nombre: "Nora Nueva",
	correo: "nora@example.com",
	telefono: "5555-1234",
};

describe("crearUsuarioDeMiAgencia", () => {
	test("un usuario de agencia (solo vendedor) recibe FORBIDDEN y no se crea nada", async () => {
		await expect(
			call(trackerUsuariosRouter.crearUsuarioDeMiAgencia, nuevo, ctx("vendedor-1")),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(llamadasCrear).toEqual([]);
	});

	test("crear en una agencia ajena da NOT_FOUND y no se crea nada", async () => {
		await expect(
			call(trackerUsuariosRouter.crearUsuarioDeMiAgencia, { ...nuevo, agenciaId: AG_B }, ctx(G)),
		).rejects.toMatchObject({ code: "NOT_FOUND", message: "Agencia no encontrada" });
		expect(llamadasCrear).toEqual([]);
	});

	test("crear en la agencia donde solo es vendedor (no gerente) da NOT_FOUND", async () => {
		await expect(
			call(trackerUsuariosRouter.crearUsuarioDeMiAgencia, { ...nuevo, agenciaId: AG_C }, ctx(G)),
		).rejects.toMatchObject({ code: "NOT_FOUND", message: "Agencia no encontrada" });
		expect(llamadasCrear).toEqual([]);
	});

	test("crea vendedor + usuario con contraseña generada y sin dominio interno", async () => {
		const r = await call(trackerUsuariosRouter.crearUsuarioDeMiAgencia, nuevo, ctx(G));
		expect(llamadasCrear).toHaveLength(1);
		const arg = llamadasCrear[0];
		expect(arg.permitirDominioInterno).toBe(false);
		expect(arg.membresias).toEqual([]);
		expect(arg.vendedorNuevo).toEqual({ companyId: AG_A, telefono: "5555-1234" });
		expect(arg.nombre).toBe("Nora Nueva");
		expect(arg.correo).toBe("nora@example.com");
		expect(String(arg.contrasena).length).toBeGreaterThanOrEqual(12);
		expect(r).toEqual({ userId: "nuevo-1", contrasenaTemporal: arg.contrasena as string });
	});

	test("un correo repetido responde CONFLICT", async () => {
		correoRepetido = true;
		await expect(
			call(trackerUsuariosRouter.crearUsuarioDeMiAgencia, nuevo, ctx(G)),
		).rejects.toMatchObject({ code: "CONFLICT" });
	});

	test("deja bitácora con el socio gerente como actor y sin la contraseña", async () => {
		const r = await call(trackerUsuariosRouter.crearUsuarioDeMiAgencia, nuevo, ctx(G));
		expect(auditorias).toHaveLength(1);
		expect(auditorias[0]).toMatchObject({
			entity: "partner_member",
			id: "nuevo-1",
			action: "create",
			actor: { id: G, role: ROLES.PARTNER },
		});
		expect(JSON.stringify(auditorias)).not.toContain(r.contrasenaTemporal);
	});

	test.each([
		["correo inválido", { correo: "no-es-correo" }],
		["nombre vacío", { nombre: "  " }],
		["agencia que no es uuid", { agenciaId: "x" }],
	])("rechaza input inválido: %s", async (_n, parche) => {
		await expect(
			call(trackerUsuariosRouter.crearUsuarioDeMiAgencia, { ...nuevo, ...parche }, ctx(G)),
		).rejects.toThrow();
		expect(llamadasCrear).toEqual([]);
	});
});

describe("editarUsuarioDeMiAgencia", () => {
	test("un usuario de agencia recibe FORBIDDEN y no se escribe nada", async () => {
		await expect(
			call(
				trackerUsuariosRouter.editarUsuarioDeMiAgencia,
				{ userId: "vendedor-1", agenciaId: AG_A, telefono: "1" },
				ctx("vendedor-1"),
			),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(llamadasDatos).toEqual([]);
		expect(llamadasEstado).toEqual([]);
	});

	test("un usuario de otra agencia da NOT_FOUND", async () => {
		await expect(
			call(
				trackerUsuariosRouter.editarUsuarioDeMiAgencia,
				{ userId: "ajeno", agenciaId: AG_A, activa: false },
				ctx(G),
			),
		).rejects.toMatchObject({ code: "NOT_FOUND", message: "Usuario no encontrado" });
		expect(llamadasEstado).toEqual([]);
	});

	test("una agencia ajena da NOT_FOUND aunque el usuario sea visible", async () => {
		await expect(
			call(
				trackerUsuariosRouter.editarUsuarioDeMiAgencia,
				{ userId: "multi", agenciaId: AG_B, activa: false },
				ctx(G),
			),
		).rejects.toMatchObject({ code: "NOT_FOUND", message: "Agencia no encontrada" });
		expect(llamadasEstado).toEqual([]);
	});

	test("un usuario de otra agencia del mismo gerente, pedido con la agencia equivocada, da NOT_FOUND", async () => {
		const AG_D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
		membresiasPorUsuario[G] = [
			{ companyId: AG_A, sellerId: null },
			{ companyId: AG_D, sellerId: null },
		];
		baseDeSocios.push(socio("en-d", "Dora en D", [[AG_D, "Agencia D", "vd"]]));
		await expect(
			call(
				trackerUsuariosRouter.editarUsuarioDeMiAgencia,
				{ userId: "en-d", agenciaId: AG_A, activa: false },
				ctx(G),
			),
		).rejects.toMatchObject({ code: "NOT_FOUND", message: "Usuario no encontrado" });
		expect(llamadasEstado).toEqual([]);
	});

	test("desactivarse a sí mismo da FORBIDDEN", async () => {
		await expect(
			call(
				trackerUsuariosRouter.editarUsuarioDeMiAgencia,
				{ userId: G, agenciaId: AG_A, activa: false },
				ctx(G),
			),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(llamadasEstado).toEqual([]);
	});

	test("desactivar a un co-gerente da FORBIDDEN", async () => {
		await expect(
			call(
				trackerUsuariosRouter.editarUsuarioDeMiAgencia,
				{ userId: "cogerente", agenciaId: AG_A, activa: false },
				ctx(G),
			),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(llamadasEstado).toEqual([]);
	});

	test("editar el teléfono de un co-gerente da FORBIDDEN", async () => {
		await expect(
			call(
				trackerUsuariosRouter.editarUsuarioDeMiAgencia,
				{ userId: "cogerente", agenciaId: AG_A, telefono: "1" },
				ctx(G),
			),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(llamadasDatos).toEqual([]);
	});

	test("editar el nombre de alguien multi-agencia da FORBIDDEN y no escribe nada", async () => {
		await expect(
			call(
				trackerUsuariosRouter.editarUsuarioDeMiAgencia,
				{ userId: "multi", agenciaId: AG_A, nombre: "Otro", telefono: "9" },
				ctx(G),
			),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(llamadasDatos).toEqual([]);
		expect(llamadasEstado).toEqual([]);
	});

	test("el motivo del FORBIDDEN no nombra la otra agencia", async () => {
		const e = await call(
			trackerUsuariosRouter.editarUsuarioDeMiAgencia,
			{ userId: "multi", agenciaId: AG_A, nombre: "Otro" },
			ctx(G),
		).catch((x) => x);
		expect(String(e.message)).not.toContain("Agencia B");
	});

	test("a alguien multi-agencia sí se le desactiva en la agencia propia", async () => {
		const r = await call(
			trackerUsuariosRouter.editarUsuarioDeMiAgencia,
			{ userId: "multi", agenciaId: AG_A, activa: false },
			ctx(G),
		);
		expect(r).toEqual({ success: true });
		expect(llamadasEstado).toEqual([["multi", AG_A, false, G]]);
	});

	test("reactivar llama con activa=true", async () => {
		await call(
			trackerUsuariosRouter.editarUsuarioDeMiAgencia,
			{ userId: "vendedor-1", agenciaId: AG_A, activa: true },
			ctx(G),
		);
		expect(llamadasEstado).toEqual([["vendedor-1", AG_A, true, G]]);
	});

	test("un vendedor de solo mi agencia: nombre y teléfono se escriben", async () => {
		const r = await call(
			trackerUsuariosRouter.editarUsuarioDeMiAgencia,
			{ userId: "vendedor-1", agenciaId: AG_A, nombre: "Vera Nueva", telefono: "7777" },
			ctx(G),
		);
		expect(r).toEqual({ success: true });
		expect(llamadasDatos).toEqual([
			["vendedor-1", { nombre: "Vera Nueva", telefono: "7777" }, AG_A],
		]);
		expect(llamadasEstado).toEqual([]);
	});

	test("sin nada que cambiar se rechaza", async () => {
		await expect(
			call(
				trackerUsuariosRouter.editarUsuarioDeMiAgencia,
				{ userId: "vendedor-1", agenciaId: AG_A },
				ctx(G),
			),
		).rejects.toThrow();
	});

	test("pedir datos y estado juntos se rechaza sin escribir nada", async () => {
		await expect(
			call(
				trackerUsuariosRouter.editarUsuarioDeMiAgencia,
				{ userId: "vendedor-1", agenciaId: AG_A, telefono: "7777", activa: false },
				ctx(G),
			),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message:
				"Edita los datos o cambia el estado del usuario, no las dos cosas a la vez",
		});
		expect(llamadasDatos).toEqual([]);
		expect(llamadasEstado).toEqual([]);
		expect(auditorias).toEqual([]);
	});

	test("bitácora con el socio gerente como actor, una entrada por acción", async () => {
		await call(
			trackerUsuariosRouter.editarUsuarioDeMiAgencia,
			{ userId: "vendedor-1", agenciaId: AG_A, telefono: "7777" },
			ctx(G),
		);
		await call(
			trackerUsuariosRouter.editarUsuarioDeMiAgencia,
			{ userId: "vendedor-1", agenciaId: AG_A, activa: false },
			ctx(G),
		);
		const acciones = auditorias.map((a) => a.action).sort();
		expect(acciones).toEqual(["deactivate", "update"]);
		for (const a of auditorias) {
			expect(a).toMatchObject({
				entity: "partner_member",
				id: "vendedor-1",
				actor: { id: G, role: ROLES.PARTNER },
			});
		}
	});

	test("desactivar o reactivar lo que ya estaba así (false) responde success pero no se registra", async () => {
		estadoCambio = false;
		const r1 = await call(
			trackerUsuariosRouter.editarUsuarioDeMiAgencia,
			{ userId: "vendedor-1", agenciaId: AG_A, activa: false },
			ctx(G),
		);
		const r2 = await call(
			trackerUsuariosRouter.editarUsuarioDeMiAgencia,
			{ userId: "vendedor-1", agenciaId: AG_A, activa: true },
			ctx(G),
		);
		expect(r1).toEqual({ success: true });
		expect(r2).toEqual({ success: true });
		expect(llamadasEstado).toHaveLength(2);
		expect(auditorias).toEqual([]);
	});

	test("si la fila sí cambió (true) se registra deactivate / reactivate", async () => {
		estadoCambio = true;
		await call(
			trackerUsuariosRouter.editarUsuarioDeMiAgencia,
			{ userId: "vendedor-1", agenciaId: AG_A, activa: false },
			ctx(G),
		);
		await call(
			trackerUsuariosRouter.editarUsuarioDeMiAgencia,
			{ userId: "vendedor-1", agenciaId: AG_A, activa: true },
			ctx(G),
		);
		expect(auditorias.map((a) => a.action)).toEqual(["deactivate", "reactivate"]);
	});

	test("carrera: si dentro de la transacción el objetivo ya es gerente, se rechaza al desactivar y no se escribe", async () => {
		// El router lo vio vendedor; un admin lo hizo gerente de A antes del candado.
		membresiasEnTransaccion = [{ companyId: AG_A, sellerId: null, activa: true }];
		const e = await call(
			trackerUsuariosRouter.editarUsuarioDeMiAgencia,
			{ userId: "vendedor-1", agenciaId: AG_A, activa: false },
			ctx(G),
		).catch((x) => x);
		expect(e).toMatchObject({
			code: "FORBIDDEN",
			message: "Es gerente de esta agencia; lo administra Club Cash In",
		});
		expect(llamadasEstado).toEqual([]);
		expect(auditorias).toEqual([]);
	});

	test("carrera: si dentro de la transacción el objetivo ya trabaja con otra agencia, no se renombra", async () => {
		membresiasEnTransaccion = [
			{ companyId: AG_A, sellerId: "v1", activa: true },
			{ companyId: AG_B, sellerId: "vb-9", activa: true },
		];
		const e = await call(
			trackerUsuariosRouter.editarUsuarioDeMiAgencia,
			{ userId: "vendedor-1", agenciaId: AG_A, nombre: "Otro Nombre" },
			ctx(G),
		).catch((x) => x);
		expect(e).toMatchObject({
			code: "FORBIDDEN",
			message:
				"El nombre lo administra Club Cash In porque también trabaja con otra agencia",
		});
		expect(llamadasDatos).toEqual([]);
		expect(auditorias).toEqual([]);
	});

	test("revalidación sin cambios: el caso feliz sigue escribiendo", async () => {
		membresiasEnTransaccion = [{ companyId: AG_A, sellerId: "v1", activa: true }];
		const r = await call(
			trackerUsuariosRouter.editarUsuarioDeMiAgencia,
			{ userId: "vendedor-1", agenciaId: AG_A, activa: false },
			ctx(G),
		);
		expect(r).toEqual({ success: true });
		expect(llamadasEstado).toEqual([["vendedor-1", AG_A, false, G]]);
	});

	test("una acción rechazada no deja bitácora", async () => {
		await call(
			trackerUsuariosRouter.editarUsuarioDeMiAgencia,
			{ userId: G, agenciaId: AG_A, activa: false },
			ctx(G),
		).catch(() => undefined);
		expect(auditorias).toEqual([]);
	});
});

describe("superficie y montaje", () => {
	test("tracker-usuarios expone exactamente sus 5 procedures", () => {
		expect(Object.keys(trackerUsuariosRouter).sort()).toEqual([
			"crearUsuarioDeMiAgencia",
			"editarUsuarioDeMiAgencia",
			"getMiPerfil",
			"getUsuarioDeMiAgencia",
			"getUsuariosDeMiAgencia",
		]);
	});

	test("crear y editar están montados en partnerTrackerRouter", () => {
		expect(partnerTrackerRouter.crearUsuarioDeMiAgencia).toBe(
			trackerUsuariosRouter.crearUsuarioDeMiAgencia,
		);
		expect(partnerTrackerRouter.editarUsuarioDeMiAgencia).toBe(
			trackerUsuariosRouter.editarUsuarioDeMiAgencia,
		);
	});
});
