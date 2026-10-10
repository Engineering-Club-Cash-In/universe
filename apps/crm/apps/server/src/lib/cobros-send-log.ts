/**
 * Helper compartido para persistir intentos de envío en `cobros_send_logs`.
 *
 * Lo usan los servicios de envío automático (bienvenida, mensaje adjunto). Es la
 * misma tabla que usa el envío manual de cobros (cuyo wrapper privado vive en
 * `routers/cobros.ts`); eventualmente ese también debería apuntar acá.
 * Best-effort: si el insert falla, solo loguea — nunca rompe el flujo de envío.
 */

import { db } from "../db";
import { cobrosSendLogs } from "../db/schema/cobros-send-logs";

export interface PersistCobrosSendLogParams {
	numeroCreditoSifco: string | null;
	telefono: string;
	mensaje: string;
	/** Id de la plantilla usada (ej. "bienvenida", "mensaje_adjunto"). */
	plantillaId: string;
	providerRequest: Record<string, unknown> | null;
	createdBy: string;
	result:
		| { success: true; providerResponse?: Record<string, unknown> }
		| {
				success: false;
				errorMessage?: string;
				providerResponse?: Record<string, unknown>;
		  };
}

export async function persistCobrosSendLog(
	params: PersistCobrosSendLogParams,
): Promise<void> {
	try {
		await db.insert(cobrosSendLogs).values({
			numeroCreditoSifco: params.numeroCreditoSifco,
			canal: "whatsapp",
			telefono: params.telefono,
			mensaje: params.mensaje,
			plantillaId: params.plantillaId,
			providerRequest: params.providerRequest,
			status: params.result.success ? "sent" : "failed",
			errorMessage: params.result.success ? null : params.result.errorMessage,
			providerResponse: params.result.providerResponse,
			createdBy: params.createdBy,
			sentAt: params.result.success ? new Date() : null,
		});
	} catch (err) {
		console.error("[cobros_send_logs] Error guardando log:", err);
	}
}
