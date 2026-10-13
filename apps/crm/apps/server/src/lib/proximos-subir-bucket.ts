/**
 * «Próximos a subir de bucket» de un asesor (tarea M2 de
 * docs/features/cobros-02/18-equipo-solicitudes-backend.md). Es el mismo criterio
 * de «Listos para Prejurídico» (lib/prejuridico.ts, que es el caso B3 → B4)
 * generalizado a los buckets con mora.
 *
 * Un crédito está a punto de subir cuando:
 *  · sigue en el funnel (ACTIVO, MOROSO o EN_RECUPERACION);
 *  · su siguiente cuota sin pagar vence en `DIAS_VENTANA_SUBIR_BUCKET` días o
 *    menos: si no se paga, el crédito suma una cuota vencida;
 *  · con esa cuota más, el catálogo de buckets lo pone en OTRO bucket. Los
 *    rangos (`cuotas_min`/`cuotas_max`), los estados que clavan un bucket y
 *    los pisos por estado salen del catálogo, no de que «bucket = cuotas»:
 *    con un B1 de 1 a 2 cuotas, un B1 con una vencida no sube y uno con dos sí;
 *  · no tiene una promesa de pago vigente (la promesa congela la cuota).
 *
 * Decisión 2026-10-12, docs/features/cobros-02/24-plan-backend-equipo-solicitudes.md.
 */

export const DIAS_VENTANA_SUBIR_BUCKET = 7;

/** Fila del catálogo de buckets (`GET /config/buckets`) que usa la derivación. */
export interface BucketCatalogoLite {
	numero: number;
	cuotas_min: number;
	cuotas_max: number | null;
	/** Estados que CLAVAN el bucket (p. ej. INCOBRABLE → B5). */
	estados_incluidos: readonly string[];
	/** Estados para los que este bucket es el MÍNIMO (p. ej. EN_RECUPERACION → B4). */
	estados_piso?: readonly string[];
}

/**
 * Bucket de un crédito con `cuotas` vencidas, igual que `bucketDeCredito` de
 * cartera (lib/buckets-classification.ts): primero el estado que clava, luego
 * el rango y al final el piso por estado. `null` si el catálogo no lo cubre.
 */
export function bucketDeCuotas(
	status: string,
	cuotas: number,
	catalogo: readonly BucketCatalogoLite[],
): number | null {
	const clavado = catalogo.find((b) => b.estados_incluidos.includes(status));
	if (clavado) return clavado.numero;
	const n = Math.max(cuotas, 0);
	const porRango = catalogo.find(
		(b) => n >= b.cuotas_min && (b.cuotas_max == null || n <= b.cuotas_max),
	);
	if (!porRango) return null;
	const piso = catalogo.find((b) => b.estados_piso?.includes(status));
	return Math.max(porRango.numero, piso ? piso.numero : -1);
}

/**
 * Buckets desde los que un crédito puede subir según el catálogo: del B1 al
 * penúltimo (B0 es premora y el último no sube más).
 */
export function bucketsQueSuben(
	catalogo: readonly BucketCatalogoLite[],
): number[] {
	const numeros = catalogo.map((b) => b.numero).sort((a, b) => a - b);
	const ultimo = numeros[numeros.length - 1];
	return numeros.filter((n) => n >= 1 && n < ultimo);
}

// EN_RECUPERACION cuenta: un B4 con cuatro cuotas vencidas de verdad sube a B5
// con la quinta aunque el vehículo ya esté en recuperación. Los que el motor
// forzó a B4 sin tener cuatro vencidas los descarta la coincidencia de abajo.
const ESTADOS_FUNNEL = ["ACTIVO", "MOROSO", "EN_RECUPERACION"] as const;

export interface CuotaProximaParaSubir {
	numero_credito_sifco: string;
	credito_id: number;
	cliente: string;
	status_credit: string;
	bucket: number | null;
	cuotas_vencidas_reales: number;
	dias_para_vencer: number;
	fecha_vencimiento: string;
	monto_cuota: string;
	monto_mora: string;
}

export interface CreditoProximoASubir {
	sifco: string;
	creditoId: number;
	cliente: string;
	bucketActual: number;
	bucketSiguiente: number;
	diasParaVencer: number;
	/** YYYY-MM-DD de la cuota que lo haría subir. */
	fechaVencimiento: string;
	montoCuota: number;
	montoMora: number;
}

const monto = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * Créditos a punto de subir según las cuotas próximas de cartera. Una fila por
 * crédito (la cuota que vence primero), de la más urgente a la menos.
 */
export function proximosASubirBucket(
	cuotas: readonly CuotaProximaParaSubir[],
	catalogo: readonly BucketCatalogoLite[],
	ventanaDias: number = DIAS_VENTANA_SUBIR_BUCKET,
): CreditoProximoASubir[] {
	const porSifco = new Map<
		string,
		{ c: CuotaProximaParaSubir; actual: number; siguiente: number }
	>();
	for (const c of cuotas) {
		if (!(ESTADOS_FUNNEL as readonly string[]).includes(c.status_credit))
			continue;
		if (c.dias_para_vencer < 0 || c.dias_para_vencer > ventanaDias) continue;
		const actual = bucketDeCuotas(
			c.status_credit,
			c.cuotas_vencidas_reales,
			catalogo,
		);
		const siguiente = bucketDeCuotas(
			c.status_credit,
			c.cuotas_vencidas_reales + 1,
			catalogo,
		);
		if (actual == null || siguiente == null) continue;
		// B0 es premora; y si con una cuota más sigue en el mismo bucket no sube.
		if (actual < 1 || siguiente <= actual) continue;
		// Si el motor aún no se actualizó (su bucket no es el que dan las cuotas),
		// no se adivina.
		if (c.bucket !== actual) continue;
		const previa = porSifco.get(c.numero_credito_sifco);
		if (!previa || c.dias_para_vencer < previa.c.dias_para_vencer) {
			porSifco.set(c.numero_credito_sifco, { c, actual, siguiente });
		}
	}
	return [...porSifco.values()]
		.map(({ c, actual, siguiente }) => ({
			sifco: c.numero_credito_sifco,
			creditoId: c.credito_id,
			cliente: c.cliente,
			bucketActual: actual,
			bucketSiguiente: siguiente,
			diasParaVencer: c.dias_para_vencer,
			fechaVencimiento: c.fecha_vencimiento,
			montoCuota: monto(c.monto_cuota),
			montoMora: monto(c.monto_mora),
		}))
		.sort(
			(a, b) =>
				a.diasParaVencer - b.diasParaVencer ||
				b.bucketActual - a.bucketActual ||
				a.sifco.localeCompare(b.sifco),
		);
}

/** Cuántos suben a cada bucket siguiente (clave = bucket actual). */
export function conteoPorBucket(
	items: readonly CreditoProximoASubir[],
	buckets: readonly number[],
): Record<number, number> {
	const conteo: Record<number, number> = {};
	for (const b of buckets) conteo[b] = 0;
	for (const i of items)
		conteo[i.bucketActual] = (conteo[i.bucketActual] ?? 0) + 1;
	return conteo;
}
