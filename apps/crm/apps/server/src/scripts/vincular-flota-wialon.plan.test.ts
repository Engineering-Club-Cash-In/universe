import { describe, expect, test } from "bun:test";
import { WIALON_VINCULO_AUTO_PLACA } from "../routers/wialon";
import {
	diagnosticar,
	type UnidadWialon,
	type VehiculoCrm,
} from "./vincular-flota-wialon.logic";
import {
	aplicarPlan,
	conRegistro,
	destinoBd,
	type ItemVinculo,
	MARCADOR_PLACA,
	MARCADOR_REGISTRO,
	MARCADOR_VIN,
	planificar,
	RegistroFallido,
	sqlReversa,
	validarDestinoParaEscribir,
} from "./vincular-flota-wialon.plan";

const u = (
	id: number,
	nm: string,
	campos: Record<string, string> = {},
): UnidadWialon => ({ id, nm, campos });
const v = (id: string, datos: Partial<VehiculoCrm> = {}): VehiculoCrm => ({
	id,
	placa: null,
	vin: null,
	wialonUnitId: null,
	vinculadoPor: null,
	conCredito: false,
	...datos,
});
const VIN = "3N6CD33B3ZL454112";
const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";

const item = (datos: Partial<ItemVinculo> = {}): ItemVinculo => ({
	vehicleId: ID1,
	placa: "P0-420CDP",
	vin: null,
	unitId: 1,
	unitName: "P-420CDP - CON APAGADO",
	metodo: "placa",
	marcador: MARCADOR_PLACA,
	confirmar: false,
	nota: null,
	...datos,
});

describe("marcadores", () => {
	test("auto:placa es el mismo valor que revalida la ficha", () => {
		expect(MARCADOR_PLACA).toBe(WIALON_VINCULO_AUTO_PLACA);
	});
});

describe("planificar", () => {
	test("placa en el nombre → auto:placa; VIN → auto:vin; registration_plate → auto:registro", () => {
		const unidades = [
			u(1, "P-420CDP - CON APAGADO"),
			u(2, `${VIN} - CON APAGADO`),
			u(3, "Unidad 3", { registration_plate: "P-555ABC" }),
		];
		const diag = diagnosticar(unidades, [
			v(ID1, { placa: "P0-420CDP" }),
			v(ID2, { vin: VIN }),
			v("33333333-3333-4333-8333-333333333333", { placa: "P-555ABC" }),
		]);
		const plan = planificar(diag.vehiculos, unidades, {
			incluirConfirmar: false,
		});
		expect(plan.items.map((i) => [i.unitId, i.marcador])).toEqual([
			[1, MARCADOR_PLACA],
			[2, MARCADOR_VIN],
			[3, MARCADOR_REGISTRO],
		]);
	});

	test("solo entran los propuestos: ya vinculados y ambiguos no se tocan", () => {
		const unidades = [
			u(1, "P-420CDP - CON APAGADO"),
			u(2, "P-777XYZ"),
			u(3, "C-777XYZ"),
		];
		const diag = diagnosticar(unidades, [
			v(ID1, {
				placa: "P0-420CDP",
				wialonUnitId: 1,
				vinculadoPor: "auto:placa",
			}),
			v(ID2, { placa: "P-777XYZ" }),
		]);
		expect(
			planificar(diag.vehiculos, unidades, { incluirConfirmar: false }).items,
		).toEqual([]);
	});

	test("los desempates por confirmar quedan afuera salvo que se pidan", () => {
		const unidades = [u(1, "P-420CDP")];
		const diag = diagnosticar(unidades, [
			v(ID1, {
				placa: "P0-420CDP",
				conCredito: true,
				creditos: [
					{ sifco: "A", estado: "CANCELADO", fechaCreacion: "2024-01-01" },
				],
			}),
			v(ID2, { placa: "P-420CDP" }),
		]);
		const sin = planificar(diag.vehiculos, unidades, {
			incluirConfirmar: false,
		});
		expect(sin.items).toEqual([]);
		expect(sin.excluidos.map((e) => e.motivo)).toEqual([
			"requiere_confirmacion",
		]);
		const con = planificar(diag.vehiculos, unidades, {
			incluirConfirmar: true,
		});
		expect(con.items.map((i) => i.vehicleId)).toEqual([ID1]);
	});

	test("max recorta en orden estable por unidad", () => {
		const unidades = [u(2, "P-222BBB"), u(1, "P-111AAA")];
		const diag = diagnosticar(unidades, [
			v(ID1, { placa: "P-222BBB" }),
			v(ID2, { placa: "P-111AAA" }),
		]);
		const plan = planificar(diag.vehiculos, unidades, {
			incluirConfirmar: false,
			max: 1,
		});
		expect(plan.items.map((i) => i.unitId)).toEqual([1]);
		expect(plan.excluidos.map((e) => [e.item.unitId, e.motivo])).toEqual([
			[2, "fuera_del_limite"],
		]);
	});
});

describe("aplicarPlan", () => {
	test("separa guardados, omitidos y errores", async () => {
		const res = await aplicarPlan(
			[item({ unitId: 1 }), item({ unitId: 2 }), item({ unitId: 3 })],
			{
				vincular: async (i) => {
					if (i.unitId === 3) throw new Error("boom");
					return i.unitId === 1 ? "guardado" : "unidad_ocupada";
				},
			},
		);
		expect(res.guardados.map((i) => i.unitId)).toEqual([1]);
		expect(res.omitidos.map((o) => o.resultado)).toEqual(["unidad_ocupada"]);
		expect(res.errores.map((e) => e.error)).toEqual(["boom"]);
		expect(res.abortado).toBe(false);
	});

	test("aborta al llegar a maxErrores y cuenta los pendientes", async () => {
		const res = await aplicarPlan(
			[1, 2, 3, 4].map((unitId) => item({ unitId })),
			{
				vincular: async () => {
					throw new Error("base caída");
				},
			},
			{ maxErrores: 2 },
		);
		expect(res.errores).toHaveLength(2);
		expect(res.abortado).toBe(true);
		expect(res.pendientes).toBe(2);
	});
});

describe("conRegistro", () => {
	test("prepara antes de escribir y registra cada resultado antes de la siguiente, también los errores", async () => {
		const eventos: string[] = [];
		const escritor = conRegistro(
			{
				vincular: async (i) => {
					eventos.push(`escribe ${i.unitId}`);
					if (i.unitId === 2) throw new Error("boom");
					return i.unitId === 1 ? "guardado" : "unidad_ocupada";
				},
			},
			{
				antes: (i) => eventos.push(`prepara ${i.unitId}`),
				despues: (i, r) =>
					eventos.push(
						`registra ${i.unitId} ${typeof r === "string" ? r : `error:${r.error}`}`,
					),
			},
		);
		const res = await aplicarPlan(
			[1, 2, 3].map((unitId) => item({ unitId })),
			escritor,
		);
		// `prepara` va antes de escribir: un corte justo después del commit
		// deja el vínculo ya cubierto por la reversa.
		expect(eventos).toEqual([
			"prepara 1",
			"escribe 1",
			"registra 1 guardado",
			"prepara 2",
			"escribe 2",
			"registra 2 error:boom",
			"prepara 3",
			"escribe 3",
			"registra 3 unidad_ocupada",
		]);
		// El error sigue llegando a aplicarPlan.
		expect(res.errores.map((e) => e.error)).toEqual(["boom"]);
		expect(res.guardados.map((i) => i.unitId)).toEqual([1]);
	});
});

describe("conRegistro · si registrar falla, la corrida se detiene", () => {
	test("falla al registrar DESPUÉS de un vínculo confirmado: no se escribe nada más", async () => {
		const escritos: number[] = [];
		const escritor = conRegistro(
			{
				vincular: async (i) => {
					escritos.push(i.unitId);
					return "guardado";
				},
			},
			{
				despues: (i) => {
					if (i.unitId === 2) throw new Error("disco lleno");
				},
			},
		);
		const res = await aplicarPlan(
			[1, 2, 3, 4].map((unitId) => item({ unitId })),
			escritor,
		);
		expect(escritos).toEqual([1, 2]);
		expect(res.abortado).toBe(true);
		expect(res.pendientes).toBe(2);
		expect(res.errores[0]?.error).toContain("disco lleno");
	});

	test("falla al preparar la reversa ANTES de escribir: ese vínculo no se escribe", async () => {
		const escritos: number[] = [];
		const escritor = conRegistro(
			{
				vincular: async (i) => {
					escritos.push(i.unitId);
					return "guardado";
				},
			},
			{
				antes: (i) => {
					if (i.unitId === 2) throw new Error("sin permisos");
				},
				despues: () => {},
			},
		);
		const res = await aplicarPlan(
			[1, 2, 3].map((unitId) => item({ unitId })),
			escritor,
		);
		expect(escritos).toEqual([1]);
		expect(res.abortado).toBe(true);
		expect(res.pendientes).toBe(1);
	});

	test("un error normal de escritura no detiene la corrida", async () => {
		const res = await aplicarPlan(
			[1, 2].map((unitId) => item({ unitId })),
			conRegistro(
				{
					vincular: async (i) => {
						if (i.unitId === 1) throw new Error("timeout");
						return "guardado";
					},
				},
				{ despues: () => {} },
			),
		);
		expect(res.abortado).toBe(false);
		expect(res.guardados.map((i) => i.unitId)).toEqual([2]);
		expect(res.errores[0]?.error).toBe("timeout");
		expect(new RegistroFallido(item(), new Error("x")).message).toContain(
			"No se pudo registrar",
		);
	});
});

describe("destino de la base", () => {
	test("producción se rechaza aunque se confirme", () => {
		const d = destinoBd(
			"postgresql://u:p@ep-winter-butterfly-a5rgkcy7-pooler.us-east-2.aws.neon.tech/neondb",
		);
		const r = validarDestinoParaEscribir(d, d?.host);
		expect(r.ok).toBe(false);
	});

	test("hay que teclear el host exacto", () => {
		const d = destinoBd("postgresql://u:p@localhost:55433/Cobros2");
		expect(d).toEqual({ host: "localhost", puerto: "55433", bd: "Cobros2" });
		expect(validarDestinoParaEscribir(d, undefined).ok).toBe(false);
		expect(validarDestinoParaEscribir(d, "otro").ok).toBe(false);
		expect(validarDestinoParaEscribir(d, "localhost").ok).toBe(true);
	});

	test("sin DATABASE_URL no se escribe", () => {
		expect(validarDestinoParaEscribir(destinoBd(undefined), "x").ok).toBe(
			false,
		);
	});
});

describe("sqlReversa", () => {
	test("suelta solo lo que sigue con la misma unidad y marcador", () => {
		const sql = sqlReversa(
			[
				item({ unitId: 7 }),
				item({ vehicleId: ID2, unitId: 8, marcador: MARCADOR_VIN }),
			],
			new Date("2026-10-07T00:00:00Z"),
		);
		expect(sql).toContain(`('${ID1}', 7, 'auto:placa')`);
		expect(sql).toContain(`('${ID2}', 8, 'auto:vin')`);
		expect(sql).toContain("AND v.wialon_vinculado_por = x.marcador");
		expect(sql).toContain("Debe decir UPDATE 2");
	});

	test("sin vínculos guardados lanza en vez de generar SQL inválido", () => {
		expect(() => sqlReversa([], new Date())).toThrow();
	});

	test("rechaza ids o marcadores que no vienen del plan", () => {
		expect(() =>
			sqlReversa(
				[item({ vehicleId: "1'; drop table vehicles;--" })],
				new Date(),
			),
		).toThrow();
		expect(() =>
			sqlReversa([item({ marcador: "a mano" })], new Date()),
		).toThrow();
	});
});
