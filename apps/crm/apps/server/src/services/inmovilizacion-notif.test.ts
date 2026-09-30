/**
 * CB-041 — notificarInmovilizacionPendiente: el lock de fila (SELECT ...
 * FOR UPDATE dentro de una transacción) que cierra la ventana de carrera
 * con decidirInmovilizacion/cancelarSolicitud (review de Codex, PR #1758).
 * Mock de `db` propio, mismo criterio que inmovilizacion-unidad.test.ts:
 * identifica ramas por TABLA. `db.transaction` recibe un `tx` con la misma
 * forma que `db` — el mock no simula el lock en sí (no hay concurrencia
 * real en un mock in-memory), solo que el código pasa por `for("update")`
 * y que el INSERT queda condicionado al estado leído.
 */
import { afterEach, describe, expect, it, mock } from "bun:test";
import { user } from "../db/schema/auth";
import { casosCobros } from "../db/schema/cobros";
import { inmovilizacionesUnidad } from "../db/schema/inmovilizacion-unidad";
import { notifications } from "../db/schema/notifications";
import { moduloAccesoFalso } from "../lib/acceso-caso-cobro.mock";

let estadoInmovilizacionMock: string | null = "pendiente_aprobacion";
let notificacionesInsertadas: Record<string, unknown>[][] = [];
let notificacionesActualizadas: { set: Record<string, unknown> }[] = [];
let supervisoresMock = ["sup-1", "sup-2"];
// Avisos abiertos de "llamar al cliente" (reconciliarAvisosLlamarCliente) y el
// dueño del crédito en cartera, ya resuelto a usuario del CRM.
type AvisoAbierto = {
	id: string;
	casoCobroId: string;
	assignedTo: string | null;
	numeroCreditoSifco: string | null;
};
// Cada lectura de avisos toma la siguiente foto de la cola (la última se repite).
let lecturasAvisos: AvisoAbierto[][] = [];
// Resultado de cada compare-and-set, en orden (true = movió la fila).
let resultadosCas: boolean[] = [];
function siguienteLectura(): AvisoAbierto[] {
	return lecturasAvisos.length > 1
		? (lecturasAvisos.shift() ?? [])
		: (lecturasAvisos[0] ?? []);
}
let duenoEnCarteraMock: string | null = null;
// Apagados aprobados hace más de 24 h (recordarInmovilizacionesSinEjecutar).
let apagadosSinEjecutarMock: {
	accion?: "apagado" | "reactivacion";
	id: string;
	casoCobroId: string;
	numeroCreditoSifco: string;
	solicitadoPor: string;
}[] = [];

function mockDb() {
	return {
		select: () => ({
			from: (tabla: unknown) => {
				if (tabla === inmovilizacionesUnidad) {
					return {
						// Con `for("update")` es el re-chequeo de estado; sin él, la
						// lectura de apagados sin ejecutar (se espera directo).
						where: () =>
							Object.assign(Promise.resolve(apagadosSinEjecutarMock), {
								for: () => ({
									limit: async () =>
										estadoInmovilizacionMock
											? [{ estado: estadoInmovilizacionMock }]
											: [],
								}),
							}),
					};
				}
				if (tabla === casosCobros) {
					return {
						where: () => ({}),
					};
				}
				if (tabla === user) {
					return {
						where: () => ({
							limit: async () => [{ name: "Jorge Sente" }],
						}),
					};
				}
				if (tabla === notifications) {
					return {
						innerJoin: () => ({ where: async () => siguienteLectura() }),
					};
				}
				throw new Error(`select from tabla no mockeada: ${String(tabla)}`);
			},
		}),
		insert: (tabla: unknown) => {
			if (tabla === notifications) {
				return {
					values: (filas: Record<string, unknown>[]) => {
						notificacionesInsertadas.push(filas);
						const resultado = Promise.resolve() as Promise<void> & {
							onConflictDoNothing: () => {
								returning: () => Promise<{ id: string }[]>;
							};
						};
						// Sin conflicto: cada fila se inserta.
						resultado.onConflictDoNothing = () => ({
							returning: async () => filas.map((_, i) => ({ id: `n${i}` })),
						});
						return resultado;
					},
				};
			}
			throw new Error(`insert en tabla no mockeada: ${String(tabla)}`);
		},
		update: (tabla: unknown) => {
			if (tabla === notifications) {
				return {
					set: (cambios: Record<string, unknown>) => {
						notificacionesActualizadas.push({ set: cambios });
						return {
							// Awaitable directo (los UPDATE sin RETURNING) y con
							// `.returning()` para el compare-and-set de la reconciliación.
							where: () => {
								const movio =
									resultadosCas.length > 0 ? resultadosCas.shift() : true;
								const resultado = Promise.resolve() as Promise<void> & {
									returning: () => Promise<{ id: string }[]>;
								};
								resultado.returning = async () => (movio ? [{ id: "n" }] : []);
								return resultado;
							},
						};
					},
				};
			}
			throw new Error(`update en tabla no mockeada: ${String(tabla)}`);
		},
		transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb()),
	};
}

mock.module("../db", () => ({ db: mockDb() }));
mock.module("./cobros-notif-helpers", () => ({
	obtenerSupervisoresCobros: async () => supervisoresMock,
}));
mock.module("../lib/acceso-caso-cobro", () =>
	moduloAccesoFalso({
		tieneAcceso: () => true,
		duenoUsuario: () => duenoEnCarteraMock,
	}),
);

const {
	notificarEjecucionASupervisores,
	notificarInmovilizacionPendiente,
	notificarInmovilizacionResuelta,
	reconciliarAvisosLlamarCliente,
	recordarInmovilizacionesSinEjecutar,
} = await import("./inmovilizacion-notif");

function reset() {
	estadoInmovilizacionMock = "pendiente_aprobacion";
	notificacionesInsertadas = [];
	notificacionesActualizadas = [];
	supervisoresMock = ["sup-1", "sup-2"];
	lecturasAvisos = [];
	resultadosCas = [];
	duenoEnCarteraMock = null;
	apagadosSinEjecutarMock = [];
}

const params = {
	inmovilizacionId: "id-1",
	casoCobroId: "caso-1",
	accion: "apagado" as const,
	motivo: "Cliente incontactable",
	solicitadoPorUserId: "asesor-1",
};

describe("CB-041 — notificarInmovilizacionPendiente", () => {
	afterEach(reset);

	it("estado sigue pendiente_aprobacion: inserta un aviso por supervisor", async () => {
		await notificarInmovilizacionPendiente(params);
		expect(notificacionesInsertadas).toHaveLength(1);
		expect(notificacionesInsertadas[0]).toHaveLength(2);
	});

	it("ya fue decidida (aprobada) antes del INSERT: no crea avisos huérfanos (review de Codex)", async () => {
		// Ventana entre el commit de solicitarInmovilizacion y esta llamada:
		// un supervisor ya decidió. Sin el re-chequeo, esto insertaba avisos
		// `pending` que resolverPendientesInmovilizacion ya no podía cerrar
		// (corrió antes de que existieran).
		estadoInmovilizacionMock = "aprobada";
		await notificarInmovilizacionPendiente(params);
		expect(notificacionesInsertadas).toHaveLength(0);
	});

	it("ya fue rechazada antes del INSERT: no crea avisos huérfanos", async () => {
		estadoInmovilizacionMock = "rechazada";
		await notificarInmovilizacionPendiente(params);
		expect(notificacionesInsertadas).toHaveLength(0);
	});

	it("solicitud cancelada antes del INSERT: no crea avisos huérfanos", async () => {
		estadoInmovilizacionMock = "cancelada";
		await notificarInmovilizacionPendiente(params);
		expect(notificacionesInsertadas).toHaveLength(0);
	});

	it("la fila ya no existe (caso límite): no crea avisos", async () => {
		estadoInmovilizacionMock = null;
		await notificarInmovilizacionPendiente(params);
		expect(notificacionesInsertadas).toHaveLength(0);
	});

	it("sin supervisores: no inserta nada (pero tampoco falla)", async () => {
		supervisoresMock = [];
		await notificarInmovilizacionPendiente(params);
		expect(notificacionesInsertadas).toHaveLength(0);
	});
});

describe("reconciliarAvisosLlamarCliente — el aviso sigue al dueño en cartera (review de Codex, PR #1765)", () => {
	afterEach(reset);

	it("cartera reasignó el crédito: el aviso pasa al dueño de hoy", async () => {
		lecturasAvisos = [
			[
				{
					id: "n1",
					casoCobroId: "caso-1",
					assignedTo: "asesor-viejo",
					numeroCreditoSifco: "0101",
				},
			],
		];
		duenoEnCarteraMock = "asesor-nuevo";

		const movidos = await reconciliarAvisosLlamarCliente();

		expect(movidos).toBe(1);
		expect(notificacionesActualizadas).toHaveLength(1);
		expect(notificacionesActualizadas[0]?.set.assignedTo).toBe("asesor-nuevo");
	});

	it("el aviso ya es del dueño: no toca nada", async () => {
		lecturasAvisos = [
			[
				{
					id: "n1",
					casoCobroId: "caso-1",
					assignedTo: "asesor-nuevo",
					numeroCreditoSifco: "0101",
				},
			],
		];
		duenoEnCarteraMock = "asesor-nuevo";

		expect(await reconciliarAvisosLlamarCliente()).toBe(0);
		expect(notificacionesActualizadas).toHaveLength(0);
	});

	it("el dueño no tiene usuario en el CRM: el aviso se queda donde está", async () => {
		lecturasAvisos = [
			[
				{
					id: "n1",
					casoCobroId: "caso-1",
					assignedTo: "quien-pidio",
					numeroCreditoSifco: "0101",
				},
			],
		];
		duenoEnCarteraMock = null;

		expect(await reconciliarAvisosLlamarCliente()).toBe(0);
		expect(notificacionesActualizadas).toHaveLength(0);
	});

	it("otra reconciliación lo movió entre la lectura y el UPDATE: relee y no lo pisa", async () => {
		// 1ª lectura: el aviso está en A y el dueño en cartera es C. Otra
		// reconciliación lo mueve a C antes del UPDATE, así que el compare-and-set
		// sobre "A" no encuentra la fila. 2ª lectura: ya está en C, nada que hacer.
		lecturasAvisos = [
			[
				{
					id: "n1",
					casoCobroId: "caso-1",
					assignedTo: "asesor-A",
					numeroCreditoSifco: "0101",
				},
			],
			[
				{
					id: "n1",
					casoCobroId: "caso-1",
					assignedTo: "asesor-C",
					numeroCreditoSifco: "0101",
				},
			],
		];
		resultadosCas = [false];
		duenoEnCarteraMock = "asesor-C";

		expect(await reconciliarAvisosLlamarCliente()).toBe(0);
		expect(notificacionesActualizadas).toHaveLength(1); // un solo intento, el que falló
	});

	it("si el compare-and-set sigue fallando, se rinde a las 3 vueltas sin pisar nada", async () => {
		lecturasAvisos = [
			[
				{
					id: "n1",
					casoCobroId: "caso-1",
					assignedTo: "asesor-A",
					numeroCreditoSifco: "0101",
				},
			],
		];
		resultadosCas = [false, false, false, false];
		duenoEnCarteraMock = "asesor-C";

		expect(await reconciliarAvisosLlamarCliente()).toBe(0);
		expect(notificacionesActualizadas).toHaveLength(3);
	});

	it("con una lista vacía de casos no consulta nada", async () => {
		expect(await reconciliarAvisosLlamarCliente([])).toBe(0);
	});
});

describe("CB-041 — apagado aprobado: aviso al asesor", () => {
	afterEach(reset);

	const aprobada = {
		inmovilizacionId: "id-1",
		casoCobroId: "caso-1",
		decision: "aprobada" as const,
		solicitanteUserId: "asesor-1",
		decididoPorUserId: "sup-1",
	};

	it("al aprobar un apagado le dice al asesor que lo ejecuta él, con la confirmación de LEGION", async () => {
		await notificarInmovilizacionResuelta({ ...aprobada, accion: "apagado" });
		const aviso = notificacionesInsertadas[0] as unknown as Record<
			string,
			unknown
		>;
		expect(aviso).toMatchObject({
			cobrosTipo: "inmovilizacion_resuelta",
			assignedTo: "asesor-1",
		});
		expect(String(aviso.descripcion)).toContain("LEGION");
		expect(String(aviso.descripcion)).toContain("Ficha 360");
	});

	it("si cartera reasignó el crédito mientras esperaba la decisión, el aviso va al dueño de hoy (review de Codex, PR #1807)", async () => {
		duenoEnCarteraMock = "asesor-nuevo";
		await notificarInmovilizacionResuelta({
			...aprobada,
			accion: "apagado",
			numeroCreditoSifco: "0101",
		});
		expect(notificacionesInsertadas[0]).toMatchObject({
			assignedTo: "asesor-nuevo",
		});
	});

	it("dueño sin usuario en el CRM: el aviso de apagado aprobado cae en quien solicitó", async () => {
		duenoEnCarteraMock = null;
		await notificarInmovilizacionResuelta({
			...aprobada,
			accion: "apagado",
			numeroCreditoSifco: "0101",
		});
		expect(notificacionesInsertadas[0]).toMatchObject({
			assignedTo: "asesor-1",
		});
	});

	it("reactivación aprobada con el crédito reasignado: el aviso va al dueño de hoy, que es quien puede ejecutarla (review de Codex, PR #1808)", async () => {
		duenoEnCarteraMock = "asesor-nuevo";
		await notificarInmovilizacionResuelta({
			...aprobada,
			accion: "reactivacion",
			numeroCreditoSifco: "0101",
		});
		expect(notificacionesInsertadas[0]).toMatchObject({
			assignedTo: "asesor-nuevo",
		});
	});

	it("reactivación aprobada con el dueño sin usuario en el CRM: cae en quien solicitó", async () => {
		duenoEnCarteraMock = null;
		await notificarInmovilizacionResuelta({
			...aprobada,
			accion: "reactivacion",
			numeroCreditoSifco: "0101",
		});
		expect(notificacionesInsertadas[0]).toMatchObject({
			assignedTo: "asesor-1",
		});
	});

	it("un rechazo de reactivación sigue yendo a quien solicitó aunque el crédito tenga otro dueño", async () => {
		duenoEnCarteraMock = "asesor-nuevo";
		await notificarInmovilizacionResuelta({
			...aprobada,
			accion: "reactivacion",
			decision: "rechazada",
			numeroCreditoSifco: "0101",
		});
		expect(notificacionesInsertadas[0]).toMatchObject({
			assignedTo: "asesor-1",
		});
	});

	it("un rechazo sigue yendo a quien solicitó aunque el crédito tenga otro dueño", async () => {
		duenoEnCarteraMock = "asesor-nuevo";
		await notificarInmovilizacionResuelta({
			...aprobada,
			accion: "apagado",
			decision: "rechazada",
			numeroCreditoSifco: "0101",
		});
		expect(notificacionesInsertadas[0]).toMatchObject({
			assignedTo: "asesor-1",
		});
	});

	it("al aprobar una reactivación el asesor también la ejecuta él, con la confirmación de LEGION", async () => {
		await notificarInmovilizacionResuelta({
			...aprobada,
			accion: "reactivacion",
		});
		const aviso = notificacionesInsertadas[0] as unknown as Record<
			string,
			unknown
		>;
		expect(String(aviso.descripcion)).toContain("la reactivación");
		expect(String(aviso.descripcion)).toContain("LEGION");
	});
});

describe("CB-041 — recordarInmovilizacionesSinEjecutar", () => {
	afterEach(reset);

	it("sin apagados aprobados de hace más de 24 h: no avisa", async () => {
		apagadosSinEjecutarMock = [];
		expect(await recordarInmovilizacionesSinEjecutar()).toBe(0);
		expect(notificacionesInsertadas).toHaveLength(0);
	});

	it("avisa al dueño del crédito en cartera, con una llave de dedup por apagado y día", async () => {
		apagadosSinEjecutarMock = [
			{
				id: "inm-1",
				casoCobroId: "caso-1",
				numeroCreditoSifco: "0101",
				solicitadoPor: "quien-solicito",
				accion: "apagado",
			},
		];
		duenoEnCarteraMock = "asesor-hoy";

		const creados = await recordarInmovilizacionesSinEjecutar(
			new Date("2026-09-30T14:00:00.000Z"),
		);
		expect(creados).toBe(1);
		const [fila] = notificacionesInsertadas[0] ?? [];
		expect(fila).toMatchObject({
			cobrosTipo: "inmovilizacion_ejecutar_pendiente",
			type: "action_required",
			assignedTo: "asesor-hoy",
			inmovilizacionId: "inm-1",
			cobrosDedupKey: "inmov-ejecutar:inm-1:2026-09-30",
		});
	});

	it("una reactivación aprobada sin ejecutar también se recuerda, con su propio texto", async () => {
		apagadosSinEjecutarMock = [
			{
				id: "inm-2",
				casoCobroId: "caso-1",
				numeroCreditoSifco: "0101",
				solicitadoPor: "quien-solicito",
				accion: "reactivacion",
			},
		];
		duenoEnCarteraMock = "asesor-hoy";
		await recordarInmovilizacionesSinEjecutar(
			new Date("2026-09-30T14:00:00.000Z"),
		);
		const [fila] = notificacionesInsertadas[0] ?? [];
		expect(fila).toMatchObject({
			titulo: "Reactivación aprobada sin ejecutar",
			assignedTo: "asesor-hoy",
		});
		expect(String(fila?.descripcion)).toContain("la reactivación");
	});

	it("dueño sin usuario en el CRM: cae en quien solicitó", async () => {
		apagadosSinEjecutarMock = [
			{
				id: "inm-1",
				casoCobroId: "caso-1",
				numeroCreditoSifco: "0101",
				solicitadoPor: "quien-solicito",
				accion: "apagado",
			},
		];
		duenoEnCarteraMock = null;
		await recordarInmovilizacionesSinEjecutar();
		const [fila] = notificacionesInsertadas[0] ?? [];
		expect(fila).toMatchObject({ assignedTo: "quien-solicito" });
	});
});

describe("CB-041 — notificarEjecucionASupervisores: aviso solo a los supervisores", () => {
	afterEach(reset);

	const ejecutado = {
		inmovilizacionId: "inm-1",
		casoCobroId: "caso-1",
		accion: "apagado" as const,
		clienteNombre: "Jonathan Barrillas",
		numeroCreditoSifco: "0101",
		ejecutadoPorUserId: "asesor-1",
		ejecutadoPorRole: "cobros" as const,
	};

	it("avisa a cada cobros_supervisor, con quién lo registró y el cliente", async () => {
		await notificarEjecucionASupervisores(ejecutado);
		const filas = notificacionesInsertadas[0] ?? [];
		expect(filas).toHaveLength(2);
		expect(filas.map((f) => f.assignedTo)).toEqual(["sup-1", "sup-2"]);
		expect(filas[0]).toMatchObject({
			cobrosTipo: "inmovilizacion_apagado_ejecutado",
			assignedToRole: "cobros_supervisor",
			type: "aviso",
			inmovilizacionId: "inm-1",
			cobrosDedupKey: "inmov-apagado:inm-1",
		});
		expect(String(filas[0]?.descripcion)).toContain("Jorge Sente");
		expect(String(filas[0]?.descripcion)).toContain("Jonathan Barrillas");
	});

	it("una reactivación usa su propio tipo, título y llave de dedup", async () => {
		await notificarEjecucionASupervisores({
			...ejecutado,
			accion: "reactivacion",
		});
		const [fila] = notificacionesInsertadas[0] ?? [];
		expect(fila).toMatchObject({
			titulo: "Reactivación ejecutada",
			cobrosTipo: "inmovilizacion_reactivacion_ejecutada",
			cobrosDedupKey: "inmov-reactivacion:inm-1",
		});
		expect(String(fila?.descripcion)).toContain("reactivó");
	});

	it("la frase lee bien con y sin nombre: 'de Fulano (crédito X)', 'del crédito X', 'de un cliente'", async () => {
		const descripcion = async (extra: Record<string, unknown>) => {
			notificacionesInsertadas = [];
			await notificarEjecucionASupervisores({
				...ejecutado,
				clienteNombre: undefined,
				numeroCreditoSifco: undefined,
				...extra,
			});
			return String(notificacionesInsertadas[0]?.[0]?.descripcion);
		};
		expect(
			await descripcion({
				clienteNombre: "Jonathan Barrillas",
				numeroCreditoSifco: "0101",
			}),
		).toContain("la unidad de Jonathan Barrillas (crédito 0101).");
		expect(await descripcion({ numeroCreditoSifco: "0101" })).toContain(
			"la unidad del crédito 0101.",
		);
		expect(await descripcion({})).toContain("la unidad de un cliente.");
	});

	it("si hay advertencia (el crédito ya cambió de bucket), los supervisores la ven en el aviso", async () => {
		await notificarEjecucionASupervisores({
			...ejecutado,
			advertencia: "El crédito ya no está en B2/B3/B4 (está en B0).",
		});
		const [fila] = notificacionesInsertadas[0] ?? [];
		expect(String(fila?.descripcion)).toContain("(está en B0)");
	});

	it("no le avisa a un supervisor que es quien lo registró", async () => {
		await notificarEjecucionASupervisores({
			...ejecutado,
			ejecutadoPorUserId: "sup-1",
		});
		const filas = notificacionesInsertadas[0] ?? [];
		expect(filas.map((f) => f.assignedTo)).toEqual(["sup-2"]);
	});

	it("sin supervisores: no inserta nada ni falla", async () => {
		supervisoresMock = [];
		await notificarEjecucionASupervisores(ejecutado);
		expect(notificacionesInsertadas).toHaveLength(0);
	});
});
