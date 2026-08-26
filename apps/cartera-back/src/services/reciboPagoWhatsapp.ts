import { eq } from "drizzle-orm";
import { generateReciboPagoPDF } from "../controllers/reports";
import { db } from "../database";
import { creditos, usuarios } from "../database/db";
import { notifyReciboPagoWhatsapp } from "./crm.service";

export interface EnviarReciboPagoWhatsappParams {
  pagoId: number;
  numeroSifco: string | null;
  clienteNombre: string;
}

export interface EnviarReciboPagoWhatsappResult {
  success: boolean;
  message: string;
}

/**
 * Genera el recibo de pago y lo envía por WhatsApp vía CRM, tras facturar.
 * Best-effort: nunca lanza — un fallo acá (PDF o envío) no debe afectar la
 * respuesta de facturación, solo se reporta en el resultado devuelto.
 */
export async function enviarReciboPagoWhatsappBestEffort(
  params: EnviarReciboPagoWhatsappParams,
): Promise<EnviarReciboPagoWhatsappResult> {
  if (!params.numeroSifco) {
    return { success: false, message: "No se intentó el envío (sin número SIFCO)" };
  }

  try {
    const recibo = await generateReciboPagoPDF(params.pagoId);
    return await notifyReciboPagoWhatsapp({
      pagoId: params.pagoId,
      numeroSifco: params.numeroSifco,
      reciboUrl: recibo.pdfUrl,
      clienteNombre: params.clienteNombre,
      numeroCuota: recibo.numeroCuota,
      asesorNombre: recibo.asesorNombre,
      asesorTelefono: recibo.asesorTelefono,
    });
  } catch (error: any) {
    console.error(
      `⚠️ No se pudo enviar recibo de pago por WhatsApp para pago ${params.pagoId} (NO afecta la facturación):`,
      error?.message
    );
    return { success: false, message: error?.message ?? "Error desconocido" };
  }
}

/**
 * Un lookup del cliente por crédito y un recibo por cada pago. Lo comparten
 * `/aplicar-pago` (un pago) y el import Págalo (N pagos de un mismo grupo).
 * Nunca lanza: cualquier fallo (DB, PDF, envío) queda solo en el log.
 */
export async function enviarRecibosPagoDeCreditoBestEffort(params: {
  creditoId: number;
  pagoIds: number[];
}): Promise<EnviarReciboPagoWhatsappResult[]> {
  try {
    const [cliente] = await db
      .select({ numeroSifco: creditos.numero_credito_sifco, nombre: usuarios.nombre })
      .from(creditos)
      .innerJoin(usuarios, eq(usuarios.usuario_id, creditos.usuario_id))
      .where(eq(creditos.credito_id, params.creditoId))
      .limit(1);
    const resultados: EnviarReciboPagoWhatsappResult[] = [];
    for (const pagoId of params.pagoIds) {
      resultados.push(
        await enviarReciboPagoWhatsappBestEffort({
          pagoId,
          numeroSifco: cliente?.numeroSifco ?? null,
          clienteNombre: cliente?.nombre ?? "",
        }),
      );
    }
    return resultados;
  } catch (error) {
    console.error(
      `⚠️ No se pudo enviar recibo de pago por WhatsApp para pagos ${params.pagoIds.join(",")} (NO afecta la validación):`,
      error instanceof Error ? error.message : error,
    );
    return [];
  }
}
