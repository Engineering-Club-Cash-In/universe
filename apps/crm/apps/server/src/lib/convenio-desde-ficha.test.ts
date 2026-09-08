import { describe, expect, it } from "bun:test";
import type { CarteraCuotaCredito } from "../types/cartera-back";
import {
	agruparCuotasParaConvenio,
	bucketPermiteConvenio,
	CONVENIO_MAX_MESES_DEFAULT,
	calcularTotalConvenio,
	elegiblesParaConvenio,
	leerMaxMesesConvenio,
	resolverPagoIdsDeCuotas,
} from "./convenio-desde-ficha";

function cuota(
	cuotaId: number,
	numero: number,
	pagoId?: number,
): CarteraCuotaCredito {
	return {
		cuota_id: cuotaId,
		credito_id: 1,
		numero_cuota: numero,
		fecha_vencimiento: `2026-0${numero}-08`,
		pagado: false,
		createdAt: "2026-01-01T00:00:00.000Z",
		pago_id: pagoId,
	};
}

describe("leerMaxMesesConvenio", () => {
	it("cae al default sin env o con basura", () => {
		expect(leerMaxMesesConvenio({})).toBe(CONVENIO_MAX_MESES_DEFAULT);
		expect(leerMaxMesesConvenio({ CONVENIO_MAX_MESES: "abc" })).toBe(6);
		expect(leerMaxMesesConvenio({ CONVENIO_MAX_MESES: "0" })).toBe(6);
		expect(leerMaxMesesConvenio({ CONVENIO_MAX_MESES: "99" })).toBe(6);
	});

	it("respeta un entero válido", () => {
		expect(leerMaxMesesConvenio({ CONVENIO_MAX_MESES: "12" })).toBe(12);
	});
});

describe("agruparCuotasParaConvenio", () => {
	it("junta todos los pago_id de una cuota y prioriza la lista de atrasadas", () => {
		const atrasadas = [cuota(10, 1, 100), cuota(10, 1, 101)];
		const pendientes = [cuota(10, 1, 101), cuota(11, 2, 102), cuota(12, 3)];
		const grupos = agruparCuotasParaConvenio(atrasadas, pendientes);
		expect(grupos.map((g) => g.cuotaId)).toEqual([10, 11, 12]);
		expect(grupos[0]).toMatchObject({ atrasada: true, pagoIds: [100, 101] });
		expect(grupos[1]).toMatchObject({ atrasada: false, pagoIds: [102] });
		expect(grupos[2].pagoIds).toEqual([]);
	});

	it("ordena por numero_cuota e ignora filas sin cuota_id", () => {
		const grupos = agruparCuotasParaConvenio(
			[cuota(20, 5, 200)],
			[cuota(0, 9, 1), cuota(19, 4, 190)],
		);
		expect(grupos.map((g) => g.numeroCuota)).toEqual([4, 5]);
	});
});

describe("elegiblesParaConvenio", () => {
	it("deja las vencidas y solo la primera cuota no vencida (la actual)", () => {
		const grupos = agruparCuotasParaConvenio(
			[cuota(10, 1, 100), cuota(11, 2, 101)],
			[cuota(12, 3, 102), cuota(13, 4, 103), cuota(14, 5, 104)],
		);
		expect(elegiblesParaConvenio(grupos).map((g) => g.numeroCuota)).toEqual([
			1, 2, 3,
		]);
	});

	it("sin cuotas vencidas deja solo la actual", () => {
		const grupos = agruparCuotasParaConvenio(
			[],
			[cuota(12, 3, 102), cuota(13, 4, 103)],
		);
		expect(elegiblesParaConvenio(grupos).map((g) => g.numeroCuota)).toEqual([
			3,
		]);
	});

	it("sin cuota futura deja solo las vencidas", () => {
		const grupos = agruparCuotasParaConvenio([cuota(10, 1, 100)], []);
		expect(elegiblesParaConvenio(grupos).map((g) => g.numeroCuota)).toEqual([
			1,
		]);
	});
});

describe("resolverPagoIdsDeCuotas", () => {
	const elegibles = agruparCuotasParaConvenio(
		[cuota(10, 1, 100), cuota(10, 1, 101)],
		[cuota(11, 2, 102), cuota(12, 3)],
	);

	it("devuelve los pago_ids de las cuotas elegidas, sin repetir", () => {
		const r = resolverPagoIdsDeCuotas(elegibles, [10, 11, 10]);
		expect(r).toEqual({
			pagoIds: [100, 101, 102],
			faltantes: [],
			sinRecibo: [],
		});
	});

	it("reporta cuotas que no son elegibles y cuotas sin recibo", () => {
		const r = resolverPagoIdsDeCuotas(elegibles, [11, 99, 12]);
		expect(r.pagoIds).toEqual([102]);
		expect(r.faltantes).toEqual([99]);
		expect(r.sinRecibo).toEqual([3]);
	});
});

describe("calcularTotalConvenio", () => {
	it("suma cuota × n + mora, a centavos", () => {
		expect(calcularTotalConvenio("2568.16", 2, "361.36")).toBe(5497.68);
		expect(calcularTotalConvenio(null, 3, undefined)).toBe(0);
	});
});

describe("bucketPermiteConvenio", () => {
	const catalogo = [
		{ numero: 0, estado_mora: "al_dia", orden: 0 },
		{ numero: 1, estado_mora: "mora_30", orden: 1 },
		{ numero: 2, estado_mora: "mora_60", orden: 2 },
		{ numero: 3, estado_mora: "mora_90", orden: 3 },
	];

	it("permite desde B2 en adelante y niega antes", () => {
		expect(bucketPermiteConvenio(1, catalogo).permitido).toBe(false);
		expect(bucketPermiteConvenio(2, catalogo).permitido).toBe(true);
		expect(bucketPermiteConvenio(3, catalogo).permitido).toBe(true);
		expect(bucketPermiteConvenio(2, catalogo).prefijoMinimo).toBe("B2");
	});

	it("niega sin bucket (fuera del funnel o sin traza)", () => {
		expect(bucketPermiteConvenio(null, catalogo).permitido).toBe(false);
		expect(bucketPermiteConvenio(undefined, catalogo).permitido).toBe(false);
	});

	it("sigue la key aunque el admin renumere el catálogo", () => {
		const renumerado = [
			{ numero: 5, estado_mora: "mora_30", orden: 1 },
			{ numero: 7, estado_mora: "mora_60", orden: 2 },
		];
		expect(bucketPermiteConvenio(5, renumerado).permitido).toBe(false);
		expect(bucketPermiteConvenio(7, renumerado).permitido).toBe(true);
		expect(bucketPermiteConvenio(7, renumerado).prefijoMinimo).toBe("B7");
	});

	it("cae al número 2 si el catálogo no trae la fila mínima", () => {
		expect(bucketPermiteConvenio(2, []).permitido).toBe(true);
		expect(bucketPermiteConvenio(1, []).permitido).toBe(false);
	});
});
