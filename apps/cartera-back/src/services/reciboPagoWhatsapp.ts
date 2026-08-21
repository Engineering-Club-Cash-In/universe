import { generateReciboPagoPDF } from "../controllers/reports";
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
