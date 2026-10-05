import { call } from "@orpc/server";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { user } from "../db/schema/auth";
import {
	companies,
	opportunities,
	opportunityStageHistory,
} from "../db/schema/crm";
import { partnerAccounts, partnerMembers } from "../db/schema/partners";
import { ROLES } from "../lib/roles";

// Filas que cada tabla "devuelve" en el test actual. Cada `describe` las pisa
// con `beforeEach`, así un test nunca hereda estado del anterior.
let filaUsuario: Array<{ id: string; email: string; role: string; banned: boolean }> = [];
let filasMembresia: Array<{ companyId: string }> = [];
let filaCuentaSocio: Array<{ passwordChangedAt: Date | null }> = [];
let filasOportunidad: Array<Record<string, unknown>> = [];
let filasHistorial: Array<Record<string, unknown>> = [];
let filasAgencia: Array<{ id: string; name: string }> = [];

const escrituras = { insert: 0, update: 0, delete: 0 };

// Nodo encadenable genérico: cualquier método de la query builder de Drizzle
// devuelve el mismo nodo, y `await` en cualquier punto de la cadena resuelve
// a `obtenerFilas()`. No valida el WHERE/JOIN real — lo que importa acá es el
// comportamiento de la aplicación *después* de leer la fila, no el SQL.
function cadena<T>(obtenerFilas: () => T[]) {
	const nodo = {
		from: () => nodo,
		innerJoin: () => nodo,
		leftJoin: () => nodo,
		where: () => nodo,
		orderBy: () => nodo,
		limit: () => nodo,
		then: (resolve: (filas: T[]) => void) => resolve(obtenerFilas()),
	};
	return nodo;
}

mock.module("../lib/partner-auth", () => ({
	PARTNER_AUTH_BASE_PATH: "/api/partner-auth",
	PARTNER_CHANGE_PASSWORD_PATH: "/api/partner-auth/change-password",
	// Se mockea entero: lo que importa acá es si el rate limit corta antes de
	// llegar hasta acá, no la verificación real de contraseña de Better Auth.
	partnerAuth: { api: { changePassword: async () => ({}) } },
}));

mock.module("../db", () => ({
	db: {
		select: () => ({
			from: (tabla: unknown) => {
				if (tabla === user) return cadena(() => filaUsuario);
				if (tabla === partnerMembers) return cadena(() => filasMembresia);
				if (tabla === partnerAccounts) return cadena(() => filaCuentaSocio);
				if (tabla === opportunities) return cadena(() => filasOportunidad);
				if (tabla === companies) return cadena(() => filasAgencia);
				if (tabla === opportunityStageHistory) return cadena(() => filasHistorial);
				throw new Error("Tabla no mockeada en tracker.authorization.test.ts");
			},
		}),
		// Usado solo para construir la subquery `ultimaCotizacion` al importar el
		// módulo; nunca se lee de verdad porque el `.from()` de arriba ignora la
		// proyección pedida y siempre devuelve las filas fijas del test.
		selectDistinctOn: () => ({
			from: () => ({ orderBy: () => ({ as: () => ({}) }) }),
		}),
		insert: () => {
			escrituras.insert++;
			return { values: () => ({ onConflictDoUpdate: async () => {} }) };
		},
		update: () => {
			escrituras.update++;
			return { set: () => ({ where: async () => {} }) };
		},
		delete: () => {
			escrituras.delete++;
			return { where: async () => {} };
		},
	},
}));

const { trackerRouter } = await import("./tracker");
const { partnerAuthLimiter } = await import("../lib/rate-limit");

function contextoDeSocioValido(opciones: { ip?: string } = {}) {
	const headers = new Map<string, string>();
	if (opciones.ip) headers.set("x-forwarded-for", opciones.ip);
	return {
		context: {
			partnerSession: { user: { id: "socio-1" }, session: { id: "sesion-1" } },
			headers: { get: (nombre: string) => headers.get(nombre) ?? null },
		},
	} as never;
}

function socioConAcceso(companyId: string) {
	filaUsuario = [
		{ id: "socio-1", email: "socio@example.com", role: ROLES.PARTNER, banned: false },
	];
	filasMembresia = [{ companyId }];
	filaCuentaSocio = [{ passwordChangedAt: new Date("2026-01-01") }];
}

function filaOportunidad(overrides: Record<string, unknown>) {
	return {
		id: "caso-1",
		status: "open",
		createdAt: new Date("2026-01-01"),
		updatedAt: new Date("2026-02-01"),
		closurePercentage: 50,
		agenciaNombre: "Agencia de prueba",
		leadFirstName: "Juan",
		leadLastName: "Pérez",
		vehicleMake: null,
		vehicleModel: null,
		vehicleYear: null,
		quotationBrand: null,
		quotationLine: null,
		quotationModel: null,
		vehicleValue: null,
		...overrides,
	};
}

beforeEach(() => {
	filaUsuario = [];
	filasMembresia = [];
	filaCuentaSocio = [];
	filasOportunidad = [];
	filasHistorial = [];
	filasAgencia = [];
	escrituras.insert = 0;
	escrituras.update = 0;
	escrituras.delete = 0;
});

describe("getCasoById: aislamiento por agencia", () => {
	test("rechaza con FORBIDDEN un caso que existe pero es de otra agencia", async () => {
		socioConAcceso("agencia-A");
		filasOportunidad = [filaOportunidad({ companyId: "agencia-B" })];

		await expect(
			call(
				trackerRouter.getCasoById,
				{ id: "11111111-1111-4111-8111-111111111111" },
				contextoDeSocioValido(),
			),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	test("responde NOT_FOUND cuando el id no existe, sin filtrar por agencia", async () => {
		socioConAcceso("agencia-A");
		filasOportunidad = [];

		await expect(
			call(
				trackerRouter.getCasoById,
				{ id: "11111111-1111-4111-8111-111111111111" },
				contextoDeSocioValido(),
			),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	test("devuelve el caso cuando sí pertenece a una agencia del socio", async () => {
		socioConAcceso("agencia-A");
		filasOportunidad = [filaOportunidad({ companyId: "agencia-A" })];

		const caso = await call(
			trackerRouter.getCasoById,
			{ id: "11111111-1111-4111-8111-111111111111" },
			contextoDeSocioValido(),
		);

		expect(caso.id).toBe("caso-1");
	});

	test("un id ajeno armado a mano nunca revela datos: el rechazo llega antes de leer el historial", async () => {
		// Si alguien de la Agencia 1 arma un fetch con el id de un caso de la
		// Agencia 2, el servidor igual encuentra la fila (no hay filtro de
		// agencia en el WHERE) pero la re-valida antes de devolver nada.
		socioConAcceso("agencia-1");
		filasOportunidad = [filaOportunidad({ id: "caso-de-otra-agencia", companyId: "agencia-2" })];

		const intento = call(
			trackerRouter.getCasoById,
			{ id: "22222222-2222-4222-8222-222222222222" },
			contextoDeSocioValido(),
		);

		await expect(intento).rejects.toMatchObject({
			code: "FORBIDDEN",
			message: "Este caso no pertenece a tu agencia",
		});
	});
});

describe("superficie de escritura del tracker", () => {
	test("el router expone exactamente estas 5 procedures (si agregás una, este test te obliga a revisarla)", () => {
		expect(Object.keys(trackerRouter).sort()).toEqual(
			[
				"changePartnerPassword",
				"getCasoById",
				"getCasos",
				"getPartnerAgencies",
				"getPartnerPasswordStatus",
			].sort(),
		);
	});

	test("getCasos nunca escribe en la base de datos", async () => {
		socioConAcceso("agencia-A");
		filasOportunidad = [filaOportunidad({ companyId: "agencia-A" })];

		await call(trackerRouter.getCasos, {}, contextoDeSocioValido());

		expect(escrituras).toEqual({ insert: 0, update: 0, delete: 0 });
	});

	test("getCasoById nunca escribe en la base de datos", async () => {
		socioConAcceso("agencia-A");
		filasOportunidad = [filaOportunidad({ companyId: "agencia-A" })];

		await call(
			trackerRouter.getCasoById,
			{ id: "11111111-1111-4111-8111-111111111111" },
			contextoDeSocioValido(),
		);

		expect(escrituras).toEqual({ insert: 0, update: 0, delete: 0 });
	});

	test("getPartnerAgencies nunca escribe en la base de datos", async () => {
		socioConAcceso("agencia-A");
		filasAgencia = [{ id: "agencia-A", name: "Agencia de prueba" }];

		await call(trackerRouter.getPartnerAgencies, {}, contextoDeSocioValido());

		expect(escrituras).toEqual({ insert: 0, update: 0, delete: 0 });
	});

	test("getPartnerPasswordStatus nunca escribe en la base de datos", async () => {
		socioConAcceso("agencia-A");

		await call(trackerRouter.getPartnerPasswordStatus, {}, contextoDeSocioValido());

		expect(escrituras).toEqual({ insert: 0, update: 0, delete: 0 });
	});
});

describe("changePartnerPassword: rate limit en el camino real (RPC)", () => {
	const entradaValida = {
		email: "socio@example.com",
		currentPassword: "actual1234",
		newPassword: "nueva12345",
		confirmPassword: "nueva12345",
	};

	// Antes del fix, esta llamada nunca pasaba por partnerAuthLimiter: el
	// límite solo vivía en /api/partner-auth/change-password, una ruta que
	// esta pantalla (cambiar-contrasena.tsx) no usa. Prueba que ahora sí
	// comparte cupo, con una IP exclusiva para no chocar con otros tests.
	test("bloquea con TOO_MANY_REQUESTS al superar el máximo de intentos", async () => {
		socioConAcceso("agencia-A");
		const ctx = () => contextoDeSocioValido({ ip: "203.0.113.77" });

		const intentos = await Promise.all(
			Array.from({ length: 5 }, () =>
				call(trackerRouter.changePartnerPassword, entradaValida, ctx()).catch(
					(error) => error,
				),
			),
		);
		// Los primeros 5 pasan el rate limit (fallan o no en el paso de
		// contraseña, no es lo que se prueba acá).
		for (const resultado of intentos) {
			expect(resultado?.code).not.toBe("TOO_MANY_REQUESTS");
		}

		await expect(
			call(trackerRouter.changePartnerPassword, entradaValida, ctx()),
		).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
	});

	test("comparte cupo con la ruta cruda /api/partner-auth/change-password", async () => {
		socioConAcceso("agencia-A");
		const ip = "203.0.113.99";
		const ruta = "/api/partner-auth/change-password";

		// 4 intentos ya consumidos por la ruta cruda (como si alguien hubiera
		// atacado directo la API)...
		for (let i = 0; i < 4; i++) {
			partnerAuthLimiter.permitir(`${ip}:${ruta}`);
		}

		// ...dejan solo 1 disponible para el mismo socio entrando por la
		// pantalla real (RPC): el 5to pasa, el 6to no.
		await call(
			trackerRouter.changePartnerPassword,
			entradaValida,
			contextoDeSocioValido({ ip }),
		);

		await expect(
			call(
				trackerRouter.changePartnerPassword,
				entradaValida,
				contextoDeSocioValido({ ip }),
			),
		).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
	});
});
