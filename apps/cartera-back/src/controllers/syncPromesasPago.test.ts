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
							estado.inserts.push({ tabla, filas });
							return Promise.resolve([]);
						},
					};
					return chain;
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

function prepararEscenario(opts: { creditosRows?: Fila[] }) {
	estado.selects = new Map<any, Fila[]>([[creditos, opts.creditosRows ?? []]]);
	estado.inserts = [];
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
});
