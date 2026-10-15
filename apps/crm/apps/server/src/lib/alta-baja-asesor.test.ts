import { describe, expect, test } from "bun:test";
import {
	capacidadSugeridaPorBucket,
	elegirCreditosDonante,
	evaluarUsuarioAlta,
	MAX_CARTERA_INICIAL,
	motivoDeLaBaja,
	planCarteraInicial,
	recomendarCarteraInicial,
	resumenRedistribucion,
	sugerirResponsableEspeciales,
	suspendidoPorBaja,
} from "./alta-baja-asesor";
import { eventoDeTraslado } from "./bitacora-supervision";

const equipo = [
	{ asesorId: 1, nombre: "C. Ruiz", carga: 66 },
	{ asesorId: 2, nombre: "A. Díaz", carga: 64 },
	{ asesorId: 3, nombre: "L. Morales", carga: 63 },
	{ asesorId: 4, nombre: "P. Gómez", carga: 61 },
	{ asesorId: 5, nombre: "M. Soto", carga: 50 },
];

describe("cartera inicial del alta", () => {
	test("recomienda lo que deja a todos parejos y un rango para empezar con menos", () => {
		const r = recomendarCarteraInicial(equipo);
		expect(r.total).toBe(304);
		expect(r.recomendado).toBe(50); // 304 / 6
		expect(r.rango).toEqual({ min: 25, max: 65 });
		expect(r.tope).toBe(MAX_CARTERA_INICIAL);
	});

	test("sin equipo del nivel no hay nada que asignar", () => {
		expect(recomendarCarteraInicial([])).toMatchObject({
			recomendado: 0,
			rango: { min: 0, max: 0 },
			tope: 0,
		});
		expect(planCarteraInicial([], 10)).toMatchObject({
			asignados: 0,
			donantes: [],
			resto: null,
		});
	});

	test("quita siempre al que más tiene: empareja al equipo desde arriba", () => {
		const plan = planCarteraInicial(equipo, 8);
		expect(plan.asignados).toBe(8);
		expect(plan.donantes.reduce((t, d) => t + d.quitar, 0)).toBe(8);
		// 66,64,63 bajan a 61/62 hasta sumar 8; P. Gómez (61) y M. Soto (50) no ceden.
		expect(plan.donantes.map((d) => [d.nombre, d.antes, d.despues])).toEqual([
			["C. Ruiz", 66, 61],
			["A. Díaz", 64, 62],
			["L. Morales", 63, 62],
		]);
		expect(plan.donantes.find((d) => d.asesorId === 5)).toBeUndefined();
	});

	test("con el recomendado el resto del equipo queda equilibrado", () => {
		const plan = planCarteraInicial(equipo, 50);
		expect(plan.asignados).toBe(50);
		expect(plan.resto).toEqual({ min: 50, max: 51 });
		expect(plan.equilibrado).toBe(true);
		// Nadie queda por debajo de quien no cedió.
		for (const d of plan.donantes) expect(d.despues).toBeGreaterThanOrEqual(50);
	});

	test("lo pedido se acota a la cartera del equipo y al tope del lote", () => {
		const chico = [{ asesorId: 9, nombre: "Único", carga: 3 }];
		expect(planCarteraInicial(chico, 10).asignados).toBe(3);
		const grande = [{ asesorId: 9, nombre: "Grande", carga: 900 }];
		expect(planCarteraInicial(grande, 500).asignados).toBe(MAX_CARTERA_INICIAL);
		expect(planCarteraInicial(equipo, -4).asignados).toBe(0);
	});

	test("a igual carga cede primero el de menor id (determinístico)", () => {
		const parejos = [
			{ asesorId: 8, nombre: "B", carga: 10 },
			{ asesorId: 7, nombre: "A", carga: 10 },
		];
		const plan = planCarteraInicial(parejos, 1);
		expect(plan.donantes).toEqual([
			{ asesorId: 7, nombre: "A", antes: 10, despues: 9, quitar: 1 },
		]);
	});

	test("elige créditos en proporción a cada bucket y los más recientes", () => {
		const creditos = [
			...[1, 2, 3, 4, 5, 6].map((id) => ({ creditoId: id, bucket: 0 })),
			...[7, 8].map((id) => ({ creditoId: id, bucket: 1 })),
		];
		// 4 de 8: 3 de B0 (6/8 · 4) y 1 de B1 (2/8 · 4).
		expect(elegirCreditosDonante(creditos, 4)).toEqual([4, 5, 6, 8]);
		// Sin los excluidos, toma los siguientes.
		expect(elegirCreditosDonante(creditos, 4, new Set([6, 8]))).toEqual([
			3, 4, 5, 7,
		]);
		expect(elegirCreditosDonante(creditos, 20)).toHaveLength(8);
		expect(elegirCreditosDonante(creditos, 0)).toEqual([]);
	});

	test("capacidad del pool nuevo: la más repetida del equipo, si no 300", () => {
		expect(
			capacidadSugeridaPorBucket(
				[
					{ bucket: 0, capacidad: 120 },
					{ bucket: 0, capacidad: 120 },
					{ bucket: 0, capacidad: 300 },
					{ bucket: 1, capacidad: 80 },
					{ bucket: 1, capacidad: 90 },
				],
				[0, 1, 2],
			),
		).toEqual({ "0": 120, "1": 90, "2": 300 });
	});
});

describe("usuario del CRM en el alta", () => {
	const base = {
		id: "u1",
		name: "Juan Pérez",
		role: "cobros",
		banned: false,
		banReason: null,
	};

	test("sin usuario se crea (supervisión o administración)", () => {
		expect(evaluarUsuarioAlta(null, false)).toEqual({
			usuario: { estado: "nuevo" },
			bloqueo: null,
		});
	});

	test("de cobros y habilitado se vincula", () => {
		expect(evaluarUsuarioAlta(base, false).usuario).toEqual({
			estado: "existente",
			userId: "u1",
			nombre: "Juan Pérez",
		});
	});

	test("suspendido por una baja lo habilita supervisión; por administración, solo admin", () => {
		const porBaja = {
			...base,
			banned: true,
			banReason:
				"Baja de asesor: Renuncia voluntaria · último día de trabajo 01/10/2026",
		};
		expect(evaluarUsuarioAlta(porBaja, false).usuario?.estado).toBe(
			"reactivar",
		);
		const porAdmin = { ...base, banned: true, banReason: null };
		expect(evaluarUsuarioAlta(porAdmin, false).bloqueo).toContain(
			"suspendido por administración",
		);
		expect(evaluarUsuarioAlta(porAdmin, true).usuario?.estado).toBe(
			"reactivar",
		);
	});

	test("con otro rol no se toca", () => {
		const r = evaluarUsuarioAlta({ ...base, role: "sales" }, true);
		expect(r.usuario).toBeNull();
		expect(r.bloqueo).toContain("otro rol");
	});
});

describe("baja", () => {
	test("el motivo es estable, la bitácora lo reconoce como baja", () => {
		const motivo = motivoDeLaBaja({
			motivo: "renuncia",
			ultimoDia: "2026-10-30",
			detalle: "  se muda  ",
		});
		expect(motivo).toBe(
			"Baja de asesor: Renuncia voluntaria · último día de trabajo 30/10/2026 · se muda",
		);
		expect(eventoDeTraslado(motivo)).toBe("baja");
		expect(suspendidoPorBaja(motivo)).toBe(true);
		expect(
			motivoDeLaBaja({
				motivo: "otro",
				ultimoDia: "2026-10-30",
				detalle: "Traslado a otra área",
			}),
		).toBe(
			"Baja de asesor: Traslado a otra área · último día de trabajo 30/10/2026",
		);
	});

	test("resume el reparto de cartera: composición, receptores y responsable", () => {
		const asignacion = (
			creditoId: number,
			bucket: number | null,
			asesorNuevoId: number,
		) => ({
			creditoId,
			numeroCreditoSifco: `S${creditoId}`,
			cliente: null,
			asesorAnteriorId: 10,
			asesorNuevoId,
			bucket,
			prioridad: 1 as const,
		});
		const r = resumenRedistribucion(
			{
				asignaciones: [
					asignacion(1, 0, 20),
					asignacion(2, 0, 30),
					asignacion(3, 1, 20),
					asignacion(4, null, 30),
				],
				bloqueos: [{ bucket: 1, creditoId: 5, razon: "sin_receptor_elegible" }],
				excluidos: [],
				carga: [
					{
						asesorId: 10,
						nombre: "Origen",
						bucket: 0,
						antes: 2,
						despues: 0,
						capacidad: 300,
					},
					{
						asesorId: 20,
						nombre: "A. Díaz",
						bucket: 0,
						antes: 5,
						despues: 6,
						capacidad: 100,
					},
					{
						asesorId: 20,
						nombre: "A. Díaz",
						bucket: 1,
						antes: 5,
						despues: 6,
						capacidad: 100,
					},
					{
						asesorId: 30,
						nombre: "M. Soto",
						bucket: 0,
						antes: 7,
						despues: 8,
						capacidad: 100,
					},
					{
						asesorId: 40,
						nombre: "Sin cambio",
						bucket: 1,
						antes: 3,
						despues: 3,
						capacidad: 100,
					},
				],
			},
			10,
		);
		expect(r.total).toBe(5);
		expect(r.repartidos).toBe(4);
		expect(r.composicion).toEqual([
			{ bucket: 0, cantidad: 2 },
			{ bucket: 1, cantidad: 2 },
		]);
		expect(r.especiales).toEqual({ cantidad: 1, responsableId: 30 });
		expect(
			r.receptores.map((x) => [x.nombre, x.antes, x.despues, x.recibe]),
		).toEqual([
			["A. Díaz", 10, 12, 2],
			["M. Soto", 7, 8, 1],
		]);
		expect(r.rangoDespues).toEqual({ min: 8, max: 12 });
		expect(r.bloqueados).toBe(1);
	});

	test("responsable sugerido de las cuentas fuera de cobro: su nivel, con menos carga", () => {
		const candidatos = [
			{ asesorId: 1, nivel: "senior" as const, carga: 5 },
			{ asesorId: 2, nivel: "junior" as const, carga: 40 },
			{ asesorId: 3, nivel: "junior" as const, carga: 30 },
		];
		expect(sugerirResponsableEspeciales(candidatos, "junior")).toBe(3);
		expect(sugerirResponsableEspeciales(candidatos, "especial")).toBe(1);
		expect(sugerirResponsableEspeciales([], "junior")).toBeNull();
	});
});
