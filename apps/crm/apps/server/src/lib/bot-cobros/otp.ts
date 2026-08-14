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

import { SMSClient } from "@repo/sms";
import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "../../db";
import { otps } from "../../db/schema/otp";
import { normalizarDpi } from "../../utils/cui-validation";
import { getTestPhone, isTestModeEnabled } from "../messaging-test-mode";
import { aFormatoSms, enmascararTelefono } from "./identificadores";

/** Minutos de vigencia del código. */
const VIGENCIA_MINUTOS = 5;
/** Intentos fallidos antes de obligar a pedir uno nuevo. */
const MAX_INTENTOS = 3;

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
	| { enviado: false; motivo: string };

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

function generarCodigo(): string {
	return Math.floor(1000 + Math.random() * 9000).toString();
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
	const codigo = generarCodigo();
	const expiraEn = new Date();
	expiraEn.setMinutes(expiraEn.getMinutes() + VIGENCIA_MINUTOS);

	// Se guarda antes de enviar para no perder el código si el SMS tarda, y se
	// borra si el envío falla: si no, quedaría un código válido que nadie
	// recibió.
	let referencia: string | null = null;

	try {
		const [fila] = await db
			.insert(otps)
			.values({
				code: codigo,
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

		return {
			enviado: false,
			motivo: "No se pudo enviar el código por SMS",
		};
	}
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
 */
export async function validarOtp(
	referencia: string,
	codigo: string,
): Promise<ResultadoValidacion> {
	// La referencia es un uuid; si viene cualquier cosa, la consulta explota.
	if (
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
			referencia,
		)
	) {
		return { valido: false, codigo: "REFERENCIA_INVALIDA" };
	}

	const [otp] = await db
		.select()
		.from(otps)
		.where(eq(otps.id, referencia))
		.limit(1);

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
		await db
			.update(otps)
			.set({ attempts: intentos })
			.where(eq(otps.id, otp.id));

		return {
			valido: false,
			codigo: "OTP_INVALIDO",
			intentosRestantes: Math.max(0, MAX_INTENTOS - intentos),
		};
	}

	await db
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
