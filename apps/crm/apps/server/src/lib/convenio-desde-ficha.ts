// CB-032 — Convenio de pago desde la Ficha 360. Helpers PUROS (sin DB, sin
// cliente HTTP) para que el procedure `crearConvenioDesdeFicha` quede corto y
// esto se pueda testear solo.
//
// El convenio lo crea cartera-back (`POST /payment-agreements`, el mismo
// endpoint que usa carteraFront). Cartera no recibe cuota_ids sino los
// `pago_id` de los recibos pre-sembrados de cada cuota — acá se reproduce el
// agrupado que carteraFront hace en el navegador (paymentAgreement.tsx,
// `cuotasParaConvenio`), pero del lado del server, sobre la data real de
// `/credito`, para que el front del CRM solo mande "estas cuotas".

import type { CarteraCuotaCredito } from "../types/cartera-back";

/** Tope de meses por defecto (CB-032: "máximo 6, parametrizable"). */
export const CONVENIO_MAX_MESES_DEFAULT = 6;

/**
 * Tope de meses del convenio. Env `CONVENIO_MAX_MESES` (entero 1..60) manda;
 * cualquier otra cosa cae al default. Se lee en cada llamada — es un valor
 * de configuración, no vale la pena cachearlo.
 */
export function leerMaxMesesConvenio(
	env: Record<string, string | undefined> = process.env,
): number {
	const crudo = env.CONVENIO_MAX_MESES;
	if (!crudo) return CONVENIO_MAX_MESES_DEFAULT;
	const n = Number.parseInt(crudo, 10);
	if (!Number.isInteger(n) || n < 1 || n > 60)
		return CONVENIO_MAX_MESES_DEFAULT;
	return n;
}

/**
 * `estado_mora` del bucket mínimo desde el cual se permite un convenio
 * (CB-032: "a partir de B2"). Es la KEY estable del catálogo, no el número:
 * `cartera.buckets.numero` es config y un admin puede reasignarlo (misma
 * lección que esBucketB2 en el web).
 */
export const CONVENIO_BUCKET_MINIMO_KEY = "mora_60";

export interface CuotaParaConvenio {
	cuotaId: number;
	numeroCuota: number;
	fechaVencimiento: string;
	/** true si vino en `cuotasAtrasadas` (ya vencida). */
	atrasada: boolean;
	/** Recibos (pagos_credito) de la cuota; es lo que cartera espera. */
	pagoIds: number[];
}

/**
 * Agrupa las cuotas elegibles para convenio por `cuota_id`, juntando TODOS
 * los `pago_id` de cada una. Calca `cuotasParaConvenio` de carteraFront:
 * atrasadas primero (ganan sobre pendientes si la misma cuota viene en las
 * dos listas), sin cuotas sin id, sin pago_ids repetidos, ordenadas por
 * numero_cuota.
 *
 * NO filtra recibos pre-sembrados (monto 0): justamente esos son los que el
 * convenio necesita — el recibo abierto de la cuota es la fila que cartera
 * suma y asocia al convenio.
 */
export function agruparCuotasParaConvenio(
	cuotasAtrasadas: CarteraCuotaCredito[] | undefined,
	cuotasPendientes: CarteraCuotaCredito[] | undefined,
): CuotaParaConvenio[] {
	const porCuota = new Map<number, CuotaParaConvenio>();
	const filas: Array<{ fila: CarteraCuotaCredito; atrasada: boolean }> = [
		...(cuotasAtrasadas ?? []).map((fila) => ({ fila, atrasada: true })),
		...(cuotasPendientes ?? []).map((fila) => ({ fila, atrasada: false })),
	];
	for (const { fila, atrasada } of filas) {
		const cuotaId = fila.cuota_id;
		if (!cuotaId) continue;
		const existente = porCuota.get(cuotaId);
		if (existente) {
			if (fila.pago_id && !existente.pagoIds.includes(fila.pago_id)) {
				existente.pagoIds.push(fila.pago_id);
			}
			continue;
		}
		porCuota.set(cuotaId, {
			cuotaId,
			numeroCuota: fila.numero_cuota,
			fechaVencimiento: fila.fecha_vencimiento,
			atrasada,
			pagoIds: fila.pago_id ? [fila.pago_id] : [],
		});
	}
	return [...porCuota.values()].sort((a, b) => a.numeroCuota - b.numeroCuota);
}

/**
 * Regla de negocio (Daniel, CB-032): al convenio entran SOLO las cuotas
 * VENCIDAS y la cuota ACTUAL (la primera que aún no venció, la del ciclo en
 * curso). Cuotas futuras no — un convenio reestructura deuda exigible, no
 * adelanta el calendario. Sobre la lista ya agrupada: todas las `atrasada` +
 * la no-atrasada de menor numero_cuota, si existe.
 */
export function elegiblesParaConvenio(
	grupos: CuotaParaConvenio[],
): CuotaParaConvenio[] {
	const vencidas = grupos.filter((g) => g.atrasada);
	const actual = grupos
		.filter((g) => !g.atrasada)
		.sort((a, b) => a.numeroCuota - b.numeroCuota)[0];
	return actual ? [...vencidas, actual] : vencidas;
}

/**
 * Traduce las cuotas que eligió el asesor a los `pago_id` que cartera espera.
 * `faltantes` = cuota_ids que no están entre las elegibles (ya se pagó, está
 * en validación, o el id es de otro crédito); `sinRecibo` = elegibles pero
 * sin ningún pago_id (cartera no podría sumarlas). El caller rechaza si hay
 * cualquiera de los dos — mandar a cartera una lista parcial crearía un
 * convenio por menos cuotas de las que el asesor cree que acordó.
 */
export function resolverPagoIdsDeCuotas(
	elegibles: CuotaParaConvenio[],
	cuotaIds: number[],
): { pagoIds: number[]; faltantes: number[]; sinRecibo: number[] } {
	const porId = new Map(elegibles.map((c) => [c.cuotaId, c]));
	const pagoIds: number[] = [];
	const faltantes: number[] = [];
	const sinRecibo: number[] = [];
	for (const cuotaId of [...new Set(cuotaIds)]) {
		const cuota = porId.get(cuotaId);
		if (!cuota) {
			faltantes.push(cuotaId);
			continue;
		}
		if (cuota.pagoIds.length === 0) {
			sinRecibo.push(cuota.numeroCuota);
			continue;
		}
		for (const pagoId of cuota.pagoIds) {
			if (!pagoIds.includes(pagoId)) pagoIds.push(pagoId);
		}
	}
	return { pagoIds, faltantes, sinRecibo };
}

/**
 * ¿El bucket actual del crédito permite convenio? Regla CB-032: a partir de
 * B2. Compara por `orden` del catálogo (no por número literal) contra la fila
 * cuyo `estado_mora` es la key mínima. Si el catálogo no trae esa fila, cae al
 * número 2 (semilla). `bucket === null` (fuera del funnel o sin traza) → no.
 */
export function bucketPermiteConvenio(
	bucket: number | null | undefined,
	catalogo: Array<{
		numero: number;
		estado_mora: string | null;
		orden: number;
	}>,
	keyMinima: string = CONVENIO_BUCKET_MINIMO_KEY,
): { permitido: boolean; prefijoMinimo: string } {
	const filaMinima = catalogo.find((b) => b.estado_mora === keyMinima);
	const prefijoMinimo = filaMinima ? `B${filaMinima.numero}` : "B2";
	if (bucket === null || bucket === undefined) {
		return { permitido: false, prefijoMinimo };
	}
	if (!filaMinima) {
		return { permitido: bucket >= 2, prefijoMinimo };
	}
	const filaActual = catalogo.find((b) => b.numero === bucket);
	if (!filaActual) {
		return { permitido: bucket >= filaMinima.numero, prefijoMinimo };
	}
	return { permitido: filaActual.orden >= filaMinima.orden, prefijoMinimo };
}
