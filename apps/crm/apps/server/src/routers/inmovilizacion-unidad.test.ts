/**
 * CB-041 — solicitarInmovilizacion, decidirInmovilizacion, ejecutarApagado,
 * registrarLlamadaApagado.
 *
 * Mock de `db` propio: identifica ramas por TABLA (`.from(tabla)` /
 * `.insert(tabla)` / `.update(tabla)`), igual que gps-eventos-router.test.ts
 * y wialon.test.ts. `db.transaction` recibe un `tx` con la misma forma que
 * `db` — alcanza para los casos que este router necesita en transacción.
 */
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
	spyOn,
} from "bun:test";
import { call, ORPCError } from "@orpc/server";
import { PgDialect } from "drizzle-orm/pg-core";
import { user } from "../db/schema/auth";
import { casosCobros, contactosCobros } from "../db/schema/cobros";
import { opportunities } from "../db/schema/crm";
import { gpsConsultaLogs } from "../db/schema/gps-consulta-logs";
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
//  - registrarLlamadaApagado / registrarLlamadaReactivacion llaman SOLO
//    getHistorialUnidadFisica, nada antes → 0 (los tests de esos describe
//    lo pisan).
let historialUnidadFisicaMock: Record<string, unknown>[] | null = null;
let llamadasAntesDeHistorialFisico = 1;
let llamadasHistorialUnidad = 0;
let updateDevuelveFila = true;
// Fila que lee cancelarSolicitud antes de decidir quién puede cancelar; null
// = la solicitud no existe (se comporta como pendiente de aprobación).
let solicitudACancelarMock: {
	accion: string;
	estado: string;
	casoCobroId: string;
	numeroCreditoSifco: string;
} | null = null;
let recordatoriosEjecucionResueltos: string[] = [];
let contactoExisteMock = true;
let contactoInmovilizacionIdMock: string | null = null;
let contactoUpdateDevuelveFila = true;
let resolverPendientesLlamadas: string[] = [];
let unidadReactivadaNotificada = 0;
let resolverAvisoLlamarClienteLlamadas: string[] = [];
let notificarLlamarClienteLlamadas: { asesorUserId: string }[] = [];
let ejecucionNotificadaASupervisores: {
	ejecutadoPorUserId: string;
	accion: string;
	advertencia?: string;
}[] = [];
// Pagos de cartera-back del crédito (shape de `getPagosByCredito`) y la promesa
// activa del caso — lo que respalda una reactivación.
let pagosCarteraMock: Record<string, unknown>[] = [];
let pagosCarteraFalla = false;
let promesaActivaMock: Record<string, unknown> | null = null;
// Gestiones enlazadas (la llamada de cada inmovilización) y nombres de usuario
// que lee `getInmovilizacionesCaso` para el historial de la carta.
let llamadasEnlazadasMock: Record<string, unknown>[] = [];
// `casos_cobros.contrato_id` del caso (null = crédito migrado sin contrato) y los
// vehículos que dan sus oportunidades con ese SIFCO (el fallback).
let contratoIdMock: string | null = "contrato-1";
// Vehículo que da el CONTRATO del caso; undefined = el mismo `vehicleIdMock`.
let vehicleIdContratoMock: string | null | undefined;
let vehiculosOportunidadMock: Record<string, unknown>[] = [];
// La condición (`where`) con que se buscó el vehículo en las oportunidades.
let condicionOportunidadMock: unknown = null;
let nombresUsuarioMock: { id: string; name: string }[] = [];
let reconciliarAvisosLlamadas: (readonly string[] | undefined)[] = [];
let onNotificarLlamarCliente: (() => void) | null = null;
let reactivacionesObsoletasMock: { id: string }[] = [];
// Consulta de ubicación (gps_consulta_logs) a la que apunta la solicitud o la
// ejecución; null = no existe / venció / no es del usuario.
let consultaGpsMock: { snapshot: unknown; unitName: string | null } | null =
	null;
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
						// `limit` es la lectura del usuario actual; sin `limit`, la de
						// nombres del historial (se espera directo).
						where: () =>
							Object.assign(Promise.resolve(nombresUsuarioMock), {
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
															contratoId: contratoIdMock,
															vehicleId:
																vehicleIdContratoMock === undefined
																	? vehicleIdMock
																	: vehicleIdContratoMock,
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
				if (
					tabla === inmovilizacionesUnidad &&
					campos &&
					"estado" in campos &&
					"accion" in campos &&
					!("id" in campos)
				) {
					// cancelarSolicitud: select({ accion, estado, casoCobroId, sifco }).limit()
					return {
						where: () => ({
							limit: async () =>
								solicitudACancelarMock ? [solicitudACancelarMock] : [],
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
					// `limit` (marcarEjecutada / registrarLlamadaApagado /
					// registrarLlamadaReactivacion, que traen una fila por id).
					// marcarEjecutada / registrarLlamadaApagado: select().from().where().limit()
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
				if (tabla === opportunities) {
					// getCasoParaInmovilizacion (fallback): from().innerJoin().leftJoin().where()
					return {
						innerJoin: () => ({
							leftJoin: () => ({
								where: async (condicion: unknown) => {
									condicionOportunidadMock = condicion;
									return vehiculosOportunidadMock;
								},
							}),
						}),
					};
				}
				if (tabla === gpsConsultaLogs) {
					return {
						where: () => ({
							limit: async () => (consultaGpsMock ? [consultaGpsMock] : []),
						}),
					};
				}
				if (tabla === contactosCobros && campos && "comentarios" in campos) {
					// enriquecerFilasCarta: la llamada enlazada a cada inmovilización
					return { where: async () => llamadasEnlazadasMock };
				}
				if (
					tabla === contactosCobros &&
					campos &&
					"fechaProximoContacto" in campos
				) {
					// leerPromesaActivaCaso
					return {
						where: () => ({
							limit: async () => (promesaActivaMock ? [promesaActivaMock] : []),
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
														(
															inmovilizacionExistente as {
																casoCobroId?: string;
															}
														)?.casoCobroId ?? CASO_ID,
													accion:
														(inmovilizacionExistente as { accion?: string })
															?.accion ?? "apagado",
													solicitadoPor:
														(
															inmovilizacionExistente as {
																solicitadoPor?: string;
															}
														)?.solicitadoPor ??
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
	notificarEjecucionASupervisores: async (params: {
		ejecutadoPorUserId: string;
		accion: string;
		advertencia?: string;
	}) => {
		ejecucionNotificadaASupervisores.push({
			ejecutadoPorUserId: params.ejecutadoPorUserId,
			accion: params.accion,
			...(params.advertencia ? { advertencia: params.advertencia } : {}),
		});
	},
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
	resolverRecordatoriosEjecucion: async (id: string) => {
		recordatoriosEjecucionResueltos.push(id);
	},
	recordarInmovilizacionesSinEjecutar: async () => 0,
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
	getPagosByCredito: async () => {
		if (pagosCarteraFalla) throw new Error("cartera-back caído");
		return pagosCarteraMock;
	},
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
	ejecutarReactivacion,
	getRespaldoReactivacion,
	registrarLlamadaApagado,
	registrarLlamadaReactivacion,
	marcarInmovilizacionEnviadaARecuperacion,
} = await import("./inmovilizacion-unidad");
const carteraBackClient = carteraBackClientMock;

// Lo que pide el modal de solicitar un apagado: motivos del catálogo y la
// ubicación (acá la escribió el asesor; la consulta GPS se prueba aparte).
const FORMULARIO_APAGADO = {
	motivos: ["se_niega_a_pagar"],
	ubicacion: { direccion: "Zona 1, Ciudad de Guatemala" },
};
const NOTA_LEGION = "LEGION confirmó el apagado por WhatsApp";

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
	ejecucionNotificadaASupervisores = [];
	carteraHabilitadaMock = true;
	pagosCarteraFalla = false;
	llamadasEnlazadasMock = [];
	nombresUsuarioMock = [];
	contratoIdMock = "contrato-1";
	vehicleIdContratoMock = undefined;
	vehiculosOportunidadMock = [];
	condicionOportunidadMock = null;
	// Por defecto hay respaldo para cualquier opción: un pago muy posterior a
	// cualquier apagado y una promesa activa. Cada test lo quita o lo cambia.
	pagosCarteraMock = [
		{
			pago_id: 501,
			fecha_pago: "2099-01-10",
			monto_boleta: "1500.00",
			numeroAutorizacion: "REF-1",
			paymentFalse: false,
		},
	];
	promesaActivaMock = {
		id: "77777777-7777-7777-7777-777777777777",
		fechaProximoContacto: new Date("2099-02-01T00:00:00.000Z"),
		montoComprometido: "800.00",
	};
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
	solicitudACancelarMock = null;
	recordatoriosEjecucionResueltos = [];
	contactoExisteMock = true;
	contactoInmovilizacionIdMock = null;
	contactoUpdateDevuelveFila = true;
	resolverPendientesLlamadas = [];
	unidadReactivadaNotificada = 0;
	resolverAvisoLlamarClienteLlamadas = [];
	reactivacionesObsoletasMock = [];
	consultaGpsMock = null;
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
				...FORMULARIO_APAGADO,
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
					...FORMULARIO_APAGADO,
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
					...FORMULARIO_APAGADO,
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
					...FORMULARIO_APAGADO,
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
					...FORMULARIO_APAGADO,
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
					...FORMULARIO_APAGADO,
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
					...FORMULARIO_APAGADO,
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
					...FORMULARIO_APAGADO,
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
					...FORMULARIO_APAGADO,
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
					quePaso: "promesa",
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
				...FORMULARIO_APAGADO,
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
					...FORMULARIO_APAGADO,
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
				quePaso: "promesa",
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
					...FORMULARIO_APAGADO,
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
					...FORMULARIO_APAGADO,
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

	describe("aprobar un apagado revisa el bucket (último control antes de pedirle a LEGION)", () => {
		const solicitudPendiente = (accion: "apagado" | "reactivacion") => {
			inmovilizacionExistente = {
				id: INMOV_ID,
				casoCobroId: CASO_ID,
				accion,
				estado: "pendiente_aprobacion",
				wialonUnitId: 12345,
				numeroCreditoSifco: "01010214100000",
				solicitadoPor: "user-test",
				quePaso: accion === "reactivacion" ? "pago" : null,
				respaldoReactivacion:
					accion === "reactivacion" ? { pago: { id: 501 } } : null,
			};
		};
		const aprobar = () =>
			call(
				inmovilizacionUnidadRouter.decidirInmovilizacion,
				{ id: INMOV_ID, decision: "aprobar" },
				{ context: ctx("cobros_supervisor") },
			);

		it("crédito en B3: aprueba", async () => {
			solicitudPendiente("apagado");
			spyOn(carteraBackClient, "getBucketActualCredito").mockResolvedValue({
				bucket: 3,
			} as never);
			expect((await aprobar()).ok).toBe(true);
			expect(inmovilizacionExistente?.estado).toBe("aprobada");
		});

		it("una reactivación sin respaldo (pedida antes de exigirlo) no se aprueba: CONFLICT y sigue pendiente", async () => {
			solicitudPendiente("reactivacion");
			inmovilizacionExistente = {
				...inmovilizacionExistente,
				quePaso: null,
				respaldoReactivacion: null,
			};
			await expect(aprobar()).rejects.toMatchObject({
				code: "CONFLICT",
				message: expect.stringContaining("Rechazá esta solicitud"),
			});
			expect(inmovilizacionExistente?.estado).toBe("pendiente_aprobacion");
		});

		it("una reactivación sin respaldo sí se puede rechazar", async () => {
			solicitudPendiente("reactivacion");
			inmovilizacionExistente = {
				...inmovilizacionExistente,
				quePaso: null,
				respaldoReactivacion: null,
			};
			const res = await call(
				inmovilizacionUnidadRouter.decidirInmovilizacion,
				{
					id: INMOV_ID,
					decision: "rechazar",
					motivoRechazo: "Sin pago ni promesa",
				},
				{ context: ctx("cobros_supervisor") },
			);
			expect(res.ok).toBe(true);
		});

		it("el cliente ya pagó (B0): no se aprueba, con el mensaje de rechazarla", async () => {
			solicitudPendiente("apagado");
			spyOn(carteraBackClient, "getBucketActualCredito").mockResolvedValue({
				bucket: 0,
			} as never);
			await expect(aprobar()).rejects.toMatchObject({
				code: "CONFLICT",
				message: expect.stringContaining("Rechazá la solicitud"),
			});
			expect(inmovilizacionExistente?.estado).toBe("pendiente_aprobacion");
		});

		it("cartera no responde: falla cerrado, no se aprueba", async () => {
			solicitudPendiente("apagado");
			spyOn(carteraBackClient, "getBucketActualCredito").mockRejectedValue(
				new Error("cartera-back caído"),
			);
			await expect(aprobar()).rejects.toMatchObject({ code: "CONFLICT" });
			expect(inmovilizacionExistente?.estado).toBe("pendiente_aprobacion");
		});

		it("una reactivación se aprueba sin mirar el bucket (el cliente suele estar en B0)", async () => {
			solicitudPendiente("reactivacion");
			spyOn(carteraBackClient, "getBucketActualCredito").mockResolvedValue({
				bucket: 0,
			} as never);
			expect((await aprobar()).ok).toBe(true);
		});

		it("rechazar un apagado no consulta el bucket", async () => {
			solicitudPendiente("apagado");
			spyOn(carteraBackClient, "getBucketActualCredito").mockRejectedValue(
				new Error("cartera-back caído"),
			);
			const res = await call(
				inmovilizacionUnidadRouter.decidirInmovilizacion,
				{
					id: INMOV_ID,
					decision: "rechazar",
					motivoRechazo: "El cliente ya pagó",
				},
				{ context: ctx("cobros_supervisor") },
			);
			expect(res.ok).toBe(true);
		});
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

describe("CB-041 — ejecución del apagado (ejecutarApagado)", () => {
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
			inmovilizacionUnidadRouter.ejecutarApagado,
			{ id: INMOV_ID, nota: NOTA_LEGION },
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
			inmovilizacionUnidadRouter.ejecutarApagado,
			{ id: INMOV_ID, nota: NOTA_LEGION },
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
				inmovilizacionUnidadRouter.ejecutarApagado,
				{ id: INMOV_ID, nota: NOTA_LEGION },
				{ context: ctx("cobros_supervisor") },
			),
		).rejects.toBeInstanceOf(ORPCError);
	});

	it("apagado ya aplicado por LEGION pero el crédito bajó a B0 (el cliente pagó): se REGISTRA con advertencia, no se cancela — el carro sigue apagado y hay que poder reactivarlo", async () => {
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

		const res = await call(
			inmovilizacionUnidadRouter.ejecutarApagado,
			{ id: INMOV_ID, nota: NOTA_LEGION },
			{ context: ctx("cobros") },
		);

		expect(res.advertencia).toContain("B0");
		expect(res.advertencia).toContain("solicitá la reactivación");
		expect(inmovilizacionExistente.estado).toBe("ejecutada");
		expect(eventosInsertados.some((e) => e.evento === "cancelar")).toBe(false);
		const evento = eventosInsertados.find(
			(e) => e.evento === "marcar_ejecutada",
		);
		expect(evento?.detalle).toMatchObject({ bucketAlEjecutar: 0 });
		// Sigue el ciclo normal: aviso de llamar al cliente y aviso a supervisores
		// (con la advertencia, para que sepan que el crédito ya cambió de bucket).
		expect(notificarLlamarClienteLlamadas).toHaveLength(1);
		expect(ejecucionNotificadaASupervisores[0]?.advertencia).toContain("B0");
	});

	it("tras ese apagado tardío (crédito en B0) el CRM deja solicitar la reactivación: era el bloqueo que señaló el review", async () => {
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
		await call(
			inmovilizacionUnidadRouter.ejecutarApagado,
			{ id: INMOV_ID, nota: NOTA_LEGION },
			{ context: ctx("cobros") },
		);

		// La unidad ahora figura inmovilizada (hay un apagado ejecutado)...
		const res = await call(
			inmovilizacionUnidadRouter.solicitarInmovilizacion,
			{
				casoCobroId: CASO_ID,
				accion: "reactivacion",
				quePaso: "promesa",
			},
			{ context: ctx("cobros") },
		);
		// ...y la reactivación no pide bucket: se crea.
		expect(res.id).toBe(INMOV_ID);
		expect(
			inmovilizacionesInsertadas.some((f) => f.accion === "reactivacion"),
		).toBe(true);
	});

	it("apagado aprobado y cartera no responde: se registra igual, con advertencia de que no se pudo confirmar el bucket", async () => {
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

		const res = await call(
			inmovilizacionUnidadRouter.ejecutarApagado,
			{ id: INMOV_ID, nota: NOTA_LEGION },
			{ context: ctx("cobros") },
		);

		expect(res.advertencia).toContain("No se pudo confirmar el bucket");
		expect(inmovilizacionExistente.estado).toBe("ejecutada");
		expect(notificarLlamarClienteLlamadas).toHaveLength(1);
	});

	it("apagado con el crédito todavía en B2-B4: se registra sin advertencia", async () => {
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
		const res = await call(
			inmovilizacionUnidadRouter.ejecutarApagado,
			{ id: INMOV_ID, nota: NOTA_LEGION },
			{ context: ctx("cobros") },
		);
		expect(res.advertencia).toBeNull();
		expect(ejecucionNotificadaASupervisores[0]?.advertencia).toBeUndefined();
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
				inmovilizacionUnidadRouter.ejecutarApagado,
				{ id: INMOV_ID, nota: NOTA_LEGION },
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
				inmovilizacionUnidadRouter.ejecutarApagado,
				{ id: INMOV_ID, nota: NOTA_LEGION },
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
				inmovilizacionUnidadRouter.ejecutarApagado,
				{ id: INMOV_ID, nota: NOTA_LEGION },
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
		// Precondición que sí sigue cancelando: la unidad GPS cambió tras la aprobación
		wialonUnitIdVehiculoMock = 99999;
		// Simular que otra transacción ya la canceló: el UPDATE devuelve 0 filas
		updateDevuelveFila = false;

		await expect(
			call(
				inmovilizacionUnidadRouter.ejecutarApagado,
				{ id: INMOV_ID, nota: NOTA_LEGION },
				{ context: ctx("cobros_supervisor") },
			),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message:
				"La unidad GPS del vehículo cambió o fue reasignada tras la aprobación. La acción ya no aplica a la unidad original.",
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
			inmovilizacionUnidadRouter.ejecutarApagado,
			{ id: INMOV_ID, nota: NOTA_LEGION },
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
				quePaso: "pago",
				pagoId: 501,
				motivoDetalle: "Cliente pagó por ventanilla",
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
				quePaso: "promesa",
				motivoDetalle: "Entró en convenio",
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
				{ casoCobroId: CASO_ID, accion: "apagado", ...FORMULARIO_APAGADO },
				{ context: ctx("cobros") },
			),
		).rejects.toMatchObject({ code: "CONFLICT" });
	});

	it("un error de DB que NO es de índice único no se disfraza de CONFLICT", async () => {
		asesorAsignadoEnBucket(2);
		insertError = "otro";

		const error = await call(
			inmovilizacionUnidadRouter.solicitarInmovilizacion,
			{ casoCobroId: CASO_ID, accion: "apagado", ...FORMULARIO_APAGADO },
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

	it("cancelarSolicitud de un apagado aprobado: lo cancela el que lo puede ejecutar y cierra sus recordatorios", async () => {
		solicitudACancelarMock = {
			accion: "apagado",
			estado: "aprobada",
			casoCobroId: CASO_ID,
			numeroCreditoSifco: "01010214100000",
		};
		const res = await call(
			inmovilizacionUnidadRouter.cancelarSolicitud,
			{ id: INMOV_ID },
			{ context: ctx("cobros") },
		);
		expect(res).toEqual({ ok: true });
		expect(eventosInsertados[0]).toMatchObject({
			evento: "cancelar",
			estadoAnterior: "aprobada",
			estadoNuevo: "cancelada",
		});
		expect(resolverPendientesLlamadas).toEqual([INMOV_ID]);
		expect(recordatoriosEjecucionResueltos).toEqual([INMOV_ID]);
	});

	it("cancelarSolicitud de un apagado aprobado por alguien sin acceso al caso: no cancela", async () => {
		solicitudACancelarMock = {
			accion: "apagado",
			estado: "aprobada",
			casoCobroId: CASO_ID,
			numeroCreditoSifco: "01010214100000",
		};
		responsableCasoMock = "otro-asesor";
		await expect(
			call(
				inmovilizacionUnidadRouter.cancelarSolicitud,
				{ id: INMOV_ID },
				{ context: ctx("cobros") },
			),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(eventosInsertados).toHaveLength(0);
		expect(resolverPendientesLlamadas).toHaveLength(0);
	});

	it("cancelarSolicitud de una reactivación aprobada sigue sin permitirse (solo pendientes)", async () => {
		solicitudACancelarMock = {
			accion: "reactivacion",
			estado: "aprobada",
			casoCobroId: CASO_ID,
			numeroCreditoSifco: "01010214100000",
		};
		updateDevuelveFila = false; // el UPDATE exige estado pendiente: no hay fila
		await expect(
			call(
				inmovilizacionUnidadRouter.cancelarSolicitud,
				{ id: INMOV_ID },
				{ context: ctx("cobros") },
			),
		).rejects.toMatchObject({ code: "CONFLICT" });
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

	it("el historial trae la llamada enlazada (estado, comentarios y quién la hizo) para verla desde la carta", async () => {
		const CONTACTO = "44444444-4444-4444-4444-444444444444";
		historialCasoMock = [
			{
				...apagadoEjecutado(),
				llamadaContactoId: CONTACTO,
				ejecutadoPor: "user-test",
			},
		];
		llamadasEnlazadasMock = [
			{
				id: CONTACTO,
				fechaContacto: new Date("2026-09-30T20:58:00.000Z"),
				estadoContacto: "contactado",
				duracionLlamada: 95,
				comentarios: "Se le avisó del apagado y dijo que paga mañana",
				acuerdosAlcanzados: null,
				realizadoPor: "user-test",
			},
		];
		nombresUsuarioMock = [{ id: "user-test", name: "Jorge Sente" }];

		const res = await call(
			inmovilizacionUnidadRouter.getInmovilizacionesCaso,
			{ casoCobroId: CASO_ID },
			{ context: ctx("cobros") },
		);
		expect(res.historial[0]?.llamada).toMatchObject({
			id: CONTACTO,
			estadoContacto: "contactado",
			duracionLlamada: 95,
			comentarios: "Se le avisó del apagado y dijo que paga mañana",
			realizadoPorNombre: "Jorge Sente",
		});
	});

	it("una inmovilización sin llamada enlazada no trae llamada", async () => {
		historialCasoMock = [{ ...apagadoEjecutado(), llamadaContactoId: null }];
		const res = await call(
			inmovilizacionUnidadRouter.getInmovilizacionesCaso,
			{ casoCobroId: CASO_ID },
			{ context: ctx("cobros") },
		);
		expect(res.historial[0]?.llamada).toBeNull();
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

	it("ejecutarReactivacion avisa a los supervisores con la acción 'reactivacion'", async () => {
		inmovilizacionExistente = {
			id: INMOV_ID,
			casoCobroId: CASO_ID,
			accion: "reactivacion",
			estado: "aprobada",
			quePaso: "pago",
			respaldoReactivacion: { pago: { id: 501 } },
			wialonUnitId: 12345,
			bucketSnapshot: 2,
			numeroCreditoSifco: "01010214100000",
			vehicleId: VEHICLE_ID,
			inmovilizacionOrigenId: null,
		};
		await call(
			ejecutarReactivacion,
			{ id: INMOV_ID, nota: NOTA_LEGION },
			{ context: ctx("cobros") },
		);
		expect(ejecucionNotificadaASupervisores).toEqual([
			{ ejecutadoPorUserId: "user-test", accion: "reactivacion" },
		]);
	});

	it("ejecutarReactivacion avisa al asesor", async () => {
		inmovilizacionExistente = {
			...apagadoEjecutado(),
			accion: "reactivacion",
			estado: "aprobada",
			quePaso: "pago",
			respaldoReactivacion: { pago: { id: 501 } },
			inmovilizacionOrigenId: "88888888-8888-8888-8888-888888888888",
		};
		await call(
			ejecutarReactivacion,
			{ id: INMOV_ID, nota: NOTA_LEGION },
			{ context: ctx("cobros") },
		);
		expect(unidadReactivadaNotificada).toBe(1);
	});

	it("ejecutarReactivacion cierra el aviso 'llamar al cliente' del apagado origen (review de Codex)", async () => {
		const ORIGEN_ID = "88888888-8888-8888-8888-888888888888";
		inmovilizacionExistente = {
			...apagadoEjecutado(),
			accion: "reactivacion",
			estado: "aprobada",
			quePaso: "pago",
			respaldoReactivacion: { pago: { id: 501 } },
			inmovilizacionOrigenId: ORIGEN_ID,
		};
		await call(
			ejecutarReactivacion,
			{ id: INMOV_ID, nota: NOTA_LEGION },
			{ context: ctx("cobros") },
		);
		expect(resolverAvisoLlamarClienteLlamadas).toEqual([ORIGEN_ID]);
	});

	it("ejecutarReactivacion toma el advisory lock ANTES de tocar cualquier fila (review de Codex — evita deadlock 40P01)", async () => {
		// ejecutarReactivacion y registrarLlamadaApagado/registrarLlamadaReactivacion
		// pueden tomar locks de FILA en orden cruzado si compiten por la misma
		// unidad física — el advisory lock (adquirido primero, antes de
		// cualquier UPDATE/SELECT FOR UPDATE) serializa esa carrera en vez de
		// dejar que dos transacciones se esperen mutuamente.
		inmovilizacionExistente = {
			...apagadoEjecutado(),
			accion: "reactivacion",
			estado: "aprobada",
			quePaso: "pago",
			respaldoReactivacion: { pago: { id: 501 } },
			inmovilizacionOrigenId: "88888888-8888-8888-8888-888888888888",
		};
		await call(
			ejecutarReactivacion,
			{ id: INMOV_ID, nota: NOTA_LEGION },
			{ context: ctx("cobros") },
		);
		expect(executeLlamadas[0]).toBe("advisory_lock");
	});

	it("ejecutarApagado de un apagado NO toca el aviso de llamar al cliente (nada que cerrar todavía)", async () => {
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
			inmovilizacionUnidadRouter.ejecutarApagado,
			{ id: INMOV_ID, nota: NOTA_LEGION },
			{ context: ctx("cobros_supervisor") },
		);
		expect(resolverAvisoLlamarClienteLlamadas).toEqual([]);
	});

	it("ejecutarApagado de un apagado resuelve avisos de reactivaciones previas pendientes de llamada", async () => {
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
			inmovilizacionUnidadRouter.ejecutarApagado,
			{ id: INMOV_ID, nota: NOTA_LEGION },
			{ context: ctx("cobros_supervisor") },
		);

		expect(resolverAvisoLlamarClienteLlamadas).toEqual([
			REACTIVACION_OBSOLETA_ID,
		]);
	});

	it("ejecutarApagado no envía aviso de llamada si la llamada ya fue registrada concurrentemente", async () => {
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
			inmovilizacionUnidadRouter.ejecutarApagado,
			{ id: INMOV_ID, nota: NOTA_LEGION },
			{ context: ctx("cobros_supervisor") },
		);

		expect(notificarLlamarClienteLlamadas).toEqual([]);
		expect(resolverAvisoLlamarClienteLlamadas).toEqual([]);
	});

	it("ejecutarApagado no envía aviso si la acción ya fue superada en la unidad física", async () => {
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
			inmovilizacionUnidadRouter.ejecutarApagado,
			{ id: INMOV_ID, nota: NOTA_LEGION },
			{ context: ctx("cobros_supervisor") },
		);

		expect(notificarLlamarClienteLlamadas).toEqual([]);
	});

	it("ejecutarApagado reconcilia y resuelve el aviso si la llamada se registró durante el envío", async () => {
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
			inmovilizacionUnidadRouter.ejecutarApagado,
			{ id: INMOV_ID, nota: NOTA_LEGION },
			{ context: ctx("cobros_supervisor") },
		);

		// Se intentó notificar, pero al reconciliar se detectó el cambio y se resolvió
		expect(notificarLlamarClienteLlamadas).toHaveLength(1);
		expect(resolverAvisoLlamarClienteLlamadas).toEqual([INMOV_ID]);
	});

	it("ejecutarApagado reasigna el aviso si el caso fue reasignado concurrentemente durante el envío (review de Codex)", async () => {
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
			inmovilizacionUnidadRouter.ejecutarApagado,
			{ id: INMOV_ID, nota: NOTA_LEGION },
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

// ── Apagado con ubicación, evidencia y llamada inmediata ─────────────────────

const CONSULTA_ID = "55555555-5555-5555-5555-555555555555";

/** Snapshot de una consulta GPS con posición (misma forma que getGpsVehiculo). */
const snapshotConPosicion = (extra: Record<string, unknown> = {}) => ({
	estado: "vinculado",
	auditada: true,
	unitId: 12345,
	unitName: "P-123ABC",
	telemetria: {
		latitude: 14.6349,
		longitude: -90.5069,
		speedKmh: 0,
		isIgnitionOn: false,
		ultimaPosicionAt: "2026-09-30T15:00:00.000Z",
		ultimaSenalAt: "2026-09-30T15:00:05.000Z",
		...extra,
	},
});

describe("CB-041 — solicitarInmovilizacion de un apagado: motivos y ubicación", () => {
	afterEach(reset);

	const solicitar = (extra: Record<string, unknown>) =>
		call(
			inmovilizacionUnidadRouter.solicitarInmovilizacion,
			{ casoCobroId: CASO_ID, accion: "apagado", ...extra },
			{ context: ctx("cobros") },
		);

	it("sin ningún motivo marcado: BAD_REQUEST y no crea nada", async () => {
		await expect(
			solicitar({ motivos: [], ubicacion: { direccion: "Zona 1" } }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(inmovilizacionesInsertadas).toHaveLength(0);
	});

	it("'Se inmovilizó la unidad y no pagó' no es un motivo válido para pedir el apagado", async () => {
		await expect(
			solicitar({
				motivos: ["inmovilizada_sin_pago"],
				ubicacion: { direccion: "Zona 1" },
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("'Otro' sin detalle: BAD_REQUEST", async () => {
		await expect(
			solicitar({ motivos: ["otro"], ubicacion: { direccion: "Zona 1" } }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("sin ubicación (ni consulta GPS ni dirección/enlace): BAD_REQUEST", async () => {
		await expect(
			solicitar({ motivos: ["se_niega_a_pagar"] }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(inmovilizacionesInsertadas).toHaveLength(0);
	});

	it("enlace que no es http(s): BAD_REQUEST", async () => {
		await expect(
			solicitar({
				motivos: ["se_niega_a_pagar"],
				ubicacion: { enlace: "javascript:alert(1)" },
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("con dirección escrita a mano: guarda motivos, motivo compuesto y ubicación manual", async () => {
		await solicitar({
			motivos: ["se_niega_a_pagar", "otro"],
			motivoDetalle: "Dejó de contestar",
			ubicacion: { direccion: "3a calle 4-10 zona 7" },
		});
		const fila = inmovilizacionesInsertadas[0];
		expect(fila?.motivos).toEqual(["se_niega_a_pagar", "otro"]);
		expect(fila?.motivoDetalle).toBe("Dejó de contestar");
		expect(fila?.motivo).toBe("Se niega a pagar, Otro — Dejó de contestar");
		expect(fila?.ubicacionSolicitud).toMatchObject({
			fuente: "manual",
			direccion: "3a calle 4-10 zona 7",
		});
	});

	it("con la consulta GPS: la ubicación sale del snapshot auditado, no del cliente", async () => {
		consultaGpsMock = {
			snapshot: snapshotConPosicion({ speedKmh: 45 }),
			unitName: "P-123ABC",
		};
		await solicitar({
			motivos: ["se_niega_a_pagar"],
			ubicacion: { consultaLogId: CONSULTA_ID },
		});
		const ubicacion = inmovilizacionesInsertadas[0]?.ubicacionSolicitud as {
			fuente: string;
			lat: number;
			aviso: string;
			consultaLogId: string;
		};
		expect(ubicacion.fuente).toBe("gps");
		expect(ubicacion.lat).toBe(14.6349);
		expect(ubicacion.consultaLogId).toBe(CONSULTA_ID);
		// Va a 45 km/h: se advierte y se deja constancia, sin bloquear.
		expect(ubicacion.aviso).toContain("en movimiento");
	});

	it("consulta GPS vencida o de otro usuario/vehículo: BAD_REQUEST", async () => {
		consultaGpsMock = null;
		await expect(
			solicitar({
				motivos: ["se_niega_a_pagar"],
				ubicacion: { consultaLogId: CONSULTA_ID },
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(inmovilizacionesInsertadas).toHaveLength(0);
	});

	it("Wialon no dio posición pero el asesor escribió la dirección: se guarda como manual con el aviso", async () => {
		consultaGpsMock = {
			snapshot: {
				estado: "no_disponible",
				auditada: true,
				error: { code: "WIALON_TIMEOUT", message: "Wialon tardó demasiado." },
			},
			unitName: "P-123ABC",
		};
		await solicitar({
			motivos: ["se_niega_a_pagar"],
			ubicacion: { consultaLogId: CONSULTA_ID, direccion: "Zona 10" },
		});
		expect(inmovilizacionesInsertadas[0]?.ubicacionSolicitud).toMatchObject({
			fuente: "manual",
			direccion: "Zona 10",
			aviso: "Wialon tardó demasiado.",
		});
	});

	it("Wialon no dio posición y no hay dirección: BAD_REQUEST", async () => {
		consultaGpsMock = {
			snapshot: {
				estado: "no_disponible",
				auditada: true,
				error: { code: "X", message: "x" },
			},
			unitName: null,
		};
		await expect(
			solicitar({
				motivos: ["se_niega_a_pagar"],
				ubicacion: { consultaLogId: CONSULTA_ID },
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});
});

describe("CB-041 — el asesor ejecuta el apagado", () => {
	afterEach(reset);

	function apagadoAprobado(extra: Record<string, unknown> = {}) {
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
			...extra,
		};
	}

	it("el supervisor ya no marca ejecutadas desde la cola: el procedure no existe", () => {
		expect("marcarEjecutada" in inmovilizacionUnidadRouter).toBe(false);
	});

	it("sin archivo ni nota: BAD_REQUEST y no ejecuta", async () => {
		apagadoAprobado();
		await expect(
			call(
				inmovilizacionUnidadRouter.ejecutarApagado,
				{ id: INMOV_ID },
				{ context: ctx("cobros_supervisor") },
			),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(inmovilizacionExistente?.estado).toBe("aprobada");
	});

	it("nota sola alcanza: queda quién ejecutó, la nota y 'sin ubicación' en la fila y en el evento", async () => {
		apagadoAprobado();
		await call(
			inmovilizacionUnidadRouter.ejecutarApagado,
			{ id: INMOV_ID, nota: NOTA_LEGION },
			{ context: ctx("cobros_supervisor") },
		);
		expect(inmovilizacionExistente).toMatchObject({
			estado: "ejecutada",
			ejecutadoPor: "user-test",
			evidenciaNota: NOTA_LEGION,
			evidenciaR2Key: null,
			ubicacionEjecucion: { fuente: "sin_ubicacion" },
		});
		const evento = eventosInsertados.find(
			(e) => e.evento === "marcar_ejecutada",
		);
		expect(evento?.usuarioId).toBe("user-test");
		expect(evento?.detalle).toMatchObject({
			nota: NOTA_LEGION,
			ubicacion: { fuente: "sin_ubicacion" },
		});
	});

	it("al registrar el apagado avisa a los supervisores, una sola vez y con quién lo hizo", async () => {
		apagadoAprobado();
		await call(
			inmovilizacionUnidadRouter.ejecutarApagado,
			{ id: INMOV_ID, nota: NOTA_LEGION },
			{ context: ctx("cobros") },
		);
		expect(ejecucionNotificadaASupervisores).toEqual([
			{ ejecutadoPorUserId: "user-test", accion: "apagado" },
		]);
	});

	it("si el apagado se cancela por precondición (la unidad GPS cambió tras la aprobación), no avisa a nadie", async () => {
		apagadoAprobado();
		wialonUnitIdVehiculoMock = 99999;
		await expect(
			call(
				inmovilizacionUnidadRouter.ejecutarApagado,
				{ id: INMOV_ID, nota: NOTA_LEGION },
				{ context: ctx("cobros") },
			),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(ejecucionNotificadaASupervisores).toHaveLength(0);
	});

	it("con la consulta GPS de ese momento: guarda la ubicación y avisa si el vehículo está encendido", async () => {
		apagadoAprobado();
		consultaGpsMock = {
			snapshot: snapshotConPosicion({ isIgnitionOn: true }),
			unitName: "P-123ABC",
		};
		await call(
			inmovilizacionUnidadRouter.ejecutarApagado,
			{ id: INMOV_ID, nota: NOTA_LEGION, consultaLogId: CONSULTA_ID },
			{ context: ctx("cobros_supervisor") },
		);
		expect(inmovilizacionExistente?.ubicacionEjecucion).toMatchObject({
			fuente: "gps",
			lat: 14.6349,
			consultaLogId: CONSULTA_ID,
			aviso: "El vehículo tiene el motor encendido.",
		});
	});

	it("consulta GPS vencida o ajena: BAD_REQUEST y no ejecuta", async () => {
		apagadoAprobado();
		consultaGpsMock = null;
		await expect(
			call(
				inmovilizacionUnidadRouter.ejecutarApagado,
				{ id: INMOV_ID, nota: NOTA_LEGION, consultaLogId: CONSULTA_ID },
				{ context: ctx("cobros_supervisor") },
			),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(inmovilizacionExistente?.estado).toBe("aprobada");
	});

	it("una reactivación no se ejecuta por este endpoint: NOT_FOUND", async () => {
		apagadoAprobado({ accion: "reactivacion" });
		await expect(
			call(
				inmovilizacionUnidadRouter.ejecutarApagado,
				{ id: INMOV_ID, nota: NOTA_LEGION },
				{ context: ctx("cobros_supervisor") },
			),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("aún pendiente de aprobación: CONFLICT", async () => {
		apagadoAprobado({ estado: "pendiente_aprobacion" });
		await expect(
			call(
				inmovilizacionUnidadRouter.ejecutarApagado,
				{ id: INMOV_ID, nota: NOTA_LEGION },
				{ context: ctx("cobros_supervisor") },
			),
		).rejects.toMatchObject({ code: "CONFLICT" });
	});

	it("un asesor que no lleva el caso no puede ejecutarlo: NOT_FOUND", async () => {
		apagadoAprobado();
		responsableCasoMock = "otro-asesor";
		await expect(
			call(
				inmovilizacionUnidadRouter.ejecutarApagado,
				{ id: INMOV_ID, nota: NOTA_LEGION },
				{ context: ctx("cobros") },
			),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(inmovilizacionExistente?.estado).toBe("aprobada");
	});
});

describe("CB-041 — registrarLlamadaApagado", () => {
	afterEach(reset);

	function apagadoEjecutado(extra: Record<string, unknown> = {}) {
		const fila = {
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
		inmovilizacionExistente = fila;
		historialCasoMock = [fila];
		return fila;
	}

	const llamar = () =>
		call(
			registrarLlamadaApagado,
			{ inmovilizacionId: INMOV_ID, contactoId: CONTACTO_ID },
			{ context: ctx("cobros") },
		);

	it("enlaza la llamada sin 'Pagó / No pagó': no abre ninguna reactivación ni fija un resultado", async () => {
		apagadoEjecutado();
		const res = await llamar();
		expect(res.ok).toBe(true);
		expect(inmovilizacionesInsertadas).toHaveLength(0);
		expect(inmovilizacionExistente?.resultado).toBeUndefined();
		expect(
			eventosInsertados.some((e) => e.evento === "registrar_llamada_apagado"),
		).toBe(true);
		expect(resolverAvisoLlamarClienteLlamadas).toContain(INMOV_ID);
	});

	it("toma el advisory lock antes del SELECT ... FOR UPDATE de la fila", async () => {
		apagadoEjecutado();
		await llamar();
		expect(executeLlamadas).toEqual([
			"advisory_lock",
			"select_for_update_fila",
		]);
	});

	it("la llamada ya estaba registrada: CONFLICT", async () => {
		apagadoEjecutado({ llamadaContactoId: CONTACTO_ID });
		await expect(llamar()).rejects.toMatchObject({ code: "CONFLICT" });
	});

	it("la gestión no es una llamada posterior al apagado: BAD_REQUEST", async () => {
		apagadoEjecutado();
		contactoExisteMock = false;
		await expect(llamar()).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("la gestión ya está enlazada a otra inmovilización: CONFLICT", async () => {
		apagadoEjecutado();
		contactoInmovilizacionIdMock = "99999999-9999-9999-9999-999999999999";
		await expect(llamar()).rejects.toMatchObject({ code: "CONFLICT" });
	});

	it("apagado superado por una reactivación más reciente: CONFLICT", async () => {
		const fila = apagadoEjecutado();
		historialCasoMock = [
			{
				...fila,
				id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
				accion: "reactivacion",
				ejecutadoAt: new Date("2026-09-25T10:00:00.000Z"),
			},
			fila,
		];
		await expect(llamar()).rejects.toMatchObject({ code: "CONFLICT" });
	});

	it("dueño en cartera sin usuario en el CRM y el usuario es solicitadoPor (fallback del aviso): permite registrar la llamada", async () => {
		responsableCasoMock = null;
		apagadoEjecutado({ solicitadoPor: "user-test" });
		const res = await llamar();
		expect(res.ok).toBe(true);
	});

	it("dueño en cartera sin usuario en el CRM y el usuario NO es solicitadoPor: rechaza con NOT_FOUND", async () => {
		responsableCasoMock = null;
		apagadoEjecutado({ solicitadoPor: "otro-asesor" });
		await expect(llamar()).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("cartera no responde: el ex solicitante NO registra la llamada (falla cerrado)", async () => {
		// El crédito es de otro (el gate no lo deja pasar) y cartera se cae al
		// buscar al dueño: eso no puede leerse como "el dueño no tiene usuario".
		responsableCasoMock = "otro-asesor";
		carteraFallaMock = true;
		apagadoEjecutado({ solicitadoPor: "user-test" });
		await expect(llamar()).rejects.toMatchObject({
			code: "SERVICE_UNAVAILABLE",
		});
	});
});

describe("CB-041 — la reactivación solo se pide con respaldo", () => {
	// Review de Codex, PR #1808: `registrarResultadoLlamada` ("paga") abría una
	// reactivación sin `quePaso` ni respaldo. La única vía es
	// `solicitarInmovilizacion`, que valida el pago o la promesa.
	it("el router ya no expone registrarResultadoLlamada (no hay reactivación sin respaldo)", () => {
		expect("registrarResultadoLlamada" in inmovilizacionUnidadRouter).toBe(
			false,
		);
	});
});

// ── Reactivación: qué pasó, respaldo y ejecución por el asesor ───────────────

describe("CB-041 — solicitarInmovilizacion de una reactivación: respaldo", () => {
	afterEach(reset);

	const APAGADO_EJECUTADO_AT = new Date("2026-09-20T10:00:00.000Z");

	function conApagadoVigente() {
		historialCasoMock = [
			{
				id: INMOV_ID,
				casoCobroId: CASO_ID,
				accion: "apagado",
				estado: "ejecutada",
				ejecutadoAt: APAGADO_EJECUTADO_AT,
				wialonUnitId: 12345,
			},
		];
	}

	const solicitar = (extra: Record<string, unknown>) =>
		call(
			inmovilizacionUnidadRouter.solicitarInmovilizacion,
			{ casoCobroId: CASO_ID, accion: "reactivacion", ...extra },
			{ context: ctx("cobros") },
		);

	it("sin elegir qué pasó: BAD_REQUEST", async () => {
		conApagadoVigente();
		await expect(solicitar({})).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(inmovilizacionesInsertadas).toHaveLength(0);
	});

	it("'Pago' con un pago posterior al apagado: guarda la opción y el pago tal como está en cartera", async () => {
		conApagadoVigente();
		await solicitar({
			quePaso: "pago",
			pagoId: 501,
			motivoDetalle: "Depositó en ventanilla",
		});
		const fila = inmovilizacionesInsertadas[0];
		expect(fila?.quePaso).toBe("pago");
		expect(fila?.motivo).toBe("Pago — Depositó en ventanilla");
		expect(fila?.respaldoReactivacion).toEqual({
			pago: {
				pagoId: 501,
				fechaPago: "2099-01-10",
				monto: "1500.00",
				referencia: "REF-1",
				validacion: null,
			},
		});
	});

	it("'Pago' con un pago pendiente de validación: se puede solicitar y queda marcado como pendiente (solo informativo)", async () => {
		conApagadoVigente();
		pagosCarteraMock = [
			{ ...pagosCarteraMock[0], validationStatus: "pending" },
		];
		await solicitar({ quePaso: "pago", pagoId: 501 });
		expect(inmovilizacionesInsertadas).toHaveLength(1);
		expect(
			(
				inmovilizacionesInsertadas[0]?.respaldoReactivacion as {
					pago: { validacion: string };
				}
			).pago.validacion,
		).toBe("pending");
	});

	it("'Pago' sin elegir el pago: BAD_REQUEST", async () => {
		conApagadoVigente();
		await expect(solicitar({ quePaso: "pago" })).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
	});

	it("'Pago' con un pago que no es de este crédito (id inventado): BAD_REQUEST", async () => {
		conApagadoVigente();
		await expect(
			solicitar({ quePaso: "pago", pagoId: 999999 }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("'Pago' con un pago ANTERIOR al apagado: no cuenta", async () => {
		conApagadoVigente();
		pagosCarteraMock = [
			{
				pago_id: 400,
				fecha_pago: "2026-09-10",
				monto_boleta: "900.00",
				numeroAutorizacion: null,
				paymentFalse: false,
			},
		];
		await expect(
			solicitar({ quePaso: "pago", pagoId: 400 }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("'Pago' con un pago anulado (paymentFalse): no cuenta", async () => {
		conApagadoVigente();
		pagosCarteraMock = [
			{
				pago_id: 501,
				fecha_pago: "2099-01-10",
				monto_boleta: "1500.00",
				numeroAutorizacion: null,
				paymentFalse: true,
			},
		];
		await expect(
			solicitar({ quePaso: "pago", pagoId: 501 }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("'Pago' con cartera caída: SERVICE_UNAVAILABLE, no se aprueba a ciegas", async () => {
		conApagadoVigente();
		pagosCarteraFalla = true;
		await expect(
			solicitar({ quePaso: "pago", pagoId: 501 }),
		).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
		expect(inmovilizacionesInsertadas).toHaveLength(0);
	});

	it("'Promesa de pago' con una promesa activa: la guarda con su fecha y monto", async () => {
		conApagadoVigente();
		await solicitar({ quePaso: "promesa" });
		expect(inmovilizacionesInsertadas[0]?.respaldoReactivacion).toEqual({
			promesa: {
				contactoId: "77777777-7777-7777-7777-777777777777",
				fechaPrometida: "2099-02-01T00:00:00.000Z",
				monto: "800.00",
			},
		});
	});

	it("'Promesa de pago' sin promesa activa en el caso: BAD_REQUEST", async () => {
		conApagadoVigente();
		promesaActivaMock = null;
		await expect(solicitar({ quePaso: "promesa" })).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
		expect(inmovilizacionesInsertadas).toHaveLength(0);
	});

	it("'Promesa de pago' no consulta pagos: sirve aunque cartera no los dé", async () => {
		conApagadoVigente();
		pagosCarteraFalla = true;
		await solicitar({ quePaso: "promesa" });
		expect(inmovilizacionesInsertadas).toHaveLength(1);
	});

	it("'50% + promesa' exige las dos cosas", async () => {
		conApagadoVigente();
		promesaActivaMock = null;
		await expect(
			solicitar({ quePaso: "pago_parcial_promesa", pagoId: 501 }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		promesaActivaMock = {
			id: "77777777-7777-7777-7777-777777777777",
			fechaProximoContacto: new Date("2099-02-01T00:00:00.000Z"),
			montoComprometido: null,
		};
		await expect(
			solicitar({ quePaso: "pago_parcial_promesa" }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await solicitar({ quePaso: "pago_parcial_promesa", pagoId: 501 });
		const respaldo = inmovilizacionesInsertadas[0]?.respaldoReactivacion as {
			pago?: unknown;
			promesa?: { monto: string | null };
		};
		expect(respaldo.pago).toBeDefined();
		expect(respaldo.promesa?.monto).toBeNull();
	});

	it("'Entrega voluntaria' y 'Sin contacto' no son opciones de reactivación: BAD_REQUEST", async () => {
		conApagadoVigente();
		await expect(
			solicitar({ quePaso: "entrega_voluntaria" }),
		).rejects.toBeInstanceOf(ORPCError);
		await expect(solicitar({ quePaso: "sin_contacto" })).rejects.toBeInstanceOf(
			ORPCError,
		);
	});
});

describe("CB-041 — getRespaldoReactivacion", () => {
	afterEach(reset);

	const leer = () =>
		call(
			getRespaldoReactivacion,
			{ casoCobroId: CASO_ID },
			{ context: ctx("cobros") },
		);

	function conApagadoVigente() {
		historialCasoMock = [
			{
				id: INMOV_ID,
				casoCobroId: CASO_ID,
				accion: "apagado",
				estado: "ejecutada",
				ejecutadoAt: new Date("2026-09-20T10:00:00.000Z"),
				wialonUnitId: 12345,
			},
		];
	}

	it("da los pagos posteriores al apagado (más reciente primero) y la promesa activa", async () => {
		conApagadoVigente();
		pagosCarteraMock = [
			{
				pago_id: 1,
				fecha_pago: "2026-09-01",
				monto_boleta: "100.00",
				numeroAutorizacion: null,
				paymentFalse: false,
			},
			{
				pago_id: 2,
				fecha_pago: "2026-09-21",
				monto_boleta: "200.00",
				numeroAutorizacion: "A",
				paymentFalse: false,
			},
			{
				pago_id: 3,
				fecha_pago: "2026-09-25",
				monto_boleta: "300.00",
				numeroAutorizacion: null,
				paymentFalse: false,
			},
		];
		const res = await leer();
		expect(res.pagos.map((p) => p.pagoId)).toEqual([3, 2]);
		expect(res.promesa?.monto).toBe("800.00");
		expect(res.errorPagos).toBeNull();
	});

	it("cartera caída: no rompe, devuelve la promesa y el motivo por el que no hay pagos", async () => {
		conApagadoVigente();
		pagosCarteraFalla = true;
		const res = await leer();
		expect(res.pagos).toEqual([]);
		expect(res.errorPagos).toContain("pagos");
		expect(res.promesa).not.toBeNull();
	});

	it("unidad que no está apagada: sin fecha de apagado y sin pagos", async () => {
		historialCasoMock = [];
		const res = await leer();
		expect(res.apagadoEjecutadoAt).toBeNull();
		expect(res.pagos).toEqual([]);
	});

	it("un asesor ajeno al caso: NOT_FOUND", async () => {
		responsableCasoMock = "otro-asesor";
		await expect(leer()).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("CB-041 — el asesor ejecuta la reactivación", () => {
	afterEach(reset);

	function reactivacionAprobada() {
		inmovilizacionExistente = {
			...{
				id: INMOV_ID,
				casoCobroId: CASO_ID,
				accion: "reactivacion",
				estado: "aprobada",
				quePaso: "pago",
				respaldoReactivacion: { pago: { id: 501 } },
				wialonUnitId: 12345,
				bucketSnapshot: 0,
				numeroCreditoSifco: "01010214100000",
				vehicleId: VEHICLE_ID,
				solicitadoPor: "user-test",
				inmovilizacionOrigenId: null,
			},
		};
	}

	it("sin archivo ni nota: BAD_REQUEST", async () => {
		reactivacionAprobada();
		await expect(
			call(ejecutarReactivacion, { id: INMOV_ID }, { context: ctx("cobros") }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(inmovilizacionExistente?.estado).toBe("aprobada");
	});

	it("una reactivación aprobada sin respaldo (anterior a exigirlo) no se ejecuta: CONFLICT", async () => {
		reactivacionAprobada();
		inmovilizacionExistente = {
			...inmovilizacionExistente,
			quePaso: null,
			respaldoReactivacion: null,
		};
		await expect(
			call(
				ejecutarReactivacion,
				{ id: INMOV_ID, nota: NOTA_LEGION },
				{ context: ctx("cobros") },
			),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(inmovilizacionExistente?.estado).toBe("aprobada");
	});

	it("con nota: queda ejecutada por el asesor, sin ubicación (la reactivación no la consulta)", async () => {
		reactivacionAprobada();
		await call(
			ejecutarReactivacion,
			{ id: INMOV_ID, nota: NOTA_LEGION },
			{ context: ctx("cobros") },
		);
		expect(inmovilizacionExistente).toMatchObject({
			estado: "ejecutada",
			ejecutadoPor: "user-test",
			evidenciaNota: NOTA_LEGION,
			ubicacionEjecucion: null,
		});
		const evento = eventosInsertados.find(
			(e) => e.evento === "marcar_ejecutada",
		);
		expect(evento?.usuarioId).toBe("user-test");
	});

	it("ignora una consulta GPS: la reactivación no guarda ubicación", async () => {
		reactivacionAprobada();
		consultaGpsMock = {
			snapshot: snapshotConPosicion(),
			unitName: "P-123ABC",
		};
		await call(
			ejecutarReactivacion,
			{ id: INMOV_ID, nota: NOTA_LEGION, consultaLogId: CONSULTA_ID },
			{ context: ctx("cobros") },
		);
		expect(inmovilizacionExistente?.ubicacionEjecucion).toBeNull();
	});

	it("un apagado no se ejecuta por este endpoint: NOT_FOUND", async () => {
		reactivacionAprobada();
		inmovilizacionExistente = { ...inmovilizacionExistente, accion: "apagado" };
		await expect(
			call(
				ejecutarReactivacion,
				{ id: INMOV_ID, nota: NOTA_LEGION },
				{ context: ctx("cobros") },
			),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("un asesor que no lleva el caso no puede ejecutarla: NOT_FOUND", async () => {
		reactivacionAprobada();
		responsableCasoMock = "otro-asesor";
		await expect(
			call(
				ejecutarReactivacion,
				{ id: INMOV_ID, nota: NOTA_LEGION },
				{ context: ctx("cobros") },
			),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

// ── Vehículo del caso: contrato primero, oportunidad si no hay contrato ──────

describe("CB-041 — de dónde sale el vehículo del caso", () => {
	afterEach(reset);

	const solicitar = () =>
		call(
			inmovilizacionUnidadRouter.solicitarInmovilizacion,
			{ casoCobroId: CASO_ID, accion: "apagado", ...FORMULARIO_APAGADO },
			{ context: ctx("cobros") },
		);

	const vehiculoOportunidad = (extra: Record<string, unknown> = {}) => ({
		vehicleId: VEHICLE_ID,
		wialonUnitId: 12345,
		wialonUnitName: "P-123ABC CON APAGADO",
		nombre: "Jaime",
		apellido: "Monzón",
		...extra,
	});

	it("con contrato: usa el vehículo del contrato y no consulta la oportunidad", async () => {
		vehiculosOportunidadMock = [
			vehiculoOportunidad({
				vehicleId: "99999999-9999-9999-9999-999999999999",
			}),
		];
		await solicitar();
		expect(inmovilizacionesInsertadas[0]?.vehicleId).toBe(VEHICLE_ID);
	});

	it("con contrato pero sin vehículo: no cae a la oportunidad (el contrato manda) y rechaza", async () => {
		vehicleIdContratoMock = null;
		wialonUnitIdCasoMock = null;
		vehiculosOportunidadMock = [vehiculoOportunidad()];
		await expect(solicitar()).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(inmovilizacionesInsertadas).toHaveLength(0);
	});

	it("sin contrato: usa el vehículo de la oportunidad con ese SIFCO", async () => {
		contratoIdMock = null;
		vehicleIdContratoMock = null;
		wialonUnitIdCasoMock = null;
		vehiculosOportunidadMock = [vehiculoOportunidad()];
		const res = await solicitar();
		expect(res.id).toBe(INMOV_ID);
		expect(inmovilizacionesInsertadas[0]).toMatchObject({
			vehicleId: VEHICLE_ID,
			wialonUnitId: 12345,
		});
	});

	it("sin contrato: solo mira oportunidades de un crédito otorgado (won/migrate), no open/lost/on_hold", async () => {
		contratoIdMock = null;
		vehicleIdContratoMock = null;
		wialonUnitIdCasoMock = null;
		vehiculosOportunidadMock = [vehiculoOportunidad()];
		await solicitar();
		// La base no se puede consultar en el mock: se revisa el SQL de la condición.
		const { sql, params } = new PgDialect().sqlToQuery(
			condicionOportunidadMock as never,
		);
		expect(sql).toContain('"status" in');
		expect(params).toEqual(
			expect.arrayContaining(["01010214100000", "won", "migrate"]),
		);
		expect(params).not.toContain("lost");
		expect(params).not.toContain("open");
		expect(params).not.toContain("on_hold");
	});

	describe("con la unidad ya apagada por este caso, el vehículo guardado en el apagado no se pierde", () => {
		// `reset` deja el respaldo por defecto (pago y promesa): sin esto el primer
		// test dependería de que otro corriera antes.
		beforeEach(reset);
		const apagadoEjecutado = (extra: Record<string, unknown> = {}) => ({
			id: INMOV_ID,
			casoCobroId: CASO_ID,
			accion: "apagado",
			estado: "ejecutada",
			vehicleId: VEHICLE_ID,
			wialonUnitId: 12345,
			ejecutadoAt: new Date("2026-09-20T10:00:00.000Z"),
			...extra,
		});
		// Sin contrato y con dos vehículos won/migrate en las oportunidades: hoy no
		// se podría elegir ninguno (p. ej. se sumó una oportunidad después).
		const oportunidadesAmbiguas = () => {
			contratoIdMock = null;
			vehicleIdContratoMock = null;
			wialonUnitIdCasoMock = null;
			vehiculosOportunidadMock = [
				vehiculoOportunidad(),
				vehiculoOportunidad({
					vehicleId: "88888888-8888-8888-8888-888888888888",
				}),
			];
		};

		it("se puede pedir la reactivación contra la unidad del apagado", async () => {
			oportunidadesAmbiguas();
			historialCasoMock = [apagadoEjecutado()];
			await call(
				inmovilizacionUnidadRouter.solicitarInmovilizacion,
				{ casoCobroId: CASO_ID, accion: "reactivacion", quePaso: "promesa" },
				{ context: ctx("cobros") },
			);
			expect(inmovilizacionesInsertadas[0]).toMatchObject({
				accion: "reactivacion",
				vehicleId: VEHICLE_ID,
				wialonUnitId: 12345,
			});
		});

		it("la carta sigue ofreciendo la unidad (tieneGps) aunque las oportunidades ya no den un único vehículo", async () => {
			oportunidadesAmbiguas();
			historialCasoMock = [apagadoEjecutado()];
			const res = await call(
				inmovilizacionUnidadRouter.getInmovilizacionesCaso,
				{ casoCobroId: CASO_ID },
				{ context: ctx("cobros") },
			);
			expect(res.tieneGps).toBe(true);
			expect(res.estadoUnidad).toBe("inmovilizada");
		});

		it("si después se reactivó (la unidad volvió a estar activa), no se reutiliza el apagado viejo: un apagado nuevo sigue rechazándose por ambiguo", async () => {
			oportunidadesAmbiguas();
			historialCasoMock = [
				apagadoEjecutado(),
				{
					...apagadoEjecutado(),
					id: "77777777-7777-7777-7777-777777777777",
					accion: "reactivacion",
					ejecutadoAt: new Date("2026-09-25T10:00:00.000Z"),
				},
			];
			await expect(solicitar()).rejects.toMatchObject({
				code: "BAD_REQUEST",
				message: expect.stringContaining("más de un vehículo"),
			});
			expect(inmovilizacionesInsertadas).toHaveLength(0);
		});

		it("un apagado que no guardó la unidad (filas viejas) no sirve de respaldo", async () => {
			oportunidadesAmbiguas();
			historialCasoMock = [apagadoEjecutado({ wialonUnitId: null })];
			await expect(
				call(
					inmovilizacionUnidadRouter.solicitarInmovilizacion,
					{ casoCobroId: CASO_ID, accion: "reactivacion", quePaso: "promesa" },
					{ context: ctx("cobros") },
				),
			).rejects.toMatchObject({ code: "BAD_REQUEST" });
		});
	});

	it("sin contrato y varias oportunidades del MISMO vehículo: lo usa (no es ambiguo)", async () => {
		contratoIdMock = null;
		vehicleIdContratoMock = null;
		wialonUnitIdCasoMock = null;
		vehiculosOportunidadMock = [vehiculoOportunidad(), vehiculoOportunidad()];
		await solicitar();
		expect(inmovilizacionesInsertadas).toHaveLength(1);
	});

	it("sin contrato y oportunidades con vehículos DISTINTOS: no elige ninguno y lo dice", async () => {
		contratoIdMock = null;
		vehicleIdContratoMock = null;
		wialonUnitIdCasoMock = null;
		vehiculosOportunidadMock = [
			vehiculoOportunidad(),
			vehiculoOportunidad({
				vehicleId: "88888888-8888-8888-8888-888888888888",
			}),
		];
		await expect(solicitar()).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: expect.stringContaining("más de un vehículo"),
		});
		expect(inmovilizacionesInsertadas).toHaveLength(0);
	});

	it("sin contrato y sin oportunidad con vehículo: rechaza como un caso sin vehículo", async () => {
		contratoIdMock = null;
		vehicleIdContratoMock = null;
		wialonUnitIdCasoMock = null;
		vehiculosOportunidadMock = [];
		await expect(solicitar()).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: expect.stringContaining("no tiene un vehículo asociado"),
		});
	});

	it("sin contrato, el vehículo de la oportunidad sin GPS vinculada: rechaza por la unidad", async () => {
		contratoIdMock = null;
		vehicleIdContratoMock = null;
		wialonUnitIdCasoMock = null;
		vehiculosOportunidadMock = [vehiculoOportunidad({ wialonUnitId: null })];
		await expect(solicitar()).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: expect.stringContaining("unidad GPS"),
		});
	});

	it("sin contrato: la carta ve tieneGps según la unidad del vehículo de la oportunidad", async () => {
		contratoIdMock = null;
		vehicleIdContratoMock = null;
		wialonUnitIdCasoMock = null;
		vehiculosOportunidadMock = [vehiculoOportunidad()];
		const res = await call(
			inmovilizacionUnidadRouter.getInmovilizacionesCaso,
			{ casoCobroId: CASO_ID },
			{ context: ctx("cobros") },
		);
		expect(res.tieneGps).toBe(true);
	});
});
