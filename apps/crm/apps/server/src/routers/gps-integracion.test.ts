/**
 * CB-121 — endpoints de bitácora técnica, salud y alertas de la integración
 * GPS/Wialon. Mock de `db` propio y aislado (no reutiliza el de wialon.test.ts):
 * ese mock identifica ramas por los CAMPOS que pide cada `select`, y estos
 * endpoints nuevos hacen `db.select()` SIN proyección (igual que el middleware
 * de auth), así que se diferencian por la TABLA (`.from(tabla)`) en vez de
 * por campos.
 */
import { afterEach, describe, expect, it, mock } from "bun:test";
import { call, ORPCError } from "@orpc/server";
import { user } from "../db/schema/auth";
import {
	gpsIntegracionAlertas,
	gpsIntegracionLogs,
} from "../db/schema/gps-integracion-logs";
import type { Context } from "../lib/context";
import {
	getWialonClient,
	setWialonClient,
} from "../services/wialon/wialon-client";

let rolUsuarioMock = "admin";
let logsFilasMock: Record<string, unknown>[] = [];
let logsTotalMock = 0;
let alertasFilasMock: Record<string, unknown>[] = [];
let alertaResueltaFilasMock: Record<string, unknown>[] = [];
let ultimoCriticoFilasMock: Record<string, unknown>[] = [];
let alertasAbiertasTotalMock = 0;

function mockDb() {
	return {
		select: (campos?: Record<string, unknown>) => ({
			from: (tabla: unknown) => {
				if (tabla === user) {
					return {
						where: () => ({
							limit: async () => [{ id: "user-test", role: rolUsuarioMock }],
						}),
					};
				}
				if (tabla === gpsIntegracionLogs) {
					// Cuatro formas de consultar esta tabla, cada una con su cadena:
					//  - getGpsIntegracionSalud (ventana): { resultado, duracionMs },
					//    resuelve directo en .where() (sin orderBy/limit/offset).
					//  - getGpsIntegracionSalud (último crítico): { errorCode, operacion,
					//    createdAt } → where → orderBy → limit.
					//  - getGpsIntegracionLogs (conteo): { total }, resuelve en .where().
					//  - getGpsIntegracionLogs (filas): columnas + { userNombre,
					//    userEmail } → leftJoin(user) → where → orderBy → limit → offset.
					const camposNombres = campos ? Object.keys(campos) : [];
					if (camposNombres.includes("userNombre")) {
						const lista = {
							leftJoin: () => lista,
							where: () => lista,
							orderBy: () => lista,
							limit: () => lista,
							offset: async () => logsFilasMock,
						};
						return lista;
					}
					const esConteo =
						camposNombres.length === 1 && camposNombres[0] === "total";
					const esVentanaSalud =
						camposNombres.includes("resultado") &&
						camposNombres.includes("duracionMs");
					const esUltimoCritico = camposNombres.includes("errorCode");

					if (esVentanaSalud) {
						return { where: async () => logsFilasMock };
					}
					if (esUltimoCritico) {
						const encadenable = {
							where: () => encadenable,
							orderBy: () => encadenable,
							limit: async () => ultimoCriticoFilasMock,
						};
						return encadenable;
					}
					if (esConteo) {
						return { where: async () => [{ total: logsTotalMock }] };
					}
					throw new Error(
						`Consulta a gps_integracion_logs no reconocida: ${camposNombres.join(",")}`,
					);
				}
				if (tabla === gpsIntegracionAlertas) {
					const esConteo = Boolean(
						campos && "total" in campos && Object.keys(campos).length === 1,
					);
					if (esConteo) {
						return { where: async () => [{ total: alertasAbiertasTotalMock }] };
					}
					const encadenable = {
						orderBy: () => encadenable,
						limit: async () => alertasFilasMock,
					};
					return encadenable;
				}
				return { where: () => ({ limit: async () => [] }) };
			},
		}),
		update: (tabla: unknown) => ({
			set: () => ({
				where: () => ({
					returning: async () =>
						tabla === gpsIntegracionAlertas ? alertaResueltaFilasMock : [],
				}),
			}),
		}),
	};
}

mock.module("../db", () => ({ db: mockDb() }));

const { gpsIntegracionRouter } = await import("./gps-integracion");

function ctx(role: string): Context {
	rolUsuarioMock = role;
	return {
		session: { user: { id: "user-test", email: "u@example.com" } },
		user: { id: "user-test", email: "u@example.com", role },
	} as unknown as Context;
}

describe("CB-121 — getGpsIntegracionLogs", () => {
	afterEach(() => {
		logsFilasMock = [];
		logsTotalMock = 0;
	});

	it("admin puede listar la bitácora técnica", async () => {
		logsFilasMock = [
			{
				id: "log-1",
				correlationId: "11111111-1111-1111-1111-111111111111",
				intento: 1,
				operacion: "core/search_items",
				origen: "getGpsVehiculo",
				resultado: "error",
				errorCode: "WIALON_TIMEOUT",
				wialonErrorCode: null,
				httpStatus: null,
				severidad: "warning",
				duracionMs: 5000,
				requestResumen: null,
				responseResumen: null,
				userId: "user-1",
				userNombre: "Ana Pérez",
				userEmail: "ana@example.com",
				vehicleId: "veh-1",
				numeroCreditoSifco: "0101",
				gpsConsultaLogId: null,
				createdAt: new Date(),
			},
			{
				id: "log-2",
				correlationId: "22222222-2222-2222-2222-222222222222",
				intento: 1,
				operacion: "token/login",
				origen: "desconocido",
				resultado: "ok",
				errorCode: null,
				wialonErrorCode: null,
				httpStatus: null,
				severidad: "info",
				duracionMs: 300,
				requestResumen: null,
				responseResumen: null,
				userId: null,
				userNombre: null,
				userEmail: null,
				vehicleId: null,
				numeroCreditoSifco: null,
				gpsConsultaLogId: null,
				createdAt: new Date(),
			},
		];
		logsTotalMock = 2;

		const res = await call(
			gpsIntegracionRouter.getGpsIntegracionLogs,
			{ page: 1, perPage: 25 },
			{ context: ctx("admin") },
		);
		expect(res.total).toBe(2);
		expect(res.items[0]?.errorCode).toBe("WIALON_TIMEOUT");
		expect(res.items[0]?.userNombre).toBe("Ana Pérez");
		expect(res.items[0]?.userEmail).toBe("ana@example.com");
		expect(res.items[1]?.userNombre).toBeNull();
	});

	it("un asesor de cobros no puede ver la bitácora técnica (FORBIDDEN)", async () => {
		await expect(
			call(
				gpsIntegracionRouter.getGpsIntegracionLogs,
				{ page: 1, perPage: 25 },
				{ context: ctx("cobros") },
			),
		).rejects.toThrow(ORPCError);
	});
});

describe("CB-121 — getGpsIntegracionSalud", () => {
	afterEach(() => {
		alertasAbiertasTotalMock = 0;
		ultimoCriticoFilasMock = [];
	});

	it("admin ve el resumen de salud con el estado del circuito", async () => {
		alertasAbiertasTotalMock = 2;
		setWialonClient(null);
		getWialonClient(); // fuerza a crear la instancia por defecto (circuito cerrado)

		const res = await call(
			gpsIntegracionRouter.getGpsIntegracionSalud,
			undefined,
			{
				context: ctx("admin"),
			},
		);
		expect(res.alertasAbiertas).toBe(2);
		expect(res.circuito.abierto).toBe(false);
	});

	it("un asesor de cobros no puede ver la salud de la integración (FORBIDDEN)", async () => {
		await expect(
			call(gpsIntegracionRouter.getGpsIntegracionSalud, undefined, {
				context: ctx("cobros"),
			}),
		).rejects.toThrow(ORPCError);
	});
});

describe("CB-121 — getGpsAlertas", () => {
	afterEach(() => {
		alertasFilasMock = [];
	});

	it("un supervisor de cobros SÍ puede ver las alertas abiertas", async () => {
		alertasFilasMock = [
			{
				id: "alerta-1",
				tipo: "tasa_error",
				errorCode: null,
				detalle: "Tasa de error de 40% en los últimos 15 min.",
				estado: "abierta",
				primeraVez: new Date(),
				ultimaVez: new Date(),
				ocurrencias: 3,
				resueltaPor: null,
				resueltaAt: null,
				notaResolucion: null,
			},
		];

		const res = await call(gpsIntegracionRouter.getGpsAlertas, undefined, {
			context: ctx("cobros_supervisor"),
		});
		expect(res.items.length).toBe(1);
		expect(res.items[0]?.tipo).toBe("tasa_error");
	});

	it("un asesor de cobros regular NO puede ver las alertas (FORBIDDEN)", async () => {
		await expect(
			call(gpsIntegracionRouter.getGpsAlertas, undefined, {
				context: ctx("cobros"),
			}),
		).rejects.toThrow(ORPCError);
	});
});

describe("CB-121 — resolverGpsAlerta", () => {
	afterEach(() => {
		alertaResueltaFilasMock = [];
	});

	it("admin puede resolver una alerta abierta", async () => {
		alertaResueltaFilasMock = [{ id: "alerta-1" }];
		const res = await call(
			gpsIntegracionRouter.resolverGpsAlerta,
			{
				alertaId: "11111111-1111-1111-1111-111111111111",
				nota: "Token de Wialon renovado, ya conecta.",
			},
			{ context: ctx("admin") },
		);
		expect(res.success).toBe(true);
	});

	it("responde NOT_FOUND si la alerta no existe o ya estaba resuelta", async () => {
		alertaResueltaFilasMock = [];
		await expect(
			call(
				gpsIntegracionRouter.resolverGpsAlerta,
				{
					alertaId: "11111111-1111-1111-1111-111111111111",
					nota: "Ya no aplica, se resolvió sola.",
				},
				{ context: ctx("admin") },
			),
		).rejects.toThrow(ORPCError);
	});

	it("un supervisor de cobros NO puede resolver alertas (solo admin, FORBIDDEN)", async () => {
		await expect(
			call(
				gpsIntegracionRouter.resolverGpsAlerta,
				{
					alertaId: "11111111-1111-1111-1111-111111111111",
					nota: "Intento sin permiso suficiente.",
				},
				{ context: ctx("cobros_supervisor") },
			),
		).rejects.toThrow(ORPCError);
	});
});
