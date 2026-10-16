import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { user } from "../db/schema/auth";
import { partnerMembers } from "../db/schema/partners";
import { vehicleVendors } from "../db/schema/vehicles";
import { ROLES } from "./roles";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const V_A = "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1";
const V_B = "d2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2";

let rolDelUsuario: string | null = ROLES.PARTNER;
let membresiaExiste = true;
let membresiasDelUsuario: Array<{
	companyId: string;
	sellerId: string | null;
	desactivadoAt?: Date | null;
}> = [];
let filasListado: Array<Record<string, unknown>> = [];
let idsListado: Array<{ userId: string }> = [];
let updates: Array<{
	tabla: unknown;
	valores: Record<string, unknown>;
	donde?: { sql: string; params: unknown[] };
}> = [];
let bloqueosDeUser: unknown[] = [];
let seleccionesListado = 0;
let dondeDelListado: unknown;

function nodo<T>(filas: () => T[], alBloquear?: (modo: unknown) => void) {
	const n = {
		from: () => n,
		innerJoin: () => n,
		leftJoin: () => n,
		where: (condicion?: unknown) => {
			dondeDelListado = condicion;
			return n;
		},
		for: (modo?: unknown) => {
			alBloquear?.(modo);
			return n;
		},
		limit: () => n,
		orderBy: () => n,
		then: (resolve: (f: T[]) => void) => resolve(filas()),
	};
	return n;
}

const tx = {
	select: () => ({
		from: (tabla: unknown) => {
			if (tabla === user)
				return nodo(
					() => (rolDelUsuario ? [{ role: rolDelUsuario }] : []),
					(modo) => bloqueosDeUser.push(modo),
				);
			if (tabla === partnerMembers) return nodo(() => membresiasDelUsuario);
			return nodo(() => []);
		},
	}),
	update: (tabla: unknown) => ({
		set: (valores: Record<string, unknown>) => ({
			where: (condicion: unknown) => {
				const q = new PgDialect().sqlToQuery(condicion as never);
				updates.push({ tabla, valores, donde: { sql: q.sql, params: q.params } });
				const r = membresiaExiste ? [{ id: "m-1" }] : [];
				return Object.assign(Promise.resolve(r), { returning: async () => r });
			},
		}),
	}),
};

mock.module("../db", () => ({
	db: {
		transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
		select: (seleccion: Record<string, unknown>) => {
			seleccionesListado++;
			return "companyNombre" in seleccion
				? nodo(() => filasListado)
				: nodo(() => idsListado);
		},
	},
}));

mock.module("./auth", () => ({ auth: { api: {} } }));

const {
	cambiarEstadoMembresia,
	actualizarDatosSocio,
	listarSociosDeAgencias,
	permisosDelGerente,
	recortarAlAlcance,
} = await import("./socios");
type Socio = import("./socios").SocioDeAgencia;

const G = "gerente-1";

function socio(
	id: string,
	membresias: Array<[string, string | null]>,
): Socio {
	return {
		id,
		nombre: "Lucía",
		correo: `${id}@agencia.com`,
		cuentaSuspendida: false,
		creadoEn: new Date("2026-01-01"),
		membresias: membresias.map(([companyId, sellerId]) => ({
			companyId,
			companyNombre: `Agencia ${companyId.slice(0, 1)}`,
			sellerId,
			telefono: null,
			activa: true,
		})),
	};
}

beforeEach(() => {
	rolDelUsuario = ROLES.PARTNER;
	membresiaExiste = true;
	membresiasDelUsuario = [{ companyId: A, sellerId: V_A, desactivadoAt: null }];
	filasListado = [];
	idsListado = [];
	updates = [];
	bloqueosDeUser = [];
	seleccionesListado = 0;
});

describe("permisosDelGerente", () => {
	test("vendedor solo de su agencia: puede todo", () => {
		const p = permisosDelGerente(G, [A], socio("u1", [[A, V_A]]));
		expect(p.porAgencia[A]).toMatchObject({
			puedeActivar: true,
			puedeEditarTelefono: true,
		});
		expect(p.puedeEditarNombre).toBe(true);
	});

	test("él mismo: nada, con motivo", () => {
		const p = permisosDelGerente(G, [A], socio(G, [[A, null]]));
		expect(p.porAgencia[A]?.puedeActivar).toBe(false);
		expect(p.porAgencia[A]?.puedeEditarTelefono).toBe(false);
		expect(p.porAgencia[A]?.motivo).toBeTruthy();
		expect(p.puedeEditarNombre).toBe(false);
	});

	test("él mismo con membresía de vendedor tampoco se toca", () => {
		const p = permisosDelGerente(G, [A], socio(G, [[A, V_A]]));
		expect(p.porAgencia[A]?.puedeActivar).toBe(false);
		expect(p.puedeEditarNombre).toBe(false);
	});

	test("co-gerente en X: no se puede desactivar en X", () => {
		const p = permisosDelGerente(G, [A], socio("u2", [[A, null]]));
		expect(p.porAgencia[A]?.puedeActivar).toBe(false);
		expect(p.porAgencia[A]?.puedeEditarTelefono).toBe(false);
		expect(p.porAgencia[A]?.motivo).toMatch(/gerente/i);
		expect(p.puedeEditarNombre).toBe(false);
	});

	test("vendedora en A y gerente en B, G gerente solo de A: desactiva en A, nombre no", () => {
		const p = permisosDelGerente(G, [A], socio("u3", [[A, V_A], [B, null]]));
		expect(p.porAgencia[A]?.puedeActivar).toBe(true);
		expect(p.porAgencia[A]?.puedeEditarTelefono).toBe(true);
		expect(p.puedeEditarNombre).toBe(false);
		// No revela que en B es gerente: el motivo es el genérico de «otra agencia»
		expect(p.motivoNombre).toBe(
			"El nombre lo administra Club Cash In porque también trabaja con otra agencia",
		);
	});

	test("gerente en A (del gerente) y vendedora en B: tampoco revela el rol de B", () => {
		const p = permisosDelGerente(G, [A], socio("u7", [[A, null], [B, V_B]]));
		expect(p.motivoNombre).not.toMatch(/gerente/i);
	});

	test("vendedora en A y en B, G gerente solo de A: desactiva en A, nombre no", () => {
		const p = permisosDelGerente(G, [A], socio("u6", [[A, V_A], [B, V_B]]));
		expect(p.porAgencia[A]?.puedeActivar).toBe(true);
		expect(p.puedeEditarNombre).toBe(false);
		expect(p.motivoNombre).toMatch(/otra agencia/);
	});

	test("los motivos no nombran agencias ajenas", () => {
		const p = permisosDelGerente(G, [A], socio("u3", [[A, V_A], [B, null]]));
		const texto = JSON.stringify(p);
		expect(texto).not.toContain("Agencia b");
		expect(texto).not.toContain(B);
	});

	test("vendedora en A y B, G gerente de ambas: nombre sí", () => {
		const p = permisosDelGerente(G, [A, B], socio("u4", [[A, V_A], [B, V_B]]));
		expect(p.puedeEditarNombre).toBe(true);
		expect(p.porAgencia[B]?.puedeActivar).toBe(true);
	});

	test("porAgencia solo trae agencias del gerente donde el objetivo tiene membresía", () => {
		const p = permisosDelGerente(G, [A, C], socio("u5", [[A, V_A], [B, V_B]]));
		expect(Object.keys(p.porAgencia)).toEqual([A]);
	});
});

describe("recortarAlAlcance", () => {
	test("nunca deja agencias ajenas", () => {
		const r = recortarAlAlcance(socio("u3", [[A, V_A], [B, null], [C, V_B]]), [A]);
		expect(r.membresias.map((m) => m.companyId)).toEqual([A]);
		expect(JSON.stringify(r)).not.toContain("Agencia b");
	});

	test("no muta el original", () => {
		const s = socio("u3", [[A, V_A], [B, null]]);
		recortarAlAlcance(s, [A]);
		expect(s.membresias).toHaveLength(2);
	});
});

describe("cambiarEstadoMembresia", () => {
	test("desactivar marca fecha y actor solo en esa agencia", async () => {
		await cambiarEstadoMembresia("u1", A, false, "actor-1");
		expect(updates).toHaveLength(1);
		expect(updates[0]?.tabla).toBe(partnerMembers);
		expect(updates[0]?.valores.desactivadoAt).toBeInstanceOf(Date);
		expect(updates[0]?.valores.desactivadoPor).toBe("actor-1");
	});

	test("desactivar en A filtra por usuario Y agencia: no afecta a B", async () => {
		await cambiarEstadoMembresia("u1", A, false, "actor-1");
		const donde = updates[0]?.donde;
		expect(donde?.sql).toContain('"user_id"');
		expect(donde?.sql).toContain('"company_id"');
		expect(donde?.params).toEqual(["u1", A]);
	});

	test("bloquea la fila de user con FOR UPDATE antes de escribir", async () => {
		await cambiarEstadoMembresia("u1", A, false, "actor-1");
		expect(bloqueosDeUser).toEqual(["update"]);
	});

	test("reactivar limpia fecha y actor", async () => {
		await cambiarEstadoMembresia("u1", A, true, "actor-1");
		expect(updates[0]?.valores).toEqual({
			desactivadoAt: null,
			desactivadoPor: null,
		});
	});

	test("un usuario interno da NOT_FOUND y no se actualiza nada", async () => {
		rolDelUsuario = ROLES.ADMIN;
		await expect(cambiarEstadoMembresia("u1", A, false, "x")).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		expect(updates).toHaveLength(0);
	});

	test("usuario inexistente da NOT_FOUND", async () => {
		rolDelUsuario = null;
		await expect(cambiarEstadoMembresia("u1", A, false, "x")).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	test("sin membresía en esa agencia da NOT_FOUND y no escribe", async () => {
		membresiasDelUsuario = [{ companyId: B, sellerId: V_B, desactivadoAt: null }];
		await expect(cambiarEstadoMembresia("u1", A, false, "x")).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		expect(updates).toHaveLength(0);
	});

	test("desactivar solo escribe si sigue activa (IS NULL): no pisa quién ni cuándo", async () => {
		await cambiarEstadoMembresia("u1", A, false, "actor-2");
		expect(updates[0]?.donde?.sql).toContain('"desactivado_at" is null');
	});

	test("desactivar a quien ya está inactivo (0 filas) es un no-op, no un error", async () => {
		membresiasDelUsuario = [
			{ companyId: A, sellerId: V_A, desactivadoAt: new Date("2026-01-01") },
		];
		membresiaExiste = false; // el UPDATE no encuentra fila activa
		await expect(
			cambiarEstadoMembresia("u1", A, false, "actor-2"),
		).resolves.toBe(false);
	});

	test("devuelve true cuando la fila sí cambió de estado", async () => {
		await expect(cambiarEstadoMembresia("u1", A, false, "actor-1")).resolves.toBe(true);
		await expect(cambiarEstadoMembresia("u1", A, true, "actor-1")).resolves.toBe(true);
	});

	test("reactivar a quien ya está activo (0 filas) devuelve false", async () => {
		membresiaExiste = false;
		await expect(cambiarEstadoMembresia("u1", A, true, "actor-1")).resolves.toBe(false);
	});

	test("reactivar solo escribe si sigue inactiva (IS NOT NULL): simétrico", async () => {
		await cambiarEstadoMembresia("u1", A, true, "actor-1");
		expect(updates[0]?.donde?.sql).toContain('"desactivado_at" is not null');
	});

	test("revalidar recibe las membresías releídas, tras el FOR UPDATE de user", async () => {
		membresiasDelUsuario = [
			{ companyId: A, sellerId: null, desactivadoAt: null },
			{ companyId: B, sellerId: V_B, desactivadoAt: new Date() },
		];
		let visto: unknown;
		let bloqueosAlRevalidar: unknown[] = [];
		await cambiarEstadoMembresia("u1", A, false, "x", (m) => {
			visto = m;
			bloqueosAlRevalidar = [...bloqueosDeUser];
		});
		expect(visto).toEqual([
			{ companyId: A, sellerId: null, activa: true },
			{ companyId: B, sellerId: V_B, activa: false },
		]);
		expect(bloqueosAlRevalidar).toEqual(["update"]);
		expect(updates).toHaveLength(1);
	});

	test("si revalidar lanza, aborta sin escribir", async () => {
		await expect(
			cambiarEstadoMembresia("u1", A, false, "x", () => {
				throw new Error("ya no es gerente");
			}),
		).rejects.toThrow("ya no es gerente");
		expect(updates).toHaveLength(0);
	});
});

describe("actualizarDatosSocio", () => {
	test("el nombre queda igual en user y en todos sus vendedores", async () => {
		membresiasDelUsuario = [
			{ companyId: A, sellerId: V_A },
			{ companyId: B, sellerId: V_B },
		];
		await actualizarDatosSocio("u1", { nombre: "  Lucía Nueva " }, A);
		const enUser = updates.find((u) => u.tabla === user);
		const enVendedores = updates.find((u) => u.tabla === vehicleVendors);
		expect(enUser?.valores.name).toBe("Lucía Nueva");
		expect(enVendedores?.valores.name).toBe("Lucía Nueva");
	});

	test("el teléfono se escribe en el vendedor de esa agencia", async () => {
		membresiasDelUsuario = [
			{ companyId: A, sellerId: V_A },
			{ companyId: B, sellerId: V_B },
		];
		await actualizarDatosSocio("u1", { telefono: "5555-1234" }, A);
		expect(updates).toHaveLength(1);
		expect(updates[0]?.tabla).toBe(vehicleVendors);
		expect(updates[0]?.valores.phone).toBe("5555-1234");
		// Y solo en el vendedor de A, no en el de B
		expect(updates[0]?.donde?.params).toEqual([V_A]);
	});

	test("bloquea la fila de user con FOR UPDATE antes de escribir", async () => {
		membresiasDelUsuario = [{ companyId: A, sellerId: V_A }];
		await actualizarDatosSocio("u1", { nombre: "X" }, A);
		expect(bloqueosDeUser).toEqual(["update"]);
	});

	test("un usuario interno da NOT_FOUND y no escribe nada", async () => {
		rolDelUsuario = ROLES.SALES;
		membresiasDelUsuario = [{ companyId: A, sellerId: V_A }];
		await expect(
			actualizarDatosSocio("u1", { nombre: "X" }, A),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(updates).toHaveLength(0);
	});

	test("sin membresía en esa agencia da NOT_FOUND", async () => {
		membresiasDelUsuario = [{ companyId: B, sellerId: V_B }];
		await expect(
			actualizarDatosSocio("u1", { nombre: "X" }, A),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(updates).toHaveLength(0);
	});

	test("revalidar recibe las membresías releídas, tras el FOR UPDATE de user", async () => {
		membresiasDelUsuario = [
			{ companyId: A, sellerId: null, desactivadoAt: null },
			{ companyId: B, sellerId: V_B, desactivadoAt: new Date() },
		];
		let visto: unknown;
		let bloqueosAlRevalidar: unknown[] = [];
		await actualizarDatosSocio("u1", { nombre: "X" }, A, (m) => {
			visto = m;
			bloqueosAlRevalidar = [...bloqueosDeUser];
		});
		expect(visto).toEqual([
			{ companyId: A, sellerId: null, activa: true },
			{ companyId: B, sellerId: V_B, activa: false },
		]);
		expect(bloqueosAlRevalidar).toEqual(["update"]);
		expect(updates.length).toBeGreaterThan(0);
	});

	test("si revalidar lanza, aborta sin escribir", async () => {
		membresiasDelUsuario = [{ companyId: A, sellerId: V_A, desactivadoAt: null }];
		await expect(
			actualizarDatosSocio("u1", { nombre: "X" }, A, () => {
				throw new Error("ya no es gerente");
			}),
		).rejects.toThrow("ya no es gerente");
		expect(updates).toHaveLength(0);
	});

	test("teléfono de un gerente (sin vendedor) se rechaza sin escribir", async () => {
		membresiasDelUsuario = [{ companyId: A, sellerId: null }];
		await expect(
			actualizarDatosSocio("u1", { telefono: "1" }, A),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(updates).toHaveLength(0);
	});
});

describe("listarSociosDeAgencias", () => {
	test("sin agencias no consulta nada", async () => {
		expect(await listarSociosDeAgencias([])).toEqual([]);
		expect(seleccionesListado).toBe(0);
	});

	test("agrupa todas las membresías por socio, incluidas las inactivas", async () => {
		idsListado = [{ userId: "u3" }];
		const base = {
			userId: "u3",
			nombre: "Lucía",
			correo: "l@a.com",
			banned: null,
			creadoEn: new Date("2026-01-01"),
		};
		filasListado = [
			{ ...base, companyId: A, companyNombre: "Uno", sellerId: V_A, telefono: "1", desactivadoAt: null },
			{ ...base, companyId: B, companyNombre: "Dos", sellerId: null, telefono: null, desactivadoAt: new Date() },
		];
		const r = await listarSociosDeAgencias([A]);
		expect(r).toHaveLength(1);
		expect(r[0]?.cuentaSuspendida).toBe(false);
		expect(r[0]?.membresias).toEqual([
			{ companyId: A, companyNombre: "Uno", sellerId: V_A, telefono: "1", activa: true },
			{ companyId: B, companyNombre: "Dos", sellerId: null, telefono: null, activa: false },
		]);
	});

	test("un socio sin membresía en las agencias pedidas no sale (carrera entre consultas)", async () => {
		// La 1ª consulta lo vio en A, pero al leer sus membresías solo queda B
		// (otro gerente se la quitó entre una consulta y otra).
		idsListado = [{ userId: "u3" }];
		const base = {
			userId: "u3",
			nombre: "Lucía",
			correo: "l@a.com",
			banned: null,
			creadoEn: new Date("2026-01-01"),
		};
		filasListado = [
			{ ...base, companyId: B, companyNombre: "Dos", sellerId: null, telefono: null, desactivadoAt: null },
		];
		expect(await listarSociosDeAgencias([A])).toEqual([]);
	});

	test("la 2ª consulta también exige que el usuario siga siendo socio", async () => {
		idsListado = [{ userId: "u3" }];
		await listarSociosDeAgencias([A]);
		const q = new PgDialect().sqlToQuery(dondeDelListado as never);
		// dondeDelListado es el WHERE de la 2ª consulta (filtra por userId)
		expect(q.sql).toContain('"partner_members"."user_id" in');
		expect(q.sql).toContain('"user"."role"');
		expect(q.params).toContain(ROLES.PARTNER);
	});

	test("sin socios en esas agencias devuelve vacío sin segunda consulta", async () => {
		idsListado = [];
		expect(await listarSociosDeAgencias([A])).toEqual([]);
		expect(seleccionesListado).toBe(1);
	});
});
