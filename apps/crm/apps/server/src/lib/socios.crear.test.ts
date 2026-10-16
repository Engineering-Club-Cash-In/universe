import { APIError } from "better-auth/api";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { user } from "../db/schema/auth";
import { companies } from "../db/schema/crm";
import { partnerMembers } from "../db/schema/partners";
import { vehicleVendors } from "../db/schema/vehicles";
import { ROLES } from "./roles";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const VENDEDOR_NUEVO = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

let creaUsuarioFalla: Error | null = null;
let rolDelUsuario: string | null = ROLES.PARTNER;
let agenciasQueExisten = [A, B];
let falloInsertMembresias: Error | null = null;
let membresiasActuales: Array<Record<string, unknown>> = [];
let vendedorPorCorreo: Array<{ id: string }> = [];
let membresiasDelVendedor: Array<{ id: string }> = [];
let ligadosAVendedores: Array<{ userId: string; sellerId: string }> = [];
let falloBorrarUsuario: Error | null = null;
let falloBorrarVendedor: Error | null = null;
let falloActualizarVendedor: Error | null = null;
let vendedoresActualizados: Array<Record<string, unknown>> = [];

const llamadasCreateUser: Array<Record<string, unknown>> = [];
let vendedoresInsertados: Array<Record<string, unknown>> = [];
let borrados: unknown[] = [];
let membresiasInsertadas: Array<Record<string, unknown>> = [];
let membresiasBorradas = 0;

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
			// Búsqueda del vendedor por correo y de si ya está ligado (solo `id`)
			if (tabla === vehicleVendors && !("vendorType" in seleccion))
				return nodo(() => vendedorPorCorreo);
			if (tabla === partnerMembers && "sellerId" in seleccion)
				return nodo(() => ligadosAVendedores);
			if (tabla === partnerMembers && "id" in seleccion)
				return nodo(() => membresiasDelVendedor);
			if (tabla === user)
				return nodo(() => (rolDelUsuario ? [{ role: rolDelUsuario }] : []));
			if (tabla === companies)
				return nodo(() => agenciasQueExisten.map((id) => ({ id })));
			if (tabla === partnerMembers) return nodo(() => membresiasActuales);
			if (tabla === vehicleVendors)
				return nodo(() => [
					{ id: VENDEDOR_NUEVO, vendorType: "agencia", companyId: A },
				]);
			return nodo(() => []);
		},
	}),
	delete: () => ({
		where: async () => {
			membresiasBorradas++;
		},
	}),
	insert: () => ({
		values: async (v: Array<Record<string, unknown>> | Record<string, unknown>) => {
			if (falloInsertMembresias) throw falloInsertMembresias;
			membresiasInsertadas = Array.isArray(v) ? v : [v];
		},
	}),
};

mock.module("../db", () => ({
	db: {
		transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
		insert: (tabla: unknown) => ({
			values: (v: Record<string, unknown>) => {
				if (tabla === vehicleVendors) vendedoresInsertados.push(v);
				return { returning: async () => [{ id: VENDEDOR_NUEVO }] };
			},
		}),
		update: (tabla: unknown) => ({
			set: (v: Record<string, unknown>) => ({
				where: async () => {
					if (tabla === vehicleVendors && falloActualizarVendedor)
						throw falloActualizarVendedor;
					if (tabla === vehicleVendors) vendedoresActualizados.push(v);
				},
			}),
		}),
		delete: (tabla: unknown) => ({
			where: async () => {
				if (tabla === user && falloBorrarUsuario) throw falloBorrarUsuario;
				if (tabla === vehicleVendors && falloBorrarVendedor)
					throw falloBorrarVendedor;
				borrados.push(tabla);
			},
		}),
	},
}));

mock.module("./auth", () => ({
	auth: {
		api: {
			createUser: async (args: { body: Record<string, unknown> }) => {
				llamadasCreateUser.push(args.body);
				if (creaUsuarioFalla) throw creaUsuarioFalla;
				return {
					user: {
						id: "u-1",
						name: args.body.name,
						email: String(args.body.email).toLowerCase(),
					},
				};
			},
		},
	},
}));

// Se fuerza la de ./socios para que la mutación de la compensación no dependa de azar
const { crearSocio, generarContrasenaTemporal, agregarMembresia } = await import(
	"./socios"
);

const base = {
	nombre: "Ana Pérez",
	correo: "Ana@Agencia.com",
	contrasena: "ClaveSegura123",
	permitirDominioInterno: false,
};

beforeEach(() => {
	creaUsuarioFalla = null;
	rolDelUsuario = ROLES.PARTNER;
	agenciasQueExisten = [A, B];
	falloInsertMembresias = null;
	membresiasActuales = [];
	vendedorPorCorreo = [];
	membresiasDelVendedor = [];
	ligadosAVendedores = [];
	falloBorrarUsuario = null;
	falloBorrarVendedor = null;
	falloActualizarVendedor = null;
	vendedoresActualizados = [];
	llamadasCreateUser.length = 0;
	vendedoresInsertados = [];
	borrados = [];
	membresiasInsertadas = [];
	membresiasBorradas = 0;
});

describe("generarContrasenaTemporal", () => {
	test("tiene al menos 12 caracteres y no usa caracteres ambiguos", () => {
		for (let i = 0; i < 200; i++) {
			const c = generarContrasenaTemporal();
			expect(c.length).toBeGreaterThanOrEqual(12);
			expect(c).toMatch(/^[A-Za-z0-9]+$/);
			expect(c).not.toMatch(/[0OIl1o]/);
		}
	});

	test("no repite valores entre llamadas", () => {
		const set = new Set(Array.from({ length: 100 }, generarContrasenaTemporal));
		expect(set.size).toBe(100);
	});
});

describe("crearSocio", () => {
	test("crea el socio con rol partner y el correo en minúsculas", async () => {
		agenciasQueExisten = [A];
		const r = await crearSocio({
			...base,
			membresias: [{ companyId: A, sellerId: null }],
		});
		expect(r).toEqual({ id: "u-1", name: "Ana Pérez", email: "ana@agencia.com" });
		expect(llamadasCreateUser[0]).toMatchObject({ role: ROLES.PARTNER });
		expect(membresiasInsertadas[0]).toMatchObject({ userId: "u-1", companyId: A });
	});

	test("con vendedorNuevo crea el vendedor de agencia y lo usa como sellerId", async () => {
		agenciasQueExisten = [A];
		await crearSocio({
			...base,
			membresias: [],
			vendedorNuevo: { companyId: A, telefono: "5555-1234" },
		});
		expect(vendedoresInsertados[0]).toMatchObject({
			vendorType: "agencia",
			companyId: A,
			email: "ana@agencia.com",
			phone: "5555-1234",
			name: "Ana Pérez",
		});
		expect(membresiasInsertadas[0]).toMatchObject({
			companyId: A,
			sellerId: VENDEDOR_NUEVO,
		});
	});

	test("rechaza @clubcashin.com cuando permitirDominioInterno es false, sin crear nada", async () => {
		await expect(
			crearSocio({
				...base,
				correo: "Alguien@ClubCashIn.com",
				membresias: [{ companyId: A, sellerId: null }],
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(llamadasCreateUser).toHaveLength(0);
		expect(vendedoresInsertados).toHaveLength(0);
	});

	test("acepta @clubcashin.com cuando permitirDominioInterno es true", async () => {
		agenciasQueExisten = [A];
		await crearSocio({
			...base,
			correo: "alguien@clubcashin.com",
			permitirDominioInterno: true,
			membresias: [{ companyId: A, sellerId: null }],
		});
		expect(llamadasCreateUser).toHaveLength(1);
	});

	test("sin ninguna agencia da BAD_REQUEST y no crea nada", async () => {
		await expect(crearSocio({ ...base, membresias: [] })).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
		expect(llamadasCreateUser).toHaveLength(0);
	});

	test("si falla asignar las agencias se borran el usuario y el vendedor", async () => {
		agenciasQueExisten = [A];
		falloInsertMembresias = new Error("boom");
		await expect(
			crearSocio({ ...base, membresias: [], vendedorNuevo: { companyId: A } }),
		).rejects.toThrow("boom");
		expect(borrados).toContain(user);
		expect(borrados).toContain(vehicleVendors);
	});

	test("si falla asignar sin vendedor nuevo solo se borra el usuario", async () => {
		agenciasQueExisten = [A];
		falloInsertMembresias = new Error("boom");
		await expect(
			crearSocio({ ...base, membresias: [{ companyId: A, sellerId: null }] }),
		).rejects.toThrow("boom");
		expect(borrados).toEqual([user]);
	});

	test("correo repetido (APIError) da CONFLICT y borra el vendedor creado", async () => {
		creaUsuarioFalla = new APIError("BAD_REQUEST", {
			message: "User already exists. Use another email.",
			code: "USER_ALREADY_EXISTS",
		});
		await expect(
			crearSocio({ ...base, membresias: [], vendedorNuevo: { companyId: A } }),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message: "Ese correo ya tiene una cuenta",
		});
		expect(borrados).toEqual([vehicleVendors]);
	});

	test("si falla borrar el usuario igual se borra el vendedor y se propaga el error original", async () => {
		agenciasQueExisten = [A];
		falloInsertMembresias = new Error("boom");
		falloBorrarUsuario = new Error("conexion caida");
		await expect(
			crearSocio({ ...base, membresias: [], vendedorNuevo: { companyId: A } }),
		).rejects.toThrow("boom");
		expect(borrados).toEqual([vehicleVendors]);
	});

	test("correo repetido con fallo al borrar el vendedor sigue dando el CONFLICT en español", async () => {
		creaUsuarioFalla = new APIError("BAD_REQUEST", {
			message: "User already exists. Use another email.",
			code: "USER_ALREADY_EXISTS",
		});
		falloBorrarVendedor = new Error("conexion caida");
		await expect(
			crearSocio({ ...base, membresias: [], vendedorNuevo: { companyId: A } }),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message: "Ese correo ya tiene una cuenta",
		});
	});

	test("un vendedor de la agencia con ese correo y sin socio se reutiliza y no se crea otro", async () => {
		agenciasQueExisten = [A];
		vendedorPorCorreo = [{ id: VENDEDOR_NUEVO }];
		await crearSocio({ ...base, membresias: [], vendedorNuevo: { companyId: A } });
		expect(vendedoresInsertados).toHaveLength(0);
		expect(membresiasInsertadas[0]).toMatchObject({
			companyId: A,
			sellerId: VENDEDOR_NUEVO,
		});
	});

	test("si falla la asignación no se borra el vendedor reutilizado", async () => {
		agenciasQueExisten = [A];
		vendedorPorCorreo = [{ id: VENDEDOR_NUEVO }];
		falloInsertMembresias = new Error("boom");
		await expect(
			crearSocio({ ...base, membresias: [], vendedorNuevo: { companyId: A } }),
		).rejects.toThrow("boom");
		expect(borrados).toEqual([user]);
	});

	test("el vendedor reutilizado queda con el nombre y el teléfono enviados", async () => {
		agenciasQueExisten = [A];
		vendedorPorCorreo = [{ id: VENDEDOR_NUEVO }];
		await crearSocio({
			...base,
			membresias: [],
			vendedorNuevo: { companyId: A, telefono: " 5555-9999 " },
		});
		expect(vendedoresInsertados).toHaveLength(0);
		expect(vendedoresActualizados).toEqual([
			{ name: "Ana Pérez", phone: "5555-9999" },
		]);
	});

	test("sin teléfono o con teléfono vacío el reutilizado conserva el suyo", async () => {
		agenciasQueExisten = [A];
		vendedorPorCorreo = [{ id: VENDEDOR_NUEVO }];
		await crearSocio({
			...base,
			membresias: [],
			vendedorNuevo: { companyId: A, telefono: "  " },
		});
		expect(vendedoresActualizados).toEqual([{ name: "Ana Pérez" }]);
		expect("phone" in (vendedoresActualizados[0] ?? {})).toBe(false);
	});

	test("si falla la asignación no se actualiza el vendedor reutilizado", async () => {
		agenciasQueExisten = [A];
		vendedorPorCorreo = [{ id: VENDEDOR_NUEVO }];
		falloInsertMembresias = new Error("boom");
		await expect(
			crearSocio({
				...base,
				membresias: [],
				vendedorNuevo: { companyId: A, telefono: "5555-9999" },
			}),
		).rejects.toThrow("boom");
		expect(vendedoresActualizados).toHaveLength(0);
	});

	test("si falla actualizar el vendedor reutilizado se borra solo el usuario y se propaga el error", async () => {
		agenciasQueExisten = [A];
		vendedorPorCorreo = [{ id: VENDEDOR_NUEVO }];
		falloActualizarVendedor = new Error("update caido");
		await expect(
			crearSocio({ ...base, membresias: [], vendedorNuevo: { companyId: A } }),
		).rejects.toThrow("update caido");
		expect(borrados).toEqual([user]);
	});

	test("un vendedor creado en esta llamada no se actualiza", async () => {
		agenciasQueExisten = [A];
		await crearSocio({
			...base,
			membresias: [],
			vendedorNuevo: { companyId: A, telefono: "5555-1234" },
		});
		expect(vendedoresActualizados).toHaveLength(0);
	});

	test("un vendedor ya ligado a otro socio da CONFLICT sin crear usuario ni vendedor", async () => {
		agenciasQueExisten = [A];
		vendedorPorCorreo = [{ id: VENDEDOR_NUEVO }];
		membresiasDelVendedor = [{ id: "m-9" }];
		await expect(
			crearSocio({ ...base, membresias: [], vendedorNuevo: { companyId: A } }),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(llamadasCreateUser).toHaveLength(0);
		expect(vendedoresInsertados).toHaveLength(0);
	});

	test("carrera de dos altas: 23505 sobre user.email (incluso envuelto) da CONFLICT y limpia", async () => {
		const pg = Object.assign(new Error("duplicate key value"), {
			code: "23505",
			constraint: "user_email_unique",
		});
		creaUsuarioFalla = new Error("Failed query", { cause: pg });
		await expect(
			crearSocio({ ...base, membresias: [], vendedorNuevo: { companyId: A } }),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message: "Ese correo ya tiene una cuenta",
		});
		expect(borrados).toEqual([vehicleVendors]);
	});

	test("un 23505 de otra restricción no se disfraza de correo repetido", async () => {
		creaUsuarioFalla = Object.assign(new Error("duplicate key"), {
			code: "23505",
			constraint: "account_pkey",
		});
		await expect(
			crearSocio({ ...base, membresias: [{ companyId: A, sellerId: null }] }),
		).rejects.toThrow("duplicate key");
	});

	test("otro APIError no se disfraza de correo repetido", async () => {
		creaUsuarioFalla = new APIError("BAD_REQUEST", { message: "Password too short" });
		await expect(
			crearSocio({ ...base, membresias: [{ companyId: A, sellerId: null }] }),
		).rejects.toBeInstanceOf(APIError);
	});
});

describe("agregarMembresia", () => {
	test("agrega la agencia sin borrar las demás", async () => {
		await agregarMembresia("socio-1", { companyId: B, sellerId: null });
		expect(membresiasBorradas).toBe(0);
		expect(membresiasInsertadas).toHaveLength(1);
		expect(membresiasInsertadas[0]).toMatchObject({
			userId: "socio-1",
			companyId: B,
			sellerId: null,
		});
	});

	test("un usuario que no es socio no recibe agencias", async () => {
		rolDelUsuario = ROLES.ADMIN;
		await expect(
			agregarMembresia("x", { companyId: B, sellerId: null }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(membresiasInsertadas).toHaveLength(0);
	});

	test("usuario inexistente da NOT_FOUND", async () => {
		rolDelUsuario = null;
		await expect(
			agregarMembresia("x", { companyId: B, sellerId: null }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	test("una agencia que no existe da BAD_REQUEST", async () => {
		agenciasQueExisten = [];
		await expect(
			agregarMembresia("x", { companyId: B, sellerId: null }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	test("un vendedor ligado a otro usuario da CONFLICT y no escribe", async () => {
		ligadosAVendedores = [{ userId: "otro", sellerId: VENDEDOR_NUEVO }];
		await expect(
			agregarMembresia("socio-1", { companyId: A, sellerId: VENDEDOR_NUEVO }),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message: "Ese vendedor ya está ligado a otra cuenta",
		});
		expect(membresiasInsertadas).toHaveLength(0);
	});

	test("un vendedor ligado al mismo usuario no es conflicto", async () => {
		ligadosAVendedores = [{ userId: "socio-1", sellerId: VENDEDOR_NUEVO }];
		await agregarMembresia("socio-1", { companyId: A, sellerId: VENDEDOR_NUEVO });
		expect(membresiasInsertadas[0]).toMatchObject({
			userId: "socio-1",
			sellerId: VENDEDOR_NUEVO,
		});
	});

	test("si ya tiene membresía en esa agencia da CONFLICT y no toca nada", async () => {
		membresiasActuales = [{ companyId: B }];
		await expect(
			agregarMembresia("x", { companyId: B, sellerId: null }),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(membresiasInsertadas).toHaveLength(0);
		expect(membresiasBorradas).toBe(0);
	});
});
