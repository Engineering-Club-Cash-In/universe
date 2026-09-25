/**
 * CB-119 — registrarEventoGps: resolución unidad→caso, dedup del evento y de
 * la notificación, y a quién escala cada tipo.
 *
 * Mock de `db` propio. Solo se mockean obtenerSupervisoresCobros y
 * resolverUsuarioSistemaCobros (las dos funciones con I/O de
 * cobros-notif-helpers); filasNotificacionCobros es pura y se reusa la real.
 */
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test";
import { user } from "../../db/schema/auth";
import { casosCobros } from "../../db/schema/cobros";
import { gpsEventos } from "../../db/schema/gps-eventos";
import { notifications } from "../../db/schema/notifications";
import { vehicles } from "../../db/schema/vehicles";
import { carteraBackClient } from "../cartera-back-client";
import * as carteraBackIntegration from "../cartera-back-integration";
import { filasNotificacionCobros } from "../cobros-notif-helpers";

let vehiculoMock: { id: string } | undefined;
let casoActivoMock: { id: string } | undefined;
let responsableCobrosMock: string | null = "asesor-1";
let numeroCreditoSifcoMock: string | null = "01010214100000";
// Asesor actual según cartera-back (resolverAsesorActual): distinto de
// responsableCobrosMock a propósito en el default, para que los tests
// existentes (que no lo tocan) sigan probando el camino real: cartera-back
// deshabilitado → null → cae al fallback responsableCobrosMock.
let asesorActualUserIdMock: string | null = null;
let eventoYaExisteMock = false;
let eventoExistenteIdMock = "evento-existente";
let eventoExistenteNotificadoMock = true;
let supervisoresMock: string[] = [];
let usuarioSistemaMock: string | null = "sistema-1";
let notificacionesInsertadas: Record<string, unknown>[] = [];
let notificacionInsertDaFilas = true;
let eventoInsertadoValues: Record<string, unknown> | null = null;
// Último evento notificado de la misma unidad+tipo+caso (ventana deslizante
// de dedup de notificación). null = no hay ninguno (siempre notifica).
let ultimoNotificadoMock: { ocurridoAt: Date } | null = null;

function mockDb() {
	return {
		select: (campos?: Record<string, unknown>) => ({
			from: (tabla: unknown) => {
				if (tabla === vehicles) {
					const camposNombres = campos ? Object.keys(campos) : [];
					if (
						camposNombres.includes("vehicleId") &&
						camposNombres.includes("casoCobroId")
					) {
						// resolverVehiculoYCaso: dos ramas (por contrato / por
						// oportunidad), cada una
						// vehicles→innerJoin→innerJoin→where→orderBy→limit. Ambas
						// devuelven lo mismo acá: el mock no distingue de cuál vino,
						// solo si hay caso activo o no.
						return {
							innerJoin: () => ({
								innerJoin: () => ({
									where: () => ({
										orderBy: () => ({
											limit: async () =>
												casoActivoMock && vehiculoMock
													? [
															{
																vehicleId: vehiculoMock.id,
																casoCobroId: casoActivoMock.id,
															},
														]
													: [],
										}),
									}),
								}),
							}),
						};
					}
					// Fallback sin caso: select({id}).from(vehicles).where().limit()
					return {
						where: () => ({
							limit: async () => (vehiculoMock ? [vehiculoMock] : []),
						}),
					};
				}
				if (tabla === casosCobros) {
					// Solo queda la consulta de responsableCobros +
					// numeroCreditoSifco (el join de vehicle→caso ahora arranca en
					// `vehicles`, no en `casosCobros`).
					return {
						where: () => ({
							limit: async () =>
								responsableCobrosMock != null
									? [
											{
												responsableCobros: responsableCobrosMock,
												numeroCreditoSifco: numeroCreditoSifcoMock,
											},
										]
									: [],
						}),
					};
				}
				if (tabla === user) {
					// resolverAsesorActual: select({id}).from(user).where().limit()
					return {
						where: () => ({
							limit: async () =>
								asesorActualUserIdMock ? [{ id: asesorActualUserIdMock }] : [],
						}),
					};
				}
				if (tabla === gpsEventos) {
					// Dos consultas distintas contra gpsEventos, distinguidas por
					// los campos pedidos en select():
					//  1. select({id, notificado}) — evento existente tras un
					//     conflicto de dedup (sin .orderBy).
					//  2. select({ocurridoAt}) — último evento notificado de la
					//     misma unidad+tipo+caso, para la ventana deslizante (con
					//     .orderBy().limit()).
					const camposNombres = campos ? Object.keys(campos) : [];
					if (camposNombres.includes("ocurridoAt")) {
						return {
							where: () => ({
								orderBy: () => ({
									limit: async () =>
										ultimoNotificadoMock ? [ultimoNotificadoMock] : [],
								}),
							}),
						};
					}
					return {
						where: () => ({
							limit: async () => [
								{
									id: eventoExistenteIdMock,
									notificado: eventoExistenteNotificadoMock,
								},
							],
						}),
					};
				}
				throw new Error(`select from tabla no mockeada: ${String(tabla)}`);
			},
		}),
		insert: (tabla: unknown) => {
			if (tabla === gpsEventos) {
				return {
					values: (valores: Record<string, unknown>) => {
						eventoInsertadoValues = valores;
						return {
							onConflictDoNothing: () => ({
								returning: async () =>
									eventoYaExisteMock ? [] : [{ id: "evento-nuevo" }],
							}),
						};
					},
				};
			}
			if (tabla === notifications) {
				return {
					values: (filas: Record<string, unknown>[]) => {
						notificacionesInsertadas = filas;
						return {
							onConflictDoNothing: () => ({
								returning: async () =>
									notificacionInsertDaFilas
										? filas.map((_, i) => ({ id: `notif-${i}` }))
										: [],
							}),
						};
					},
				};
			}
			throw new Error(`insert en tabla no mockeada: ${String(tabla)}`);
		},
		update: (tabla: unknown) => {
			if (tabla === gpsEventos) {
				return { set: () => ({ where: async () => undefined }) };
			}
			throw new Error(`update en tabla no mockeada: ${String(tabla)}`);
		},
	};
}

mock.module("../../db", () => ({ db: mockDb() }));
mock.module("../cobros-notif-helpers", () => ({
	filasNotificacionCobros,
	obtenerSupervisoresCobros: async () => supervisoresMock,
	resolverUsuarioSistemaCobros: async () => usuarioSistemaMock,
}));

const { registrarEventoGps } = await import("./gps-eventos");

const wialonUnitId = 30361901;
const ocurridoAt = new Date("2026-09-24T10:00:00.000Z");

let isCarteraBackEnabledSpy: ReturnType<typeof spyOn>;
// El mock devuelve solo {asesor: {emailCashIn}}, el resto de
// CreditoDirectoResponse es irrelevante para resolverAsesorActual.
// biome-ignore lint/suspicious/noExplicitAny: ver comentario arriba.
let getCreditoSpy: any;

beforeEach(() => {
	vehiculoMock = { id: "vehiculo-1" };
	casoActivoMock = { id: "caso-1" };
	responsableCobrosMock = "asesor-1";
	numeroCreditoSifcoMock = "01010214100000";
	asesorActualUserIdMock = null;
	eventoYaExisteMock = false;
	eventoExistenteIdMock = "evento-existente";
	eventoExistenteNotificadoMock = true;
	supervisoresMock = ["supervisor-1"];
	usuarioSistemaMock = "sistema-1";
	notificacionesInsertadas = [];
	notificacionInsertDaFilas = true;
	eventoInsertadoValues = null;
	ultimoNotificadoMock = null;

	// Default: cartera-back deshabilitado → resolverAsesorActual devuelve
	// null de inmediato → registrarEventoGps cae al fallback
	// responsableCobros, igual que el comportamiento de antes de este fix.
	// Los tests que prueban el camino NUEVO lo sobreescriben explícitamente.
	isCarteraBackEnabledSpy = spyOn(
		carteraBackIntegration,
		"isCarteraBackEnabled",
	).mockReturnValue(false);
	getCreditoSpy = spyOn(carteraBackClient, "getCredito");
	getCreditoSpy.mockImplementation(async () => ({ asesor: null }));
});

afterEach(() => {
	mock.restore();
});

describe("CB-119 — registrarEventoGps", () => {
	test("unidad sin vehículo vinculado: guarda el evento pero no notifica", async () => {
		vehiculoMock = undefined;
		casoActivoMock = undefined;

		const resultado = await registrarEventoGps({
			tipo: "ignicion",
			wialonUnitId,
			ocurridoAt,
		});

		expect(resultado.vehicleId).toBeNull();
		expect(resultado.casoCobroId).toBeNull();
		expect(resultado.notificado).toBe(false);
		expect(notificacionesInsertadas).toHaveLength(0);
	});

	test("vehículo sin caso de cobro activo: guarda el evento pero no notifica", async () => {
		casoActivoMock = undefined;

		const resultado = await registrarEventoGps({
			tipo: "ignicion",
			wialonUnitId,
			ocurridoAt,
		});

		expect(resultado.vehicleId).toBe("vehiculo-1");
		expect(resultado.casoCobroId).toBeNull();
		expect(resultado.notificado).toBe(false);
	});

	test("evento duplicado (mismo unitId+tipo+ocurridoAt): no reinserta ni notifica", async () => {
		eventoYaExisteMock = true;

		const resultado = await registrarEventoGps({
			tipo: "desconexion_energia",
			wialonUnitId,
			ocurridoAt,
		});

		expect(resultado.duplicado).toBe(true);
		expect(resultado.eventoId).toBe(eventoExistenteIdMock);
		expect(resultado.notificado).toBe(false);
		expect(notificacionesInsertadas).toHaveLength(0);
	});

	test("evento existe pero no fue notificado (fallo transitorio en la corrida anterior): reintenta la notificación", async () => {
		eventoYaExisteMock = true;
		eventoExistenteNotificadoMock = false;

		const resultado = await registrarEventoGps({
			tipo: "desconexion_energia",
			wialonUnitId,
			ocurridoAt,
		});

		expect(resultado.duplicado).toBe(true);
		expect(resultado.eventoId).toBe(eventoExistenteIdMock);
		expect(resultado.notificado).toBe(true);
		expect(notificacionesInsertadas.length).toBeGreaterThan(0);
	});

	test("dedupKey del evento incluye el SIFCO esperado: una unidad reasignada a otro caso B4 no colisiona con el evento ya notificado del caso viejo", async () => {
		await registrarEventoGps({
			tipo: "desconexion_energia",
			wialonUnitId,
			ocurridoAt,
			numeroCreditoSifcoEsperado: "01010214100000",
		});
		const dedupKeyPrimerCaso = eventoInsertadoValues?.dedupKey;

		await registrarEventoGps({
			tipo: "desconexion_energia",
			wialonUnitId,
			ocurridoAt,
			numeroCreditoSifcoEsperado: "02020214100000",
		});
		const dedupKeySegundoCaso = eventoInsertadoValues?.dedupKey;

		expect(dedupKeyPrimerCaso).not.toBe(dedupKeySegundoCaso);
	});

	test("desconexión de energía: notifica al asesor Y a los supervisores", async () => {
		const resultado = await registrarEventoGps({
			tipo: "desconexion_energia",
			wialonUnitId,
			ocurridoAt,
		});

		expect(resultado.notificado).toBe(true);
		expect(notificacionesInsertadas).toHaveLength(2);
		expect(
			notificacionesInsertadas.some((f) => f.assignedTo === "asesor-1"),
		).toBe(true);
		expect(
			notificacionesInsertadas.some((f) => f.assignedTo === "supervisor-1"),
		).toBe(true);
	});

	test("sin reportar: también escala a supervisores", async () => {
		await registrarEventoGps({
			tipo: "sin_reportar",
			wialonUnitId,
			ocurridoAt,
		});

		expect(
			notificacionesInsertadas.some((f) => f.assignedTo === "supervisor-1"),
		).toBe(true);
	});

	test("salida de geocerca: también escala a supervisores", async () => {
		await registrarEventoGps({
			tipo: "salida_geocerca",
			wialonUnitId,
			ocurridoAt,
		});

		expect(
			notificacionesInsertadas.some((f) => f.assignedTo === "supervisor-1"),
		).toBe(true);
	});

	test("ignición: solo notifica al asesor, no a supervisores", async () => {
		await registrarEventoGps({
			tipo: "ignicion",
			wialonUnitId,
			ocurridoAt,
		});

		expect(notificacionesInsertadas).toHaveLength(1);
		expect(notificacionesInsertadas[0]?.assignedTo).toBe("asesor-1");
	});

	test("caso sin responsable resuelto (responsableCobros null): no arma fila de asesor", async () => {
		responsableCobrosMock = null;
		supervisoresMock = [];

		const resultado = await registrarEventoGps({
			tipo: "ignicion",
			wialonUnitId,
			ocurridoAt,
		});

		expect(resultado.notificado).toBe(false);
		expect(notificacionesInsertadas).toHaveLength(0);
	});

	test("sin usuario sistema resuelto: no notifica (no puede setear created_by)", async () => {
		usuarioSistemaMock = null;

		const resultado = await registrarEventoGps({
			tipo: "ignicion",
			wialonUnitId,
			ocurridoAt,
		});

		expect(resultado.notificado).toBe(false);
		expect(notificacionesInsertadas).toHaveLength(0);
	});

	test("todas las filas de notificación usan cobrosTipo 'gps_evento' y apuntan al caso", async () => {
		await registrarEventoGps({
			tipo: "desconexion_energia",
			wialonUnitId,
			ocurridoAt,
		});

		for (const fila of notificacionesInsertadas) {
			expect(fila.cobrosTipo).toBe("gps_evento");
			expect(fila.relatedEntityId).toBe("caso-1");
			expect(fila.redirectPage).toBe("cobros_detail");
		}
	});

	test("insert de notificación sin filas devueltas (ya deduplicada por índice único): notificado queda false", async () => {
		notificacionInsertDaFilas = false;

		const resultado = await registrarEventoGps({
			tipo: "ignicion",
			wialonUnitId,
			ocurridoAt,
		});

		expect(resultado.notificado).toBe(false);
	});
});

describe("CB-119 — ventana de dedup de notificación: deslizante, no por bucket fijo", () => {
	test("dos transiciones a los dos lados de un corte de bucket, apenas minutos de diferencia real: NO vuelve a notificar", async () => {
		// Con un bucket fijo (aunque esté alineado a hora de Guatemala), dos
		// eventos que caen justo a cada lado del corte del bucket se tratan
		// como si no hubiera relación entre ellos, aunque hayan pasado pocos
		// minutos — la ventana deslizante evita eso comparando siempre contra
		// el último evento NOTIFICADO real, no contra un corte de calendario.
		ultimoNotificadoMock = {
			ocurridoAt: new Date("2026-09-24T23:58:00.000Z"),
		};

		const resultado = await registrarEventoGps({
			tipo: "ignicion",
			wialonUnitId,
			ocurridoAt: new Date("2026-09-25T00:08:00.000Z"),
		});

		expect(resultado.notificado).toBe(false);
		expect(notificacionesInsertadas).toHaveLength(0);
	});

	test("último evento notificado fuera de la ventana (24h+ para ignición): sí vuelve a notificar", async () => {
		ultimoNotificadoMock = {
			ocurridoAt: new Date("2026-09-24T10:00:00.000Z"),
		};

		const resultado = await registrarEventoGps({
			tipo: "ignicion",
			wialonUnitId,
			ocurridoAt: new Date("2026-09-26T10:00:00.000Z"),
		});

		expect(resultado.notificado).toBe(true);
		expect(notificacionesInsertadas.length).toBeGreaterThan(0);
	});

	test("sin evento notificado previo: notifica (primera vez que se ve la condición)", async () => {
		ultimoNotificadoMock = null;

		const resultado = await registrarEventoGps({
			tipo: "ignicion",
			wialonUnitId,
			ocurridoAt,
		});

		expect(resultado.notificado).toBe(true);
	});
});

describe("CB-119 — resolución del asesor: prioriza cartera-back sobre responsableCobros (bug encontrado)", () => {
	test("cartera-back deshabilitado: usa responsableCobros como siempre (comportamiento previo intacto)", async () => {
		isCarteraBackEnabledSpy.mockReturnValue(false);

		await registrarEventoGps({ tipo: "ignicion", wialonUnitId, ocurridoAt });

		expect(getCreditoSpy).not.toHaveBeenCalled();
		expect(notificacionesInsertadas[0]?.assignedTo).toBe("asesor-1");
	});

	test("cartera-back tiene un asesor DISTINTO (bucket reasignó): notifica al asesor NUEVO, no al viejo", async () => {
		isCarteraBackEnabledSpy.mockReturnValue(true);
		getCreditoSpy.mockImplementation(async () => ({
			asesor: { emailCashIn: "nuevo@clubcashin.com" },
		}));
		asesorActualUserIdMock = "asesor-nuevo-tras-reasignacion";

		await registrarEventoGps({ tipo: "ignicion", wialonUnitId, ocurridoAt });

		expect(getCreditoSpy).toHaveBeenCalledWith(
			numeroCreditoSifcoMock,
			false,
			false,
		);
		expect(notificacionesInsertadas[0]?.assignedTo).toBe(
			"asesor-nuevo-tras-reasignacion",
		);
		expect(
			notificacionesInsertadas.some((f) => f.assignedTo === "asesor-1"),
		).toBe(false);
	});

	test("cartera-back habilitado pero sin asesor mapeable en el CRM: cae a responsableCobros", async () => {
		isCarteraBackEnabledSpy.mockReturnValue(true);
		getCreditoSpy.mockImplementation(async () => ({
			asesor: { emailCashIn: "sin-cuenta-en-el-crm@clubcashin.com" },
		}));
		asesorActualUserIdMock = null; // el email no matcheó ningún user

		await registrarEventoGps({ tipo: "ignicion", wialonUnitId, ocurridoAt });

		expect(notificacionesInsertadas[0]?.assignedTo).toBe("asesor-1");
	});

	test("cartera-back habilitado pero getCredito lanza: no rompe el evento, cae a responsableCobros", async () => {
		isCarteraBackEnabledSpy.mockReturnValue(true);
		getCreditoSpy.mockImplementation(async () => {
			throw new Error("cartera-back caído");
		});

		const resultado = await registrarEventoGps({
			tipo: "ignicion",
			wialonUnitId,
			ocurridoAt,
		});

		expect(resultado.notificado).toBe(true);
		expect(notificacionesInsertadas[0]?.assignedTo).toBe("asesor-1");
	});

	test("caso sin numeroCreditoSifco: no llama a cartera-back, cae directo a responsableCobros", async () => {
		numeroCreditoSifcoMock = null;
		isCarteraBackEnabledSpy.mockReturnValue(true);

		await registrarEventoGps({ tipo: "ignicion", wialonUnitId, ocurridoAt });

		expect(getCreditoSpy).not.toHaveBeenCalled();
		expect(notificacionesInsertadas[0]?.assignedTo).toBe("asesor-1");
	});
});
