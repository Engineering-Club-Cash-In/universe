import { describe, expect, test } from "bun:test";
import {
	agruparAlertasCaso,
	type FilaAlertaCaso,
	type MarcaAlertaLeida,
	separarLeidas,
	textoLeidaPor,
} from "./alertas-caso";

const USUARIO = "asesor-1";
const SUPERVISOR = "supervisor-1";

function fila(
	id: string,
	cobrosTipo: string | null,
	fecha: string,
	assignedTo: string,
	titulo = "Aviso",
): FilaAlertaCaso {
	return {
		id,
		titulo,
		descripcion: null,
		cobrosTipo,
		status: "pending",
		createdAt: new Date(fecha),
		assignedTo,
	};
}

describe("agruparAlertasCaso", () => {
	test("cuenta repeticiones por tipo y deduplica el mismo evento entre destinatarios", () => {
		const filas = [
			// Día 2: asesor y supervisor reciben la misma alerta.
			fila("a2", "sin_contacto_3d", "2026-10-08T14:00:00Z", USUARIO),
			fila("s2", "sin_contacto_3d", "2026-10-08T14:00:00Z", SUPERVISOR),
			// Día 1: solo el asesor.
			fila("a1", "sin_contacto_3d", "2026-10-07T14:00:00Z", USUARIO),
		];
		const [grupo] = agruparAlertasCaso(filas, USUARIO);
		expect(grupo?.repeticiones).toBe(2);
		expect(grupo?.id).toBe("a2");
		expect(grupo?.desde.toISOString()).toBe("2026-10-07T14:00:00.000Z");
	});

	test("usa el título como clave cuando la alerta no tiene tipo", () => {
		const filas = [
			fila("m1", null, "2026-10-08T10:00:00Z", USUARIO, "Asignación manual"),
		];
		const [grupo] = agruparAlertasCaso(filas, USUARIO);
		expect(grupo?.clave).toBe("Asignación manual");
	});
});

describe("separarLeidas", () => {
	const filas = [
		fila("a2", "promesa_por_vencer", "2026-10-08T14:00:00Z", USUARIO),
		fila("b1", "sin_contacto_3d", "2026-10-07T14:00:00Z", USUARIO),
	];
	const grupos = agruparAlertasCaso(filas, USUARIO);

	test("un grupo marcado sale de la lista activa", () => {
		const marca: MarcaAlertaLeida = {
			leidaHasta: new Date("2026-10-08T14:00:00Z"),
			leidaEn: new Date("2026-10-08T15:00:00Z"),
			leidaPor: USUARIO,
			nombreLeidaPor: "Ana Gómez",
			origen: "manual",
		};
		const marcas = new Map([["promesa_por_vencer", marca]]);
		const { activas, leidas } = separarLeidas(grupos, marcas);
		expect(leidas.map((g) => g.clave)).toEqual(["promesa_por_vencer"]);
		expect(activas.map((g) => g.clave)).toEqual(["sin_contacto_3d"]);
	});

	test("un grupo leído reaparece cuando el job genera una repetición más nueva", () => {
		const marca: MarcaAlertaLeida = {
			leidaHasta: new Date("2026-10-07T14:00:00Z"),
			leidaEn: new Date("2026-10-07T15:00:00Z"),
			leidaPor: USUARIO,
			nombreLeidaPor: "Ana Gómez",
			origen: "manual",
		};
		const marcas = new Map([["sin_contacto_3d", marca]]);
		const { activas, leidas } = separarLeidas(grupos, marcas);
		expect(leidas).toHaveLength(1);
		// Con la marca en 07 la alerta de 07 sigue leída; ninguna repetición nueva.
		expect(activas.map((g) => g.clave)).toEqual(["promesa_por_vencer"]);

		const nuevaRepeticion = agruparAlertasCaso(
			[
				fila("b2", "sin_contacto_3d", "2026-10-09T14:00:00Z", USUARIO),
				...filas,
			],
			USUARIO,
		);
		const r = separarLeidas(nuevaRepeticion, marcas);
		expect(r.leidas).toHaveLength(0);
		expect(r.activas.map((g) => g.clave).sort()).toEqual([
			"promesa_por_vencer",
			"sin_contacto_3d",
		]);
	});
});

describe("textoLeidaPor", () => {
	test("automático, nombre del asesor y sin dato", () => {
		const base = {
			leidaHasta: new Date(),
			leidaEn: new Date(),
			leidaPor: null,
		};
		expect(
			textoLeidaPor({ ...base, nombreLeidaPor: null, origen: "automatico" }),
		).toBe("Automático (más de 30 días)");
		expect(
			textoLeidaPor({ ...base, nombreLeidaPor: "Ana Gómez", origen: "manual" }),
		).toBe("Ana Gómez");
		expect(
			textoLeidaPor({ ...base, nombreLeidaPor: null, origen: "manual" }),
		).toBe("Sin dato");
	});
});
