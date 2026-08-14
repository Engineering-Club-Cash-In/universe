/**
 * OTP del bot de cobros: envío por SMS y validación por API.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ESTE MÓDULO ESTÁ AISLADO A PROPÓSITO.
 *
 * Si mañana se decide quitar el OTP o cambiarlo por otra validación, se borra
 * este archivo y se quitan sus dos llamadas en controllers/bot-cobros.ts:
 *   · `enviarOtp`   → servicio 1
 *   · `validarOtp`  → servicio 2, antes de listar los créditos
 * Nada más del bot depende de él.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Por qué no se reusa `otpController` (controllers/otp.ts), como decía D-07:
 *   1. Tiene un **bypass hardcodeado**: el código `1234` valida siempre. Sirve
 *      para probar el bot de ventas; acá abriría los datos de crédito de
 *      cualquier cliente a cualquiera.
 *   2. Exige que exista un lead con ese DPI, y el bot de cobros también le manda
 *      el código a codeudores y encuentra clientes por placa o NIT.
 *   3. Escribe el código en la consola.
 * Se reusan la tabla `otps` y el cliente de `@repo/sms`, que es lo que importa.
 */

import { randomInt } from "node:crypto";
import { SMSClient } from "@repo/sms";
import { and, desc, eq, gt, type SQL } from "drizzle-orm";
import { db } from "../../db";
import { otps } from "../../db/schema/otp";
import { normalizarDpi } from "../../utils/cui-validation";
import { getTestPhone, isTestModeEnabled } from "../messaging-test-mode";
import { aFormatoSms, enmascararTelefono } from "./identificadores";

/** Minutos de vigencia del código. */
const VIGENCIA_MINUTOS = 5;
/** Intentos fallidos antes de obligar a pedir uno nuevo. */
const MAX_INTENTOS = 3;
/**
 * Marca del flujo que emitió el código.
 *
 * La tabla `otps` la comparte con el bot de ventas, cuyos endpoints `/info/*`
 * son públicos y aceptan cualquier DPI con un teléfono elegido por quien llama.
 * Sin esta marca, un código pedido por ahí servía para entrar acá como esa
 * persona.
 */
const ORIGEN = "cobros";
/** Segundos que hay que esperar entre un envío y el siguiente. */
const COOLDOWN_SEGUNDOS = 60;
/** Envíos máximos a la misma persona por hora. */
const MAX_ENVIOS_POR_HORA = 5;

/**
 * `db` o la transacción de un `db.transaction(...)`.
 *
 * El servicio 2 valida y lista los créditos dentro de una misma transacción,
 * para que el código no quede consumido si el listado falla.
 */
export type Ejecutor =
	| typeof db
	| Parameters<Parameters<typeof db.transaction>[0]>[0];

export type DestinatarioOtp = {
	/** Lead del titular, o null si el código va a un codeudor. */
	leadId: string | null;
	/** Codeudor al que se le manda, o null si va al titular. */
	coDebtorId: string | null;
	/**
	 * DPI de quien se identificó, si lo tenemos. Se guarda normalizado (sin
	 * espacios). Es informativo: la llave de validación es la referencia.
	 */
	dpi: string | null;
	/** Teléfono normalizado a 8 dígitos. */
	telefono8: string;
};

export type ResultadoEnvio =
	| {
			enviado: true;
			/** Id opaco que el bot guarda y devuelve al validar (servicio 2). */
			referencia: string;
			enviadoA: string;
			expiraEnSegundos: number;
	  }
	| { enviado: false; codigo: "ERROR_ENVIO" }
	| {
			enviado: false;
			codigo: "DEMASIADOS_ENVIOS";
			/** Segundos que faltan para poder pedir otro código. */
			reintentarEnSegundos: number;
	  };

/** A quién pertenece el código validado: con esto se listan sus créditos. */
export type IdentidadVerificada = {
	leadId: string | null;
	coDebtorId: string | null;
	dpi: string | null;
};

export type ResultadoValidacion =
	| { valido: true; identidad: IdentidadVerificada }
	| { valido: false; codigo: "OTP_INVALIDO"; intentosRestantes: number }
	| { valido: false; codigo: "OTP_VENCIDO" }
	| { valido: false; codigo: "OTP_YA_USADO" }
	| { valido: false; codigo: "DEMASIADOS_INTENTOS" }
	| { valido: false; codigo: "REFERENCIA_INVALIDA" };

/**
 * Código de 4 dígitos con generador criptográfico.
 *
 * `Math.random()` es predecible: quien junte varios códigos enviados a un
 * teléfono propio puede reconstruir el estado del generador y adivinar los
 * siguientes, saltándose el tope de 3 intentos. Este código autoriza el acceso
 * a datos de crédito, así que no puede salir de ahí.
 */
function generarCodigo(): string {
	return randomInt(1000, 10000).toString();
}

/**
 * Genera el código, lo guarda y lo manda por SMS.
 *
 * El código **no se devuelve ni se registra en logs** (D-16): la única forma de
 * conocerlo es recibir el SMS.
 */
export async function enviarOtp(
	destinatario: DestinatarioOtp,
): Promise<ResultadoEnvio> {
	// Identidad a la que se le manda el código: con ella se cuentan los envíos y
	// se invalidan los códigos anteriores.
	const deEstaIdentidad = destinatario.coDebtorId
		? eq(otps.coDebtorId, destinatario.coDebtorId)
		: destinatario.leadId
			? eq(otps.leadId, destinatario.leadId)
			: null;

	if (deEstaIdentidad) {
		const limite = await revisarLimiteDeEnvios(deEstaIdentidad);
		if (limite) return limite;
	}

	const codigo = generarCodigo();
	const expiraEn = new Date();
	expiraEn.setMinutes(expiraEn.getMinutes() + VIGENCIA_MINUTOS);

	// Se guarda antes de enviar para no perder el código si el SMS tarda, y se
	// borra si el envío falla: si no, quedaría un código válido que nadie
	// recibió.
	let referencia: string | null = null;

	try {
		// Un código nuevo deja sin efecto a los anteriores: si no, cada envío
		// regalaría 3 intentos más y bastaría con volver a pedir código para
		// seguir adivinando después de un bloqueo.
		if (deEstaIdentidad) {
			await db
				.update(otps)
				.set({ expiresAt: new Date() })
				.where(
					and(deEstaIdentidad, eq(otps.origen, ORIGEN), eq(otps.used, false)),
				);
		}

		const [fila] = await db
			.insert(otps)
			.values({
				code: codigo,
				origen: ORIGEN,
				dpi: destinatario.dpi ? normalizarDpi(destinatario.dpi) : null,
				leadId: destinatario.leadId,
				coDebtorId: destinatario.coDebtorId,
				phoneNumber: destinatario.telefono8,
				expiresAt: expiraEn,
			})
			.returning({ id: otps.id });

		referencia = fila.id;

		const smsClient = new SMSClient({
			token: process.env.SMS_TOKEN ?? "",
			apiKey: Number.parseInt(process.env.SMS_API_KEY ?? "0", 10),
		});

		// La base de dev es una copia de producción con teléfonos reales. Con
		// TEST_MESSAGE=true el SMS se redirige a un número interno para poder
		// probar sin escribirle a un cliente.
		const destino = isTestModeEnabled()
			? getTestPhone()
			: destinatario.telefono8;

		if (isTestModeEnabled()) {
			console.log(
				`[BotCobros] TEST_MESSAGE activo: OTP redirigido a ${enmascararTelefono(destino)} (real: ${enmascararTelefono(destinatario.telefono8)})`,
			);
		}

		await smsClient.send({
			msisdns: [aFormatoSms(destino)],
			message: `Cash In: tu codigo de verificacion es ${codigo}. Vence en ${VIGENCIA_MINUTOS} minutos. No lo compartas con nadie.`,
			country: "GT",
			tag: "otp-bot-cobros",
			dial: 50237633199,
		});

		return {
			enviado: true,
			referencia: fila.id,
			enviadoA: enmascararTelefono(destinatario.telefono8),
			expiraEnSegundos: VIGENCIA_MINUTOS * 60,
		};
	} catch (error) {
		console.error("[BotCobros] Error enviando OTP:", error);

		if (referencia) {
			await db
				.delete(otps)
				.where(eq(otps.id, referencia))
				.catch((err) =>
					console.error("[BotCobros] No se pudo limpiar el OTP fallido:", err),
				);
		}

		return { enviado: false, codigo: "ERROR_ENVIO" };
	}
}

/**
 * Frena los reenvíos antes de generar otro código.
 *
 * Sin esto, cada llamada al servicio 1 emite un código nuevo con 3 intentos
 * frescos —así el tope de intentos no frena nada— y además le llena el teléfono
 * de SMS (que se cobran) a un cliente real.
 */
async function revisarLimiteDeEnvios(
	deEstaIdentidad: SQL,
): Promise<ResultadoEnvio | null> {
	const desdeUnaHora = new Date(Date.now() - 60 * 60 * 1000);

	const enviados = await db
		.select({ createdAt: otps.createdAt })
		.from(otps)
		.where(
			and(
				deEstaIdentidad,
				eq(otps.origen, ORIGEN),
				gt(otps.createdAt, desdeUnaHora),
			),
		)
		.orderBy(desc(otps.createdAt))
		.limit(MAX_ENVIOS_POR_HORA);

	const ultimo = enviados[0];

	if (ultimo) {
		const segundosDesdeElUltimo = Math.floor(
			(Date.now() - ultimo.createdAt.getTime()) / 1000,
		);

		if (segundosDesdeElUltimo < COOLDOWN_SEGUNDOS) {
			return {
				enviado: false,
				codigo: "DEMASIADOS_ENVIOS",
				reintentarEnSegundos: COOLDOWN_SEGUNDOS - segundosDesdeElUltimo,
			};
		}
	}

	if (enviados.length >= MAX_ENVIOS_POR_HORA) {
		const masViejo = enviados[enviados.length - 1];
		const segundosParaLiberar = Math.max(
			1,
			Math.ceil(
				(masViejo.createdAt.getTime() + 60 * 60 * 1000 - Date.now()) / 1000,
			),
		);

		return {
			enviado: false,
			codigo: "DEMASIADOS_ENVIOS",
			reintentarEnSegundos: segundosParaLiberar,
		};
	}

	return null;
}

/**
 * Valida el código contra el OTP que se emitió en el servicio 1.
 *
 * Se valida acá —y no del lado de SimpleTech— por dos razones: para poder
 * distinguir un código **vencido** de uno incorrecto (comparando strings no se
 * puede), y porque esta validación es la que autoriza a listar los créditos.
 *
 * La `referencia` es el id de la fila, que el servicio 1 le devolvió al bot.
 * Ata el código a UNA persona: sin ella, mandar solo 4 dígitos permitiría
 * probar 0000…9999 hasta caer en el código vivo de cualquier cliente.
 *
 * **Se debe llamar dentro de una transacción** (`ejecutor` = la `tx`): la fila
 * se bloquea con `FOR UPDATE` para que dos peticiones simultáneas no lean el
 * mismo contador de intentos y lo pisen — si no, se podría probar el espacio
 * completo de códigos en paralelo saltándose el tope de 3.
 */
export async function validarOtp(
	referencia: string,
	codigo: string,
	ejecutor: Ejecutor = db,
): Promise<ResultadoValidacion> {
	// La referencia es un uuid; si viene cualquier cosa, la consulta explota.
	if (
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
			referencia,
		)
	) {
		return { valido: false, codigo: "REFERENCIA_INVALIDA" };
	}

	const [otp] = await ejecutor
		.select()
		.from(otps)
		.where(and(eq(otps.id, referencia), eq(otps.origen, ORIGEN)))
		.limit(1)
		.for("update");

	if (!otp) {
		return { valido: false, codigo: "REFERENCIA_INVALIDA" };
	}

	if (otp.attempts >= MAX_INTENTOS) {
		return { valido: false, codigo: "DEMASIADOS_INTENTOS" };
	}

	// El vencimiento se revisa antes que el código: al cliente le sirve más
	// "tu código venció" que "es incorrecto" cuando escribió el de hace una hora.
	if (otp.expiresAt < new Date()) {
		return { valido: false, codigo: "OTP_VENCIDO" };
	}

	if (otp.used) {
		return { valido: false, codigo: "OTP_YA_USADO" };
	}

	if (otp.code !== codigo) {
		const intentos = otp.attempts + 1;
		await ejecutor
			.update(otps)
			.set({ attempts: intentos })
			.where(eq(otps.id, otp.id));

		// Si este intento agotó el tope, se avisa el bloqueo ahora y no en el
		// siguiente: el bot rutea por `codigo`, y con OTP_INVALIDO le pediría al
		// cliente otro intento que ya no puede funcionar.
		if (intentos >= MAX_INTENTOS) {
			return { valido: false, codigo: "DEMASIADOS_INTENTOS" };
		}

		return {
			valido: false,
			codigo: "OTP_INVALIDO",
			intentosRestantes: MAX_INTENTOS - intentos,
		};
	}

	await ejecutor
		.update(otps)
		.set({ used: true, usedAt: new Date() })
		.where(eq(otps.id, otp.id));

	return {
		valido: true,
		identidad: {
			leadId: otp.leadId,
			coDebtorId: otp.coDebtorId,
			dpi: otp.dpi,
		},
	};
}
