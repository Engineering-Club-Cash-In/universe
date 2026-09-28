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
import type { Context } from "../lib/context";

let rolUsuarioMock = "cobros";
let responsableCasoMock: string | null = "user-test";
let solicitadoPorMarcarEjecutadaMock = "user-test";
let numeroCreditoSifcoMock: string | null = "01010214100000";
let vehicleIdMock: string | null; // inicializado abajo, junto a VEHICLE_ID
let carteraHabilitadaMock = true;

// null = inserta bien; "unique" = 23505 (índice único de solicitud abierta);
// "unique_envuelto" = 23505 dentro de `cause` (como lo envuelve Drizzle);
// "otro" = cualquier otro error de DB (no debe traducirse a CONFLICT).
let insertError: null | "unique" | "unique_envuelto" | "otro" = null;
let inmovilizacionesInsertadas: Record<string, unknown>[] = [];
let eventosInsertados: Record<string, unknown>[] = [];
let inmovilizacionExistente: Record<string, unknown> | null = null;
let historialCasoMock: Record<string, unknown>[] = [];
// Por defecto igual a historialCasoMock (la mayoría de los tests no
// necesitan distinguir unidad compartida). Los tests que SÍ prueban D-10
// lo sobreescriben para simular un historial de UNIDAD FÍSICA distinto al
// del caso — getHistorialCaso y getHistorialUnidadFisica tienen la misma
// firma (select().from(tabla).where().orderBy()), así que el mock las
// distingue por ORDEN de llamada dentro de getInmovilizacionesCaso: la
// 1ra es getHistorialCaso, la 2da getHistorialUnidadFisica.
let historialUnidadFisicaMock: Record<string, unknown>[] | null = null;
let llamadasHistorialUnidad = 0;
let updateDevuelveFila = true;
let contactoExisteMock = true;
let contactoInmovilizacionIdMock: string | null = null;
let contactoUpdateDevuelveFila = true;
let resolverPendientesLlamadas: string[] = [];
let unidadReactivadaNotificada = 0;
let resolverAvisoLlamarClienteLlamadas: string[] = [];
let notificarLlamarClienteLlamadas: { asesorUserId: string }[] = [];

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
				if (tabla === casosCobros && campos && "responsableCobros" in campos) {
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
															responsableCobros: responsableCasoMock,
															numeroCreditoSifco: numeroCreditoSifcoMock,
															vehicleId: vehicleIdMock,
															wialonUnitId: 12345,
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
					// assertAccesoCasoCobro: select({id}).from(casosCobros).where().limit()
					return {
						where: () => ({
							limit: async () =>
								rolUsuarioMock === "admin" ||
								rolUsuarioMock === "cobros_supervisor" ||
								responsableCasoMock === "user-test"
									? [{ id: CASO_ID }]
									: [],
						}),
					};
				}
				if (tabla === inmovilizacionesUnidad && campos === undefined) {
					// getHistorialCaso: select().from(inmovilizacionesUnidad).where().orderBy()
					// getHistorialUnidadFisica: misma firma — ver comentario de
					// historialUnidadFisicaMock arriba.
					// marcarEjecutada / registrarResultadoLlamada: select().from().where().limit()
					llamadasHistorialUnidad++;
					const esSegundaLlamada = llamadasHistorialUnidad % 2 === 0;
					const historialDevuelto =
						esSegundaLlamada && historialUnidadFisicaMock !== null
							? historialUnidadFisicaMock
							: historialCasoMock;
					return {
						where: () => ({
							orderBy: async () => historialDevuelto,
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
					set: () => ({
						where: () => ({
							returning: async () =>
								updateDevuelveFila
									? [
											{
												id: INMOV_ID,
												casoCobroId: CASO_ID,
												accion: inmovilizacionExistente?.accion ?? "apagado",
												solicitadoPor: solicitadoPorMarcarEjecutadaMock,
											},
										]
									: [],
						}),
					}),
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
		transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb()),
	};
}

mock.module("../db", () => ({ db: mockDb() }));
// routers/cobros.ts (de donde sale assertAccesoCasoCobro) inicializa
// @cci/email al importarse y exige RESEND_API_KEY — mismo mock que
// cobros.moraRecuperacion.test.ts y convenio-decision.errores.test.ts.
mock.module("@cci/email", () => ({ sendPlainEmail: mock() }));
mock.module("../services/inmovilizacion-notif", () => ({
	notificarInmovilizacionPendiente: async () => undefined,
	notificarInmovilizacionResuelta: async () => undefined,
	notificarLlamarCliente: async (params: { asesorUserId: string }) => {
		notificarLlamarClienteLlamadas.push({ asesorUserId: params.asesorUserId });
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

const { inmovilizacionUnidadRouter } = await import("./inmovilizacion-unidad");
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
	solicitadoPorMarcarEjecutadaMock = "user-test";
	numeroCreditoSifcoMock = "01010214100000";
	vehicleIdMock = VEHICLE_ID;
	notificarLlamarClienteLlamadas = [];
	carteraHabilitadaMock = true;
	insertError = null;
	inmovilizacionesInsertadas = [];
	eventosInsertados = [];
	inmovilizacionExistente = null;
	historialCasoMock = [];
	historialUnidadFisicaMock = null;
	llamadasHistorialUnidad = 0;
	updateDevuelveFila = true;
	contactoExisteMock = true;
	contactoInmovilizacionIdMock = null;
	contactoUpdateDevuelveFila = true;
	resolverPendientesLlamadas = [];
	unidadReactivadaNotificada = 0;
	resolverAvisoLlamarClienteLlamadas = [];
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

	it("bucket B4 (fuera de rango en CB-041): rechaza", async () => {
		spyOn(carteraBackClient, "getCredito").mockResolvedValue({
			asesor: { emailCashIn: "u@example.com" },
		} as never);
		spyOn(carteraBackClient, "getBucketActualCredito").mockResolvedValue({
			bucket: 4,
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
			vehicleId: null,
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

	it("caso sin responsableCobros: notifica igual, con fallback a quien solicitó (review de Codex)", async () => {
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
});

function apagadoEjecutado(extra: Record<string, unknown> = {}) {
	return {
		id: INMOV_ID,
		casoCobroId: CASO_ID,
		accion: "apagado",
		estado: "ejecutada",
		numeroCreditoSifco: "01010214100000",
		vehicleId: null,
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

	it("resultado=paga: enlaza el contacto y abre reactivación apuntando al apagado", async () => {
		inmovilizacionExistente = apagadoEjecutado();

		const res = await llamar("paga");
		expect(res.ok).toBe(true);
		const reactivacion = inmovilizacionesInsertadas.find(
			(f) => f.accion === "reactivacion",
		);
		expect(reactivacion?.inmovilizacionOrigenId).toBe(INMOV_ID);
	});

	it("resultado=no_paga: no abre reactivación", async () => {
		inmovilizacionExistente = apagadoEjecutado();

		const res = await llamar("no_paga");
		expect(res.ok).toBe(true);
		expect(inmovilizacionesInsertadas).toHaveLength(0);
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
		inmovilizacionExistente = apagadoEjecutado();
		contactoExisteMock = false;
		await expect(llamar("paga")).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
	});

	it("la llamada ya estaba registrada: CONFLICT y no abre otra reactivación", async () => {
		inmovilizacionExistente = apagadoEjecutado({
			llamadaContactoId: "55555555-5555-5555-5555-555555555555",
		});
		await expect(llamar("paga")).rejects.toMatchObject({ code: "CONFLICT" });
		expect(inmovilizacionesInsertadas).toHaveLength(0);
	});

	it("la gestión ya está enlazada a otra inmovilización: CONFLICT", async () => {
		inmovilizacionExistente = apagadoEjecutado();
		contactoInmovilizacionIdMock = "66666666-6666-6666-6666-666666666666";
		await expect(llamar("no_paga")).rejects.toMatchObject({
			code: "CONFLICT",
		});
	});

	it("carrera (doble clic): el UPDATE condicionado no devuelve fila → CONFLICT y no inserta nada", async () => {
		// El SELECT inicial todavía ve la llamada sin registrar; el otro
		// request ya la registró antes del UPDATE.
		inmovilizacionExistente = apagadoEjecutado();
		updateDevuelveFila = false;
		await expect(llamar("paga")).rejects.toMatchObject({ code: "CONFLICT" });
		expect(inmovilizacionesInsertadas).toHaveLength(0);
	});

	it("carrera sobre la gestión: el enlace del contacto no devuelve fila → CONFLICT", async () => {
		inmovilizacionExistente = apagadoEjecutado();
		contactoUpdateDevuelveFila = false;
		await expect(llamar("paga")).rejects.toMatchObject({ code: "CONFLICT" });
		expect(inmovilizacionesInsertadas).toHaveLength(0);
	});

	it("paga con otra solicitud ya abierta en el caso (índice único): CONFLICT, no 500", async () => {
		inmovilizacionExistente = apagadoEjecutado();
		insertError = "unique_envuelto";
		await expect(llamar("paga")).rejects.toMatchObject({ code: "CONFLICT" });
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
});
