/**
 * Motor de escenarios "qué pasaría si" para los reportes.
 *
 * Funciones puras que toman los datos reales de un reporte + supuestos y
 * devuelven una versión simulada del mismo tipo. Todo el cálculo ocurre en el
 * cliente sobre los agregados que el reporte ya cargó, por lo que los
 * resultados son ESTIMACIONES y no modifican datos reales.
 */
import {
	calculateMonthlyPayment,
	IVA_FACTOR,
} from "@/utils/quoter-calculations";

export type LeverKey = "colocacion" | "mora" | "efectividad" | "metodo";

export interface ScenarioParams {
	/** % extra de colocación (0 = sin cambio). */
	colocacionDeltaPct: number;
	/** Reduce la mora en X% (0 = sin cambio). */
	moraReduccionPct: number;
	/** Cierra la brecha cobrado vs esperado en X% (0 = sin cambio). */
	efectividadDeltaPct: number;
	/** Plazo promedio (meses) para la cuota ilustrativa. */
	metodoPlazoMeses: number;
	/** Tasa mensual (%) para la cuota ilustrativa. */
	metodoTasaMensual: number;
	/** Capital del crédito promedio para la cuota ilustrativa. */
	metodoCapital: number;
}

export const DEFAULT_SCENARIO_PARAMS: ScenarioParams = {
	colocacionDeltaPct: 0,
	moraReduccionPct: 0,
	efectividadDeltaPct: 0,
	metodoPlazoMeses: 12,
	metodoTasaMensual: 1.78,
	metodoCapital: 50000,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convierte string|null a número seguro. */
function num(value: string | number | null | undefined): number {
	const x = Number(value);
	return Number.isFinite(x) ? x : 0;
}

/** Número a string con 2 decimales (formato de los reportes). */
function money(value: number): string {
	return value.toFixed(2);
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

const colocacionFactor = (p: ScenarioParams) =>
	1 + Math.max(0, p.colocacionDeltaPct) / 100;
/** Reducción de mora acotada a [0, 100]% → factor en [0, 1]. */
const moraFactor = (p: ScenarioParams) => 1 - clamp01(p.moraReduccionPct / 100);
/** Fracción de la brecha cobrado→esperado que se cierra (efectividad + mora).
 *  Cada palanca se acota individualmente a [0,1] antes de sumar para evitar
 *  que valores negativos en una cancelen una reducción válida en la otra. */
const gapClose = (p: ScenarioParams) =>
	clamp01(
		clamp01(p.efectividadDeltaPct / 100) + clamp01(p.moraReduccionPct / 100),
	);

// ---------------------------------------------------------------------------
// Tipos de fila de cada reporte (estructuralmente iguales a los de la ruta)
// ---------------------------------------------------------------------------

export type MontoACobrarRow = {
	bucket: string;
	cuotas_count: number;
	total_cuota: string;
	total_interes: string;
	total_iva: string;
	total_seguro: string;
	total_gps: string;
	total_membresias: string;
	total_mora: string;
};

export type MontoACobrarPeriodoRow = {
	bucket: string;
	cuotas_count: number;
	total_cuota: string;
	total_interes: string;
	total_iva: string;
	total_seguro: string;
	total_gps: string;
	total_membresias: string;
	total_mora: string;
	mora_count: number;
	total_credits: number;
	credits_con_mora: number;
	acum_total_cuota: string;
	acum_total_interes: string;
	acum_total_iva: string;
	acum_total_seguro: string;
	acum_total_gps: string;
	acum_total_membresias: string;
	total_interes_inversionista: string;
	acum_total_interes_inversionista: string;
	total_interes_inversionista_pagos: string;
	acum_total_interes_inversionista_pagos: string;
};

export type FacturacionMesRubro = {
	interes: string;
	membresias: string;
	seguro_gps: string;
	royalti: string;
	mora: string;
	otros: string;
};

export type FacturacionMesResponse = {
	cobrado: FacturacionMesRubro;
	esperado: { meta_mensual: string };
};

export type FlujoCuotasRubro = {
	capital: string;
	interes: string;
	iva: string;
};
export type FlujoCuotasInversionesResponse = {
	reinversionPorTipo: (FlujoCuotasRubro & {
		tipo: string;
		monto_reinvertido?: string;
	})[];
	cashParcialPorTipo: (FlujoCuotasRubro & {
		tipo: string;
		monto_cash?: string;
	})[];
	sinReinversion: {
		totales: FlujoCuotasRubro;
		porInversionista: (FlujoCuotasRubro & {
			inversionista_id: number;
			nombre: string;
		})[];
	};
	pagosExtras: { abonos_capital: string; cancelaciones: string };
};

export type ReinversionLiquidacionesResponse = {
	/**
	 * Por modalidad (`tipo_reinversion`), campos crudos de la liquidación:
	 * - `reinversion_total` → sección "Cuotas → Reinversión".
	 * - `total_capital` / `total_interes` / `total_iva` / `total_isr` / `total_cuota`
	 *   → sección "Cuotas → A Recibir".
	 */
	porTipo: Record<
		string,
		{
			reinversion_capital: string;
			reinversion_interes: string;
			reinversion_total: string;
			total_capital: string;
			total_interes: string;
			total_iva: string;
			total_isr: string;
			total_cuota: string;
		}
	>;
	/**
	 * Interés neto agrupado por si el inversionista emite factura:
	 * - `conFactura`: neto = interés + IVA.
	 * - `sinFactura`: neto = interés − ISR.
	 */
	interesNeto: {
		conFactura: { interes: string; iva: string; neto: string };
		sinFactura: { interes: string; isr: string; neto: string };
		cube: { interes: string; iva: string; neto: string };
	};
	/** Pagos extras recibidos del mes (vía liquidación → pago espejo → abono). */
	pagosExtras: { abonos_capital: string; cancelaciones: string };
	/** Desglose por inversionista (desde liquidaciones): reinversión y a recibir. */
	porInversionista: {
		inversionista_id: number;
		nombre: string;
		tipo_reinversion: string;
		reinversion_capital: string;
		reinversion_interes: string;
		reinversion: string;
		a_recibir: string;
		monto_aportado: string;
	}[];
	/** Compras del mes (operación de compra) agrupadas por modalidad de reinversión. */
	comprasMes: { tipo: string; cantidad: number; monto: string }[];
	cantidad_liquidaciones: number;
};

export type PuntoEquilibrioRow = {
	bucket: string;
	cantidad_creditos: number;
	colocado: string;
	meta: string;
	cobertura: string | null;
	faltante: string | null;
};

export type ComparativoHistoricoRow = {
	mes: number;
	colocacion_monto: string | null;
	colocacion_creditos: number | null;
	facturacion: string | null;
	cartera_activa: string | null;
	creditos_activos: number | null;
	mora_30: string | null;
	mora_60: string | null;
	mora_90: string | null;
	mora_120: string | null;
	creditos_30: number | null;
	creditos_60: number | null;
	creditos_90: number | null;
	creditos_120: number | null;
};

// ---------------------------------------------------------------------------
// Transformaciones por reporte
// ---------------------------------------------------------------------------

/**
 * Monto a Cobrar: colocación escala los rubros (más cartera ≈ más cuotas),
 * la mora reduce el promedio de mora por bucket.
 */
export function transformMontoACobrar(
	rows: MontoACobrarRow[],
	p: ScenarioParams,
): MontoACobrarRow[] {
	const col = colocacionFactor(p);
	const mora = moraFactor(p);
	return rows.map((r) => ({
		...r,
		cuotas_count: Math.round(r.cuotas_count * col),
		total_cuota: money(num(r.total_cuota) * col),
		total_interes: money(num(r.total_interes) * col),
		total_iva: money(num(r.total_iva) * col),
		total_seguro: money(num(r.total_seguro) * col),
		total_gps: money(num(r.total_gps) * col),
		total_membresias: money(num(r.total_membresias) * col),
		total_mora: money(num(r.total_mora) * mora),
	}));
}

/**
 * Facturado vs Esperado: efectividad y mora cierran la brecha entre lo
 * cobrado y lo esperado por rubro. Lo esperado no cambia.
 */
export function transformFacturacion(
	data: FacturacionMesResponse,
	p: ScenarioParams,
): FacturacionMesResponse {
	const close = gapClose(p);
	// mora se excluye del upscale proporcional: menos morosidad → menos ingreso
	// por mora, por lo que sigue moraFactor (dirección opuesta a los otros rubros).
	const rubros: (keyof FacturacionMesRubro)[] = [
		"interes",
		"membresias",
		"seguro_gps",
		"royalti",
		"otros",
	];
	const totalCobrado =
		rubros.reduce((acc, k) => acc + num(data.cobrado[k]), 0) +
		num(data.cobrado.mora);
	const totalEsperado = num(data.esperado.meta_mensual);
	const gap = totalEsperado - totalCobrado;
	const cobrado = { ...data.cobrado };
	// mora siempre baja con moraFactor, independientemente del gap
	cobrado.mora = money(num(data.cobrado.mora) * moraFactor(p));
	if (gap <= 0 || totalCobrado === 0) {
		return { cobrado, esperado: data.esperado };
	}
	// Distribuir el cierre de brecha proporcionalmente entre los rubros de ingreso
	const factor = 1 + (gap * close) / totalCobrado;
	for (const k of rubros) {
		cobrado[k] = money(num(data.cobrado[k]) * factor);
	}
	return { cobrado, esperado: data.esperado };
}

/** Flujo de Cuotas de Inversiones: la colocación escala todos los flujos. */
export function transformFlujoCuotas(
	data: FlujoCuotasInversionesResponse,
	p: ScenarioParams,
): FlujoCuotasInversionesResponse {
	const col = colocacionFactor(p);
	const scaleRubro = <T extends FlujoCuotasRubro>(r: T): T => ({
		...r,
		capital: money(num(r.capital) * col),
		interes: money(num(r.interes) * col),
		iva: money(num(r.iva) * col),
	});
	return {
		reinversionPorTipo: data.reinversionPorTipo.map((r) => ({
			...scaleRubro(r),
			monto_reinvertido:
				r.monto_reinvertido != null
					? money(num(r.monto_reinvertido) * col)
					: r.monto_reinvertido,
		})),
		cashParcialPorTipo: data.cashParcialPorTipo.map((r) => ({
			...scaleRubro(r),
			monto_cash:
				r.monto_cash != null ? money(num(r.monto_cash) * col) : r.monto_cash,
		})),
		sinReinversion: {
			totales: scaleRubro(data.sinReinversion.totales),
			porInversionista: data.sinReinversion.porInversionista.map(scaleRubro),
		},
		pagosExtras: {
			abonos_capital: money(num(data.pagosExtras.abonos_capital) * col),
			cancelaciones: money(num(data.pagosExtras.cancelaciones) * col),
		},
	};
}

/**
 * Cobertura vs Meta: la colocación escala lo colocado; cobertura y faltante
 * se recalculan con la misma fórmula del backend.
 */
export function transformCobertura(
	rows: PuntoEquilibrioRow[],
	p: ScenarioParams,
): PuntoEquilibrioRow[] {
	const col = colocacionFactor(p);
	return rows.map((r) => {
		const colocado = num(r.colocado) * col;
		const meta = num(r.meta);
		return {
			...r,
			cantidad_creditos: Math.round(r.cantidad_creditos * col),
			colocado: money(colocado),
			cobertura: meta > 0 ? ((colocado / meta) * 100).toFixed(1) : null,
			faltante: meta > 0 ? money(Math.max(0, meta - colocado)) : null,
		};
	});
}

/**
 * Comparativo Histórico: colocación escala colocación/cartera, efectividad
 * sube la facturación y la mora reduce los buckets de mora.
 */
export function transformComparativo(
	rows: ComparativoHistoricoRow[],
	p: ScenarioParams,
): ComparativoHistoricoRow[] {
	const col = colocacionFactor(p);
	const mora = moraFactor(p);
	// Acotado a ≥0: "subir efectividad" nunca debe reducir la facturación.
	const fact = 1 + Math.max(0, p.efectividadDeltaPct) / 100;
	const scale = (v: string | null, f: number) =>
		v == null ? null : money(num(v) * f);
	const scaleN = (v: number | null, f: number) =>
		v == null ? null : Math.round(v * f);
	return rows.map((r) => ({
		...r,
		colocacion_monto: scale(r.colocacion_monto, col),
		colocacion_creditos: scaleN(r.colocacion_creditos, col),
		cartera_activa: scale(r.cartera_activa, col),
		creditos_activos: scaleN(r.creditos_activos, col),
		facturacion: scale(r.facturacion, fact),
		mora_30: scale(r.mora_30, mora),
		mora_60: scale(r.mora_60, mora),
		mora_90: scale(r.mora_90, mora),
		mora_120: scale(r.mora_120, mora),
		creditos_30: scaleN(r.creditos_30, mora),
		creditos_60: scaleN(r.creditos_60, mora),
		creditos_90: scaleN(r.creditos_90, mora),
		creditos_120: scaleN(r.creditos_120, mora),
	}));
}

// ---------------------------------------------------------------------------
// Cuota ilustrativa por método de amortización
// ---------------------------------------------------------------------------

export interface CuotaIlustrativa {
	frances: number;
	fija: number;
}

/**
 * Cuota mensual de un crédito promedio según método. Francés = cuota nivelada
 * (reusa calculateMonthlyPayment). Fija = capital/plazo + interés sobre saldo
 * (primera cuota, la más alta). Ambas con IVA sobre el interés.
 */
export function cuotaIlustrativa(p: ScenarioParams): CuotaIlustrativa {
	const capital = p.metodoCapital;
	const plazo = p.metodoPlazoMeses > 0 ? p.metodoPlazoMeses : 1;
	const frances = calculateMonthlyPayment(
		capital,
		p.metodoTasaMensual,
		plazo,
		0,
		0,
	);
	const r = (p.metodoTasaMensual / 100) * IVA_FACTOR;
	const fija = Math.round((capital / plazo + capital * r) * 100) / 100;
	return { frances, fija };
}
