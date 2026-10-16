import { call } from "@orpc/server";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { companies } from "../db/schema/crm";
import { ROLES } from "../lib/roles";
import type { SocioDeAgencia } from "../lib/socios";

const ACTOR = "test-user";
const AGENCIA = "11111111-1111-4111-8111-111111111111";
const AJENA = "22222222-2222-4222-8222-222222222222";
const GERENTE = "33333333-3333-4333-8333-333333333333";
const VENDEDOR = "44444444-4444-4444-8444-444444444444";
const SELLER_ID = "55555555-5555-4555-8555-555555555555";

let currentRole: string = ROLES.ADMIN;
let agenciaExiste = true;

// Un nodo de consulta que sirve a las dos lecturas del router: el rol del que
// llama (tabla user) y la agencia (tabla companies).
function nodo(filas: () => unknown[]) {
	const n = {
		from: (tabla: unknown) =>
			tabla === companies ? nodo(() => (agenciaExiste ? [{ id: AGENCIA, name: "Agencia" }] : [])) : n,
		where: () => n,
		orderBy: () => n,
		limit: async () => filas(),
		then: (resolve: (f: unknown[]) => void) => resolve(filas()),
	};
	return n;
}
mock.module("../db", () => ({
	db: {
		select: () => nodo(() => [{ id: ACTOR, role: currentRole }]),
		// La bitácora escribe su lote al terminar la request (fila de fallo
		// incluida, por el `meta.audit` de las procedures de escritura).
		insert: () => ({ values: async () => {} }),
	},
}));

function socio(
	id: string,
	membresias: { companyId: string; sellerId: string | null; activa?: boolean }[],
	correo = `${id}@agencia.com`,
): SocioDeAgencia {
	return {
		id,
		nombre: `Socio ${id.slice(0, 4)}`,
		correo,
		cuentaSuspendida: false,
		creadoEn: new Date("2026-01-01"),
		membresias: membresias.map((m) => ({
			companyId: m.companyId,
			companyNombre: m.companyId === AGENCIA ? "Agencia" : "Otra",
			sellerId: m.sellerId,
			telefono: null,
			activa: m.activa ?? true,
		})),
	};
}

let base: SocioDeAgencia[] = [];
let cuentaPorCorreo: { id: string; role: string } | null = null;
let cambioDeEstado = true;

const llamadas = {
	crearSocio: [] as unknown[],
	agregarMembresia: [] as unknown[],
	promover: [] as unknown[],
	cambiarEstado: [] as unknown[],
	actualizarDatos: [] as unknown[],
	crearEmpresa: [] as unknown[],
	actualizarEmpresa: [] as unknown[],
	audit: [] as unknown[],
};

// Las dependencias viajan por parámetro: mock.module es global al proceso y
// rompería las pruebas de socios y companies.
const { crearAgencyManagersRouter } = await import("./agency-managers");
const agencyManagersRouter = crearAgencyManagersRouter({
	generarContrasenaTemporal: () => "ContrasenaTemporal1",
	listarSociosDeAgencias: async (ids: string[]) =>
		base.filter((s) => s.membresias.some((m) => ids.includes(m.companyId))),
	buscarCuentaPorCorreo: async (correo: string) => {
		llamadas.audit.push({ buscar: correo });
		return cuentaPorCorreo;
	},
	crearSocio: async (input: unknown) => {
		llamadas.crearSocio.push(input);
		return { id: GERENTE, name: "Nuevo", email: "nuevo@agencia.com" };
	},
	agregarMembresia: async (...args: unknown[]) => {
		llamadas.agregarMembresia.push(args);
	},
	promoverMembresiaAGerente: async (...args: unknown[]) => {
		llamadas.promover.push(args);
	},
	cambiarEstadoMembresia: async (...args: unknown[]) => {
		llamadas.cambiarEstado.push(args);
		return cambioDeEstado;
	},
	actualizarDatosSocio: async (...args: unknown[]) => {
		llamadas.actualizarDatos.push(args);
	},
	crearEmpresa: async (...args: unknown[]) => {
		llamadas.crearEmpresa.push(args);
		return { id: AGENCIA };
	},
	actualizarEmpresa: async (...args: unknown[]) => {
		llamadas.actualizarEmpresa.push(args);
		return { id: AGENCIA };
	},
	auditRecord: (entry: unknown) => {
		llamadas.audit.push(entry);
	},
} as never);


const conSesion = { context: { session: { user: { id: ACTOR } } } } as never;
const sinSesion = { context: {} } as never;

const PROCEDURES = {
	getAgencias: undefined,
	getAgencia: { companyId: AGENCIA },
	crearAgencia: { name: "Agencia Nueva" },
	editarAgencia: { id: AGENCIA, name: "Renombrada" },
	getGerentesDeAgencia: { companyId: AGENCIA },
	getGerenteDeAgencia: { companyId: AGENCIA, userId: GERENTE },
	crearGerenteDeAgencia: {
		companyId: AGENCIA,
		nombre: "Gerente Nuevo",
		correo: "Nuevo@Agencia.com",
	},
	editarGerenteDeAgencia: { companyId: AGENCIA, userId: GERENTE, nombre: "Otro" },
} as const;

beforeEach(() => {
	currentRole = ROLES.ADMIN;
	agenciaExiste = true;
	cuentaPorCorreo = null;
	cambioDeEstado = true;
	base = [
		socio(GERENTE, [{ companyId: AGENCIA, sellerId: null }, { companyId: AJENA, sellerId: SELLER_ID }]),
		socio(VENDEDOR, [{ companyId: AGENCIA, sellerId: SELLER_ID }]),
	];
	for (const k of Object.keys(llamadas) as (keyof typeof llamadas)[]) {
		llamadas[k].length = 0;
	}
});

describe("superficie", () => {
	test("expone exactamente las 8 procedures", () => {
		expect(Object.keys(agencyManagersRouter).sort()).toEqual(
			Object.keys(PROCEDURES).sort(),
		);
	});
});

describe("permiso por rol en las 8 procedures", () => {
	for (const [nombre, input] of Object.entries(PROCEDURES)) {
		const proc = () =>
			agencyManagersRouter[nombre as keyof typeof agencyManagersRouter] as never;

		for (const rol of [ROLES.ADMIN, ROLES.SALES_SUPERVISOR]) {
			test(`${nombre}: ${rol} puede`, async () => {
				currentRole = rol;
				await expect(call(proc(), input as never, conSesion)).resolves.toBeDefined();
			});
		}

		for (const rol of Object.values(ROLES).filter(
			(r) => r !== ROLES.ADMIN && r !== ROLES.SALES_SUPERVISOR,
		)) {
			test(`${nombre}: ${rol} recibe FORBIDDEN y no escribe`, async () => {
				currentRole = rol;
				await expect(call(proc(), input as never, conSesion)).rejects.toMatchObject({
					code: "FORBIDDEN",
				});
				expect(llamadas.crearSocio).toHaveLength(0);
				expect(llamadas.agregarMembresia).toHaveLength(0);
				expect(llamadas.cambiarEstado).toHaveLength(0);
				expect(llamadas.actualizarDatos).toHaveLength(0);
				expect(llamadas.crearEmpresa).toHaveLength(0);
				expect(llamadas.actualizarEmpresa).toHaveLength(0);
			});
		}

		test(`${nombre}: sin sesión recibe UNAUTHORIZED`, async () => {
			await expect(call(proc(), input as never, sinSesion)).rejects.toMatchObject({
				code: "UNAUTHORIZED",
			});
		});
	}
});

describe("agencias", () => {
	test("crear y editar una agencia dejan una entrada en la bitácora con el id de la empresa", async () => {
		await call(agencyManagersRouter.crearAgencia, { name: "X" }, conSesion);
		await call(agencyManagersRouter.editarAgencia, { id: AGENCIA, name: "Y" }, conSesion);
		expect(llamadas.audit).toHaveLength(2);
		expect(llamadas.audit[0]).toMatchObject({
			entity: "partner_member",
			id: AGENCIA,
			action: "create_agencia",
			data: { name: "X" },
		});
		expect(llamadas.audit[1]).toMatchObject({
			entity: "partner_member",
			id: AGENCIA,
			action: "update_agencia",
			data: { id: AGENCIA, name: "Y" },
		});
	});

	test("getAgencia de una agencia que no existe da NOT_FOUND", async () => {
		agenciaExiste = false;
		await expect(
			call(agencyManagersRouter.getAgencia, { companyId: AJENA }, conSesion),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	test("crearAgencia y editarAgencia delegan en lib/companies con el actor", async () => {
		currentRole = ROLES.SALES_SUPERVISOR;
		await call(agencyManagersRouter.crearAgencia, { name: "X" }, conSesion);
		await call(agencyManagersRouter.editarAgencia, { id: AGENCIA, name: "Y" }, conSesion);
		expect(llamadas.crearEmpresa[0]).toMatchObject([
			expect.anything(),
			{ name: "X" },
			{ userId: ACTOR, userRole: ROLES.SALES_SUPERVISOR },
		]);
		expect(llamadas.actualizarEmpresa[0]).toMatchObject([
			expect.anything(),
			{ id: AGENCIA, name: "Y" },
			{ userId: ACTOR, userRole: ROLES.SALES_SUPERVISOR },
		]);
	});
});

describe("gerentes acotados", () => {
	test("getGerentesDeAgencia lista solo gerentes y no revela otras agencias", async () => {
		const r = await call(agencyManagersRouter.getGerentesDeAgencia, { companyId: AGENCIA }, conSesion);
		expect(r.map((g: { id: string }) => g.id)).toEqual([GERENTE]);
		expect(JSON.stringify(r)).not.toContain(AJENA);
	});

	test("getGerenteDeAgencia de un vendedor (no gerente) da NOT_FOUND", async () => {
		await expect(
			call(agencyManagersRouter.getGerenteDeAgencia, { companyId: AGENCIA, userId: VENDEDOR }, conSesion),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	test("getGerenteDeAgencia de un id que no es socio (admin o interno) da NOT_FOUND", async () => {
		await expect(
			call(
				agencyManagersRouter.getGerenteDeAgencia,
				{ companyId: AGENCIA, userId: "99999999-9999-4999-8999-999999999999" },
				conSesion,
			),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	test("getGerenteDeAgencia con la agencia equivocada da NOT_FOUND", async () => {
		await expect(
			call(agencyManagersRouter.getGerenteDeAgencia, { companyId: AJENA, userId: GERENTE }, conSesion),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	test("editar o desactivar a quien no es gerente de esa agencia da NOT_FOUND y no escribe", async () => {
		currentRole = ROLES.SALES_SUPERVISOR;
		for (const userId of [VENDEDOR, "99999999-9999-4999-8999-999999999999"]) {
			await expect(
				call(
					agencyManagersRouter.editarGerenteDeAgencia,
					{ companyId: AGENCIA, userId, nombre: "Hack", activa: false },
					conSesion,
				),
			).rejects.toMatchObject({ code: "NOT_FOUND" });
		}
		await expect(
			call(
				agencyManagersRouter.editarGerenteDeAgencia,
				{ companyId: AJENA, userId: GERENTE, activa: false },
				conSesion,
			),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(llamadas.actualizarDatos).toHaveLength(0);
		expect(llamadas.cambiarEstado).toHaveLength(0);
	});

	test("editar nombre y desactivar actúa solo sobre esa agencia", async () => {
		await call(
			agencyManagersRouter.editarGerenteDeAgencia,
			{ companyId: AGENCIA, userId: GERENTE, nombre: "Nombre Nuevo", activa: false },
			conSesion,
		);
		expect(llamadas.actualizarDatos).toEqual([
			[GERENTE, { nombre: "Nombre Nuevo" }, AGENCIA, expect.any(Function)],
		]);
		expect(llamadas.cambiarEstado).toEqual([
			[GERENTE, AGENCIA, false, ACTOR, expect.any(Function)],
		]);
		// Una anotación por escritura, y sin `actor`: la sesión (con su
		// suplantación) ya da el actor correcto en la bitácora.
		const anotaciones = llamadas.audit.filter(
			(e) => (e as { entity?: string }).entity === "partner_member",
		);
		expect(anotaciones).toHaveLength(2);
		for (const e of anotaciones) expect(e).not.toHaveProperty("actor");
		expect(anotaciones[0]).toMatchObject({ data: { nombre: "Nombre Nuevo" } });
		expect(anotaciones[1]).toMatchObject({ data: { activa: false } });
	});

	test("si el cambio de estado falla, el renombre ya quedó en la bitácora", async () => {
		const dep = crearAgencyManagersRouter({
			listarSociosDeAgencias: async () => base,
			actualizarDatosSocio: async () => {},
			cambiarEstadoMembresia: async () => {
				throw new Error("falla");
			},
			auditRecord: (e: unknown) => {
				llamadas.audit.push(e);
			},
		} as never);
		await expect(
			call(
				dep.editarGerenteDeAgencia,
				{ companyId: AGENCIA, userId: GERENTE, nombre: "Nuevo", activa: false },
				conSesion,
			),
		).rejects.toThrow();
		expect(llamadas.audit).toHaveLength(1);
		expect(llamadas.audit[0]).toMatchObject({ data: { nombre: "Nuevo" } });
	});

	test("si la membresía ya estaba en ese estado (false), no se anota update_gerente", async () => {
		cambioDeEstado = false;
		await call(
			agencyManagersRouter.editarGerenteDeAgencia,
			{ companyId: AGENCIA, userId: GERENTE, activa: false },
			conSesion,
		);
		expect(llamadas.cambiarEstado).toHaveLength(1);
		expect(
			llamadas.audit.filter((e) => (e as { action?: string }).action === "update_gerente"),
		).toHaveLength(0);
	});

	test("si el estado sí cambió (true), se anota update_gerente con activa", async () => {
		await call(
			agencyManagersRouter.editarGerenteDeAgencia,
			{ companyId: AGENCIA, userId: GERENTE, activa: true },
			conSesion,
		);
		expect(
			llamadas.audit.filter((e) => (e as { action?: string }).action === "update_gerente"),
		).toMatchObject([{ data: { companyId: AGENCIA, activa: true } }]);
	});

	test("desactivar al último gerente activo se permite", async () => {
		base = [socio(GERENTE, [{ companyId: AGENCIA, sellerId: null }])];
		await call(
			agencyManagersRouter.editarGerenteDeAgencia,
			{ companyId: AGENCIA, userId: GERENTE, activa: false },
			conSesion,
		);
		expect(llamadas.cambiarEstado).toHaveLength(1);
	});
});

describe("revalidación dentro de la transacción", () => {
	type Revalidar = (
		m: { companyId: string; sellerId: string | null; activa: boolean }[],
	) => void;

	async function capturar() {
		await call(
			agencyManagersRouter.editarGerenteDeAgencia,
			{ companyId: AGENCIA, userId: GERENTE, nombre: "Nuevo", activa: false },
			conSesion,
		);
		return {
			deNombre: (llamadas.actualizarDatos[0] as unknown[])[3] as Revalidar,
			deEstado: (llamadas.cambiarEstado[0] as unknown[])[4] as Revalidar,
		};
	}

	test("editar nombre y cambiar estado pasan una revalidación a la capa de datos", async () => {
		const { deNombre, deEstado } = await capturar();
		expect(typeof deNombre).toBe("function");
		expect(typeof deEstado).toBe("function");
	});

	test("la revalidación deja pasar si sigue siendo gerente de esa agencia (aun inactivo)", async () => {
		const { deNombre, deEstado } = await capturar();
		for (const revalidar of [deNombre, deEstado]) {
			expect(() =>
				revalidar([
					{ companyId: AGENCIA, sellerId: null, activa: false },
					{ companyId: AJENA, sellerId: SELLER_ID, activa: true },
				]),
			).not.toThrow();
		}
	});

	test("la revalidación aborta con NOT_FOUND si ya no es gerente de esa agencia", async () => {
		const { deNombre, deEstado } = await capturar();
		const yaNoEsGerente = [
			// lo pasaron a vendedor entre el chequeo y la escritura
			[{ companyId: AGENCIA, sellerId: SELLER_ID, activa: true }],
			// gerente solo de otra agencia
			[{ companyId: AJENA, sellerId: null, activa: true }],
			// sin membresías
			[],
		];
		for (const revalidar of [deNombre, deEstado]) {
			for (const membresias of yaNoEsGerente) {
				try {
					revalidar(membresias);
					throw new Error("debió lanzar");
				} catch (e) {
					expect(e).toMatchObject({ code: "NOT_FOUND" });
				}
			}
		}
	});
});

describe("bitácora: meta.audit", () => {
	test("las 4 procedures de escritura declaran la entidad auditada", () => {
		const meta = (p: unknown) =>
			(p as { "~orpc": { meta: { audit?: unknown } } })["~orpc"].meta.audit;
		expect(meta(agencyManagersRouter.crearGerenteDeAgencia)).toEqual({
			entity: "partner_member",
			action: "create_gerente",
		});
		expect(meta(agencyManagersRouter.editarGerenteDeAgencia)).toEqual({
			entity: "partner_member",
			action: "update_gerente",
		});
		expect(meta(agencyManagersRouter.crearAgencia)).toMatchObject({
			entity: "partner_member",
		});
		expect(meta(agencyManagersRouter.editarAgencia)).toMatchObject({
			entity: "partner_member",
		});
	});
});

describe("crearGerenteDeAgencia", () => {
	const input = { companyId: AGENCIA, nombre: "Gerente Nuevo", correo: "Nuevo@Agencia.com" };

	test("correo nuevo: crea socio con sellerId NULL, sin vendedor y sin dominio interno", async () => {
		const r = await call(agencyManagersRouter.crearGerenteDeAgencia, input, conSesion);
		expect(r).toEqual({ userId: GERENTE, contrasenaTemporal: "ContrasenaTemporal1" });
		expect(llamadas.crearSocio).toHaveLength(1);
		expect(llamadas.crearSocio[0]).toMatchObject({
			correo: "nuevo@agencia.com",
			membresias: [{ companyId: AGENCIA, sellerId: null }],
			permitirDominioInterno: false,
		});
		expect(llamadas.crearSocio[0]).not.toHaveProperty("vendedorNuevo");
	});

	test("agencia inexistente da NOT_FOUND y no crea nada", async () => {
		agenciaExiste = false;
		await expect(
			call(agencyManagersRouter.crearGerenteDeAgencia, input, conSesion),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(llamadas.crearSocio).toHaveLength(0);
	});

	test("socio existente: agrega la membresía de gerente, sin contraseña ni reemplazar las otras", async () => {
		cuentaPorCorreo = { id: VENDEDOR, role: ROLES.PARTNER };
		base = [socio(VENDEDOR, [{ companyId: AJENA, sellerId: SELLER_ID }])];
		const r = await call(agencyManagersRouter.crearGerenteDeAgencia, input, conSesion);
		expect(r).toEqual({ userId: VENDEDOR, yaExistia: true });
		expect(llamadas.agregarMembresia).toEqual([[VENDEDOR, { companyId: AGENCIA, sellerId: null }]]);
		expect(llamadas.crearSocio).toHaveLength(0);
		expect(llamadas.promover).toHaveLength(0);
	});

	test("vendedor de esa agencia sin confirmar: CONFLICT con datos y sin escribir", async () => {
		cuentaPorCorreo = { id: VENDEDOR, role: ROLES.PARTNER };
		await expect(
			call(agencyManagersRouter.crearGerenteDeAgencia, input, conSesion),
		).rejects.toMatchObject({
			code: "CONFLICT",
			data: { requiereConfirmacion: true, eraVendedor: true, activa: true },
		});
		expect(llamadas.promover).toHaveLength(0);
		expect(llamadas.agregarMembresia).toHaveLength(0);
		expect(llamadas.audit.filter((e) => (e as { entity?: string }).entity)).toHaveLength(0);
	});

	test("vendedor de esa agencia con confirmación: se promueve a gerente", async () => {
		cuentaPorCorreo = { id: VENDEDOR, role: ROLES.PARTNER };
		const r = await call(
			agencyManagersRouter.crearGerenteDeAgencia,
			{ ...input, confirmarPromocion: true },
			conSesion,
		);
		expect(r).toEqual({ userId: VENDEDOR, yaExistia: true });
		expect(llamadas.promover).toEqual([[VENDEDOR, AGENCIA]]);
		expect(llamadas.agregarMembresia).toHaveLength(0);
	});

	test("vendedor DESACTIVADO sin confirmar: el CONFLICT avisa que confirmar lo reactiva", async () => {
		cuentaPorCorreo = { id: VENDEDOR, role: ROLES.PARTNER };
		base = [socio(VENDEDOR, [{ companyId: AGENCIA, sellerId: SELLER_ID, activa: false }])];
		await expect(
			call(agencyManagersRouter.crearGerenteDeAgencia, input, conSesion),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message: expect.stringContaining(
				"Está desactivado en esta agencia; confirmar lo reactiva como gerente",
			),
			data: { requiereConfirmacion: true, eraVendedor: true, activa: false },
		});
		expect(llamadas.promover).toHaveLength(0);
	});

	test("vendedor activo: el aviso no habla de reactivar", async () => {
		cuentaPorCorreo = { id: VENDEDOR, role: ROLES.PARTNER };
		const error = await call(
			agencyManagersRouter.crearGerenteDeAgencia,
			input,
			conSesion,
		).catch((e) => e as Error);
		expect((error as Error).message).not.toMatch(/desactivado|reactiva/i);
	});

	test("correo @clubcashin.com se rechaza también si la cuenta ya existe", async () => {
		for (const cuenta of [
			{ id: VENDEDOR, role: ROLES.PARTNER },
			{ id: GERENTE, role: ROLES.PARTNER },
		]) {
			cuentaPorCorreo = cuenta;
			await expect(
				call(
					agencyManagersRouter.crearGerenteDeAgencia,
					{ ...input, correo: "Socio@ClubCashIn.com" },
					conSesion,
				),
			).rejects.toMatchObject({ code: "BAD_REQUEST" });
		}
		expect(llamadas.crearSocio).toHaveLength(0);
		expect(llamadas.agregarMembresia).toHaveLength(0);
		expect(llamadas.promover).toHaveLength(0);
		// ni siquiera se consulta la cuenta
		expect(llamadas.audit.filter((e) => (e as { buscar?: string }).buscar)).toHaveLength(0);
	});

	test("gerente inactivo sin confirmar: CONFLICT; con confirmación se reactiva", async () => {
		cuentaPorCorreo = { id: GERENTE, role: ROLES.PARTNER };
		base = [socio(GERENTE, [{ companyId: AGENCIA, sellerId: null, activa: false }])];
		await expect(
			call(agencyManagersRouter.crearGerenteDeAgencia, input, conSesion),
		).rejects.toMatchObject({
			code: "CONFLICT",
			data: { requiereConfirmacion: true, eraVendedor: false, activa: false },
		});
		expect(llamadas.promover).toHaveLength(0);
		await call(
			agencyManagersRouter.crearGerenteDeAgencia,
			{ ...input, confirmarPromocion: true },
			conSesion,
		);
		expect(llamadas.promover).toEqual([[GERENTE, AGENCIA]]);
	});

	test("ya es gerente activo de esa agencia: CONFLICT", async () => {
		cuentaPorCorreo = { id: GERENTE, role: ROLES.PARTNER };
		await expect(
			call(agencyManagersRouter.crearGerenteDeAgencia, input, conSesion),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(llamadas.promover).toHaveLength(0);
		expect(llamadas.agregarMembresia).toHaveLength(0);
	});

	test("correo de un usuario interno se rechaza siempre", async () => {
		for (const rol of [ROLES.ADMIN, ROLES.SALES, ROLES.SALES_SUPERVISOR]) {
			cuentaPorCorreo = { id: VENDEDOR, role: rol };
			await expect(
				call(agencyManagersRouter.crearGerenteDeAgencia, input, conSesion),
			).rejects.toMatchObject({ code: "BAD_REQUEST" });
		}
		expect(llamadas.crearSocio).toHaveLength(0);
		expect(llamadas.agregarMembresia).toHaveLength(0);
		expect(llamadas.promover).toHaveLength(0);
	});
});
