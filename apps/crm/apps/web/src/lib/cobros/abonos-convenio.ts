import { hoyEnGuatemala } from "@/lib/date-utils";

/**
 * W4 (#1873) · Pagos de hoy que pueden entrar como abono inicial del convenio
 * (`abonoInicialPagoId` de `crearConvenioDesdeFicha`). Misma regla que el
 * convenio del Workspace (`gestion-panel.tsx`); aquí exportada para que la
 * Ficha 360 ofrezca el mismo «Abono de hoy».
 */

/** Un pago del día que puede descontarse del convenio. Igual a `AbonoConvenio`. */
export interface AbonoDeHoy {
	pagoId: number;
	/** Monto del pago (el de la boleta), para mostrarlo. */
	monto: number;
	/** Lo que el pago aplicó a cada cuota (por `cuotaId`). */
	aplicadoPorCuota: Record<number, number>;
}

/** Lo mínimo de una cuota de `getHistorialPagos` que hace falta aquí. */
export interface CuotaConPagos {
	id?: string | number | null;
	pagos?: Array<{
		pagoId?: number;
		montoBoleta?: string | number | null;
		montoAplicado?: string | number | null;
		fechaPago?: string | null;
		validationStatus?: string | null;
	}> | null;
}

/** Solo lo que contabilidad ya validó. */
const VALIDACION_ABONO = ["validated", "capital_validated"];

/**
 * Pagos de hoy (día de Guatemala) ya validados. Un pago repartido en varias
 * cuotas aparece una vez; `aplicadoPorCuota` guarda cuánto cayó en cada una,
 * porque solo eso baja el total de las cuotas elegidas (la parte que fue a
 * mora ya está en la mora vigente).
 */
export function abonosDeHoy(
	plan: CuotaConPagos[],
	hoy: string = hoyEnGuatemala(),
): AbonoDeHoy[] {
	const porId = new Map<number, AbonoDeHoy>();
	for (const cuota of plan) {
		const cuotaId = Number(cuota.id);
		for (const p of cuota.pagos ?? []) {
			if (p.pagoId === undefined) continue;
			if (!VALIDACION_ABONO.includes(p.validationStatus ?? "")) continue;
			// `fecha_pago` ya viene en hora de Guatemala (sin zona): el día es la
			// parte de la fecha, sin convertirla otra vez (igual que cartera).
			if (!p.fechaPago || p.fechaPago.slice(0, 10) !== hoy) continue;
			const aplicado = Number(p.montoAplicado ?? 0);
			const boleta = Number(p.montoBoleta ?? 0);
			const monto = boleta > 0 ? boleta : aplicado;
			if (!(monto > 0)) continue;
			const abono = porId.get(p.pagoId) ?? {
				pagoId: p.pagoId,
				monto,
				aplicadoPorCuota: {},
			};
			if (aplicado > 0 && Number.isFinite(cuotaId)) {
				abono.aplicadoPorCuota[cuotaId] =
					(abono.aplicadoPorCuota[cuotaId] ?? 0) + aplicado;
			}
			porId.set(p.pagoId, abono);
		}
	}
	return [...porId.values()];
}
