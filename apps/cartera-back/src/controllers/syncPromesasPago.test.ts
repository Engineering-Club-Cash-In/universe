import { beforeEach, describe, expect, it, mock } from "bun:test";

/**
 * CB-030 — cubre syncPromesasPago (upsert idempotente del espejo de
 * promesas) con la DB fakeada, mismo patrón que latefee.test.ts: despacho
 * de selects por identidad de tabla drizzle, inserts/updates grabados.
 *
 * Foco: el bug de batch-abort (una fila inválida no debe tumbar el resto
 * del batch) y los caminos de noEncontradas/fallaTotal.
 */

type Fila = Record<string, any>;

const estado = {
	selects: new Map<any, Fila[]>(),
	inserts: [] as { tabla: any; filas: Fila[] }[],
	updates: [] as { tabla: any; set: Fila }[],
	// Error que deben lanzar insert/update en vez de resolver — para simular la
	// tabla del espejo aún no migrada (undefined_table / 42P01) y cualquier otro
	// fallo de DB que NO debe tragarse.
	errorEscritura: null as any,
};

function crearBuilderSelect() {
	let tabla: any = null;
	const b: any = {
		from(t: any) {
			tabla = t;
			return b;
		},
		where() {
			return b;
		},
		orderBy() {
			return b;
		},
		limit() {
			return b;
		},
		then(res: any, rej: any) {
			return Promise.resolve(estado.selects.get(tabla) ?? []).then(res, rej);
		},
	};
	return b;
}

function crearMutadores() {
	return {
		insert(tabla: any) {
			return {
				values(v: Fila | Fila[]) {
					const filas = Array.isArray(v) ? v : [v];
					const chain: any = {
						onConflictDoUpdate() {
							if (estado.errorEscritura) return Promise.reject(estado.errorEscritura);
							estado.inserts.push({ tabla, filas });
							return Promise.resolve([]);
						},
					};
					return chain;
				},
			};
		},
		update(tabla: any) {
			return {
				set(set: Fila) {
					return {
						where() {
							if (estado.errorEscritura) return Promise.reject(estado.errorEscritura);
							estado.updates.push({ tabla, set });
							return Promise.resolve([]);
						},
					};
				},
			};
		},
	};
}

const fakeDb: any = {
	select: () => crearBuilderSelect(),
	...crearMutadores(),
	transaction: async (cb: any) => cb(crearMutadores()),
};

mock.module("../database", () => ({ db: fakeDb }));

const { syncPromesasPago } = await import("./syncPromesasPago");
const { creditos, promesas_pago_espejo } = await import("../database/db/schema");

function prepararEscenario(opts: { creditosRows?: Fila[]; errorEscritura?: any }) {
	estado.selects = new Map<any, Fila[]>([[creditos, opts.creditosRows ?? []]]);
	estado.inserts = [];
	estado.updates = [];
	estado.errorEscritura = opts.errorEscritura ?? null;
}

const insertsEn = (tabla: any) => estado.inserts.filter((i) => i.tabla === tabla).flatMap((i) => i.filas);

beforeEach(() => prepararEscenario({}));

function promesa(overrides: Partial<Parameters<typeof syncPromesasPago>[0][number]> = {}) {
	return {
		contacto_cobros_id: "c1",
		numero_credito_sifco: "S1",
		cuota_inicio: null,
		cuota_fin: null,
		incluye_mora: false,
		fecha_promesa: "2026-08-10",
		activa: true,
		...overrides,
	};
}

describe("syncPromesasPago", () => {
	it("batch vacío → success:false sin tocar DB", async () => {
		const r = await syncPromesasPago([]);
		expect(r.success).toBe(false);
		expect(insertsEn(promesas_pago_espejo)).toHaveLength(0);
	});

	it("fecha_promesa con forma válida pero calendario imposible (2026-02-31) se rechaza por-fila, no aborta el batch (Codex PR #1235, comentario P2)", async () => {
		prepararEscenario({ creditosRows: [{ credito_id: 1, numero_credito_sifco: "S1" }] });

		const r = await syncPromesasPago([
			promesa({ contacto_cobros_id: "c1", numero_credito_sifco: "S1" }),
			promesa({ contacto_cobros_id: "c2", fecha_promesa: "2026-02-31" }), // pasa el regex, no existe en el calendario
		]);

		expect(r.success).toBe(true);
		expect(r.actualizadas).toBe(1);
		expect(r.noValidas).toHaveLength(1);
	});

	it("cuota_inicio:0 (fuera del rango real, numero_cuota arranca en 1) se rechaza por-fila (Codex PR #1235, comentario #7)", async () => {
		prepararEscenario({ creditosRows: [{ credito_id: 1, numero_credito_sifco: "S1" }] });

		const r = await syncPromesasPago([
			promesa({ contacto_cobros_id: "c1", numero_credito_sifco: "S1" }),
			promesa({ contacto_cobros_id: "c2", cuota_inicio: 0, cuota_fin: 2 }),
		]);

		expect(r.success).toBe(true);
		expect(r.actualizadas).toBe(1);
		expect(r.noValidas).toHaveLength(1);
	});

	it("cuota_inicio/cuota_fin fraccionarios se rechazan por-fila antes de llegar a la columna integer (Codex PR #1235, comentario #7)", async () => {
		prepararEscenario({ creditosRows: [{ credito_id: 1, numero_credito_sifco: "S1" }] });

		const r = await syncPromesasPago([
			promesa({ contacto_cobros_id: "c1", numero_credito_sifco: "S1" }),
			promesa({ contacto_cobros_id: "c2", cuota_inicio: 1.5, cuota_fin: 3 }),
		]);

		expect(r.success).toBe(true);
		expect(r.actualizadas).toBe(1);
		expect(r.noValidas).toHaveLength(1);
	});

	it("una fila con formato inválido NO aborta el batch — las demás válidas se sincronizan igual", async () => {
		prepararEscenario({ creditosRows: [{ credito_id: 1, numero_credito_sifco: "S1" }] });

		const r = await syncPromesasPago([
			promesa({ contacto_cobros_id: "c1", numero_credito_sifco: "S1" }),
			promesa({ contacto_cobros_id: "c2", fecha_promesa: "fecha-mala" }), // inválida
		]);

		expect(r.success).toBe(true);
		expect(r.actualizadas).toBe(1);
		expect(r.noValidas).toHaveLength(1);
		const filas = insertsEn(promesas_pago_espejo);
		expect(filas).toHaveLength(1);
		expect(filas[0]).toMatchObject({ contacto_cobros_id: "c1", credito_id: 1 });
	});

	it("todas las filas inválidas → success:false, ningún insert", async () => {
		const r = await syncPromesasPago([promesa({ fecha_promesa: "mala" }), promesa({ cuota_inicio: 5, cuota_fin: 1 })]);
		expect(r.success).toBe(false);
		expect(insertsEn(promesas_pago_espejo)).toHaveLength(0);
	});

	// El rango invertido {5,1} son DOS enteros positivos, así que pasa el guard de
	// enteros y lo rechaza específicamente el check inicio>fin. Se afirma el
	// mensaje (no solo success:false) para que, si alguien reordena las
	// validaciones, quede claro cuál disparó.
	it("rango invertido (cuota_inicio > cuota_fin) se rechaza por el check de rango, no por el de enteros", async () => {
		prepararEscenario({ creditosRows: [{ credito_id: 1, numero_credito_sifco: "S1" }] });

		const r = await syncPromesasPago([promesa({ cuota_inicio: 5, cuota_fin: 1 })]);

		expect(r.success).toBe(false);
		expect(r.message).toContain("no puede ser mayor que cuota_fin");
	});

	it("SIFCO no resuelve a ningún crédito → noEncontradas, no bloquea otras filas válidas", async () => {
		prepararEscenario({ creditosRows: [{ credito_id: 1, numero_credito_sifco: "S1" }] });

		const r = await syncPromesasPago([
			promesa({ contacto_cobros_id: "c1", numero_credito_sifco: "S1" }),
			promesa({ contacto_cobros_id: "c2", numero_credito_sifco: "SIFCO-FANTASMA" }),
		]);

		expect(r.success).toBe(true);
		expect(r.actualizadas).toBe(1);
		expect(r.noEncontradas).toEqual(["SIFCO-FANTASMA"]);
		expect(r.fallaTotal).toBeUndefined();
	});

	it("fallaTotal: NINGÚN sifco del batch resuelve", async () => {
		prepararEscenario({ creditosRows: [] });

		const r = await syncPromesasPago([promesa({ numero_credito_sifco: "S-X" })]);

		expect(r.success).toBe(true);
		expect(r.actualizadas).toBe(0);
		expect(r.fallaTotal).toBe(true);
	});

	it("cuota_inicio sin cuota_fin (pareja incompleta) es rechazada por fila, resto del batch sigue", async () => {
		prepararEscenario({ creditosRows: [{ credito_id: 1, numero_credito_sifco: "S1" }] });

		const r = await syncPromesasPago([
			promesa({ contacto_cobros_id: "c1", numero_credito_sifco: "S1" }),
			promesa({ contacto_cobros_id: "c2", cuota_inicio: 3, cuota_fin: null }),
		]);

		expect(r.actualizadas).toBe(1);
		expect(r.noValidas).toHaveLength(1);
	});

	describe("modo reconciliacion_completa (Codex PR #1234: filas zombie)", () => {
		it("modo default (push por evento) NO desactiva nada fuera de su propia fila", async () => {
			prepararEscenario({ creditosRows: [{ credito_id: 1, numero_credito_sifco: "S1" }] });

			await syncPromesasPago([promesa({ contacto_cobros_id: "c1", numero_credito_sifco: "S1" })]);

			expect(estado.updates).toHaveLength(0);
		});

		it("reconciliacion_completa desactiva filas activas que ya NO vienen en el batch", async () => {
			prepararEscenario({ creditosRows: [{ credito_id: 1, numero_credito_sifco: "S1" }] });

			await syncPromesasPago(
				[promesa({ contacto_cobros_id: "c1", numero_credito_sifco: "S1" })],
				"reconciliacion_completa",
			);

			expect(estado.updates).toHaveLength(1);
			expect(estado.updates[0].set).toMatchObject({ activa: false });
		});

		it("reconciliacion_completa NO desactiva si el batch viene vacío tras filtrar inválidas (evita apagar todo por un payload malformado)", async () => {
			prepararEscenario({ creditosRows: [] });

			const r = await syncPromesasPago([promesa({ fecha_promesa: "mala" })], "reconciliacion_completa");

			expect(r.success).toBe(false);
			expect(estado.updates).toHaveLength(0);
		});

		it("reconciliacion_completa con batch [] (nada vigente hoy) desactiva TODAS las filas activas (Codex PR #1234, comentario #4)", async () => {
			prepararEscenario({ creditosRows: [] });

			const r = await syncPromesasPago([], "reconciliacion_completa");

			expect(r.success).toBe(true);
			expect(r.actualizadas).toBe(0);
			expect(r.fallaTotal).toBeUndefined(); // batch vacío legítimo, no es una falla
			expect(estado.updates).toHaveLength(1);
			expect(estado.updates[0].set).toMatchObject({ activa: false });
		});

		it("modo evento con batch [] sigue siendo inválido (no tiene sentido pushear nada)", async () => {
			const r = await syncPromesasPago([], "evento");
			expect(r.success).toBe(false);
			expect(estado.updates).toHaveLength(0);
		});
	});
});

// CB-030 — 0007_promesas_pago_espejo.sql se aplica a mano (sin migraciones
// automáticas). Los paths de LECTURA ya hacían fail-open ante undefined_table;
// el de ESCRITURA no tenía guard, así que crm-server (push por evento y job de
// reconciliación diario) recibía un 500 crudo en vez de una señal limpia
// mientras la migración estuviera pendiente (Codex review PR #1235, comentario P2).
describe("syncPromesasPago — tabla del espejo aún no migrada (42P01)", () => {
	const undefinedTable = Object.assign(new Error('relation "promesas_pago_espejo" does not exist'), {
		code: "42P01",
	});

	it("devuelve success:false con mensaje explícito, sin propagar el 500", async () => {
		prepararEscenario({
			creditosRows: [{ credito_id: 1, numero_credito_sifco: "S1" }],
			errorEscritura: undefinedTable,
		});

		const r = await syncPromesasPago([promesa()]);

		expect(r.success).toBe(false);
		expect(r.message).toContain("no migrado");
		// No se reporta como aplicado: nada se escribió.
		expect(r.actualizadas).toBeUndefined();
	});

	it("también cubre el UPDATE de desactivación en reconciliación completa", async () => {
		prepararEscenario({
			creditosRows: [{ credito_id: 1, numero_credito_sifco: "S1" }],
			errorEscritura: undefinedTable,
		});

		const r = await syncPromesasPago([], "reconciliacion_completa");

		expect(r.success).toBe(false);
		expect(r.message).toContain("no migrado");
	});

	it("un error de DB que NO es 42P01 se sigue propagando (no se traga)", async () => {
		prepararEscenario({
			creditosRows: [{ credito_id: 1, numero_credito_sifco: "S1" }],
			errorEscritura: Object.assign(new Error("deadlock detected"), { code: "40P01" }),
		});

		await expect(syncPromesasPago([promesa()])).rejects.toThrow("deadlock detected");
	});
});
