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
import { and, eq, sql } from "drizzle-orm";
import { db } from "../database/index";
import {
	aseguradoras,
	convenios_pago,
	creditos,
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
	/**
	 * `null` si no tiene mora activa **o si su foto quedó vieja** — ver
	 * `moraConfiable`. Nunca se devuelve un monto que no cuadre con las cuotas
	 * atrasadas que se están reportando.
	 */
	mora: {
		monto: string;
		porcentaje: string;
		cuotas_atrasadas: number;
	} | null;
	/**
	 * true = tiene una mora activa que NO se está mostrando porque su foto no
	 * coincide con las cuotas atrasadas de este momento. El bot puede usarlo para
	 * mandar al cliente con su asesor en vez de callar el tema.
	 */
	mora_por_confirmar: boolean;
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
 * Todo lo que se dice sobre las cuotas, en una sola consulta.
 *
 * Dos cosas que no son obvias y que Codex marcó en el PR #1326:
 *
 * 1. **Se deduplica por `numero_cuota`, quedándose con el `cuota_id` mayor.**
 *    Hay créditos con filas duplicadas en `cuotas_credito` —mismo número, id
 *    distinto, artefacto del flujo viejo de abonos—: 78 grupos en 51 créditos
 *    del sandbox. Hoy ninguna pareja tiene las dos copias vencidas a la vez, así
 *    que el conteo por filas físicas todavía no se desvía; en cuanto pase, el
 *    cliente vería una cuota atrasada de más. Es la misma canonicalización que
 *    hace `registerPayment` (dedupe por número, gana la copia más reciente
 *    porque es la que trae el recibo vigente), y conviene que las dos lecturas
 *    del mismo dato no discrepen.
 *
 * 2. **Una boleta esperando validación saca a la cuota de TODOS los cálculos**, no
 *    solo del conteo de atrasos. Antes el filtro estaba únicamente en las
 *    atrasadas, así que un cliente que subió su boleta podía recibir "0 cuotas
 *    atrasadas" y, a la vez, "te toca pagar la cuota 8" — la que acababa de
 *    pagar. El cliente ya pagó; falta que cobranza lo valide. (En el sandbox no
 *    hay ninguna cuota en ese estado hoy, pero la contradicción aparecía sola en
 *    cuanto alguien subiera una boleta.)
 */
/**
 * Ya hay una boleta registrada para esta cuota que CONTA no ha validado.
 *
 * Es el predicado de `cuotasProximas`, **no** el de `getCreditoByNumero**: aquel
 * exige además `pagado = true` y así se le escapan los **pagos parciales**, que
 * `registerPayment` guarda con `pagado: false` + `validationStatus: "pending"`.
 * Con el predicado viejo, un cliente que abonó parte de su cuota vencida y subió
 * la boleta seguía viendo esa cuota como enteramente pendiente (Codex, PR #1326).
 *
 * `paymentFalse = false` descarta las filas anuladas y `monto_boleta > 0` exige
 * que haya una boleta de verdad, no un recibo sembrado en cero.
 */
const BOLETA_EN_REVISION = sql`
	SELECT 1 FROM ${SQL_CARTERA_SCHEMA}.pagos_credito p
	WHERE p.cuota_id = c.cuota_id
		AND p."paymentFalse" = false
		AND p.validation_status = 'pending'
		AND COALESCE(p.monto_boleta, 0) > 0
`;

function consultaDeCuotas(creditoId: number, hoy: string) {
	return sql`
		WITH canonicas AS (
			SELECT DISTINCT ON (q.numero_cuota)
				q.cuota_id, q.numero_cuota, q.fecha_vencimiento, q.pagado
			FROM ${SQL_CARTERA_SCHEMA}.cuotas_credito q
			WHERE q.credito_id = ${creditoId}
			ORDER BY q.numero_cuota, q.cuota_id DESC
		),
		vigentes AS (
			SELECT * FROM canonicas c
			WHERE NOT EXISTS (${BOLETA_EN_REVISION})
		)
		SELECT
			COUNT(*) FILTER (
				WHERE NOT pagado AND fecha_vencimiento < ${hoy}
			)::int AS atrasadas,
			COUNT(*) FILTER (WHERE pagado)::int AS pagadas,
			-- La cuota actual es la de menor NÚMERO sin pagar, y su fecha es la de
			-- esa misma fila: tomar el MIN de cada columna por separado podría
			-- mezclar dos cuotas distintas si las fechas no siguen el orden.
			(SELECT numero_cuota FROM vigentes WHERE NOT pagado
				ORDER BY numero_cuota LIMIT 1)::int AS numero_pendiente,
			(SELECT fecha_vencimiento::text FROM vigentes WHERE NOT pagado
				ORDER BY numero_cuota LIMIT 1) AS fecha_pendiente,
			(SELECT MIN(fecha_vencimiento)::text FROM vigentes
				WHERE NOT pagado AND fecha_vencimiento >= ${hoy}) AS proxima_futura
		FROM vigentes
	`;
}

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
	const [abonos, cuotas, mora, convenio, aseguradora] =
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

			db.execute<{
				atrasadas: number;
				pagadas: number;
				numero_pendiente: number | null;
				fecha_pendiente: string | null;
				proxima_futura: string | null;
			}>(consultaDeCuotas(creditoId, hoy)),

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

	const [filaCuotas] = cuotas.rows as Array<{
		atrasadas: number;
		pagadas: number;
		numero_pendiente: number | null;
		fecha_pendiente: string | null;
		proxima_futura: string | null;
	}>;

	return {
		encontrado: true,
		resumen: armarResumen({
			credito,
			totalAbonos: abonos[0]?.total ?? "0",
			conteos: filaCuotas
				? { atrasadas: filaCuotas.atrasadas, pagadas: filaCuotas.pagadas }
				: { atrasadas: 0, pagadas: 0 },
			pendientes: filaCuotas,
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
/**
 * Estados que no devengan mora. Espejo de `ESTADOS_SIN_MORA` en
 * `cuotasProximas.ts`: en convenio la mora se congela, y un crédito cancelado,
 * caído o incobrable no sigue acumulando.
 */
const ESTADOS_SIN_MORA = new Set([
	"EN_CONVENIO",
	"INCOBRABLE",
	"CANCELADO",
	"PENDIENTE_CANCELACION",
	"CAIDO",
]);

/**
 * ¿Se puede citar el monto de la mora?
 *
 * `moras_credito` es una **foto** que solo se refresca cuando corre
 * `procesarMoras` (23:59 GT). Entre que CONTA valida una cuota vencida —o el
 * cliente sube su boleta— y la siguiente corrida del job, la fila sigue diciendo
 * las cuotas y el recargo VIEJOS.
 *
 * Sin esta comprobación el bot podía responder `cuotasAtrasadas: 0` junto a una
 * mora de Q598: "ya no debés cuotas, pero pagá el recargo por atrasarte". Es el
 * mismo criterio que ya aplica `cuotasProximas`, que compara la foto contra el
 * conteo vivo y solo cita números cuando cuadran (Codex, PR #1326).
 */
export function moraConfiable(
	estado: string,
	cuotasEnLaFoto: number,
	cuotasAtrasadasHoy: number,
): boolean {
	if (ESTADOS_SIN_MORA.has(estado)) return false;

	return cuotasEnLaFoto === cuotasAtrasadasHoy;
}

export function armarResumen(insumos: InsumosResumen): ResumenCredito {
	const { credito, conteos, pendientes, mora, convenio, hoy } = insumos;

	const moraAlDia =
		mora !== null &&
		moraConfiable(credito.statusCredit, mora.cuotas_atrasadas, conteos.atrasadas);

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
		mora:
			mora && moraAlDia
				? {
						monto: new Big(mora.monto_mora ?? 0).toFixed(2),
						porcentaje: new Big(mora.porcentaje_mora ?? 0).toFixed(2),
						cuotas_atrasadas: mora.cuotas_atrasadas,
					}
				: null,
		mora_por_confirmar: mora !== null && !moraAlDia,
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
