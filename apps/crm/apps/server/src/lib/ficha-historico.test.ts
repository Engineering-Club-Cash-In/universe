import { describe, expect, test } from "bun:test";
import type {
	CarteraBucketHistorialEvento,
	CarteraConvenio,
} from "../types/cartera-back";
import { armarHistorico } from "./ficha-complementos";

const evento = (
	p: Partial<CarteraBucketHistorialEvento>,
): CarteraBucketHistorialEvento => ({
	historial_id: 1,
	fecha: "2026-09-01T06:05:00Z",
	tipo_evento: "INICIAL",
	origen: "PROCESO_AUTO",
	bucket_anterior: null,
	bucket_anterior_prefijo: null,
	bucket_anterior_nombre: null,
	bucket_nuevo: 1,
	bucket_nuevo_prefijo: "B1",
	bucket_nuevo_nombre: "Alerta temprana",
	cuotas_atrasadas_nuevas: 1,
	status_credito: "MOROSO",
	asesor_atribucion_id: null,
	asesor_atribucion: null,
	pago_id: null,
	motivo: null,
	...p,
});

const convenio = (p: Partial<CarteraConvenio>): CarteraConvenio => ({
	convenio_id: 7,
	credito_id: 1,
	monto_total_convenio: "3000",
	numero_meses: 6,
	cuota_mensual: "500",
	activo: true,
	completado: false,
	fecha_convenio: "2026-09-10T15:00:00Z",
	created_at: "2026-09-10T15:00:00Z",
	updated_at: "2026-09-10T15:00:00Z",
	...p,
});

const vacio = { buckets: [], convenios: [], promesas: [] };

describe("armarHistorico", () => {
	test("textos de bucket: ingreso, subida y bajada", () => {
		const r = armarHistorico({
			...vacio,
			buckets: [
				evento({}),
				evento({
					historial_id: 2,
					fecha: "2026-09-05T06:05:00Z",
					tipo_evento: "SUBIDA",
					bucket_anterior: 1,
					bucket_anterior_prefijo: "B1",
					bucket_nuevo: 2,
					bucket_nuevo_prefijo: "B2",
					bucket_nuevo_nombre: "Mora temprana",
				}),
				evento({
					historial_id: 3,
					fecha: "2026-09-20T06:05:00Z",
					tipo_evento: "BAJADA",
					bucket_anterior: 2,
					bucket_anterior_prefijo: "B2",
					bucket_nuevo: 0,
					bucket_nuevo_prefijo: null,
					bucket_nuevo_nombre: null,
				}),
			],
		});
		expect(r.map((h) => h.descripcion)).toEqual([
			"Bajó a Bucket B0 (desde B2)",
			"Subió a Bucket B2 · Mora temprana (desde B1)",
			"Ingresó a Bucket B1 · Alerta temprana",
		]);
		expect(r.every((h) => h.tipo === "bucket")).toBe(true);
	});

	test("convenio vigente, completado y deshecho; el pendiente no sale", () => {
		const r = armarHistorico({
			...vacio,
			convenios: [
				convenio({}),
				convenio({
					convenio_id: 8,
					activo: false,
					completado: true,
					fecha_convenio: "2026-01-10T15:00:00Z",
					updated_at: "2026-07-10T15:00:00Z",
				}),
				convenio({
					convenio_id: 9,
					activo: false,
					fecha_convenio: "2026-08-01T15:00:00Z",
					anulado_at: "2026-08-03T15:00:00Z",
				}),
				convenio({ convenio_id: 10, activo: false, numero_meses: 1 }),
			],
		});
		expect(r.map((h) => h.descripcion)).toEqual([
			"Convenio de pago firmado · 6 cuotas de Q500.00",
			"Convenio de pago deshecho",
			"Convenio de pago firmado · 6 cuotas de Q500.00",
			"Convenio de pago completado",
			"Convenio de pago firmado · 6 cuotas de Q500.00",
		]);
	});

	test("promesas cumplidas con y sin monto, mezcladas por fecha", () => {
		const r = armarHistorico({
			...vacio,
			buckets: [evento({ fecha: "2026-09-15T06:05:00Z" })],
			promesas: [
				{ id: "p1", monto: "750", fecha: new Date("2026-09-20T18:00:00Z") },
				{ id: "p2", monto: null, fecha: new Date("2026-09-10T18:00:00Z") },
			],
		});
		expect(r.map((h) => h.descripcion)).toEqual([
			"Promesa de pago cumplida · Q750.00",
			"Ingresó a Bucket B1 · Alerta temprana",
			"Promesa de pago cumplida",
		]);
	});
});
