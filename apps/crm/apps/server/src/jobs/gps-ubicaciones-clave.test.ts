import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
	setSystemTime,
	spyOn,
} from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { db } from "../db";
import { gpsConsultaLogs } from "../db/schema/gps-consulta-logs";
import {
	gpsEstancias,
	gpsEstanciasCursor,
	gpsUbicacionesClave,
} from "../db/schema/gps-eventos";
import * as gpsEventosService from "../services/wialon/gps-eventos";
import * as wialonClientModule from "../services/wialon/wialon-client";
import * as gpsEventosPoll from "./gps-eventos-poll";
import {
	calcularUbicacionesUnidadBajoDemanda,
	correrPurgaUbicacionesClave,
	ejecutarCalculoUbicacionesClave,
} from "./gps-ubicaciones-clave";

const DIA_MS = 24 * 60 * 60 * 1000;
// Cursor que ve la transacción tras tomar el lock (revalidación). Por defecto
// el mismo que leyó la corrida; un test lo cambia para simular a otra instancia.
let cursorEnTx: () => { procesadoHasta: Date }[] = () => [];
// Estancias que lee, dentro del lock, el armado de ubicaciones.
let estanciasEnTx: () => unknown[] = () => [];
// Orden de lo que ocurre dentro de las transacciones (lock, lecturas, escrituras).
let ordenTx: string[] = [];
// `select` de la transacción: con `.limit` es la revalidación del cursor; sin
// `.limit` (se hace await del where) es la lectura de estancias.
const selectCursorEnTx = () => ({
	from: () => ({
		where: () => {
			ordenTx.push("select");
			return Object.assign(Promise.resolve(estanciasEnTx()), {
				limit: async () => cursorEnTx(),
			});
		},
	}),
});
// Alineado a segundos: Wialon trabaja en segundos y la semilla trunca los ms.
const ahoraSeg = () => Math.floor(Date.now() / 1000) * 1000;

const historialCompleto = (tramos = 1) => ({
	mensajes: [],
	completo: true,
	tramosTotal: tramos,
	tramosCompletados: tramos,
});

// Captura lo que el job escribe dentro de las transacciones: las estancias
// insertadas y los valores que se mandan al cursor.
function capturarTransaccion() {
	let insertadas: any[] = [];
	let cursor: any = null;
	spyOn(db, "transaction").mockImplementation(async (cb: any) =>
		cb({
			execute: async () => {
				ordenTx.push("lock");
			},
			select: selectCursorEnTx,
			delete: () => ({ where: async () => {} }),
			insert: () => ({
				values: (v: any) => {
					if (Array.isArray(v) && v[0]?.desde) insertadas = v;
					else if (v?.procesadoHasta) cursor = v;
					return Object.assign(Promise.resolve(), {
						onConflictDoUpdate: async () => {},
					});
				},
			}),
		}),
	);
	return { insertadas: () => insertadas, cursor: () => cursor };
}

describe("CB-119 (D-15) — ejecutarCalculoUbicacionesClave", () => {
	let txCalled = false;
	// Valores que el job manda a `update(gps_consulta_logs).set(...)`.
	let snapshotsPurgados: unknown[] = [];
	// Valores con que se recortan las estancias que cruzan el borde de 60 días.
	let estanciasRecortadas: unknown[] = [];
	// Lo que devuelven los `select` del job, en el orden en que los hace por
	// unidad: cursores (1 vez), luego [última estancia?, estancias guardadas].
	let cursoresMock: {
		wialonUnitId: number;
		procesadoHasta: Date;
		ultimoMensajeAt: Date | null;
	}[] = [];
	let ultimaEstanciaMock: {
		lat: number;
		lon: number;
		desde: Date;
		hasta: Date;
	}[] = [];
	let estanciasGuardadasMock: unknown[] = [];

	beforeEach(() => {
		txCalled = false;
		snapshotsPurgados = [];
		estanciasRecortadas = [];
		cursoresMock = [];
		cursorEnTx = () => cursoresMock;
		estanciasEnTx = () => estanciasGuardadasMock;
		ordenTx = [];
		ultimaEstanciaMock = [];
		estanciasGuardadasMock = [];
		spyOn(db, "update").mockImplementation(((tabla: unknown) => ({
			set: (valores: unknown) => ({
				where: async () => {
					if (tabla === gpsConsultaLogs) snapshotsPurgados.push(valores);
					else if (tabla === gpsEstancias) estanciasRecortadas.push(valores);
				},
			}),
		})) as any);
		spyOn(db, "select").mockImplementation(((campos?: unknown) => {
			// select() sin campos = lectura de cursores.
			if (campos === undefined) {
				return { from: async () => cursoresMock };
			}
			const c = campos as Record<string, unknown>;
			// Con `limit` = última estancia; sin `limit` = estancias guardadas.
			return {
				from: () => ({
					where: () =>
						Object.assign(Promise.resolve(estanciasGuardadasMock), {
							orderBy: () => ({ limit: async () => ultimaEstanciaMock }),
						}),
				}),
				_campos: c,
			};
		}) as any);
		spyOn(gpsEventosPoll, "sifcosEnB4").mockResolvedValue(["01010214100000"]);
		spyOn(gpsEventosPoll, "unidadesConCasoActivo").mockResolvedValue([
			{ wialonUnitId: 100, numeroCreditoSifco: "01010214100000" },
		]);
		spyOn(gpsEventosService, "resolverVehiculoYCaso").mockResolvedValue({
			vehicleId: "veh-1",
			casoCobroId: "caso-1",
		});
		spyOn(db, "delete").mockReturnValue({
			where: async () => {},
		} as any);
		spyOn(db, "transaction").mockImplementation(async (cb: any) => {
			txCalled = true;
			return cb({
				execute: async () => {
					ordenTx.push("lock");
				},
				select: selectCursorEnTx,
				delete: () => ({ where: async () => {} }),
				insert: () => ({
					values: () =>
						Object.assign(Promise.resolve(), {
							onConflictDoUpdate: async () => {},
						}),
				}),
			});
		});
	});

	afterEach(() => {
		mock.restore();
	});

	function wialonMock(resultado: unknown = historialCompleto()) {
		const getHistorialPosiciones = mock().mockResolvedValue(resultado);
		spyOn(wialonClientModule, "getWialonClient").mockReturnValue({
			getHistorialPosiciones,
		} as any);
		return getHistorialPosiciones;
	}

	it("consulta todos los casos activos, sin filtrar por bucket", async () => {
		wialonMock();
		await ejecutarCalculoUbicacionesClave();
		expect(gpsEventosPoll.unidadesConCasoActivo).toHaveBeenCalledWith();
	});

	it("preserva el snapshot previo si el historial de Wialon está incompleto (!completo)", async () => {
		wialonMock({
			mensajes: [],
			completo: false,
			tramosTotal: 2,
			tramosCompletados: 1,
		});

		const res = await ejecutarCalculoUbicacionesClave();

		expect(res.unidadesConError).toBe(1);
		expect(res.unidadesProcesadas).toBe(0);
		// Ni estancias ni cursor ni ubicaciones se tocan: el cursor no avanza.
		expect(txCalled).toBe(false);
	});

	it("reemplaza el snapshot en DB cuando el historial de Wialon está completo", async () => {
		wialonMock(historialCompleto(2));

		const res = await ejecutarCalculoUbicacionesClave();

		expect(res.unidadesConError).toBe(0);
		expect(res.unidadesProcesadas).toBe(1);
		expect(txCalled).toBe(true);
	});

	it("unidad sin cursor: backfill completo de la ventana de 60 días", async () => {
		const historial = wialonMock();

		await ejecutarCalculoUbicacionesClave();

		const [unitId, desde, hasta] = historial.mock.calls[0]!;
		expect(unitId).toBe(100);
		const dias = (hasta.getTime() - desde.getTime()) / DIA_MS;
		expect(Math.round(dias)).toBe(60);
	});

	it("unidad con cursor reciente: pide solo desde el cursor (incremental)", async () => {
		const cursor = new Date(ahoraSeg() - DIA_MS);
		cursoresMock = [
			{ wialonUnitId: 100, procesadoHasta: cursor, ultimoMensajeAt: null },
		];
		ultimaEstanciaMock = [
			{
				lat: 14.6,
				lon: -90.5,
				desde: new Date(cursor.getTime() - 10 * 60 * 60 * 1000),
				hasta: new Date(cursor.getTime() - 9 * 60 * 60 * 1000),
			},
		];
		const historial = wialonMock();

		await ejecutarCalculoUbicacionesClave();

		expect(historial.mock.calls[0]![1]).toEqual(cursor);
	});

	it("estancia abierta: no re-pide su historial, la extiende con lo nuevo y reemplaza la fila", async () => {
		const cursor = new Date(ahoraSeg() - DIA_MS);
		const inicio = new Date(cursor.getTime() - 5 * DIA_MS);
		const fin = new Date(cursor.getTime() - 60_000);
		// Abierta: su último mensaje es el último que se leyó.
		cursoresMock = [
			{ wialonUnitId: 100, procesadoHasta: cursor, ultimoMensajeAt: fin },
		];
		ultimaEstanciaMock = [{ lat: 14.6, lon: -90.5, desde: inicio, hasta: fin }];
		// Un mensaje nuevo, detenido en el mismo punto, 10 h después del cursor.
		const tNuevo = Math.floor(cursor.getTime() / 1000) + 10 * 3600;
		const historial = wialonMock({
			mensajes: [{ t: tNuevo, lat: 14.6, lon: -90.5, velocidadKmh: 0 }],
			completo: true,
			tramosTotal: 1,
			tramosCompletados: 1,
		});
		let insertadas: any[] = [];
		spyOn(db, "transaction").mockImplementation(async (cb: any) =>
			cb({
				execute: async () => {
					ordenTx.push("lock");
				},
				select: selectCursorEnTx,
				delete: () => ({ where: async () => {} }),
				insert: () => ({
					values: (v: any) => {
						if (Array.isArray(v) && v[0]?.desde) insertadas = v;
						return Object.assign(Promise.resolve(), {
							onConflictDoUpdate: async () => {},
						});
					},
				}),
			}),
		);

		await ejecutarCalculoUbicacionesClave();

		// Se pide desde el cursor, no desde el inicio de la estancia (5 días atrás).
		expect(historial.mock.calls[0]![1]).toEqual(cursor);
		// Una sola estancia: la misma de antes, ahora terminando en el mensaje nuevo.
		expect(insertadas).toHaveLength(1);
		expect(insertadas[0].desde).toEqual(inicio);
		expect(insertadas[0].hasta.getTime()).toBe(tNuevo * 1000);
	});

	it("estancia abierta y el vehículo se movió: se conserva tal cual y no se extiende", async () => {
		const cursor = new Date(ahoraSeg() - DIA_MS);
		const inicio = new Date(cursor.getTime() - 5 * DIA_MS);
		const fin = new Date(cursor.getTime() - 60_000);
		cursoresMock = [
			{ wialonUnitId: 100, procesadoHasta: cursor, ultimoMensajeAt: fin },
		];
		ultimaEstanciaMock = [{ lat: 14.6, lon: -90.5, desde: inicio, hasta: fin }];
		wialonMock({
			mensajes: [
				{
					t: Math.floor(cursor.getTime() / 1000) + 60,
					lat: 14.7,
					lon: -90.6,
					velocidadKmh: 40,
				},
			],
			completo: true,
			tramosTotal: 1,
			tramosCompletados: 1,
		});
		let insertadas: any[] = [];
		spyOn(db, "transaction").mockImplementation(async (cb: any) =>
			cb({
				execute: async () => {
					ordenTx.push("lock");
				},
				select: selectCursorEnTx,
				delete: () => ({ where: async () => {} }),
				insert: () => ({
					values: (v: any) => {
						if (Array.isArray(v) && v[0]?.desde) insertadas = v;
						return Object.assign(Promise.resolve(), {
							onConflictDoUpdate: async () => {},
						});
					},
				}),
			}),
		);

		await ejecutarCalculoUbicacionesClave();

		expect(insertadas).toHaveLength(1);
		expect(insertadas[0].desde).toEqual(inicio);
		expect(insertadas[0].hasta.getTime()).toBe(
			Math.floor(fin.getTime() / 1000) * 1000,
		);
	});

	// Regresión: una estancia vieja y CERRADA no debe sembrarse. Si el carro se
	// fue y hoy vuelve al mismo lugar, fusionarlas daría una "estancia" de días.
	it("estancia vieja y cerrada: no se fusiona con la visita de hoy al mismo lugar", async () => {
		const cursor = new Date(ahoraSeg() - DIA_MS);
		const inicioViejo = new Date(cursor.getTime() - 10 * DIA_MS);
		const finViejo = new Date(inicioViejo.getTime() + 3600_000);
		// El último mensaje leído es de hace 1 h, posterior al fin de la estancia
		// (el carro se movió después): quedó cerrada.
		cursoresMock = [
			{
				wialonUnitId: 100,
				procesadoHasta: cursor,
				ultimoMensajeAt: new Date(cursor.getTime() - 3600_000),
			},
		];
		ultimaEstanciaMock = [
			{ lat: 14.6, lon: -90.5, desde: inicioViejo, hasta: finViejo },
		];
		const t0 = Math.floor(cursor.getTime() / 1000) + 3600;
		wialonMock({
			mensajes: [
				{ t: t0, lat: 14.6, lon: -90.5, velocidadKmh: 0 },
				{ t: t0 + 1800, lat: 14.6, lon: -90.5, velocidadKmh: 0 },
			],
			completo: true,
			tramosTotal: 1,
			tramosCompletados: 1,
		});
		const { insertadas } = capturarTransaccion();

		await ejecutarCalculoUbicacionesClave();

		expect(insertadas()).toHaveLength(1);
		// La visita de hoy, de 30 min, y no una de ~10 días.
		expect(insertadas()[0].desde.getTime()).toBe(t0 * 1000);
		expect(insertadas()[0].hasta.getTime()).toBe((t0 + 1800) * 1000);
	});

	it("cursor sin ultimoMensajeAt (anterior a la columna): no siembra", async () => {
		const cursor = new Date(ahoraSeg() - DIA_MS);
		cursoresMock = [
			{ wialonUnitId: 100, procesadoHasta: cursor, ultimoMensajeAt: null },
		];
		ultimaEstanciaMock = [
			{
				lat: 14.6,
				lon: -90.5,
				desde: new Date(cursor.getTime() - 5 * DIA_MS),
				hasta: new Date(cursor.getTime() - 60_000),
			},
		];
		const t0 = Math.floor(cursor.getTime() / 1000) + 3600;
		wialonMock({
			mensajes: [
				{ t: t0, lat: 14.6, lon: -90.5, velocidadKmh: 0 },
				{ t: t0 + 1800, lat: 14.6, lon: -90.5, velocidadKmh: 0 },
			],
			completo: true,
			tramosTotal: 1,
			tramosCompletados: 1,
		});
		const { insertadas } = capturarTransaccion();

		await ejecutarCalculoUbicacionesClave();

		expect(insertadas()[0].desde.getTime()).toBe(t0 * 1000);
	});

	it("guarda el último mensaje leído en el cursor; sin mensajes nuevos conserva el anterior", async () => {
		const previo = new Date(ahoraSeg() - 2 * DIA_MS);
		cursoresMock = [
			{
				wialonUnitId: 100,
				procesadoHasta: new Date(ahoraSeg() - DIA_MS),
				ultimoMensajeAt: previo,
			},
		];
		// Sin mensajes nuevos: el último leído sigue siendo el anterior.
		wialonMock();
		const sinNuevos = capturarTransaccion();
		await ejecutarCalculoUbicacionesClave();
		expect(sinNuevos.cursor()?.ultimoMensajeAt).toEqual(previo);
		mock.restore();
	});

	// Una parada que cruza el cursor con las dos mitades de <20 min se perdía:
	// ninguna cumplía el mínimo por separado.
	it("tramo corto en curso al cursor: se siembra y la parada completa se recupera", async () => {
		const cursor = new Date(ahoraSeg() - DIA_MS);
		const t0 = Math.floor(cursor.getTime() / 1000) - 12 * 60;
		cursoresMock = [
			{
				wialonUnitId: 100,
				procesadoHasta: cursor,
				ultimoMensajeAt: new Date(cursor.getTime()),
				pendienteLat: 14.6,
				pendienteLon: -90.5,
				pendienteDesde: new Date(t0 * 1000),
				pendienteHasta: new Date(cursor.getTime()),
			} as any,
		];
		// Pendiente: 12 min antes del cursor. Lo nuevo: 12 min después → 24 min.
		wialonMock({
			mensajes: [
				{
					t: Math.floor(cursor.getTime() / 1000) + 12 * 60,
					lat: 14.6,
					lon: -90.5,
					velocidadKmh: 0,
				},
			],
			completo: true,
			tramosTotal: 1,
			tramosCompletados: 1,
		});
		const { insertadas } = capturarTransaccion();

		await ejecutarCalculoUbicacionesClave();

		expect(insertadas()).toHaveLength(1);
		expect(insertadas()[0].desde.getTime()).toBe(t0 * 1000);
		expect(insertadas()[0].hasta.getTime()).toBe(
			(Math.floor(cursor.getTime() / 1000) + 12 * 60) * 1000,
		);
	});

	it("sin pendiente guardado, esa misma parada no alcanza el mínimo (comportamiento previo)", async () => {
		const cursor = new Date(ahoraSeg() - DIA_MS);
		cursoresMock = [
			{
				wialonUnitId: 100,
				procesadoHasta: cursor,
				ultimoMensajeAt: null,
				pendienteLat: null,
				pendienteLon: null,
				pendienteDesde: null,
				pendienteHasta: null,
			} as any,
		];
		wialonMock({
			mensajes: [
				{
					t: Math.floor(cursor.getTime() / 1000) + 12 * 60,
					lat: 14.6,
					lon: -90.5,
					velocidadKmh: 0,
				},
			],
			completo: true,
			tramosTotal: 1,
			tramosCompletados: 1,
		});
		const { insertadas } = capturarTransaccion();

		await ejecutarCalculoUbicacionesClave();

		expect(insertadas()).toHaveLength(0);
	});

	it("guarda en el cursor el tramo en curso (<20 min) al terminar la corrida", async () => {
		const cursor = new Date(ahoraSeg() - DIA_MS);
		cursoresMock = [
			{
				wialonUnitId: 100,
				procesadoHasta: cursor,
				ultimoMensajeAt: null,
				pendienteLat: null,
				pendienteLon: null,
				pendienteDesde: null,
				pendienteHasta: null,
			} as any,
		];
		const t0 = Math.floor(cursor.getTime() / 1000) + 3600;
		wialonMock({
			mensajes: [
				{ t: t0, lat: 14.6, lon: -90.5, velocidadKmh: 0 },
				{ t: t0 + 10 * 60, lat: 14.6, lon: -90.5, velocidadKmh: 0 },
			],
			completo: true,
			tramosTotal: 1,
			tramosCompletados: 1,
		});
		const { cursor: cursorGuardado } = capturarTransaccion();

		await ejecutarCalculoUbicacionesClave();

		expect(cursorGuardado()).toMatchObject({
			pendienteLat: 14.6,
			pendienteLon: -90.5,
			pendienteDesde: new Date(t0 * 1000),
			pendienteHasta: new Date((t0 + 600) * 1000),
		});
	});

	it("al terminar en movimiento limpia el pendiente anterior", async () => {
		const cursor = new Date(ahoraSeg() - DIA_MS);
		cursoresMock = [
			{
				wialonUnitId: 100,
				procesadoHasta: cursor,
				ultimoMensajeAt: null,
				pendienteLat: 14.6,
				pendienteLon: -90.5,
				pendienteDesde: new Date(cursor.getTime() - 600_000),
				pendienteHasta: cursor,
			} as any,
		];
		wialonMock({
			mensajes: [
				{
					t: Math.floor(cursor.getTime() / 1000) + 60,
					lat: 14.7,
					lon: -90.6,
					velocidadKmh: 50,
				},
			],
			completo: true,
			tramosTotal: 1,
			tramosCompletados: 1,
		});
		const { cursor: cursorGuardado } = capturarTransaccion();

		await ejecutarCalculoUbicacionesClave();

		expect(cursorGuardado()).toMatchObject({
			pendienteLat: null,
			pendienteDesde: null,
		});
	});

	// Dos instancias leen el mismo cursor y piden a Wialon; la que commitea
	// después estaría vieja y movería el cursor hacia atrás.
	it("otra instancia avanzó el cursor entre la lectura y la escritura: descarta sin escribir", async () => {
		const cursor = new Date(ahoraSeg() - 2 * DIA_MS);
		cursoresMock = [
			{
				wialonUnitId: 100,
				procesadoHasta: cursor,
				ultimoMensajeAt: null,
				pendienteLat: null,
				pendienteLon: null,
				pendienteDesde: null,
				pendienteHasta: null,
			} as any,
		];
		// Dentro del lock, el cursor ya es más nuevo: otra instancia lo procesó.
		cursorEnTx = () => [
			{ procesadoHasta: new Date(cursor.getTime() + DIA_MS) },
		];
		wialonMock();
		const { insertadas, cursor: cursorGuardado } = capturarTransaccion();

		const res = await ejecutarCalculoUbicacionesClave();

		expect(cursorGuardado()).toBeNull();
		expect(insertadas()).toHaveLength(0);
		expect(res.unidadesProcesadas).toBe(0);
		expect(res.unidadesConError).toBe(0);
	});

	it("primera corrida de una unidad que otra instancia ya empezó: descarta sin escribir", async () => {
		// Esta corrida no vio cursor (undefined) pero dentro del lock ya existe uno.
		cursoresMock = [];
		cursorEnTx = () => [{ procesadoHasta: new Date() }];
		wialonMock();
		const { cursor: cursorGuardado } = capturarTransaccion();

		const res = await ejecutarCalculoUbicacionesClave();

		expect(cursorGuardado()).toBeNull();
		expect(res.unidadesProcesadas).toBe(0);
	});

	// Si la unidad dejó de reportar, un pendiente de antes de la ventana se
	// volvería a sembrar y reescribir en cada corrida, y esas coordenadas nunca
	// vencerían.
	it("tramo pendiente anterior a la ventana de 60 días: no se siembra y se borra del cursor", async () => {
		const cursor = new Date(ahoraSeg() - DIA_MS);
		const viejo = new Date(ahoraSeg() - 70 * DIA_MS);
		cursoresMock = [
			{
				wialonUnitId: 100,
				procesadoHasta: cursor,
				ultimoMensajeAt: null,
				pendienteLat: 14.6,
				pendienteLon: -90.5,
				pendienteDesde: viejo,
				pendienteHasta: new Date(viejo.getTime() + 600_000),
			} as any,
		];
		// Sin mensajes nuevos: la unidad no reporta.
		const historial = wialonMock();
		const { cursor: cursorGuardado, insertadas } = capturarTransaccion();

		await ejecutarCalculoUbicacionesClave();

		expect(historial).toHaveBeenCalledTimes(1);
		expect(cursorGuardado()).toMatchObject({
			pendienteLat: null,
			pendienteLon: null,
			pendienteDesde: null,
			pendienteHasta: null,
		});
		expect(insertadas()).toHaveLength(0);
	});

	it("cursor fuera de la ventana de 60 días: se trata como backfill completo", async () => {
		cursoresMock = [
			{
				wialonUnitId: 100,
				procesadoHasta: new Date(Date.now() - 90 * DIA_MS),
				ultimoMensajeAt: null,
			},
		];
		const historial = wialonMock();

		await ejecutarCalculoUbicacionesClave();

		const [, desde, hasta] = historial.mock.calls[0]!;
		expect(Math.round((hasta.getTime() - desde.getTime()) / DIA_MS)).toBe(60);
	});

	it("limita los backfills por corrida y reporta los pendientes", async () => {
		const unidades = Array.from({ length: 105 }, (_, i) => ({
			wialonUnitId: 1000 + i,
			numeroCreditoSifco: `0101${i}`,
		}));
		spyOn(gpsEventosPoll, "unidadesConCasoActivo").mockResolvedValue(unidades);
		const historial = wialonMock();

		const res = await ejecutarCalculoUbicacionesClave();

		expect(historial).toHaveBeenCalledTimes(100);
		expect(res.unidadesProcesadas).toBe(100);
		expect(res.unidadesPendientesBackfill).toBe(5);
	});

	it("las unidades en B4 hacen el backfill primero", async () => {
		const unidades = Array.from({ length: 101 }, (_, i) => ({
			wialonUnitId: 2000 + i,
			numeroCreditoSifco: `S${i}`,
		}));
		// La única en B4 es la última de la lista (2100): sin prioridad quedaría
		// fuera de las 100 plazas.
		spyOn(gpsEventosPoll, "sifcosEnB4").mockResolvedValue(["S100"]);
		spyOn(gpsEventosPoll, "unidadesConCasoActivo").mockResolvedValue(unidades);
		const historial = wialonMock();

		await ejecutarCalculoUbicacionesClave();

		expect(historial.mock.calls[0]![0]).toBe(2100);
		expect(historial.mock.calls.map((c) => c[0])).toContain(2100);
		expect(historial).toHaveBeenCalledTimes(100);
	});

	// Unidades sin cursor cuyo historial falla siempre (unidad inaccesible,
	// borrada en Wialon…) consumían las mismas plazas cada noche y dejaban sin
	// su backfill a todas las que venían detrás.
	it("unidades que fallan siempre no acaparan las plazas de backfill de todas las noches", async () => {
		const unidades = Array.from({ length: 250 }, (_, i) => ({
			wialonUnitId: 1000 + i,
			numeroCreditoSifco: `S${i}`,
		}));
		spyOn(gpsEventosPoll, "sifcosEnB4").mockResolvedValue([]);
		spyOn(gpsEventosPoll, "unidadesConCasoActivo").mockResolvedValue(unidades);
		// Las primeras 100 fallan siempre ("incompleto"); el resto sale bien.
		const getHistorialPosiciones = mock().mockImplementation(
			async (unitId: number) =>
				unitId < 1100
					? {
							mensajes: [],
							completo: false,
							tramosTotal: 9,
							tramosCompletados: 0,
						}
					: historialCompleto(9),
		);
		spyOn(wialonClientModule, "getWialonClient").mockReturnValue({
			getHistorialPosiciones,
		} as any);

		const procesadasPorNoche: number[] = [];
		try {
			// Tres noches seguidas (la plaza se reparte por día).
			for (const dia of [100, 101, 102]) {
				setSystemTime(new Date(dia * DIA_MS + 8 * 3600_000));
				const res = await ejecutarCalculoUbicacionesClave();
				procesadasPorNoche.push(res.unidadesProcesadas);
			}
		} finally {
			setSystemTime();
		}

		// En ninguna de las tres noches pueden quedar TODAS las plazas en
		// unidades que fallan: alguna noche procesa unidades buenas, y entre las
		// tres noches se llega a unidades distintas.
		expect(procesadasPorNoche.some((n) => n > 0)).toBe(true);
		const intentadas = new Set(
			getHistorialPosiciones.mock.calls.map((c: unknown[]) => c[0]),
		);
		expect(intentadas.size).toBeGreaterThan(100);
	});

	// Con 100 o más unidades de B4 sin cursor, las plazas se iban todas a B4 y
	// ninguna unidad de otro bucket recibía su cálculo inicial.
	it("si hay 100 o más candidatas de B4, las demás unidades conservan plazas de backfill", async () => {
		const unidades = Array.from({ length: 200 }, (_, i) => ({
			wialonUnitId: 3000 + i,
			numeroCreditoSifco: `S${i}`,
		}));
		// Las primeras 150 están en B4 y fallan siempre.
		spyOn(gpsEventosPoll, "sifcosEnB4").mockResolvedValue(
			unidades.slice(0, 150).map((u) => u.numeroCreditoSifco),
		);
		spyOn(gpsEventosPoll, "unidadesConCasoActivo").mockResolvedValue(unidades);
		const getHistorialPosiciones = mock().mockImplementation(
			async (unitId: number) =>
				unitId < 3150
					? {
							mensajes: [],
							completo: false,
							tramosTotal: 9,
							tramosCompletados: 0,
						}
					: historialCompleto(9),
		);
		spyOn(wialonClientModule, "getWialonClient").mockReturnValue({
			getHistorialPosiciones,
		} as any);

		const res = await ejecutarCalculoUbicacionesClave();

		expect(getHistorialPosiciones).toHaveBeenCalledTimes(100);
		// Las que no son de B4 (3150..3199) alcanzaron plaza: se procesaron.
		expect(res.unidadesProcesadas).toBeGreaterThan(0);
	});

	it("si cartera-back falla no se salta la corrida, solo no se prioriza", async () => {
		spyOn(gpsEventosPoll, "sifcosEnB4").mockResolvedValue(null);
		wialonMock();

		const res = await ejecutarCalculoUbicacionesClave();

		expect(res.unidadesProcesadas).toBe(1);
	});

	it("una unidad compartida por dos créditos se baja una sola vez", async () => {
		spyOn(gpsEventosPoll, "unidadesConCasoActivo").mockResolvedValue([
			{ wialonUnitId: 100, numeroCreditoSifco: "A" },
			{ wialonUnitId: 100, numeroCreditoSifco: "B" },
		]);
		const historial = wialonMock();

		const res = await ejecutarCalculoUbicacionesClave();

		expect(historial).toHaveBeenCalledTimes(1);
		expect(res.unidadesProcesadas).toBe(1);
		expect(gpsEventosService.resolverVehiculoYCaso).toHaveBeenCalledTimes(2);
	});

	it("invalida el snapshot anterior del caso (casoCobroId) y de la unidad al reemplazar", async () => {
		const condiciones: unknown[] = [];
		spyOn(db, "transaction").mockImplementation(async (cb: any) => {
			return cb({
				execute: async () => {
					ordenTx.push("lock");
				},
				select: selectCursorEnTx,
				delete: () => ({
					where: async (cond: unknown) => {
						condiciones.push(cond);
					},
				}),
				insert: () => ({
					values: () =>
						Object.assign(Promise.resolve(), {
							onConflictDoUpdate: async () => {},
						}),
				}),
			});
		});
		wialonMock();

		const res = await ejecutarCalculoUbicacionesClave();

		expect(res.unidadesProcesadas).toBe(1);
		// Una por las estancias y otra por las ubicaciones del par (unidad, SIFCO).
		expect(condiciones).toHaveLength(2);
		expect(condiciones.every((c) => c !== undefined)).toBe(true);
	});

	it("purga snapshots y estancias de unidades que ya no tienen caso activo", async () => {
		const deletes: unknown[] = [];
		spyOn(db, "delete").mockReturnValue({
			where: async (cond: unknown) => {
				deletes.push(cond);
			},
		} as any);
		wialonMock();

		await ejecutarCalculoUbicacionesClave();

		// ubicaciones inactivas + estancias + cursores.
		expect(deletes).toHaveLength(3);
	});

	it("purga todo si no hay unidades con caso activo (unidades.length === 0)", async () => {
		const tablasBorradas: unknown[] = [];
		spyOn(db, "delete").mockImplementation(((tabla: unknown) => {
			tablasBorradas.push(tabla);
			return Promise.resolve();
		}) as any);

		spyOn(gpsEventosPoll, "unidadesConCasoActivo").mockResolvedValue([]);

		const res = await ejecutarCalculoUbicacionesClave();

		// ubicaciones, estancias y cursores.
		expect(tablasBorradas).toHaveLength(3);
		expect(res.unidadesProcesadas).toBe(0);
		// También se limpia la copia en el historial de consultas.
		expect(snapshotsPurgados).toEqual([{ snapshot: null }]);
	});

	it("limpia el snapshot del historial de los créditos que ya no están activos (conserva la auditoría)", async () => {
		wialonMock();

		await ejecutarCalculoUbicacionesClave();

		// Solo se anula la columna snapshot: la fila (motivo, usuario) no se borra.
		expect(snapshotsPurgados).toEqual([{ snapshot: null }]);
	});

	it("una purga de snapshots que falla no tumba el cálculo nocturno", async () => {
		spyOn(db, "update").mockImplementation(((tabla: unknown) => {
			if (tabla === gpsConsultaLogs) throw new Error("db caída");
			return { set: () => ({ where: async () => {} }) };
		}) as any);
		wialonMock();

		const res = await ejecutarCalculoUbicacionesClave();

		expect(res.unidadesProcesadas).toBe(1);
		expect(res.unidadesConError).toBe(0);
	});
});

describe("calcularUbicacionesUnidadBajoDemanda (botón «Calcular ahora»)", () => {
	let cursorMock: { procesadoHasta: Date; ultimoMensajeAt: Date | null }[] = [];

	beforeEach(() => {
		cursorMock = [];
		cursorEnTx = () => cursorMock;
		estanciasEnTx = () => [];
		ordenTx = [];
		spyOn(db, "select").mockImplementation(((campos?: unknown) => ({
			from: () => ({
				where: () =>
					Object.assign(Promise.resolve([]), {
						limit: async () =>
							campos && "procesadoHasta" in (campos as object)
								? cursorMock
								: [],
						orderBy: () => ({ limit: async () => [] }),
					}),
			}),
		})) as any);
		spyOn(gpsEventosService, "resolverVehiculoYCaso").mockResolvedValue({
			vehicleId: "veh-1",
			casoCobroId: "caso-1",
		});
		spyOn(db, "transaction").mockImplementation(async (cb: any) =>
			cb({
				execute: async () => {
					ordenTx.push("lock");
				},
				select: selectCursorEnTx,
				delete: () => ({ where: async () => {} }),
				insert: () => ({
					values: () =>
						Object.assign(Promise.resolve(), {
							onConflictDoUpdate: async () => {},
						}),
				}),
			}),
		);
	});

	afterEach(() => {
		mock.restore();
	});

	function wialonMock(resultado: unknown = historialCompleto()) {
		const getHistorialPosiciones = mock().mockResolvedValue(resultado);
		spyOn(wialonClientModule, "getWialonClient").mockReturnValue({
			getHistorialPosiciones,
		} as any);
		return getHistorialPosiciones;
	}

	it("unidad sin cursor: backfill de 60 días sin tope", async () => {
		const historial = wialonMock();

		const res = await calcularUbicacionesUnidadBajoDemanda(200, ["A"]);

		expect(res.estado).toBe("calculado");
		const [unitId, desde, hasta] = historial.mock.calls[0]!;
		expect(unitId).toBe(200);
		expect(Math.round((hasta.getTime() - desde.getTime()) / DIA_MS)).toBe(60);
	});

	// Con el lock tomado, la lectura de estancias y el reemplazo de ubicaciones
	// van en el mismo ciclo: si se leyera antes, otra instancia podría guardar un
	// resultado más nuevo y este lo pisaría con uno viejo.
	it("las estancias se leen dentro de la transacción, después de tomar el lock", async () => {
		cursorMock = [
			{
				procesadoHasta: new Date(Date.now() - 60_000),
				ultimoMensajeAt: null,
			},
		];
		wialonMock();

		await calcularUbicacionesUnidadBajoDemanda(210, ["A"]);

		expect(ordenTx).toEqual(["lock", "select"]);
	});

	it("calculada hace menos de 15 min: no vuelve a Wialon pero sí arma las ubicaciones del crédito", async () => {
		cursorMock = [
			{ procesadoHasta: new Date(Date.now() - 60_000), ultimoMensajeAt: null },
		];
		const historial = wialonMock();

		const res = await calcularUbicacionesUnidadBajoDemanda(201, ["B"]);

		// Una unidad compartida por dos créditos: el otro ya la calculó, pero este
		// no se queda sin ubicaciones por el enfriamiento.
		expect(res).toEqual({ estado: "calculado", ubicaciones: 0 });
		expect(historial).not.toHaveBeenCalled();
		expect(gpsEventosService.resolverVehiculoYCaso).toHaveBeenCalledWith(
			201,
			"B",
		);
	});

	it("cursor viejo (más de 15 min): actualiza de forma incremental", async () => {
		const cursor = new Date(Date.now() - 3 * 60 * 60 * 1000);
		cursorMock = [{ procesadoHasta: cursor, ultimoMensajeAt: null }];
		const historial = wialonMock();

		const res = await calcularUbicacionesUnidadBajoDemanda(202, ["A"]);

		expect(res.estado).toBe("calculado");
		expect(historial.mock.calls[0]![1]).toEqual(cursor);
	});

	it("historial incompleto: no avanza y lo informa", async () => {
		wialonMock({
			mensajes: [],
			completo: false,
			tramosTotal: 9,
			tramosCompletados: 4,
		});

		const res = await calcularUbicacionesUnidadBajoDemanda(203, ["A"]);

		expect(res).toEqual({ estado: "incompleto" });
	});

	// Si Wialon falla, una unidad sin cursor no tiene enfriamiento (el cursor no
	// se escribe): cada clic repetiría la descarga de 60 días en plena caída.
	it("un cálculo que falló no se reintenta de inmediato desde el botón", async () => {
		const historial = wialonMock({
			mensajes: [],
			completo: false,
			tramosTotal: 9,
			tramosCompletados: 3,
		});

		try {
			setSystemTime(new Date("2026-10-01T15:00:00Z"));
			const primero = await calcularUbicacionesUnidadBajoDemanda(220, ["A"]);
			setSystemTime(new Date("2026-10-01T15:02:00Z"));
			const segundo = await calcularUbicacionesUnidadBajoDemanda(220, ["A"]);
			// Pasado el enfriamiento vuelve a intentar.
			setSystemTime(new Date("2026-10-01T15:07:00Z"));
			const tercero = await calcularUbicacionesUnidadBajoDemanda(220, ["A"]);

			expect(primero).toEqual({ estado: "incompleto" });
			expect(segundo).toEqual({ estado: "incompleto" });
			expect(tercero).toEqual({ estado: "incompleto" });
			expect(historial).toHaveBeenCalledTimes(2);
		} finally {
			setSystemTime();
		}
	});

	it("dos clics a la vez: el segundo no recalcula la misma unidad", async () => {
		let liberar: () => void = () => {};
		const historial = mock().mockImplementation(
			() =>
				new Promise((resolver) => {
					liberar = () => resolver(historialCompleto());
				}),
		);
		spyOn(wialonClientModule, "getWialonClient").mockReturnValue({
			getHistorialPosiciones: historial,
		} as any);

		const primero = calcularUbicacionesUnidadBajoDemanda(204, ["A"]);
		await new Promise((r) => setTimeout(r, 20));
		const segundo = await calcularUbicacionesUnidadBajoDemanda(204, ["A"]);
		liberar();

		expect(segundo).toEqual({ estado: "en_proceso" });
		expect((await primero).estado).toBe("calculado");
		expect(historial).toHaveBeenCalledTimes(1);
	});
});

describe("correrPurgaUbicacionesClave (retención, independiente de la bandera del cálculo)", () => {
	let borradas: unknown[] = [];
	let snapshotsPurgados: unknown[] = [];
	let estanciasRecortadas: unknown[] = [];
	// Condiciones del DELETE de ubicaciones y del UPDATE de snapshots del historial.
	let condicionUbicaciones: unknown = null;
	let condicionSnapshots: unknown = null;
	// UPDATE que borra el tramo pendiente vencido del cursor.
	let pendienteLimpiado: unknown = null;
	let condicionPendiente: unknown = null;
	const sqlDe = (cond: unknown) => new PgDialect().sqlToQuery(cond as any).sql;

	beforeEach(() => {
		borradas = [];
		snapshotsPurgados = [];
		estanciasRecortadas = [];
		condicionUbicaciones = null;
		condicionSnapshots = null;
		pendienteLimpiado = null;
		condicionPendiente = null;
		spyOn(db, "delete").mockImplementation(((tabla: unknown) => {
			borradas.push(tabla);
			return Object.assign(Promise.resolve(), {
				where: async (cond: unknown) => {
					if (tabla === gpsUbicacionesClave) condicionUbicaciones = cond;
				},
			});
		}) as any);
		spyOn(db, "update").mockImplementation(((tabla: unknown) => ({
			set: (valores: unknown) => ({
				where: async (cond: unknown) => {
					if (tabla === gpsConsultaLogs) {
						snapshotsPurgados.push(valores);
						condicionSnapshots = cond;
					} else if (tabla === gpsEstancias) estanciasRecortadas.push(valores);
					else if (tabla === gpsEstanciasCursor) {
						pendienteLimpiado = valores;
						condicionPendiente = cond;
					}
				},
			}),
		})) as any);
	});

	afterEach(() => {
		mock.restore();
	});

	it("purga sin llamar a Wialon ni a cartera-back (no depende del cálculo)", async () => {
		const getWialonClient = spyOn(wialonClientModule, "getWialonClient");
		const sifcosEnB4 = spyOn(gpsEventosPoll, "sifcosEnB4");
		spyOn(gpsEventosPoll, "unidadesConCasoActivo").mockResolvedValue([
			{ wialonUnitId: 100, numeroCreditoSifco: "A" },
		]);

		await correrPurgaUbicacionesClave();

		// ubicaciones inactivas + estancias + cursores.
		expect(borradas).toHaveLength(3);
		expect(snapshotsPurgados).toEqual([{ snapshot: null }]);
		expect(getWialonClient).not.toHaveBeenCalled();
		expect(sifcosEnB4).not.toHaveBeenCalled();
	});

	it("recorta al borde de 60 días el inicio de las estancias en curso (retención)", async () => {
		spyOn(gpsEventosPoll, "unidadesConCasoActivo").mockResolvedValue([
			{ wialonUnitId: 100, numeroCreditoSifco: "A" },
		]);
		const antes = Date.now();

		await correrPurgaUbicacionesClave();

		// Una estancia que sigue en curso extiende su `hasta` y el borrado por
		// `hasta` nunca la alcanza: su `desde` se recorta a la ventana.
		expect(estanciasRecortadas).toHaveLength(1);
		const { desde } = estanciasRecortadas[0] as { desde: Date };
		const dias = (antes - desde.getTime()) / DIA_MS;
		expect(Math.round(dias)).toBe(60);
	});

	// Con el cron apagado, un caso activo de larga vida solo se recalcula si
	// alguien usa «Calcular ahora»: la retención no puede depender de que el par
	// siga activo, también tiene que vencer por edad.
	it("las ubicaciones y los snapshots del historial vencen por edad, no solo por caso inactivo", async () => {
		spyOn(gpsEventosPoll, "unidadesConCasoActivo").mockResolvedValue([
			{ wialonUnitId: 100, numeroCreditoSifco: "A" },
		]);

		await correrPurgaUbicacionesClave();

		expect(sqlDe(condicionUbicaciones)).toContain('"calculado_at" <');
		expect(sqlDe(condicionSnapshots)).toContain('"created_at" <');
		// Y siguen vencidos los de pares que ya no están activos.
		expect(sqlDe(condicionUbicaciones)).toContain("not");
		expect(sqlDe(condicionSnapshots)).toContain("not in");
	});

	// El tramo pendiente guarda coordenadas exactas. Si la unidad dejó de
	// reportar, se reescribiría con la corrida y esas coordenadas no vencerían.
	it("borra el tramo pendiente del cursor que empezó antes de la ventana de 60 días", async () => {
		spyOn(gpsEventosPoll, "unidadesConCasoActivo").mockResolvedValue([
			{ wialonUnitId: 100, numeroCreditoSifco: "A" },
		]);

		await correrPurgaUbicacionesClave();

		expect(pendienteLimpiado).toEqual({
			pendienteLat: null,
			pendienteLon: null,
			pendienteDesde: null,
			pendienteHasta: null,
		});
		expect(sqlDe(condicionPendiente)).toContain('"pendiente_desde" <');
		// El corte es la ventana de 60 días, no una fecha cualquiera.
		const [corte] = new PgDialect().sqlToQuery(condicionPendiente as any)
			.params as Date[];
		expect(Math.round((Date.now() - new Date(corte!).getTime()) / DIA_MS)).toBe(
			60,
		);
	});

	it("sin casos activos purga todo lo retenido, incluido el snapshot del historial", async () => {
		spyOn(gpsEventosPoll, "unidadesConCasoActivo").mockResolvedValue([]);

		await correrPurgaUbicacionesClave();

		expect(borradas).toHaveLength(3);
		expect(snapshotsPurgados).toEqual([{ snapshot: null }]);
	});

	it("un fallo de BD no lanza (no tumba el proceso al arrancar)", async () => {
		spyOn(gpsEventosPoll, "unidadesConCasoActivo").mockRejectedValue(
			new Error("db caída"),
		);

		await expect(correrPurgaUbicacionesClave()).resolves.toBeUndefined();
		expect(borradas).toHaveLength(0);
	});
});
