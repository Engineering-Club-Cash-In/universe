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
import { type CuentasPagoBot, cuentasParaBot } from "../cuentas-pago";
import { type CreditoBot, listarCreditosDeCliente } from "./buscar-cliente";
import { armarMensajes, type MensajesCredito } from "./mensajes-credito";

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
	/**
	 * El capital del crédito, **el mismo número que la pantalla de cobros del CRM
	 * rotula "Capital Activo"** (`creditos.capital`, vía `montoFinanciado`).
	 *
	 * Decisión de Daniel (2026-08-18): que el bot y la pantalla digan lo mismo.
	 * Si un asesor abre el caso y ve Q190,846.74 mientras el cliente recibe otra
	 * cifra por WhatsApp, el que queda mal parado es el asesor.
	 *
	 * Ojo con el nombre: **no es el saldo pendiente de capital.** Cartera también
	 * devuelve `capital_activo` —`capital − SUM(abono_capital)`, la definición de
	 * `assignCapital`—, que para el crédito 01010214108330 da Q188,942.11 contra
	 * los Q190,846.74 de acá. Para mostrar el saldo real basta cambiar la línea
	 * de abajo por `resumen.capital_activo`; el dato ya viene en la respuesta.
	 */
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
	/**
	 * Con quién puede hablar el cliente sobre este crédito.
	 *
	 * Es el asesor asignado en cartera. `null` si el crédito no tiene uno — hoy
	 * no pasa, pero la columna lo permite; el bot debe poder seguir sin él.
	 */
	asesor: {
		nombre: string;
		telefono: string | null;
	} | null;
	/** `null` si el crédito no tiene vehículo registrado: se responde igual. */
	vehiculo: {
		placa: string | null;
		marca: string;
		modelo: string;
		anio: number;
	} | null;
	/**
	 * Dónde puede depositar el cliente.
	 *
	 * Viaja acá y no en un servicio propio porque son cuatro líneas que casi
	 * nunca cambian, y el bot ya está llamando a este endpoint para armar el
	 * menú (D-37). `texto` se muestra literal; `cuentas` sirve para cruzar la
	 * cuenta destino que se lee de una boleta.
	 */
	cuentasPago: CuentasPagoBot;
	/**
	 * Los mismos datos, ya escritos para mandar al chat.
	 *
	 * Se agregan porque armar el párrafo del lado del bot obliga a iterar el
	 * JSON en una herramienta que no da para eso. Los campos de arriba siguen
	 * ahí para lo que el bot necesite ramificar. Ver `mensajes-credito.ts`.
	 */
	mensajes: MensajesCredito;
};

export type ResultadoEstadoCuenta =
	| { ok: true; url: string }
	| {
			ok: false;
			codigo:
				| "REFERENCIA_INVALIDA"
				| "SESION_VENCIDA"
				| "CREDITO_NO_ES_DEL_CLIENTE"
				| "SIN_ESTADO_DE_CUENTA"
				| "CREDITO_SIN_DATOS";
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
export type IdentidadSesion = {
	otpId: string;
	leadId: string | null;
	coDebtorId: string | null;
};

type ResultadoAcceso =
	| { ok: true; credito: CreditoBot; identidad: IdentidadSesion }
	| {
			ok: false;
			codigo:
				| "REFERENCIA_INVALIDA"
				| "SESION_VENCIDA"
				| "CREDITO_NO_ES_DEL_CLIENTE";
	  };

/**
 * Las cuatro comprobaciones de D-24, en un solo lugar.
 *
 * La usan TODAS las gestiones del menú (info del crédito, estado de cuenta y
 * las que vengan). Si alguna se salta esto, la API key sola alcanzaría para
 * pedir datos de cualquier crédito.
 */
export async function verificarAcceso(
	referencia: string,
	numeroSifco: string,
): Promise<ResultadoAcceso> {
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

	// La identidad se devuelve además del crédito porque la boleta la guarda en
	// su propia fila: si un día se purga este OTP, el aviso de contabilidad
	// tiene que seguir sabiendo a quién avisarle.
	return {
		ok: true,
		credito,
		identidad: {
			otpId: otp.id,
			leadId: otp.leadId,
			coDebtorId: otp.coDebtorId,
		},
	};
}

export async function obtenerInfoCredito(
	referencia: string,
	numeroSifco: string,
): Promise<ResultadoInfoCredito> {
	const acceso = await verificarAcceso(referencia, numeroSifco);

	if (!acceso.ok) return { ok: false, codigo: acceso.codigo };

	const credito = acceso.credito;

	const resumen = await carteraBackClient.getResumenCredito(numeroSifco);

	// El crédito existe en el CRM pero cartera no lo tiene: pasa con los que
	// nunca se migraron. No es un error del servicio.
	if (!resumen) return { ok: false, codigo: "CREDITO_SIN_DATOS" };

	const respuesta: { ok: true; info: InfoCreditoBot } = {
		ok: true,
		info: {
			numeroSifco: credito.numeroSifco,
			etiqueta: credito.etiqueta,
			estado: resumen.status_credito,
			// El capital original, para cuadrar con la pantalla del CRM. El saldo
			// calculado está en `resumen.capital_activo` — ver el tipo de arriba.
			capitalActivo: resumen.capital,
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
			asesor: resumen.asesor,
			vehiculo: credito.vehiculo,
			cuentasPago: cuentasParaBot(),
			// Se rellena abajo: necesita el objeto completo.
			mensajes: { titulo: "", resumen: "", completo: "" },
		},
	};

	respuesta.info.mensajes = armarMensajes(respuesta.info);

	return respuesta;
}

/**
 * Genera el estado de cuenta del crédito y devuelve el enlace al PDF.
 *
 * Es un **puente**: el documento lo arma cartera, el mismo que descarga el
 * botón de carteraFront. Acá solo se comprueba que quien lo pide tenga derecho
 * a ese crédito, con las mismas cuatro condiciones de `obtenerInfoCredito`
 * (D-24) — sin eso, con la API key se podría bajar el estado de cuenta de
 * cualquiera.
 *
 * El enlace apunta a R2 y es **público para quien lo tenga**: no se le manda al
 * bot ningún dato del documento, solo la URL, y es el bot quien decide si se la
 * pasa al cliente en el chat.
 */
export async function obtenerEstadoDeCuenta(
	referencia: string,
	numeroSifco: string,
): Promise<ResultadoEstadoCuenta> {
	const acceso = await verificarAcceso(referencia, numeroSifco);

	if (!acceso.ok) return { ok: false, codigo: acceso.codigo };

	const resultado = await carteraBackClient.getEstadoCuentaUrl(numeroSifco);

	if (!resultado.ok) {
		// Los dos motivos llevan mensajes distintos: "todavía no hay movimientos"
		// es una respuesta normal; "no tenemos tu crédito" manda a soporte, y es
		// lo que pasa con los créditos del CRM que nunca llegaron a cartera.
		return {
			ok: false,
			codigo:
				resultado.motivo === "SIN_MOVIMIENTOS"
					? "SIN_ESTADO_DE_CUENTA"
					: "CREDITO_SIN_DATOS",
		};
	}

	return { ok: true, url: resultado.url };
}
