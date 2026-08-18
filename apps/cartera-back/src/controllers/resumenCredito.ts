/**
 * Resumen liviano de un crédito.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE, HABIENDO YA UN `/credito`
 *
 * `getCreditoByNumero` es el detalle completo que consume la pantalla de cobros
 * del CRM: 14 consultas y ~121 KB de respuesta para un crédito de 89 cuotas,
 * porque devuelve el calendario entero con el desglose de cada pago.
 *
 * El bot de WhatsApp necesita **siete datos** para armar el menú del crédito.
 * Pedirle 121 KB a la base para mandarle 300 bytes al cliente no tiene sentido,
 * y el bot corre sobre un chat donde la latencia se siente.
 *
 * Se hizo endpoint aparte y no un parámetro de `/credito` a propósito: ese
 * controlador tiene 473 líneas y lo usa la pantalla que cobranza ocupa todos
 * los días. Un archivo nuevo no puede romperlo.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Contrato y consumidor: docs/features/bot-whatsapp-cobros/02-menu-del-credito.md
 */

import Big from "big.js";
import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "../database/index";
import {
	aseguradoras,
	convenios_pago,
	creditos,
	cuotas_credito,
	moras_credito,
	pagos_credito,
	SQL_CARTERA_SCHEMA,
} from "../database/db/schema";
import { hoyGtISO } from "../lib/buckets-classification";

export type ResumenCredito = {
	numero_credito_sifco: string;
	credito_id: number;
	status_credito: string;
	/** Capital original del crédito, tal como se otorgó. */
	capital: string;
	/**
	 * Lo que queda de capital: `capital - SUM(abono_capital)` sobre los pagos
	 * pagados. Es la MISMA definición que usa `assignCapital`; no se inventó acá.
	 *
	 * Se calcula sobre `pagos_credito` y no sobre las cuotas a propósito: hay
	 * 441 pagos pagados sin `cuota_id` (414 con abono a capital) y sumarlos por
	 * cuota los dejaría fuera. En el sandbox eso desviaba 24 créditos, uno de
	 * ellos por Q309,485 — le diríamos al cliente que debe de más.
	 */
	capital_activo: string;
	cuota_mensual: string;
	plazo: number;
	cuotas_atrasadas: number;
	cuotas_pagadas: number;
	/**
	 * La cuota que le toca pagar: la más vieja sin pagar. Si está atrasado, su
	 * `fecha_vencimiento` ya pasó — es a propósito, es la que debe.
	 */
	cuota_actual: {
		numero: number;
		de: number;
		fecha_vencimiento: string;
		/** true = ya venció y sigue sin pagarse. */
		vencida: boolean;
	} | null;
	/**
	 * Vencimiento de la próxima cuota **que todavía no vence**.
	 *
	 * Va aparte de `cuota_actual` porque no son lo mismo cuando hay atraso: a un
	 * cliente con tres cuotas vencidas, decirle que su "próxima fecha de pago"
	 * fue en junio no le sirve de nada. `null` si no queda ninguna futura.
	 */
	proxima_fecha_pago: string | null;
	mora: {
		monto: string;
		porcentaje: string;
		cuotas_atrasadas: number;
	} | null;
	convenio: {
		monto_total: string;
		monto_pagado: string;
		monto_pendiente: string;
		cuota_mensual: string;
		numero_meses: number;
		pagos_realizados: number;
		pagos_pendientes: number;
		fecha_convenio: string | null;
	} | null;
	/** Del catálogo `aseguradoras`; hoy solo existe el nombre. */
	aseguradora: string | null;
	numero_poliza: string | null;
};

export type ResultadoResumen =
	| { encontrado: true; resumen: ResumenCredito }
	| { encontrado: false };

/**
 * Cuotas atrasadas: vencidas, sin pagar y sin un pago esperando validación.
 *
 * Es la misma regla de `getCreditoByNumero`. Un pago subido y pendiente de
 * revisión NO cuenta como atraso: el cliente ya pagó, falta que cobranza lo
 * valide, y decirle "estás atrasado" sería mentirle.
 */
const SIN_PAGO_EN_REVISION = sql`NOT EXISTS (
	SELECT 1 FROM ${SQL_CARTERA_SCHEMA}.pagos_credito p_pending
	WHERE p_pending.cuota_id = ${cuotas_credito.cuota_id}
	  AND p_pending.validation_status = 'pending'
	  AND p_pending.pagado = true
)`;

export async function obtenerResumenCredito(
	numeroCreditoSifco: string,
): Promise<ResultadoResumen> {
	const hoy = hoyGtISO();

	const [credito] = await db
		.select({
			credito_id: creditos.credito_id,
			numero_credito_sifco: creditos.numero_credito_sifco,
			capital: creditos.capital,
			cuota: creditos.cuota,
			plazo: creditos.plazo,
			statusCredit: creditos.statusCredit,
			no_poliza: creditos.no_poliza,
			aseguradora_id: creditos.aseguradora_id,
		})
		.from(creditos)
		.where(eq(creditos.numero_credito_sifco, numeroCreditoSifco))
		.limit(1);

	if (!credito) return { encontrado: false };

	const creditoId = credito.credito_id;

	// Todo lo que sigue es independiente entre sí: va en paralelo para no pagar
	// la latencia de cada consulta una detrás de otra.
	const [abonos, conteos, pendientes, mora, convenio, aseguradora] =
		await Promise.all([
			db
				.select({
					total: sql<string>`COALESCE(SUM(${pagos_credito.abono_capital}), 0)`,
				})
				.from(pagos_credito)
				.where(
					and(
						eq(pagos_credito.credito_id, creditoId),
						eq(pagos_credito.pagado, true),
					),
				),

			db
				.select({
					atrasadas: sql<number>`COUNT(*) FILTER (
						WHERE ${cuotas_credito.pagado} = false
						  AND ${cuotas_credito.fecha_vencimiento} < ${hoy}
					)::int`,
					pagadas: sql<number>`COUNT(*) FILTER (WHERE ${cuotas_credito.pagado} = true)::int`,
				})
				.from(cuotas_credito)
				.where(
					and(eq(cuotas_credito.credito_id, creditoId), SIN_PAGO_EN_REVISION),
				),

			// La más vieja sin pagar y la primera que aún no vence, en una sola
			// consulta: `MIN(...) FILTER` evita ir dos veces por lo mismo.
			db
				.select({
					numero_pendiente: sql<
						number | null
					>`MIN(${cuotas_credito.numero_cuota})::int`,
					fecha_pendiente: sql<
						string | null
					>`MIN(${cuotas_credito.fecha_vencimiento})`,
					proxima_futura: sql<string | null>`MIN(${cuotas_credito.fecha_vencimiento})
						FILTER (WHERE ${cuotas_credito.fecha_vencimiento} >= ${hoy})`,
				})
				.from(cuotas_credito)
				.where(
					and(
						eq(cuotas_credito.credito_id, creditoId),
						eq(cuotas_credito.pagado, false),
					),
				),

			db
				.select({
					monto_mora: moras_credito.monto_mora,
					porcentaje_mora: moras_credito.porcentaje_mora,
					cuotas_atrasadas: moras_credito.cuotas_atrasadas,
				})
				.from(moras_credito)
				.where(
					and(
						eq(moras_credito.credito_id, creditoId),
						eq(moras_credito.activa, true),
					),
				)
				.limit(1),

			db
				.select({
					monto_total_convenio: convenios_pago.monto_total_convenio,
					monto_pagado: convenios_pago.monto_pagado,
					monto_pendiente: convenios_pago.monto_pendiente,
					cuota_mensual: convenios_pago.cuota_mensual,
					numero_meses: convenios_pago.numero_meses,
					pagos_realizados: convenios_pago.pagos_realizados,
					pagos_pendientes: convenios_pago.pagos_pendientes,
					fecha_convenio: convenios_pago.fecha_convenio,
				})
				.from(convenios_pago)
				.where(
					and(
						eq(convenios_pago.credito_id, creditoId),
						eq(convenios_pago.activo, true),
						eq(convenios_pago.completado, false),
					),
				)
				.limit(1),

			credito.aseguradora_id === null
				? Promise.resolve([])
				: db
						.select({ nombre: aseguradoras.nombre })
						.from(aseguradoras)
						.where(eq(aseguradoras.id, credito.aseguradora_id))
						.limit(1),
		]);

	return {
		encontrado: true,
		resumen: armarResumen({
			credito,
			totalAbonos: abonos[0]?.total ?? "0",
			conteos: conteos[0] ?? { atrasadas: 0, pagadas: 0 },
			pendientes: pendientes[0] ?? null,
			mora: mora[0] ?? null,
			convenio: convenio[0] ?? null,
			nombreAseguradora: aseguradora[0]?.nombre ?? null,
			hoy,
		}),
	};
}

/** Filas crudas con las que se arma el resumen. */
export type InsumosResumen = {
	credito: {
		credito_id: number;
		numero_credito_sifco: string;
		capital: string | null;
		cuota: string | null;
		plazo: number;
		statusCredit: string;
		no_poliza: string | null;
	};
	totalAbonos: string;
	conteos: { atrasadas: number; pagadas: number };
	pendientes: {
		numero_pendiente: number | null;
		fecha_pendiente: string | null;
		proxima_futura: string | null;
	} | null;
	mora: {
		monto_mora: string | null;
		porcentaje_mora: string | null;
		cuotas_atrasadas: number;
	} | null;
	convenio: {
		monto_total_convenio: string | null;
		monto_pagado: string | null;
		monto_pendiente: string | null;
		cuota_mensual: string | null;
		numero_meses: number;
		pagos_realizados: number | null;
		pagos_pendientes: number | null;
		fecha_convenio: Date | string | null;
	} | null;
	nombreAseguradora: string | null;
	hoy: string;
};

/**
 * Arma el resumen a partir de las filas. Separada de la consulta para poder
 * probar las reglas —capital activo, cuota vencida, próxima futura— sin base.
 */
export function armarResumen(insumos: InsumosResumen): ResumenCredito {
	const { credito, conteos, pendientes, mora, convenio, hoy } = insumos;

	const capitalActivo = new Big(credito.capital ?? 0).minus(
		new Big(insumos.totalAbonos ?? 0),
	);

	const numeroPendiente = pendientes?.numero_pendiente ?? null;
	const fechaPendiente = pendientes?.fecha_pendiente ?? null;

	return {
		numero_credito_sifco: credito.numero_credito_sifco,
		credito_id: credito.credito_id,
		status_credito: credito.statusCredit,
		capital: new Big(credito.capital ?? 0).toFixed(2),
		// Un crédito sobrepagado daría negativo; se muestra 0 antes que un saldo
		// en contra que nadie sabría interpretar en un chat.
		capital_activo: (capitalActivo.lt(0) ? new Big(0) : capitalActivo).toFixed(2),
		cuota_mensual: new Big(credito.cuota ?? 0).toFixed(2),
		plazo: credito.plazo,
		cuotas_atrasadas: conteos.atrasadas ?? 0,
		cuotas_pagadas: conteos.pagadas ?? 0,
		cuota_actual:
			numeroPendiente !== null && fechaPendiente !== null
				? {
						numero: numeroPendiente,
						de: credito.plazo,
						fecha_vencimiento: fechaPendiente,
						vencida: fechaPendiente < hoy,
					}
				: null,
		proxima_fecha_pago: pendientes?.proxima_futura ?? null,
		mora: mora
			? {
					monto: new Big(mora.monto_mora ?? 0).toFixed(2),
					porcentaje: new Big(mora.porcentaje_mora ?? 0).toFixed(2),
					cuotas_atrasadas: mora.cuotas_atrasadas,
				}
			: null,
		convenio: convenio
			? {
					monto_total: new Big(convenio.monto_total_convenio ?? 0).toFixed(2),
					monto_pagado: new Big(convenio.monto_pagado ?? 0).toFixed(2),
					monto_pendiente: new Big(convenio.monto_pendiente ?? 0).toFixed(2),
					cuota_mensual: new Big(convenio.cuota_mensual ?? 0).toFixed(2),
					numero_meses: convenio.numero_meses,
					pagos_realizados: convenio.pagos_realizados ?? 0,
					pagos_pendientes: convenio.pagos_pendientes ?? 0,
					// La columna es timestamp: sin esto sale el toString de Date
					// ("Sat Aug 01 2026 11:35:36 GMT-0600…"), que nadie quiere parsear.
					fecha_convenio: convenio.fecha_convenio
						? new Date(convenio.fecha_convenio).toISOString().slice(0, 10)
						: null,
				}
			: null,
		aseguradora: insumos.nombreAseguradora,
		numero_poliza: credito.no_poliza || null,
	};
}
