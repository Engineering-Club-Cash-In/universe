import { describe, expect, test } from "bun:test";
import {
	type BucketCatalogoLite,
	bucketDeCuotas,
	bucketsQueSuben,
	type CuotaProximaParaSubir,
	conteoPorBucket,
	proximosASubirBucket,
} from "./proximos-subir-bucket";

/** Catálogo por defecto: B0..B5 de a una cuota; recuperación pisa en B4, incobrable clava B5. */
const CATALOGO: BucketCatalogoLite[] = [
	{ numero: 0, cuotas_min: 0, cuotas_max: 0, estados_incluidos: [] },
	{ numero: 1, cuotas_min: 1, cuotas_max: 1, estados_incluidos: [] },
	{ numero: 2, cuotas_min: 2, cuotas_max: 2, estados_incluidos: [] },
	{ numero: 3, cuotas_min: 3, cuotas_max: 3, estados_incluidos: [] },
	{
		numero: 4,
		cuotas_min: 4,
		cuotas_max: 4,
		estados_incluidos: [],
		estados_piso: ["EN_RECUPERACION"],
	},
	{
		numero: 5,
		cuotas_min: 5,
		cuotas_max: null,
		estados_incluidos: ["INCOBRABLE"],
	},
];

function cuota(
	sifco: string,
	over: Partial<CuotaProximaParaSubir> = {},
): CuotaProximaParaSubir {
	return {
		numero_credito_sifco: sifco,
		credito_id: 1,
		cliente: "Cliente",
		status_credit: "MOROSO",
		bucket: 2,
		cuotas_vencidas_reales: 2,
		dias_para_vencer: 3,
		fecha_vencimiento: "2026-10-15",
		monto_cuota: "1500.00",
		monto_mora: "20.50",
		...over,
	};
}

describe("proximosASubirBucket", () => {
	test("B1 a B4 con la cuota próxima suben al bucket siguiente", () => {
		const r = proximosASubirBucket(
			[
				cuota("a", { bucket: 1, cuotas_vencidas_reales: 1 }),
				cuota("b", { bucket: 4, cuotas_vencidas_reales: 4 }),
			],
			CATALOGO,
		);
		expect(r.map((x) => [x.sifco, x.bucketActual, x.bucketSiguiente])).toEqual([
			["b", 4, 5],
			["a", 1, 2],
		]);
		expect(r[0].montoCuota).toBe(1500);
		expect(r[0].montoMora).toBe(20.5);
	});

	test("B0, B5 y sin bucket no suben", () => {
		expect(
			proximosASubirBucket(
				[
					cuota("a", { bucket: 0, cuotas_vencidas_reales: 0 }),
					cuota("b", { bucket: 5, cuotas_vencidas_reales: 5 }),
					cuota("c", { bucket: null }),
				],
				CATALOGO,
			),
		).toEqual([]);
	});

	test("fuera del funnel no cuenta", () => {
		expect(
			proximosASubirBucket(
				[cuota("a", { status_credit: "EN_CONVENIO" })],
				CATALOGO,
			),
		).toEqual([]);
	});

	test("un B4 en recuperación con cuatro vencidas de verdad sube a B5", () => {
		const r = proximosASubirBucket(
			[
				cuota("a", {
					status_credit: "EN_RECUPERACION",
					bucket: 4,
					cuotas_vencidas_reales: 4,
				}),
				// Forzado a B4 por la recuperación sin tener cuatro vencidas: no cuenta.
				cuota("b", {
					status_credit: "EN_RECUPERACION",
					bucket: 4,
					cuotas_vencidas_reales: 1,
				}),
			],
			CATALOGO,
		);
		expect(r.map((x) => [x.sifco, x.bucketSiguiente])).toEqual([["a", 5]]);
	});
	test("las vencidas reales tienen que coincidir con el bucket", () => {
		expect(
			proximosASubirBucket(
				[cuota("a", { cuotas_vencidas_reales: 1 })],
				CATALOGO,
			),
		).toEqual([]);
	});

	test("respeta la ventana en días", () => {
		expect(
			proximosASubirBucket([cuota("a", { dias_para_vencer: 8 })], CATALOGO),
		).toEqual([]);
		expect(
			proximosASubirBucket([cuota("a", { dias_para_vencer: 7 })], CATALOGO),
		).toHaveLength(1);
		expect(
			proximosASubirBucket([cuota("a", { dias_para_vencer: 0 })], CATALOGO),
		).toHaveLength(1);
		expect(
			proximosASubirBucket([cuota("a", { dias_para_vencer: 8 })], CATALOGO, 10),
		).toHaveLength(1);
	});

	test("un crédito con varias cuotas próximas sale una vez, con la más urgente", () => {
		const r = proximosASubirBucket(
			[
				cuota("a", { dias_para_vencer: 6, fecha_vencimiento: "2026-10-19" }),
				cuota("a", { dias_para_vencer: 2, fecha_vencimiento: "2026-10-15" }),
			],
			CATALOGO,
		);
		expect(r).toHaveLength(1);
		expect(r[0].diasParaVencer).toBe(2);
		expect(r[0].fechaVencimiento).toBe("2026-10-15");
	});
});

describe("conteoPorBucket", () => {
	test("cuenta por bucket actual y deja en 0 los que no tienen", () => {
		const items = proximosASubirBucket(
			[
				cuota("a", { bucket: 2 }),
				cuota("b", { bucket: 2 }),
				cuota("c", { bucket: 3, cuotas_vencidas_reales: 3 }),
			],
			CATALOGO,
		);
		expect(conteoPorBucket(items, [1, 2, 3, 4])).toEqual({
			1: 0,
			2: 2,
			3: 1,
			4: 0,
		});
	});
});

describe("catálogo con rangos configurables", () => {
	// B1 cubre 1 a 2 cuotas vencidas, B2 solo 3, B3 4, B4 de 5 en adelante.
	const ANCHO: BucketCatalogoLite[] = [
		{ numero: 0, cuotas_min: 0, cuotas_max: 0, estados_incluidos: [] },
		{ numero: 1, cuotas_min: 1, cuotas_max: 2, estados_incluidos: [] },
		{ numero: 2, cuotas_min: 3, cuotas_max: 3, estados_incluidos: [] },
		{ numero: 3, cuotas_min: 4, cuotas_max: 4, estados_incluidos: [] },
		{ numero: 4, cuotas_min: 5, cuotas_max: null, estados_incluidos: [] },
	];

	test("un B1 con una vencida no sube; uno con dos sí", () => {
		const r = proximosASubirBucket(
			[
				cuota("una", { bucket: 1, cuotas_vencidas_reales: 1 }),
				cuota("dos", { bucket: 1, cuotas_vencidas_reales: 2 }),
			],
			ANCHO,
		);
		expect(r.map((x) => [x.sifco, x.bucketActual, x.bucketSiguiente])).toEqual([
			["dos", 1, 2],
		]);
	});

	test("si el motor no coincide con las cuotas no se adivina", () => {
		expect(
			proximosASubirBucket(
				[cuota("a", { bucket: 2, cuotas_vencidas_reales: 2 })],
				ANCHO,
			),
		).toEqual([]);
	});

	test("bucketDeCuotas respeta rango, estado que clava y piso", () => {
		expect(bucketDeCuotas("MOROSO", 2, ANCHO)).toBe(1);
		expect(bucketDeCuotas("MOROSO", 9, ANCHO)).toBe(4);
		expect(bucketDeCuotas("EN_RECUPERACION", 1, CATALOGO)).toBe(4);
		expect(bucketDeCuotas("EN_RECUPERACION", 6, CATALOGO)).toBe(5);
		expect(bucketDeCuotas("INCOBRABLE", 0, CATALOGO)).toBe(5);
	});

	test("bucketsQueSuben va del B1 al penúltimo del catálogo", () => {
		expect(bucketsQueSuben(CATALOGO)).toEqual([1, 2, 3, 4]);
		expect(bucketsQueSuben(ANCHO)).toEqual([1, 2, 3]);
	});
});
