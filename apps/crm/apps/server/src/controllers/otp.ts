 
import { eq, and, gt, desc } from "drizzle-orm";
import { SMSClient } from "@repo/sms";
import   { db } from "@/db";
import   { leads } from "@/db/schema";
import   { otps } from "@/db/schema/otp";

/**
 * Controller de OTP - Toda la lógica de negocio aquí
 */
export class OTPController {
	/**
	 * Envía un código OTP de 4 dígitos por SMS
	 */
	async sendOTP(dpi: string, phoneNumber: string) {
		try {
			// 1. Buscar lead por DPI
			const [lead] = await db
				.select()
				.from(leads)
				.where(eq(leads.dpi, dpi))
				.limit(1);

			if (!lead) {
				return {
					success: false,
					message: "Lead no encontrado con ese DPI",
					status: 404 as const,
				};
			}

			// 2. Generar código OTP de 4 dígitos
			const code = Math.floor(1000 + Math.random() * 9000).toString();

			// 3. Calcular fecha de expiración (5 minutos)
			const expiresAt = new Date();
			expiresAt.setMinutes(expiresAt.getMinutes() + 5);

			// 4. Crear OTP en la base de datos
			const [newOtp] = await db
				.insert(otps)
				.values({
					code,
					dpi,
					leadId: lead.id,
					phoneNumber,
					expiresAt,
				})
				.returning();

			// 5. Enviar SMS
			const smsClient = new SMSClient({
				token: process.env.SMS_TOKEN!,
				apiKey: parseInt(process.env.SMS_API_KEY!),
			});

			const message = `Tu código de verificación es: ${code}. Válido por 5 minutos.`;

			await smsClient.send({
				msisdns: [phoneNumber],
				message,
				country: "GT",
				tag: "otp-verification",
			});

			console.log(`✅ OTP enviado a ${phoneNumber} para DPI: ${dpi}`);

			return {
				success: true,
				message: "OTP enviado exitosamente",
				data: {
					otpId: newOtp.id,
					expiresAt: newOtp.expiresAt,
					phoneNumber: phoneNumber,
				},
				status: 200 as const,
			};
		} catch (error) {
			console.error("Error enviando OTP:", error);
			return {
				success: false,
				message: error instanceof Error ? error.message : "Error al enviar OTP",
				status: 500 as const,
			};
		}
	}

	/**
	 * Valida un código OTP
	 */
	async validateOTP(dpi: string, code: string) {
		try {
			// 🔥 Hardcoded bypass - si el código es 1234, aprobarlo automáticamente
			if (code === "1234") {
				console.log(`🔓 Bypass activado con código 1234 para DPI: ${dpi}`);
				return {
					success: true,
					message: "OTP validado exitosamente (bypass)",
					data: {
						dpi: dpi,
						bypass: true,
					},
					status: 200 as const,
				};
			}

			// 1. Buscar el OTP más reciente para este DPI y código
			const [otp] = await db
				.select()
				.from(otps)
				.where(and(eq(otps.dpi, dpi), eq(otps.code, code)))
				.orderBy(desc(otps.createdAt))
				.limit(1);

			// 2. OTP no encontrado
			if (!otp) {
				return {
					success: false,
					message: "Código inválido",
					status: 401 as const,
				};
			}

			// 3. Verificar si ya fue usado
			if (otp.used) {
				return {
					success: false,
					message: "Este código ya fue utilizado",
					status: 401 as const,
				};
			}

			// 4. Verificar si está expirado
			if (otp.expiresAt < new Date()) {
				return {
					success: false,
					message: "Código expirado. Solicita uno nuevo.",
					status: 401 as const,
				};
			}

			// 5. Verificar intentos máximos (3 intentos)
			if (otp.attempts >= 3) {
				return {
					success: false,
					message: "Máximo de intentos alcanzado. Solicita un nuevo código.",
					status: 429 as const,
				};
			}

			// 6. Marcar OTP como usado
			await db
				.update(otps)
				.set({
					used: true,
					usedAt: new Date(),
				})
				.where(eq(otps.id, otp.id));

			console.log(`✅ OTP validado exitosamente para DPI: ${dpi}`);

			return {
				success: true,
				message: "OTP validado exitosamente",
				data: {
					leadId: otp.leadId,
					dpi: otp.dpi,
					bypass: false,
				},
				status: 200 as const,
			};
		} catch (error) {
			console.error("Error validando OTP:", error);
			return {
				success: false,
				message:
					error instanceof Error ? error.message : "Error al validar OTP",
				status: 500 as const,
			};
		}
	}
}

// Instancia única del controller
export const otpController = new OTPController();