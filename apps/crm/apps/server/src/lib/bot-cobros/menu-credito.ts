/**
 * Paso 2 · Info del crédito para el menú del bot.
 *
 * Junta lo de cartera (saldos, cuotas, mora, convenio) con lo del CRM (el
 * vehículo) y devuelve **solo** lo que el bot muestra.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO SE REENVÍA LA RESPUESTA DE CARTERA TAL CUAL
 *
 * `GET /credito` de cartera devuelve el calendario completo del crédito: ~56 KB
 * medidos, con el desglose de cada pago, **el asesor asignado, el royalti, las
 * membresías y las observaciones internas**. Nada de eso puede salir hacia un
 * integrador externo, y el bot necesita siete datos.
 *
 * Por eso se pide `/credito/resumen` —421 bytes— y se recorta otra vez acá.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Contrato: docs/features/bot-whatsapp-cobros/02-menu-del-credito.md
 */

import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { otps } from "../../db/schema/otp";
import { carteraBackClient } from "../../services/cartera-back-client";
import { listarCreditosDeCliente } from "./buscar-cliente";

/**
 * Cuánto vale la referencia del paso 1 para seguir consultando.
 *
 * El OTP vence a los 5 minutos, pero eso es para *canjearlo*. Una vez validado,
 * el cliente se queda navegando el menú y no tiene sentido pedirle otro código
 * a los 5 minutos de conversación. Media hora cubre una consulta con calma y
 * acota la ventana si alguien se hiciera de una referencia ajena.
 */
const VIGENCIA_SESION_MINUTOS = 30;

/**
 * ¿La referencia sigue sirviendo para consultar?
 *
 * Se mide desde que el cliente **canjeó** el código, no desde que se emitió: el
 * reloj corre desde que probó su identidad.
 */
export function sesionVigente(
	canjeadoEn: Date,
	ahora: Date = new Date(),
): boolean {
	const minutos = (ahora.getTime() - canjeadoEn.getTime()) / (60 * 1000);

	// Un `usedAt` en el futuro sería reloj torcido o dato manipulado; no se
	// premia con una sesión eterna.
	if (minutos < 0) return false;

	return minutos <= VIGENCIA_SESION_MINUTOS;
}

export type InfoCreditoBot = {
	numeroSifco: string;
	/** La misma que el paso 1 mostró en el menú de selección. */
	etiqueta: string;
	estado: string;
	capitalActivo: string;
	cuotaMensual: string;
	cuotasAtrasadas: number;
	cuotaActual: {
		numero: number;
		de: number;
		fechaVencimiento: string;
		vencida: boolean;
	} | null;
	proximaFechaPago: string | null;
	mora: { monto: string; cuotasAtrasadas: number } | null;
	/**
	 * true = tiene mora pero su monto no se puede citar todavía.
	 *
	 * `moras_credito` es una foto que refresca un job a las 23:59 GT: entre que
	 * el cliente paga y esa corrida, el monto guardado no cuadra con las cuotas
	 * atrasadas reales. Antes que decirle una cifra equivocada, cartera la calla
	 * y levanta esta bandera para que el bot lo mande con su asesor.
	 */
	moraPorConfirmar: boolean;
	convenio: {
		cuotaMensual: string;
		montoPendiente: string;
		pagosRealizados: number;
		pagosPendientes: number;
		numeroMeses: number;
	} | null;
	/** `null` si el crédito no tiene vehículo registrado: se responde igual. */
	vehiculo: {
		placa: string | null;
		marca: string;
		modelo: string;
		anio: number;
	} | null;
};

export type ResultadoInfoCredito =
	| { ok: true; info: InfoCreditoBot }
	| {
			ok: false;
			codigo:
				| "REFERENCIA_INVALIDA"
				| "SESION_VENCIDA"
				| "CREDITO_NO_ES_DEL_CLIENTE"
				| "CREDITO_SIN_DATOS";
	  };

/**
 * Devuelve la info del crédito, si quien pregunta tiene derecho a verla.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EL CONTROL DE ACCESO ESTÁ ACÁ, Y ES LO IMPORTANTE DE ESTA FUNCIÓN.
 *
 * La API key identifica a SimpleTech, no al cliente final: con ella sola,
 * cualquiera podría pedir el saldo de cualquier crédito. Por eso se exige la
 * `referencia` del paso 1 y se comprueba que:
 *   1. exista y sea de un OTP de cobros,
 *   2. ya haya sido **canjeada** (o sea, el cliente escribió bien su código),
 *   3. siga dentro de la ventana de `VIGENCIA_SESION_MINUTOS`,
 *   4. el crédito consultado sea **de esa persona**.
 *
 * El punto 4 es el que impide que, con una referencia legítima, se pregunte por
 * el crédito de un tercero.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function obtenerInfoCredito(
	referencia: string,
	numeroSifco: string,
): Promise<ResultadoInfoCredito> {
	// La referencia es el uuid de la fila; con otra cosa la consulta explota.
	if (
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
			referencia,
		)
	) {
		return { ok: false, codigo: "REFERENCIA_INVALIDA" };
	}

	const [otp] = await db
		.select()
		.from(otps)
		.where(and(eq(otps.id, referencia), eq(otps.origen, "cobros")))
		.limit(1);

	if (!otp) return { ok: false, codigo: "REFERENCIA_INVALIDA" };

	// Sin canjear no hay identidad verificada: el cliente nunca escribió su
	// código, así que esta referencia no prueba que sea quien dice ser.
	if (!otp.used || !otp.usedAt) {
		return { ok: false, codigo: "REFERENCIA_INVALIDA" };
	}

	if (!sesionVigente(otp.usedAt)) {
		return { ok: false, codigo: "SESION_VENCIDA" };
	}

	// Los créditos de esta persona, con la misma consulta del paso 1.
	const creditos = await listarCreditosDeCliente({
		leadId: otp.leadId,
		dpi: otp.dpi,
	});

	const credito = creditos.find((c) => c.numeroSifco === numeroSifco);

	if (!credito) return { ok: false, codigo: "CREDITO_NO_ES_DEL_CLIENTE" };

	const resumen = await carteraBackClient.getResumenCredito(numeroSifco);

	// El crédito existe en el CRM pero cartera no lo tiene: pasa con los que
	// nunca se migraron. No es un error del servicio.
	if (!resumen) return { ok: false, codigo: "CREDITO_SIN_DATOS" };

	return {
		ok: true,
		info: {
			numeroSifco: credito.numeroSifco,
			etiqueta: credito.etiqueta,
			estado: resumen.status_credito,
			capitalActivo: resumen.capital_activo,
			cuotaMensual: resumen.cuota_mensual,
			cuotasAtrasadas: resumen.cuotas_atrasadas,
			cuotaActual: resumen.cuota_actual
				? {
						numero: resumen.cuota_actual.numero,
						de: resumen.cuota_actual.de,
						fechaVencimiento: resumen.cuota_actual.fecha_vencimiento,
						vencida: resumen.cuota_actual.vencida,
					}
				: null,
			proximaFechaPago: resumen.proxima_fecha_pago,
			mora: resumen.mora
				? {
						monto: resumen.mora.monto,
						cuotasAtrasadas: resumen.mora.cuotas_atrasadas,
					}
				: null,
			moraPorConfirmar: resumen.mora_por_confirmar,
			convenio: resumen.convenio
				? {
						cuotaMensual: resumen.convenio.cuota_mensual,
						montoPendiente: resumen.convenio.monto_pendiente,
						pagosRealizados: resumen.convenio.pagos_realizados,
						pagosPendientes: resumen.convenio.pagos_pendientes,
						numeroMeses: resumen.convenio.numero_meses,
					}
				: null,
			vehiculo: credito.vehiculo,
		},
	};
}
