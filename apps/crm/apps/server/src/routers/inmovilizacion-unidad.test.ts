/**
 * CB-041 — solicitarInmovilizacion, decidirInmovilizacion, marcarEjecutada,
 * registrarResultadoLlamada.
 *
 * Mock de `db` propio: identifica ramas por TABLA (`.from(tabla)` /
 * `.insert(tabla)` / `.update(tabla)`), igual que gps-eventos-router.test.ts
 * y wialon.test.ts. `db.transaction` recibe un `tx` con la misma forma que
 * `db` — alcanza para los casos que este router necesita en transacción.
 */
import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { call, ORPCError } from "@orpc/server";
import { user } from "../db/schema/auth";
import { casosCobros, contactosCobros } from "../db/schema/cobros";
import {
	inmovilizacionesUnidad,
	inmovilizacionesUnidadEventos,
} from "../db/schema/inmovilizacion-unidad";
import { vehicles } from "../db/schema/vehicles";
import { moduloAccesoFalso } from "../lib/acceso-caso-cobro.mock";
import type { Context } from "../lib/context";

let rolUsuarioMock = "cobros";
let responsableCasoMock: string | null = "user-test";
// Cartera no responde al buscar el dueño del crédito (lectura estricta).
let carteraFallaMock = false;
let solicitadoPorMarcarEjecutadaMock = "user-test";
let numeroCreditoSifcoMock: string | null = "01010214100000";
let vehicleIdMock: string | null; // inicializado abajo, junto a VEHICLE_ID
let wialonUnitIdCasoMock: number | null = 12345;
let wialonUnitIdVehiculoMock: number | null = 12345;
let vehiculoExisteMock = true;
let carteraHabilitadaMock = true;

// null = inserta bien; "unique" = 23505 (índice único de solicitud abierta);
// "unique_envuelto" = 23505 dentro de `cause` (como lo envuelve Drizzle);
// "otro" = cualquier otro error de DB (no debe traducirse a CONFLICT).
let insertError: null | "unique" | "unique_envuelto" | "otro" = null;
let transactionError: Error | null = null;
let inmovilizacionesInsertadas: Record<string, unknown>[] = [];
let eventosInsertados: Record<string, unknown>[] = [];
let inmovilizacionExistente: Record<string, unknown> | null = null;
let historialCasoMock: Record<string, unknown>[] = [];
// Por defecto null (la mayoría de los tests no necesitan distinguir unidad
// compartida). Los tests que SÍ prueban D-10 lo sobreescriben para simular
// un historial de UNIDAD FÍSICA distinto al del caso — getHistorialCaso y
// getHistorialUnidadFisica tienen la misma firma
// (select().from(tabla).where().orderBy()), así que el mock no puede
// distinguirlas por la consulta en sí. Las distingue por CUÁNTAS llamadas
// a esta tabla ya pasaron antes de la que nos interesa (configurable por
// `llamadasAntesDeHistorialFisico`, ver abajo):
//  - getInmovilizacionesCaso llama primero getHistorialCaso y DESPUÉS
//    getHistorialUnidadFisica → 1 llamada antes (el default).
//  - registrarResultadoLlamada / registrarLlamadaReactivacion llaman SOLO
//    getHistorialUnidadFisica, nada antes → 0 (los tests de esos describe
//    lo pisan).
let historialUnidadFisicaMock: Record<string, unknown>[] | null = null;
let llamadasAntesDeHistorialFisico = 1;
let llamadasHistorialUnidad = 0;
let updateDevuelveFila = true;
let contactoExisteMock = true;
let contactoInmovilizacionIdMock: string | null = null;
let contactoUpdateDevuelveFila = true;
let resolverPendientesLlamadas: string[] = [];
let unidadReactivadaNotificada = 0;
let resolverAvisoLlamarClienteLlamadas: string[] = [];
let notificarLlamarClienteLlamadas: { asesorUserId: string }[] = [];
let reconciliarAvisosLlamadas: (readonly string[] | undefined)[] = [];
let onNotificarLlamarCliente: (() => void) | null = null;
let reactivacionesObsoletasMock: { id: string }[] = [];
// bloquearUnidadFisica (review de Codex, PR #1758): cada llamada a
// tx.execute() dentro de una transacción — para confirmar que el advisory
// lock se adquiere, y ANTES que cualquier SELECT/UPDATE sobre una fila.
let executeLlamadas: string[] = [];

const CASO_ID = "11111111-1111-1111-1111-111111111111";
const VEHICLE_ID = "22222222-2222-2222-2222-222222222222";
vehicleIdMock = VEHICLE_ID;
const INMOV_ID = "33333333-3333-3333-3333-333333333333";
const CONTACTO_ID = "44444444-4444-4444-4444-444444444444";

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
				if (tabla === casosCobros && campos && "clienteNombre" in campos) {
					// getCasoParaInmovilizacion (con joins encadenados)
					return {
						leftJoin: () => ({
							leftJoin: () => ({
								leftJoin: () => ({
									where: () => ({
										limit: async () =>
											numeroCreditoSifcoMock
												? [
														{
															id: CASO_ID,
															numeroCreditoSifco: numeroCreditoSifcoMock,
															vehicleId: vehicleIdMock,
															wialonUnitId: wialonUnitIdCasoMock,
															clienteNombre: "Juan Pérez",
														},
													]
												: [],
									}),
								}),
							}),
						}),
					};
				}
				if (tabla === casosCobros) {
					// assertAccesoCasoCobro / assertAccesoLlamadaInmovilizacion:
					return {
						where: () => ({
							limit: async () => {
								// Fallback de assertAccesoLlamadaInmovilizacion: el SIFCO
								// para preguntar si el dueño en cartera tiene usuario.
								if (campos && "numeroCreditoSifco" in campos) {
									return numeroCreditoSifcoMock
										? [{ numeroCreditoSifco: numeroCreditoSifcoMock }]
										: [];
								}
								return rolUsuarioMock === "admin" ||
									rolUsuarioMock === "cobros_supervisor" ||
									responsableCasoMock === "user-test"
									? [{ id: CASO_ID }]
									: [];
							},
						}),
					};
				}
				if (tabla === inmovilizacionesUnidad && campos && "id" in campos) {
					// Usado por:
					// 1. filaSigueVigente: select({ id }).from(...).where().for("update")
					// 2. reactivacionesObsoletas en marcarEjecutada: select({ id }).from(...).where(...)
					return {
						where: () =>
							Object.assign(Promise.resolve(reactivacionesObsoletasMock), {
								for: () => {
									executeLlamadas.push("select_for_update_fila");
									return Promise.resolve([
										{ id: (inmovilizacionExistente as { id?: string })?.id },
									]);
								},
							}),
					};
				}
				if (tabla === inmovilizacionesUnidad && campos === undefined) {
					// getHistorialCaso: select().from(inmovilizacionesUnidad).where().orderBy()
					// getHistorialUnidadFisica: misma firma — ver comentario de
					// historialUnidadFisicaMock arriba. El contador solo cuenta
					// llamadas a `orderBy` (una por cada getHistorial*), no a
					// `limit` (marcarEjecutada / registrarResultadoLlamada /
					// registrarLlamadaReactivacion, que traen una fila por id).
					// marcarEjecutada / registrarResultadoLlamada: select().from().where().limit()
					return {
						where: () => ({
							orderBy: async () => {
								llamadasHistorialUnidad++;
								const esLlamadaDeUnidadFisica =
									llamadasHistorialUnidad > llamadasAntesDeHistorialFisico;
								if (
									esLlamadaDeUnidadFisica &&
									historialUnidadFisicaMock !== null
								) {
									return historialUnidadFisicaMock;
								}
								if (historialCasoMock.length > 0) {
									return historialCasoMock;
								}
								if (
									inmovilizacionExistente &&
									inmovilizacionExistente.estado === "ejecutada"
								) {
									return [
										{
											...inmovilizacionExistente,
											ejecutadoAt:
												inmovilizacionExistente.ejecutadoAt ?? new Date(),
										},
									];
								}
								return [];
							},
							limit: async () =>
								inmovilizacionExistente ? [inmovilizacionExistente] : [],
						}),
					};
				}
				if (tabla === contactosCobros) {
					return {
						where: () => ({
							limit: async () =>
								contactoExisteMock
									? [
											{
												id: CONTACTO_ID,
												inmovilizacionId: contactoInmovilizacionIdMock,
											},
										]
									: [],
						}),
					};
				}
				if (tabla === vehicles) {
					const devolver = async () =>
						vehiculoExisteMock && vehicleIdMock
							? [
									{
										id: vehicleIdMock,
										wialonUnitId: wialonUnitIdVehiculoMock,
									},
								]
							: [];
					return {
						where: () => ({
							limit: devolver,
							for: () => {
								executeLlamadas.push("select_for_update_vehiculo");
								return { limit: devolver };
							},
						}),
					};
				}
				throw new Error(`select from tabla no mockeada: ${String(tabla)}`);
			},
		}),
		insert: (tabla: unknown) => {
			if (tabla === inmovilizacionesUnidad) {
				return {
					values: (fila: Record<string, unknown>) => {
						if (insertError) {
							const pg = Object.assign(
								new Error(
									'duplicate key value violates unique constraint "uq_inmovilizaciones_unidad_caso_abierta"',
								),
								{ code: "23505" },
							);
							const error =
								insertError === "unique"
									? pg
									: insertError === "unique_envuelto"
										? Object.assign(new Error("Failed query"), { cause: pg })
										: new Error("connection terminated unexpectedly");
							return { returning: () => Promise.reject(error) };
						}
						inmovilizacionesInsertadas.push(fila);
						return {
							returning: async () => [{ id: INMOV_ID }],
						};
					},
				};
			}
			if (tabla === inmovilizacionesUnidadEventos) {
				return {
					values: (fila: Record<string, unknown>) => {
						eventosInsertados.push(fila);
						return Promise.resolve();
					},
				};
			}
			throw new Error(`insert en tabla no mockeada: ${String(tabla)}`);
		},
		update: (tabla: unknown) => {
			if (tabla === inmovilizacionesUnidad) {
				return {
					set: (cambios?: Record<string, unknown>) => {
						const esUpdateRecuperacion =
							cambios?.resultado === "enviada_recuperacion";
						const coincideRecuperacion =
							!esUpdateRecuperacion ||
							inmovilizacionExistente?.resultado ===
								"no_pago_pendiente_recuperacion";
						if (
							inmovilizacionExistente &&
							updateDevuelveFila &&
							coincideRecuperacion &&
							cambios
						) {
							Object.assign(inmovilizacionExistente, cambios);
						}
						return {
							where: () => ({
								returning: async () =>
									updateDevuelveFila && coincideRecuperacion
										? [
												{
													id:
														(inmovilizacionExistente as { id?: string })?.id ??
														INMOV_ID,
													casoCobroId:
														(inmovilizacionExistente as { casoCobroId?: string })
															?.casoCobroId ?? CASO_ID,
													accion:
														(inmovilizacionExistente as { accion?: string })
															?.accion ?? "apagado",
													solicitadoPor:
														(inmovilizacionExistente as {
															solicitadoPor?: string;
														})?.solicitadoPor ??
														solicitadoPorMarcarEjecutadaMock,
												},
											]
										: [],
							}),
						};
					},
				};
			}
			if (tabla === contactosCobros) {
				return {
					set: () => ({
						where: () => ({
							returning: async () =>
								contactoUpdateDevuelveFila ? [{ id: CONTACTO_ID }] : [],
						}),
					}),
				};
			}
			throw new Error(`update en tabla no mockeada: ${String(tabla)}`);
		},
		transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
			if (transactionError) {
				throw transactionError;
			}
			return fn(mockDb());
		},
		// bloquearUnidadFisica (review de Codex, PR #1758): advisory lock por
		// unidad, tx.execute(sql`select pg_advisory_xact_lock(...)`). El mock
		// in-memory no simula el lock en sí (no hay concurrencia real acá, ni
		// otro proceso Postgres con el que competir), solo deja pasar la
		// llamada.
		execute: async () => {
			executeLlamadas.push("advisory_lock");
			return undefined;
		},
	};
}

mock.module("../db", () => ({ db: mockDb() }));
// El permiso y el dueño del crédito los da cartera (lib/acceso-caso-cobro).
// Se simulan con la bandera de siempre: `responsableCasoMock` es el usuario del
// CRM que lleva el crédito en cartera (null = sin usuario vinculado).
mock.module("../lib/acceso-caso-cobro", () =>
	moduloAccesoFalso({
		tieneAcceso: (userId) => responsableCasoMock === userId,
		duenoUsuario: () => responsableCasoMock,
		carteraFalla: () => carteraFallaMock,
	}),
);
// routers/cobros.ts (de donde sale assertAccesoCasoCobro) inicializa
// @cci/email al importarse y exige RESEND_API_KEY — mismo mock que
// cobros.moraRecuperacion.test.ts y convenio-decision.errores.test.ts.
mock.module("@cci/email", () => ({ sendPlainEmail: mock() }));
mock.module("../services/inmovilizacion-notif", () => ({
	notificarInmovilizacionPendiente: async () => undefined,
	notificarInmovilizacionResuelta: async () => undefined,
	notificarLlamarCliente: async (params: { asesorUserId: string }) => {
		notificarLlamarClienteLlamadas.push({ asesorUserId: params.asesorUserId });
		onNotificarLlamarCliente?.();
	},
	notificarUnidadReactivada: async () => {
		unidadReactivadaNotificada++;
	},
	resolverAvisoLlamarCliente: async (id: string) => {
		resolverAvisoLlamarClienteLlamadas.push(id);
	},
	resolverPendientesInmovilizacion: async (id: string) => {
		resolverPendientesLlamadas.push(id);
	},
	reconciliarAvisosLlamarCliente: async (casoCobroIds?: readonly string[]) => {
		reconciliarAvisosLlamadas.push(casoCobroIds);
		return 0;
	},
}));
// Mock propio de cartera-back-client y no spyOn sobre el módulo real: otros
// archivos de test lo reemplazan con `mock.module` (global en bun), y en el
// suite completo `carteraBackClient.getCredito` dejaba de ser una función.
// Cada test sigue ajustándolo con spyOn sobre ESTE objeto.
const carteraBackClientMock = {
	getCredito: async () => ({ asesor: { emailCashIn: "u@example.com" } }),
	getBucketActualCredito: async () => ({ bucket: 2 }),
};
mock.module("../services/cartera-back-client", () => ({
	carteraBackClient: carteraBackClientMock,
	CarteraBackHttpError: class CarteraBackHttpError extends Error {},
}));
mock.module("../services/cartera-back-integration", () => ({
	createPagoInCarteraBack: mock(),
	getCreditoReferenceByNumeroSifco: mock(),
	isCarteraBackEnabled: () => carteraHabilitadaMock,
	isCarteraBackPaymentsEnabled: () => true,
}));

const {
	inmovilizacionUnidadRouter,
	registrarLlamadaReactivacion,
	marcarInmovilizacionEnviadaARecuperacion,
} = await import("./inmovilizacion-unidad");
const carteraBackClient = carteraBackClientMock;

function ctx(role: string, userId = "user-test"): Context {
	rolUsuarioMock = role;
	return {
		session: { user: { id: userId, email: "u@example.com" } },
		user: { id: userId, email: "u@example.com", role },
	} as unknown as Context;
}

function reset() {
	responsableCasoMock = "user-test";
	carteraFallaMock = false;
	solicitadoPorMarcarEjecutadaMock = "user-test";
	numeroCreditoSifcoMock = "01010214100000";
	vehicleIdMock = VEHICLE_ID;
	wialonUnitIdCasoMock = 12345;
	wialonUnitIdVehiculoMock = 12345;
	vehiculoExisteMock = true;
	notificarLlamarClienteLlamadas = [];
	carteraHabilitadaMock = true;
	insertError = null;
	transactionError = null;
	inmovilizacionesInsertadas = [];
	eventosInsertados = [];
	inmovilizacionExistente = null;
	historialCasoMock = [];
	historialUnidadFisicaMock = null;
	llamadasAntesDeHistorialFisico = 1;
	llamadasHistorialUnidad = 0;
	updateDevuelveFila = true;
	contactoExisteMock = true;
	contactoInmovilizacionIdMock = null;
	contactoUpdateDevuelveFila = true;
	resolverPendientesLlamadas = [];
	unidadReactivadaNotificada = 0;
	resolverAvisoLlamarClienteLlamadas = [];
	reactivacionesObsoletasMock = [];
	onNotificarLlamarCliente = null;
	reconciliarAvisosLlamadas = [];
	executeLlamadas = [];
	spyOn(carteraBackClient, "getBucketActualCredito").mockResolvedValue({
		bucket: 2,
	});
}

describe("CB-041 — solicitarInmovilizacion", () => {
	afterEach(reset);

	it("asesor dueño del caso, bucket B2: crea la solicitud y notifica", async () => {
		spyOn(carteraBackClient, "getCredito").mockResolvedValue({
			asesor: { emailCashIn: "u@example.com" },
		} as never);
		spyOn(carteraBackClient, "getBucketActualCredito").mockResolvedValue({
			bucket: 2,
		} as never);

		const res = await call(
			inmovilizacionUnidadRouter.solicitarInmovilizacion,
			{
				casoCobroId: CASO_ID,
				accion: "apagado",
				motivo: "Cliente incontactable",
			},
			{ context: ctx("cobros") },
		);

		expect(res.id).toBe(INMOV_ID);
		expect(inmovilizacionesInsertadas).toHaveLength(1);
		expect(inmovilizacionesInsertadas[0]?.accion).toBe("apagado");
	});

	it("bucket B1 (fuera de rango): rechaza con BAD_REQUEST", async () => {
		spyOn(carteraBackClient, "getCredito").mockResolvedValue({
			asesor: { emailCashIn: "u@example.com" },
		} as never);
		spyOn(carteraBackClient, "getBucketActualCredito").mockResolvedValue({
			bucket: 1,
		} as never);

		await expect(
			call(
				inmovilizacionUnidadRouter.solicitarInmovilizacion,
				{
					casoCobroId: CASO_ID,
					accion: "apagado",
					motivo: "Cliente incontactable",
				},
				{ context: ctx("cobros") },
			),
		).rejects.toBeInstanceOf(ORPCError);
		expect(inmovilizacionesInsertadas).toHaveLength(0);
	});

	it("bucket B5 (fuera de rango): rechaza", async () => {
		spyOn(carteraBackClient, "getCredito").mockResolvedValue({
			asesor: { emailCashIn: "u@example.com" },
		} as never);
		spyOn(carteraBackClient, "getBucketActualCredito").mockResolvedValue({
			bucket: 5,
		} as never);

		await expect(
			call(
				inmovilizacionUnidadRouter.solicitarInmovilizacion,
				{
					casoCobroId: CASO_ID,
					accion: "apagado",
					motivo: "Cliente incontactable",
				},
				{ context: ctx("cobros") },
			),
		).rejects.toBeInstanceOf(ORPCError);
	});

	it("no se pudo resolver el bucket (fail closed): rechaza", async () => {
		spyOn(carteraBackClient, "getCredito").mockResolvedValue({
			asesor: { emailCashIn: "u@example.com" },
		} as never);
		spyOn(carteraBackClient, "getBucketActualCredito").mockRejectedValue(
			new Error("timeout"),
		);

		await expect(
			call(
				inmovilizacionUnidadRouter.solicitarInmovilizacion,
				{
					casoCobroId: CASO_ID,
					accion: "apagado",
					motivo: "Cliente incontactable",
				},
				{ context: ctx("cobros") },
			),
		).rejects.toBeInstanceOf(ORPCError);
	});

	it("acceso ajeno al caso: NOT_FOUND", async () => {
		responsableCasoMock = "otro-usuario";

		await expect(
			call(
				inmovilizacionUnidadRouter.solicitarInmovilizacion,
				{
					casoCobroId: CASO_ID,
					accion: "apagado",
					motivo: "Cliente incontactable",
				},
				{ context: ctx("cobros") },
			),
		).rejects.toBeInstanceOf(ORPCError);
	});

	it("caso sin vehículo asociado: BAD_REQUEST (review de Codex)", async () => {
		vehicleIdMock = null;

		await expect(
			call(
				inmovilizacionUnidadRouter.solicitarInmovilizacion,
				{
					casoCobroId: CASO_ID,
					accion: "apagado",
					motivo: "Cliente incontactable",
				},
				{ context: ctx("cobros") },
			),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(inmovilizacionesInsertadas).toHaveLength(0);
	});

	it("vehículo sin unidad GPS vinculada (wialonUnitId null): BAD_REQUEST (review de Codex)", async () => {
		wialonUnitIdCasoMock = null;

		await expect(
			call(
				inmovilizacionUnidadRouter.solicitarInmovilizacion,
				{
					casoCobroId: CASO_ID,
					accion: "apagado",
					motivo: "Cliente incontactable",
				},
				{ context: ctx("cobros") },
			),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: "El vehículo asociado no tiene una unidad GPS vinculada.",
		});
		expect(inmovilizacionesInsertadas).toHaveLength(0);
	});

	it("crédito reasignado en cartera a otro asesor: FORBIDDEN", async () => {
		spyOn(carteraBackClient, "getCredito").mockResolvedValue({
			asesor: { emailCashIn: "otro@example.com" },
		} as never);

		await expect(
			call(
				inmovilizacionUnidadRouter.solicitarInmovilizacion,
				{
					casoCobroId: CASO_ID,
					accion: "apagado",
					motivo: "Cliente incontactable",
				},
				{ context: ctx("cobros") },
			),
		).rejects.toBeInstanceOf(ORPCError);
	});

	it("ya hay una solicitud abierta (índice único): CONFLICT", async () => {
		spyOn(carteraBackClient, "getCredito").mockResolvedValue({
			asesor: { emailCashIn: "u@example.com" },
		} as never);
		spyOn(carteraBackClient, "getBucketActualCredito").mockResolvedValue({
			bucket: 2,
		} as never);
		insertError = "unique";

		await expect(
			call(
				inmovilizacionUnidadRouter.solicitarInmovilizacion,
				{
					casoCobroId: CASO_ID,
					accion: "apagado",
					motivo: "Cliente incontactable",
				},
				{ context: ctx("cobros") },
			),
		).rejects.toBeInstanceOf(ORPCError);
	});

	it("reactivación sin apagado previo ejecutado: rechaza (unidad ya activa)", async () => {
		spyOn(carteraBackClient, "getCredito").mockResolvedValue({
			asesor: { emailCashIn: "u@example.com" },
		} as never);
		spyOn(carteraBackClient, "getBucketActualCredito").mockResolvedValue({
			bucket: 2,
		} as never);
		historialCasoMock = [];

		await expect(
			call(
				inmovilizacionUnidadRouter.solicitarInmovilizacion,
				{
					casoCobroId: CASO_ID,
					accion: "reactivacion",
					motivo: "Pidió reactivar",
				},
				{ context: ctx("cobros") },
			),
		).rejects.toBeInstanceOf(ORPCError);
	});

	it("toma el advisory lock por unidad antes de insertar en solicitarInmovilizacion (review de Codex)", async () => {
		spyOn(carteraBackClient, "getCredito").mockResolvedValue({
			asesor: { emailCashIn: "u@example.com" },
		} as never);
		spyOn(carteraBackClient, "getBucketActualCredito").mockResolvedValue({
			bucket: 2,
		} as never);

		await call(
			inmovilizacionUnidadRouter.solicitarInmovilizacion,
			{
				casoCobroId: CASO_ID,
				accion: "apagado",
				motivo: "Cliente incontactable",
			},
			{ context: ctx("cobros") },
		);

		expect(executeLlamadas).toContain("advisory_lock");
	});

	it("unidad apagada por otro caso concurrente durante la solicitud: detecta el cambio bajo lock y rechaza con CONFLICT (review de Codex)", async () => {
		spyOn(carteraBackClient, "getCredito").mockResolvedValue({
			asesor: { emailCashIn: "u@example.com" },
		} as never);
		spyOn(carteraBackClient, "getBucketActualCredito").mockResolvedValue({
			bucket: 2,
		} as never);

		// Guard temprano ve la unidad activa (historialCasoMock vacío)
		historialCasoMock = [];
		// Pero bajo lock dentro del tx, ve que otro caso ya ejecutó un apagado en la misma unidad
		historialUnidadFisicaMock = [apagadoEjecutado()];
		llamadasAntesDeHistorialFisico = 1;

		await expect(
			call(
				inmovilizacionUnidadRouter.solicitarInmovilizacion,
				{
					casoCobroId: CASO_ID,
					accion: "apagado",
					motivo: "Cliente incontactable",
				},
				{ context: ctx("cobros") },
			),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(inmovilizacionesInsertadas).toHaveLength(0);
	});

	it("reactivación re-calcula origenId bajo lock si otro caso ejecutó un apagado más reciente (review de Codex)", async () => {
		spyOn(carteraBackClient, "getCredito").mockResolvedValue({
			asesor: { emailCashIn: "u@example.com" },
		} as never);
		spyOn(carteraBackClient, "getBucketActualCredito").mockResolvedValue({
			bucket: 2,
		} as never);

		const OTRO_APAGADO_ID = "99999999-9999-9999-9999-999999999999";
		// Guard temprano ve un apagado viejo
		historialCasoMock = [
			apagadoEjecutado({ id: INMOV_ID, ejecutadoAt: new Date("2026-09-01") }),
		];
		// Bajo lock en tx, ve un apagado más reciente ejecutado por otro caso en la misma unidad
		historialUnidadFisicaMock = [
			apagadoEjecutado({
				id: OTRO_APAGADO_ID,
				ejecutadoAt: new Date("2026-09-20"),
			}),
			apagadoEjecutado({ id: INMOV_ID, ejecutadoAt: new Date("2026-09-01") }),
		];
		llamadasAntesDeHistorialFisico = 1;

		await call(
			inmovilizacionUnidadRouter.solicitarInmovilizacion,
			{
				casoCobroId: CASO_ID,
				accion: "reactivacion",
				motivo: "Reactivar unidad",
			},
			{ context: ctx("cobros") },
		);

		expect(inmovilizacionesInsertadas).toHaveLength(1);
		expect(inmovilizacionesInsertadas[0]?.inmovilizacionOrigenId).toBe(
			OTRO_APAGADO_ID,
		);
	});

	it("unidad GPS reasignada a otro vehículo antes de adquirir el lock: detecta el cambio en vehicles bajo lock y rechaza con CONFLICT (review de Codex)", async () => {
		spyOn(carteraBackClient, "getCredito").mockResolvedValue({
			asesor: { emailCashIn: "u@example.com" },
		} as never);
		spyOn(carteraBackClient, "getBucketActualCredito").mockResolvedValue({
			bucket: 2,
		} as never);

		wialonUnitIdCasoMock = 12345;
		wialonUnitIdVehiculoMock = 99999;

		await expect(
			call(
				inmovilizacionUnidadRouter.solicitarInmovilizacion,
				{
					casoCobroId: CASO_ID,
					accion: "apagado",
					motivo: "Cliente incontactable",
				},
				{ context: ctx("cobros") },
			),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message:
				"La unidad GPS del vehículo cambió durante la solicitud. Por favor intentá de nuevo.",
		});
		expect(inmovilizacionesInsertadas).toHaveLength(0);
	});

	it("unidad GPS desvinculada del vehículo antes de adquirir el lock: detecta wialonUnitId null en vehicles bajo lock y rechaza con CONFLICT (review de Codex)", async () => {
		spyOn(carteraBackClient, "getCredito").mockResolvedValue({
			asesor: { emailCashIn: "u@example.com" },
		} as never);
		spyOn(carteraBackClient, "getBucketActualCredito").mockResolvedValue({
			bucket: 2,
		} as never);

		wialonUnitIdCasoMock = 12345;
		wialonUnitIdVehiculoMock = null;

		await expect(
			call(
				inmovilizacionUnidadRouter.solicitarInmovilizacion,
				{
					casoCobroId: CASO_ID,
					accion: "apagado",
					motivo: "Cliente incontactable",
				},
				{ context: ctx("cobros") },
			),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message: "El vehículo asociado no tiene una unidad GPS vinculada.",
		});
		expect(inmovilizacionesInsertadas).toHaveLength(0);
	});
});

describe("CB-041 — decidirInmovilizacion", () => {
	afterEach(reset);

	it("supervisor aprueba: transiciona y notifica", async () => {
		const res = await call(
			inmovilizacionUnidadRouter.decidirInmovilizacion,
			{ id: INMOV_ID, decision: "aprobar" },
			{ context: ctx("cobros_supervisor") },
		);
		expect(res.ok).toBe(true);
	});

	it("rechazar sin motivo: BAD_REQUEST", async () => {
		await expect(
			call(
				inmovilizacionUnidadRouter.decidirInmovilizacion,
				{ id: INMOV_ID, decision: "rechazar" },
				{ context: ctx("cobros_supervisor") },
			),
		).rejects.toBeInstanceOf(ORPCError);
	});

	it("rechazar con motivo válido: transiciona", async () => {
		const res = await call(
			inmovilizacionUnidadRouter.decidirInmovilizacion,
			{ id: INMOV_ID, decision: "rechazar", motivoRechazo: "Cliente ya pagó" },
			{ context: ctx("cobros_supervisor") },
		);
		expect(res.ok).toBe(true);
	});

	it("otro supervisor ya decidió (UPDATE no devuelve filas): CONFLICT", async () => {
		updateDevuelveFila = false;

		await expect(
			call(
				inmovilizacionUnidadRouter.decidirInmovilizacion,
				{ id: INMOV_ID, decision: "aprobar" },
				{ context: ctx("cobros_supervisor") },
			),
		).rejects.toBeInstanceOf(ORPCError);
	});
});

describe("CB-041 — marcarEjecutada", () => {
	afterEach(reset);

	it("marca ejecutada y notifica llamar al cliente cuando accion=apagado", async () => {
		inmovilizacionExistente = {
			id: INMOV_ID,
			casoCobroId: CASO_ID,
			accion: "apagado",
			estado: "aprobada",
			wialonUnitId: 12345,
			bucketSnapshot: 2,
			numeroCreditoSifco: "01010214100000",
			vehicleId: VEHICLE_ID,
			inmovilizacionOrigenId: null,
		};

		const res = await call(
			inmovilizacionUnidadRouter.marcarEjecutada,
			{ id: INMOV_ID, referencia: "Ticket LEGION #123" },
			{ context: ctx("cobros_supervisor") },
		);
		expect(res.ok).toBe(true);
		expect(res.modo).toBe("manual");
	});

	it("dueño en cartera sin usuario en el CRM: notifica igual, con fallback a quien solicitó (review de Codex)", async () => {
		responsableCasoMock = null;
		inmovilizacionExistente = {
			id: INMOV_ID,
			casoCobroId: CASO_ID,
			accion: "apagado",
			estado: "aprobada",
			wialonUnitId: 12345,
			bucketSnapshot: 2,
			numeroCreditoSifco: "01010214100000",
			vehicleId: VEHICLE_ID,
			solicitadoPor: "asesor-que-solicito",
			inmovilizacionOrigenId: null,
		};

		await call(
			inmovilizacionUnidadRouter.marcarEjecutada,
			{ id: INMOV_ID },
			{ context: ctx("cobros_supervisor") },
		);

		expect(notificarLlamarClienteLlamadas).toEqual([
			{ asesorUserId: "asesor-que-solicito" },
		]);
	});

	it("no está aprobada (ya ejecutada u otro estado): CONFLICT", async () => {
		inmovilizacionExistente = null;

		await expect(
			call(
				inmovilizacionUnidadRouter.marcarEjecutada,
				{ id: INMOV_ID },
				{ context: ctx("cobros_supervisor") },
			),
		).rejects.toBeInstanceOf(ORPCError);
	});

	it("apagado aprobado pero el crédito bajó a B0/B1 (cliente pagó): rechaza con CONFLICT (review de Codex)", async () => {
		inmovilizacionExistente = {
			id: INMOV_ID,
			casoCobroId: CASO_ID,
			accion: "apagado",
			estado: "aprobada",
			wialonUnitId: 12345,
			bucketSnapshot: 2,
			numeroCreditoSifco: "01010214100000",
			vehicleId: VEHICLE_ID,
			solicitadoPor: "user-test",
			inmovilizacionOrigenId: null,
		};
		spyOn(carteraBackClient, "getBucketActualCredito").mockResolvedValue({
			bucket: 0,
		} as never);

		await expect(
			call(
				inmovilizacionUnidadRouter.marcarEjecutada,
				{ id: INMOV_ID },
				{ context: ctx("cobros_supervisor") },
			),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message:
				"El crédito ya no se encuentra en mora B2/B3/B4 (está en B0). El apagado ya no aplica.",
		});
		expect(notificarLlamarClienteLlamadas).toHaveLength(0);
		expect(inmovilizacionExistente.estado).toBe("cancelada");
		expect(eventosInsertados.some((e) => e.evento === "cancelar")).toBe(true);
	});

	it("apagado aprobado pero no se pudo resolver el bucket (fail closed): rechaza con CONFLICT (review de Codex)", async () => {
		inmovilizacionExistente = {
			id: INMOV_ID,
			casoCobroId: CASO_ID,
			accion: "apagado",
			estado: "aprobada",
			wialonUnitId: 12345,
			bucketSnapshot: 2,
			numeroCreditoSifco: "01010214100000",
			vehicleId: VEHICLE_ID,
			solicitadoPor: "user-test",
			inmovilizacionOrigenId: null,
		};
		spyOn(carteraBackClient, "getBucketActualCredito").mockRejectedValue(
			new Error("cartera-back caído"),
		);

		await expect(
			call(
				inmovilizacionUnidadRouter.marcarEjecutada,
				{ id: INMOV_ID },
				{ context: ctx("cobros_supervisor") },
			),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message:
				"No se pudo confirmar el bucket del crédito en cartera. Intentá de nuevo en unos minutos.",
		});
		expect(notificarLlamarClienteLlamadas).toHaveLength(0);
		// Fallo transitorio: no se cancela la aprobación
		expect(inmovilizacionExistente.estado).toBe("aprobada");
	});

	it("unidad GPS reasignada a otro vehículo tras la aprobación: detecta el cambio en vehicles bajo lock y rechaza con CONFLICT (review de Codex)", async () => {
		inmovilizacionExistente = {
			id: INMOV_ID,
			casoCobroId: CASO_ID,
			accion: "apagado",
			estado: "aprobada",
			wialonUnitId: 12345,
			bucketSnapshot: 2,
			numeroCreditoSifco: "01010214100000",
			vehicleId: VEHICLE_ID,
			solicitadoPor: "user-test",
			inmovilizacionOrigenId: null,
		};
		// El vehículo fue reasignado a otro GPS tras la aprobación
		wialonUnitIdVehiculoMock = 99999;

		await expect(
			call(
				inmovilizacionUnidadRouter.marcarEjecutada,
				{ id: INMOV_ID },
				{ context: ctx("cobros_supervisor") },
			),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message:
				"La unidad GPS del vehículo cambió o fue reasignada tras la aprobación. La acción ya no aplica a la unidad original.",
		});
		expect(notificarLlamarClienteLlamadas).toHaveLength(0);
		expect(inmovilizacionExistente.estado).toBe("cancelada");
		expect(eventosInsertados.some((e) => e.evento === "cancelar")).toBe(true);
	});

	it("vehículo desasociado o eliminado tras la aprobación: rechaza con CONFLICT bajo lock (review de Codex)", async () => {
		inmovilizacionExistente = {
			id: INMOV_ID,
			casoCobroId: CASO_ID,
			accion: "apagado",
			estado: "aprobada",
			wialonUnitId: 12345,
			bucketSnapshot: 2,
			numeroCreditoSifco: "01010214100000",
			vehicleId: VEHICLE_ID,
			solicitadoPor: "user-test",
			inmovilizacionOrigenId: null,
		};
		vehiculoExisteMock = false;

		await expect(
			call(
				inmovilizacionUnidadRouter.marcarEjecutada,
				{ id: INMOV_ID },
				{ context: ctx("cobros_supervisor") },
			),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message:
				"El vehículo asociado a la solicitud ya no existe o fue desasociado.",
		});
		expect(notificarLlamarClienteLlamadas).toHaveLength(0);
		expect(inmovilizacionExistente.estado).toBe("cancelada");
		expect(eventosInsertados.some((e) => e.evento === "cancelar")).toBe(true);
	});

	it("vehículo sin unidad GPS vinculada al momento de ejecutar: cancela y audita la solicitud con CONFLICT (review de Codex)", async () => {
		inmovilizacionExistente = {
			id: INMOV_ID,
			casoCobroId: CASO_ID,
			accion: "apagado",
			estado: "aprobada",
			wialonUnitId: 12345,
			bucketSnapshot: 2,
			numeroCreditoSifco: "01010214100000",
			vehicleId: VEHICLE_ID,
			solicitadoPor: "user-test",
			inmovilizacionOrigenId: null,
		};
		wialonUnitIdVehiculoMock = null;

		await expect(
			call(
				inmovilizacionUnidadRouter.marcarEjecutada,
				{ id: INMOV_ID },
				{ context: ctx("cobros_supervisor") },
			),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message: "El vehículo asociado no tiene una unidad GPS vinculada.",
		});
		expect(notificarLlamarClienteLlamadas).toHaveLength(0);
		expect(inmovilizacionExistente.estado).toBe("cancelada");
		expect(eventosInsertados.some((e) => e.evento === "cancelar")).toBe(true);
	});

	it("carrera en precondición fallida: si la fila ya fue cancelada concurrentemente (UPDATE 0 filas), no duplica el evento de auditoría (review de Codex)", async () => {
		inmovilizacionExistente = {
			id: INMOV_ID,
			casoCobroId: CASO_ID,
			accion: "apagado",
			estado: "aprobada",
			wialonUnitId: 12345,
			bucketSnapshot: 2,
			numeroCreditoSifco: "01010214100000",
			vehicleId: VEHICLE_ID,
			solicitadoPor: "user-test",
			inmovilizacionOrigenId: null,
		};
		// Simular que el cliente pagó y el crédito bajó a B1
		spyOn(carteraBackClient, "getBucketActualCredito").mockResolvedValue({
			bucket: 1,
		} as never);
		// Simular que otra transacción ya la canceló: el UPDATE devuelve 0 filas
		updateDevuelveFila = false;

		await expect(
			call(
				inmovilizacionUnidadRouter.marcarEjecutada,
				{ id: INMOV_ID },
				{ context: ctx("cobros_supervisor") },
			),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message:
				"El crédito ya no se encuentra en mora B2/B3/B4 (está en B1). El apagado ya no aplica.",
		});
		// No debe haberse insertado evento de cancelar porque no afectó filas
		expect(eventosInsertados.some((e) => e.evento === "cancelar")).toBe(false);
	});

	it("marcarEjecutada toma SELECT ... FOR UPDATE sobre la fila de vehicles para serializar reasignaciones concurrentes (review de Codex)", async () => {
		inmovilizacionExistente = {
			id: INMOV_ID,
			casoCobroId: CASO_ID,
			accion: "apagado",
			estado: "aprobada",
			wialonUnitId: 12345,
			bucketSnapshot: 2,
			numeroCreditoSifco: "01010214100000",
			vehicleId: VEHICLE_ID,
			solicitadoPor: "user-test",
			inmovilizacionOrigenId: null,
		};

		await call(
			inmovilizacionUnidadRouter.marcarEjecutada,
			{ id: INMOV_ID },
			{ context: ctx("cobros_supervisor") },
		);

		expect(executeLlamadas).toContain("select_for_update_vehiculo");
	});
});

function apagadoEjecutado(extra: Record<string, unknown> = {}) {
	return {
		id: INMOV_ID,
		casoCobroId: CASO_ID,
		accion: "apagado",
		estado: "ejecutada",
		numeroCreditoSifco: "01010214100000",
		vehicleId: VEHICLE_ID,
		wialonUnitId: 12345,
		bucketSnapshot: 2,
		llamadaContactoId: null,
		ejecutadoAt: new Date("2026-09-20T10:00:00.000Z"),
		...extra,
	};
}

describe("CB-041 — registrarResultadoLlamada", () => {
	afterEach(reset);

	const llamar = (resultado: "paga" | "no_paga") =>
		call(
			inmovilizacionUnidadRouter.registrarResultadoLlamada,
			{ inmovilizacionId: INMOV_ID, contactoId: CONTACTO_ID, resultado },
			{ context: ctx("cobros") },
		);

	// El nuevo guard (review de Codex, PR #1758) exige que `inm` sea el
	// apagado VIGENTE de la unidad física: getHistorialUnidadFisica necesita
	// verlo en su propio historial. `historialCasoMock` alimenta esa consulta
	// (ver el mock de inmovilizacionesUnidad arriba) — sin esto, todos los
	// tests de este describe fallarían con CONFLICT por "ya no es el
	// vigente", aunque el escenario real sí lo sea.
	function conApagadoVigente(extra: Record<string, unknown> = {}) {
		const fila = apagadoEjecutado(extra);
		inmovilizacionExistente = fila;
		historialCasoMock = [fila];
		return fila;
	}

	it("resultado=paga: enlaza el contacto y abre reactivación apuntando al apagado", async () => {
		conApagadoVigente();

		const res = await llamar("paga");
		expect(res.ok).toBe(true);
		const reactivacion = inmovilizacionesInsertadas.find(
			(f) => f.accion === "reactivacion",
		);
		expect(reactivacion?.inmovilizacionOrigenId).toBe(INMOV_ID);
	});

	it("resultado=no_paga: no abre reactivación", async () => {
		conApagadoVigente();

		const res = await llamar("no_paga");
		expect(res.ok).toBe(true);
		expect(inmovilizacionesInsertadas).toHaveLength(0);
	});

	it("resultado=paga pero el crédito fue reasignado en cartera a otro asesor: rechaza con FORBIDDEN y no abre reactivación (review de Codex)", async () => {
		conApagadoVigente();
		const getCreditoSpy = spyOn(
			carteraBackClient,
			"getCredito",
		).mockResolvedValueOnce({
			asesor: { emailCashIn: "otro-asesor@example.com" },
		});

		try {
			await expect(llamar("paga")).rejects.toMatchObject({
				code: "FORBIDDEN",
			});
			expect(inmovilizacionesInsertadas).toHaveLength(0);
		} finally {
			getCreditoSpy.mockRestore();
		}
	});

	it("resultado=no_paga: permite registrar llamada aunque en cartera esté asignado a otro asesor (no abre reactivación)", async () => {
		conApagadoVigente();
		const getCreditoSpy = spyOn(
			carteraBackClient,
			"getCredito",
		).mockResolvedValueOnce({
			asesor: { emailCashIn: "otro-asesor@example.com" },
		});

		try {
			const res = await llamar("no_paga");
			expect(res.ok).toBe(true);
			expect(inmovilizacionesInsertadas).toHaveLength(0);
			// No debe haber consultado Cartera para validar ownership de reactivación
			expect(getCreditoSpy).not.toHaveBeenCalled();
		} finally {
			getCreditoSpy.mockRestore();
		}
	});

	it("toma el advisory lock ANTES del SELECT ... FOR UPDATE de fila (review de Codex — evita deadlock 40P01)", async () => {
		conApagadoVigente();
		await llamar("paga");
		expect(executeLlamadas).toEqual([
			"advisory_lock",
			"select_for_update_fila",
		]);
	});

	it("no hay apagado ejecutado con ese id: BAD_REQUEST", async () => {
		inmovilizacionExistente = null;
		await expect(llamar("paga")).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
	});

	it("contacto no encontrado por el filtro (caso distinto, canal distinto de llamada, o anterior a la ejecución): BAD_REQUEST", async () => {
		// El mock de contactosCobros no distingue condiciones del WHERE real
		// (caso, metodo_contacto='llamada', fecha_contacto > ejecutado_at) —
		// contactoExisteMock=false simula que NINGUNA de esas condiciones
		// matchea, sea porque el contacto es de otro caso, de otro canal
		// (whatsapp/sms/visita/pago), o de antes del apagado. El filtro SQL
		// real se verificó a mano contra Postgres: 3 contactos (whatsapp
		// posterior, llamada anterior, llamada posterior) — solo el tercero
		// pasa. Review de Codex, PR #1758.
		conApagadoVigente();
		contactoExisteMock = false;
		await expect(llamar("paga")).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
	});

	it("la llamada ya estaba registrada: CONFLICT y no abre otra reactivación", async () => {
		conApagadoVigente({
			llamadaContactoId: "55555555-5555-5555-5555-555555555555",
		});
		await expect(llamar("paga")).rejects.toMatchObject({ code: "CONFLICT" });
		expect(inmovilizacionesInsertadas).toHaveLength(0);
	});

	it("la gestión ya está enlazada a otra inmovilización: CONFLICT", async () => {
		conApagadoVigente();
		contactoInmovilizacionIdMock = "66666666-6666-6666-6666-666666666666";
		await expect(llamar("no_paga")).rejects.toMatchObject({
			code: "CONFLICT",
		});
	});

	it("carrera (doble clic): el UPDATE condicionado no devuelve fila → CONFLICT y no inserta nada", async () => {
		// El SELECT inicial todavía ve la llamada sin registrar; el otro
		// request ya la registró antes del UPDATE.
		conApagadoVigente();
		updateDevuelveFila = false;
		await expect(llamar("paga")).rejects.toMatchObject({ code: "CONFLICT" });
		expect(inmovilizacionesInsertadas).toHaveLength(0);
	});

	it("carrera sobre la gestión: el enlace del contacto no devuelve fila → CONFLICT", async () => {
		conApagadoVigente();
		contactoUpdateDevuelveFila = false;
		await expect(llamar("paga")).rejects.toMatchObject({ code: "CONFLICT" });
		expect(inmovilizacionesInsertadas).toHaveLength(0);
	});

	it("paga con otra solicitud ya abierta en el caso (índice único): CONFLICT, no 500", async () => {
		conApagadoVigente();
		insertError = "unique_envuelto";
		await expect(llamar("paga")).rejects.toMatchObject({ code: "CONFLICT" });
	});

	it("apagado superado por un ciclo más reciente en la unidad física (D-10): CONFLICT, no abre reactivación (review de Codex)", async () => {
		const OTRO_CASO_ID = "55555555-5555-5555-5555-555555555555";
		inmovilizacionExistente = apagadoEjecutado(); // sigue con llamadaContactoId=null
		// registrarResultadoLlamada llama getHistorialUnidadFisica UNA sola
		// vez, nada antes (a diferencia de getInmovilizacionesCaso, default=1).
		llamadasAntesDeHistorialFisico = 0;
		// La unidad física ya pasó a un ciclo más reciente, ejecutado desde
		// OTRO caso: este apagado (INMOV_ID) quedó superado.
		historialUnidadFisicaMock = [
			{
				...apagadoEjecutado(),
				id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
				casoCobroId: OTRO_CASO_ID,
				ejecutadoAt: new Date("2026-09-25T10:00:00.000Z"),
			},
			apagadoEjecutado(), // el propio INMOV_ID, más antiguo
		];
		await expect(llamar("paga")).rejects.toMatchObject({ code: "CONFLICT" });
		expect(inmovilizacionesInsertadas).toHaveLength(0);
	});

	it("apagado seguido de una reactivación DIRECTA más reciente en la unidad física: CONFLICT (review de Codex, comparación solo-apagados no lo veía)", async () => {
		// Apagado A (este, INMOV_ID) ejecutado, nunca se llamó. Después la
		// unidad se reactivó DIRECTO (sin pasar por acá, p. ej. el cliente
		// pagó por ventanilla) — un evento MÁS RECIENTE que el apagado, pero
		// de otra acción. ultimaEjecutada(..., "apagado") sigue devolviendo A
		// (es el único/último apagado), así que comparar solo IDs entre
		// apagados no detecta que la unidad ya no está inmovilizada.
		const fila = apagadoEjecutado();
		inmovilizacionExistente = fila;
		historialCasoMock = [fila];
		historialUnidadFisicaMock = [
			{
				...apagadoEjecutado(),
				id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
				accion: "reactivacion",
				ejecutadoAt: new Date("2026-09-25T10:00:00.000Z"), // posterior
			},
			fila, // el propio INMOV_ID, más antiguo
		];
		await expect(llamar("paga")).rejects.toMatchObject({ code: "CONFLICT" });
		expect(inmovilizacionesInsertadas).toHaveLength(0);
	});

	it("apagado superado por un ciclo más reciente DETECTADO SOLO por el lock dentro de la transacción — carrera real, no el guard temprano (review de Codex)", async () => {
		// El guard TEMPRANO (1ra consulta, sin lock, historialCasoMock) ve el
		// apagado como vigente y pasa. La carrera real: entre ese guard y el
		// UPDATE, marcarEjecutada ejecuta una reactivación directa más
		// reciente desde otro lado. La transacción, con el lock adquirido,
		// re-consulta (2da consulta, historialUnidadFisicaMock) y ahí SÍ ve
		// el evento más reciente — tiene que rechazar en ese punto, no antes.
		const fila = apagadoEjecutado();
		inmovilizacionExistente = fila;
		historialCasoMock = [fila]; // guard temprano: sigue vigente, pasa
		historialUnidadFisicaMock = [
			{
				...apagadoEjecutado(),
				id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
				accion: "reactivacion",
				ejecutadoAt: new Date("2026-09-25T10:00:00.000Z"), // posterior
			},
			fila, // ya no es el vigente
		];
		await expect(llamar("paga")).rejects.toMatchObject({ code: "CONFLICT" });
		expect(inmovilizacionesInsertadas).toHaveLength(0);
	});

	it("dueño en cartera sin usuario en el CRM y el usuario es solicitadoPor (fallback del aviso): permite registrar la llamada (review de Codex)", async () => {
		responsableCasoMock = null;
		conApagadoVigente({ solicitadoPor: "user-test" });

		const res = await llamar("paga");
		expect(res.ok).toBe(true);
	});

	it("dueño en cartera sin usuario en el CRM y el usuario NO es solicitadoPor: rechaza con NOT_FOUND (review de Codex)", async () => {
		responsableCasoMock = null;
		conApagadoVigente({ solicitadoPor: "otro-asesor" });

		await expect(llamar("paga")).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("cartera no responde: el ex solicitante NO registra la llamada (falla cerrado, review de Codex PR #1765)", async () => {
		// El crédito es de otro (el gate no lo deja pasar) y cartera se cae al
		// buscar al dueño: eso no puede leerse como "el dueño no tiene usuario".
		responsableCasoMock = "otro-asesor";
		carteraFallaMock = true;
		conApagadoVigente({ solicitadoPor: "user-test" });

		await expect(llamar("no_paga")).rejects.toMatchObject({
			code: "SERVICE_UNAVAILABLE",
		});
	});
});

describe("CB-041 — reactivación y ciclo de vida (hallazgos del review)", () => {
	afterEach(reset);

	function asesorAsignadoEnBucket(bucket: number | null) {
		spyOn(carteraBackClient, "getCredito").mockResolvedValue({
			asesor: { emailCashIn: "u@example.com" },
		} as never);
		spyOn(carteraBackClient, "getBucketActualCredito").mockResolvedValue({
			bucket,
		} as never);
	}

	it("reactivación con el crédito ya en B0 (cliente pagó): se permite y apunta al último apagado", async () => {
		asesorAsignadoEnBucket(0);
		historialCasoMock = [apagadoEjecutado()];

		await call(
			inmovilizacionUnidadRouter.solicitarInmovilizacion,
			{
				casoCobroId: CASO_ID,
				accion: "reactivacion",
				motivo: "Cliente pagó por ventanilla",
			},
			{ context: ctx("cobros") },
		);

		expect(inmovilizacionesInsertadas).toHaveLength(1);
		expect(inmovilizacionesInsertadas[0]?.accion).toBe("reactivacion");
		expect(inmovilizacionesInsertadas[0]?.inmovilizacionOrigenId).toBe(
			INMOV_ID,
		);
	});

	it("reactivación con el crédito fuera del funnel (bucket null): se permite", async () => {
		asesorAsignadoEnBucket(null);
		historialCasoMock = [apagadoEjecutado()];

		await call(
			inmovilizacionUnidadRouter.solicitarInmovilizacion,
			{
				casoCobroId: CASO_ID,
				accion: "reactivacion",
				motivo: "Entró en convenio",
			},
			{ context: ctx("cobros") },
		);
		expect(inmovilizacionesInsertadas).toHaveLength(1);
	});

	it("índice único envuelto en `cause` (como lo entrega Drizzle): CONFLICT", async () => {
		asesorAsignadoEnBucket(2);
		insertError = "unique_envuelto";

		await expect(
			call(
				inmovilizacionUnidadRouter.solicitarInmovilizacion,
				{ casoCobroId: CASO_ID, accion: "apagado", motivo: "Sin contacto" },
				{ context: ctx("cobros") },
			),
		).rejects.toMatchObject({ code: "CONFLICT" });
	});

	it("un error de DB que NO es de índice único no se disfraza de CONFLICT", async () => {
		asesorAsignadoEnBucket(2);
		insertError = "otro";

		const error = await call(
			inmovilizacionUnidadRouter.solicitarInmovilizacion,
			{ casoCobroId: CASO_ID, accion: "apagado", motivo: "Sin contacto" },
			{ context: ctx("cobros") },
		).catch((e: unknown) => e);

		expect((error as { code?: string }).code).not.toBe("CONFLICT");
	});

	it("cancelarSolicitud cierra los avisos pendientes de los supervisores", async () => {
		await call(
			inmovilizacionUnidadRouter.cancelarSolicitud,
			{ id: INMOV_ID },
			{ context: ctx("cobros") },
		);
		expect(resolverPendientesLlamadas).toEqual([INMOV_ID]);
	});

	it("cancelarSolicitud que ya no está pendiente: CONFLICT y no toca avisos", async () => {
		updateDevuelveFila = false;
		await expect(
			call(
				inmovilizacionUnidadRouter.cancelarSolicitud,
				{ id: INMOV_ID },
				{ context: ctx("cobros") },
			),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(resolverPendientesLlamadas).toHaveLength(0);
	});

	it("pendienteLlamar: presente mientras la unidad sigue apagada", async () => {
		historialCasoMock = [apagadoEjecutado()];
		const res = await call(
			inmovilizacionUnidadRouter.getInmovilizacionesCaso,
			{ casoCobroId: CASO_ID },
			{ context: ctx("cobros") },
		);
		expect(res.estadoUnidad).toBe("inmovilizada");
		expect(res.pendienteLlamar?.id).toBe(INMOV_ID);
		expect(res.tieneGps).toBe(true);
	});

	it("reporta tieneGps=false si el vehículo no tiene unidad GPS vinculada", async () => {
		wialonUnitIdCasoMock = null;
		const res = await call(
			inmovilizacionUnidadRouter.getInmovilizacionesCaso,
			{ casoCobroId: CASO_ID },
			{ context: ctx("cobros") },
		);
		expect(res.tieneGps).toBe(false);
	});

	it("pendienteLlamar: null si la unidad ya se reactivó aunque el apagado no tenga llamada", async () => {
		historialCasoMock = [
			{
				...apagadoEjecutado(),
				id: "77777777-7777-7777-7777-777777777777",
				accion: "reactivacion",
				ejecutadoAt: new Date("2026-09-22T10:00:00.000Z"),
			},
			apagadoEjecutado(),
		];
		const res = await call(
			inmovilizacionUnidadRouter.getInmovilizacionesCaso,
			{ casoCobroId: CASO_ID },
			{ context: ctx("cobros") },
		);
		expect(res.estadoUnidad).toBe("activa");
		expect(res.pendienteLlamar).toBeNull();
	});

	it("pendienteLlamar: null si el apagado vigente de la unidad física es de OTRO caso (D-10, review de Codex)", async () => {
		// Caso A (CASO_ID, el que consulta) tiene un apagado viejo sin llamar.
		// La unidad FÍSICA (compartida con otro caso, D-10) después tuvo una
		// reactivación y un apagado nuevo — ambos ejecutados desde el OTRO
		// caso. estadoUnidad ve la unidad física completa y da "inmovilizada"
		// (correcto), pero pendienteLlamar NO debe apuntar al apagado viejo de
		// A: ese ciclo ya quedó superado por eventos que A no puede resolver
		// (la fila es de otro caso).
		const OTRO_CASO_ID = "55555555-5555-5555-5555-555555555555";
		historialCasoMock = [apagadoEjecutado()]; // solo lo que ve el Caso A
		historialUnidadFisicaMock = [
			{
				...apagadoEjecutado(),
				id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
				casoCobroId: OTRO_CASO_ID,
				ejecutadoAt: new Date("2026-09-25T10:00:00.000Z"),
			},
			{
				...apagadoEjecutado(),
				id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
				casoCobroId: OTRO_CASO_ID,
				accion: "reactivacion",
				ejecutadoAt: new Date("2026-09-24T10:00:00.000Z"),
			},
			apagadoEjecutado(), // el viejo de A, más antiguo que los dos de arriba
		];
		const res = await call(
			inmovilizacionUnidadRouter.getInmovilizacionesCaso,
			{ casoCobroId: CASO_ID },
			{ context: ctx("cobros") },
		);
		expect(res.estadoUnidad).toBe("inmovilizada");
		expect(res.pendienteLlamar).toBeNull();
	});

	it("marcarEjecutada de una reactivación avisa al asesor", async () => {
		inmovilizacionExistente = {
			...apagadoEjecutado(),
			accion: "reactivacion",
			estado: "aprobada",
			inmovilizacionOrigenId: "88888888-8888-8888-8888-888888888888",
		};
		await call(
			inmovilizacionUnidadRouter.marcarEjecutada,
			{ id: INMOV_ID },
			{ context: ctx("cobros_supervisor") },
		);
		expect(unidadReactivadaNotificada).toBe(1);
	});

	it("marcarEjecutada de una reactivación cierra el aviso 'llamar al cliente' del apagado origen (review de Codex)", async () => {
		const ORIGEN_ID = "88888888-8888-8888-8888-888888888888";
		inmovilizacionExistente = {
			...apagadoEjecutado(),
			accion: "reactivacion",
			estado: "aprobada",
			inmovilizacionOrigenId: ORIGEN_ID,
		};
		await call(
			inmovilizacionUnidadRouter.marcarEjecutada,
			{ id: INMOV_ID },
			{ context: ctx("cobros_supervisor") },
		);
		expect(resolverAvisoLlamarClienteLlamadas).toEqual([ORIGEN_ID]);
	});

	it("marcarEjecutada toma el advisory lock ANTES de tocar cualquier fila (review de Codex — evita deadlock 40P01)", async () => {
		// marcarEjecutada y registrarResultadoLlamada/registrarLlamadaReactivacion
		// pueden tomar locks de FILA en orden cruzado si compiten por la misma
		// unidad física — el advisory lock (adquirido primero, antes de
		// cualquier UPDATE/SELECT FOR UPDATE) serializa esa carrera en vez de
		// dejar que dos transacciones se esperen mutuamente.
		inmovilizacionExistente = {
			...apagadoEjecutado(),
			accion: "reactivacion",
			estado: "aprobada",
			inmovilizacionOrigenId: "88888888-8888-8888-8888-888888888888",
		};
		await call(
			inmovilizacionUnidadRouter.marcarEjecutada,
			{ id: INMOV_ID },
			{ context: ctx("cobros_supervisor") },
		);
		expect(executeLlamadas[0]).toBe("advisory_lock");
	});

	it("marcarEjecutada de un apagado NO toca el aviso de llamar al cliente (nada que cerrar todavía)", async () => {
		inmovilizacionExistente = {
			id: INMOV_ID,
			casoCobroId: CASO_ID,
			accion: "apagado",
			estado: "aprobada",
			wialonUnitId: 12345,
			bucketSnapshot: 2,
			numeroCreditoSifco: "01010214100000",
			vehicleId: VEHICLE_ID,
			inmovilizacionOrigenId: null,
		};
		await call(
			inmovilizacionUnidadRouter.marcarEjecutada,
			{ id: INMOV_ID },
			{ context: ctx("cobros_supervisor") },
		);
		expect(resolverAvisoLlamarClienteLlamadas).toEqual([]);
	});

	it("marcarEjecutada de un apagado resuelve avisos de reactivaciones previas pendientes de llamada", async () => {
		const REACTIVACION_OBSOLETA_ID = "77777777-7777-7777-7777-777777777777";
		inmovilizacionExistente = {
			id: INMOV_ID,
			casoCobroId: CASO_ID,
			accion: "apagado",
			estado: "aprobada",
			wialonUnitId: 12345,
			bucketSnapshot: 2,
			numeroCreditoSifco: "01010214100000",
			vehicleId: VEHICLE_ID,
			inmovilizacionOrigenId: null,
		};
		reactivacionesObsoletasMock = [{ id: REACTIVACION_OBSOLETA_ID }];

		await call(
			inmovilizacionUnidadRouter.marcarEjecutada,
			{ id: INMOV_ID },
			{ context: ctx("cobros_supervisor") },
		);

		expect(resolverAvisoLlamarClienteLlamadas).toEqual([
			REACTIVACION_OBSOLETA_ID,
		]);
	});

	it("marcarEjecutada no envía aviso de llamada si la llamada ya fue registrada concurrentemente", async () => {
		inmovilizacionExistente = {
			id: INMOV_ID,
			casoCobroId: CASO_ID,
			accion: "apagado",
			estado: "aprobada",
			wialonUnitId: 12345,
			bucketSnapshot: 2,
			numeroCreditoSifco: "01010214100000",
			vehicleId: VEHICLE_ID,
			inmovilizacionOrigenId: null,
			llamadaContactoId: CONTACTO_ID,
		};

		await call(
			inmovilizacionUnidadRouter.marcarEjecutada,
			{ id: INMOV_ID },
			{ context: ctx("cobros_supervisor") },
		);

		expect(notificarLlamarClienteLlamadas).toEqual([]);
		expect(resolverAvisoLlamarClienteLlamadas).toEqual([]);
	});

	it("marcarEjecutada no envía aviso si la acción ya fue superada en la unidad física", async () => {
		llamadasAntesDeHistorialFisico = 0;
		inmovilizacionExistente = {
			id: INMOV_ID,
			casoCobroId: CASO_ID,
			accion: "apagado",
			estado: "aprobada",
			wialonUnitId: 12345,
			bucketSnapshot: 2,
			numeroCreditoSifco: "01010214100000",
			vehicleId: VEHICLE_ID,
			inmovilizacionOrigenId: null,
		};
		// La unidad física ya fue reactivada por otro evento más reciente
		historialUnidadFisicaMock = [
			{
				id: "99999999-9999-9999-9999-999999999999",
				casoCobroId: CASO_ID,
				accion: "reactivacion",
				estado: "ejecutada",
				ejecutadoAt: new Date(Date.now() + 10000),
			},
		];

		await call(
			inmovilizacionUnidadRouter.marcarEjecutada,
			{ id: INMOV_ID },
			{ context: ctx("cobros_supervisor") },
		);

		expect(notificarLlamarClienteLlamadas).toEqual([]);
	});

	it("marcarEjecutada reconcilia y resuelve el aviso si la llamada se registró durante el envío", async () => {
		inmovilizacionExistente = {
			id: INMOV_ID,
			casoCobroId: CASO_ID,
			accion: "apagado",
			estado: "aprobada",
			wialonUnitId: 12345,
			bucketSnapshot: 2,
			numeroCreditoSifco: "01010214100000",
			vehicleId: VEHICLE_ID,
			inmovilizacionOrigenId: null,
		};

		// Durante el envío de la notificación, una llamada concurrente se registra
		onNotificarLlamarCliente = () => {
			if (inmovilizacionExistente) {
				inmovilizacionExistente.llamadaContactoId = CONTACTO_ID;
			}
		};

		await call(
			inmovilizacionUnidadRouter.marcarEjecutada,
			{ id: INMOV_ID },
			{ context: ctx("cobros_supervisor") },
		);

		// Se intentó notificar, pero al reconciliar se detectó el cambio y se resolvió
		expect(notificarLlamarClienteLlamadas).toHaveLength(1);
		expect(resolverAvisoLlamarClienteLlamadas).toEqual([INMOV_ID]);
	});

	it("marcarEjecutada reasigna el aviso si el caso fue reasignado concurrentemente durante el envío (review de Codex)", async () => {
		responsableCasoMock = "asesor-original";
		inmovilizacionExistente = {
			id: INMOV_ID,
			casoCobroId: CASO_ID,
			accion: "apagado",
			estado: "aprobada",
			wialonUnitId: 12345,
			bucketSnapshot: 2,
			numeroCreditoSifco: "01010214100000",
			vehicleId: VEHICLE_ID,
			inmovilizacionOrigenId: null,
		};

		// Durante el envío de la notificación, cartera reasigna el crédito a otro asesor
		onNotificarLlamarCliente = () => {
			responsableCasoMock = "asesor-nuevo";
		};

		await call(
			inmovilizacionUnidadRouter.marcarEjecutada,
			{ id: INMOV_ID },
			{ context: ctx("cobros_supervisor") },
		);

		// Se notificó al original inicialmente
		expect(notificarLlamarClienteLlamadas).toEqual([
			{ asesorUserId: "asesor-original" },
		]);
		// Y después del envío corre la reconciliación del caso, que relee el dueño
		// en cartera y mueve el aviso con compare-and-set (su lógica se prueba en
		// inmovilizacion-notif.test.ts).
		expect(reconciliarAvisosLlamadas).toContainEqual([CASO_ID]);
	});
});

describe("CB-041 — registrarLlamadaReactivacion", () => {
	afterEach(reset);

	function reactivacionEjecutada(extra: Record<string, unknown> = {}) {
		return {
			id: INMOV_ID,
			casoCobroId: CASO_ID,
			accion: "reactivacion",
			estado: "ejecutada",
			numeroCreditoSifco: "01010214100000",
			vehicleId: VEHICLE_ID,
			wialonUnitId: 12345,
			bucketSnapshot: 2,
			llamadaContactoId: null,
			ejecutadoAt: new Date("2026-09-20T10:00:00.000Z"),
			...extra,
		};
	}

	const llamar = () =>
		call(
			registrarLlamadaReactivacion,
			{ inmovilizacionId: INMOV_ID, contactoId: CONTACTO_ID },
			{ context: ctx("cobros") },
		);

	it("reactivación vigente: enlaza el contacto sin error", async () => {
		const fila = reactivacionEjecutada();
		inmovilizacionExistente = fila;
		historialCasoMock = [fila];

		const res = await llamar();
		expect(res.ok).toBe(true);
	});

	it("toma el advisory lock ANTES del SELECT ... FOR UPDATE de fila (review de Codex — evita deadlock 40P01)", async () => {
		const fila = reactivacionEjecutada();
		inmovilizacionExistente = fila;
		historialCasoMock = [fila];
		await llamar();
		expect(executeLlamadas).toEqual([
			"advisory_lock",
			"select_for_update_fila",
		]);
	});

	it("reactivación superada por un apagado DIRECTO más reciente en la unidad física — carrera detectada por el lock, no por el guard temprano (review de Codex)", async () => {
		// Simula la carrera: cuando el guard TEMPRANO corre (1ra consulta,
		// sin lock, historialCasoMock), la reactivación todavía es vigente —
		// pasa. En el instante siguiente, marcarEjecutada ejecuta un apagado
		// DIRECTO más reciente desde otro lado. Cuando la transacción toma el
		// lock y re-consulta (2da consulta, historialUnidadFisicaMock), ya ve
		// ese apagado — y ahí es donde tiene que rechazar. Si el guard con
		// lock no existiera (o comparara solo entre reactivaciones), esta
		// llamada pasaría igual que la 1ra.
		const fila = reactivacionEjecutada();
		inmovilizacionExistente = fila;
		historialCasoMock = [fila]; // lo que ve el guard temprano: sigue vigente
		historialUnidadFisicaMock = [
			{
				...reactivacionEjecutada(),
				id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
				accion: "apagado",
				ejecutadoAt: new Date("2026-09-25T10:00:00.000Z"), // posterior
			},
			fila, // el propio INMOV_ID, más antiguo — ya no es el vigente
		];
		await expect(llamar()).rejects.toMatchObject({ code: "CONFLICT" });
		expect(inmovilizacionesInsertadas).toHaveLength(0);
	});

	it("dueño en cartera sin usuario en el CRM y el usuario es solicitadoPor (fallback del aviso): permite registrar la llamada (review de Codex)", async () => {
		responsableCasoMock = null;
		const fila = reactivacionEjecutada({ solicitadoPor: "user-test" });
		inmovilizacionExistente = fila;
		historialCasoMock = [fila];

		const res = await llamar();
		expect(res.ok).toBe(true);
	});

	it("dueño en cartera sin usuario en el CRM y el usuario NO es solicitadoPor: rechaza con NOT_FOUND (review de Codex)", async () => {
		responsableCasoMock = null;
		const fila = reactivacionEjecutada({ solicitadoPor: "otro-asesor" });
		inmovilizacionExistente = fila;
		historialCasoMock = [fila];

		await expect(llamar()).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("cartera no responde: el ex solicitante NO registra la llamada de reactivación (falla cerrado)", async () => {
		responsableCasoMock = "otro-asesor";
		carteraFallaMock = true;
		const fila = reactivacionEjecutada({ solicitadoPor: "user-test" });
		inmovilizacionExistente = fila;
		historialCasoMock = [fila];

		await expect(llamar()).rejects.toMatchObject({
			code: "SERVICE_UNAVAILABLE",
		});
	});
});

describe("CB-041 — marcarInmovilizacionEnviadaARecuperacion", () => {
	afterEach(reset);

	it("actualiza un apagado en no_pago_pendiente_recuperacion a enviada_recuperacion y registra el evento", async () => {
		inmovilizacionExistente = {
			id: INMOV_ID,
			casoCobroId: CASO_ID,
			accion: "apagado",
			estado: "ejecutada",
			resultado: "no_pago_pendiente_recuperacion",
		};

		await marcarInmovilizacionEnviadaARecuperacion({
			casoCobroId: CASO_ID,
			usuarioId: "user-test",
			motivo: "Cliente no pagó ni respondió a llamadas",
		});

		expect(inmovilizacionExistente.resultado).toBe("enviada_recuperacion");
		expect(eventosInsertados).toHaveLength(1);
		expect(eventosInsertados[0]).toEqual({
			inmovilizacionId: INMOV_ID,
			evento: "enviar_a_recuperacion",
			estadoAnterior: "ejecutada",
			estadoNuevo: "ejecutada",
			usuarioId: "user-test",
			detalle: { motivo: "Cliente no pagó ni respondió a llamadas" },
		});
	});

	it("no toca inmovilizaciones que no están en no_pago_pendiente_recuperacion", async () => {
		inmovilizacionExistente = {
			id: INMOV_ID,
			casoCobroId: CASO_ID,
			accion: "apagado",
			estado: "ejecutada",
			resultado: "reactivada",
		};

		await marcarInmovilizacionEnviadaARecuperacion({
			casoCobroId: CASO_ID,
			usuarioId: "user-test",
			motivo: "Vehículo en recuperación",
		});

		expect(inmovilizacionExistente.resultado).toBe("reactivada");
		expect(eventosInsertados).toHaveLength(0);
	});

	it("no arroja error si la transacción local de base de datos falla (reconciliación best-effort)", async () => {
		transactionError = new Error("connection to server was lost");
		inmovilizacionExistente = {
			id: INMOV_ID,
			casoCobroId: CASO_ID,
			accion: "apagado",
			estado: "ejecutada",
			resultado: "no_pago_pendiente_recuperacion",
		};

		await expect(
			marcarInmovilizacionEnviadaARecuperacion({
				casoCobroId: CASO_ID,
				usuarioId: "user-test",
				motivo: "Cliente en recuperación",
			}),
		).resolves.toBeUndefined();

		expect(eventosInsertados).toHaveLength(0);
	});
});
