import { eq } from "drizzle-orm";
import config from "../config";
import { filasDeLaBoleta, resumirBoleta } from "../controllers/reciboBoleta";
import { generateReciboPagoPDF } from "../controllers/reports";
import { db } from "../database";
import { creditos, usuarios } from "../database/db";
import { notifyReciboPagoWhatsapp } from "./crm.service";
import { conTurnoDeRecibo, enviarPorBoleta } from "./reciboPorBoleta";

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
 * Genera el recibo de la BOLETA a la que pertenece el pago y lo envía por
 * WhatsApp vía CRM. El CRM recibe como `pagoId` el comprobante de la boleta
 * (su pago_id más bajo) y lo usa como llave de idempotencia: aunque se pida
 * desde dos filas de la misma boleta, el cliente recibe un solo recibo.
 * Best-effort: nunca lanza.
 */
export async function enviarReciboPagoWhatsappBestEffort(
  params: EnviarReciboPagoWhatsappParams,
): Promise<EnviarReciboPagoWhatsappResult> {
  if (!params.numeroSifco) {
    return { success: false, message: "No se intentó el envío (sin número SIFCO)" };
  }

  try {
    const recibo = await conTurnoDeRecibo(() => generateReciboPagoPDF(params.pagoId));
    return await notifyReciboPagoWhatsapp({
      pagoId: recibo.comprobante,
      numeroSifco: params.numeroSifco,
      reciboUrl: recibo.pdfUrl,
      clienteNombre: params.clienteNombre,
      numeroCuota: recibo.numeroCuota,
      asesorNombre: recibo.asesorNombre,
      asesorTelefono: recibo.asesorTelefono,
    });
  } catch (error: any) {
    console.error(
      `⚠️ No se pudo enviar recibo de pago por WhatsApp para pago ${params.pagoId} (NO afecta la validación):`,
      error?.message
    );
    return { success: false, message: error?.message ?? "Error desconocido" };
  }
}

const boletaDe = async (pagoId: number) => {
  const resumen = resumirBoleta(await filasDeLaBoleta(pagoId));
  return { comprobante: resumen.representativo, completa: resumen.completa };
};

/**
 * Un recibo por BOLETA para los pagos dados. Lo usan `/aplicar-pago` y la
 * revalidación (un pago) y el pago de Nexa (las filas de un evento). Devuelve
 * un resultado por cada `pagoId` de entrada, en el mismo orden: las filas de
 * una misma boleta comparten el resultado de su único envío.
 *
 * Con `soloBoletasCompletas`, una boleta que todavía tiene filas sin validar
 * no se manda (conta valida fila por fila: el recibo sale cuando valida la
 * última, con la boleta completa).
 *
 * Con RECIBO_PAGO_WHATSAPP_ENABLED apagado no hace nada y devuelve [].
 * Nunca lanza: cualquier fallo (DB, PDF, envío) queda solo en el log.
 */
export async function enviarRecibosPagoDeCreditoBestEffort(params: {
  creditoId: number;
  pagoIds: number[];
  soloBoletasCompletas?: boolean;
}): Promise<EnviarReciboPagoWhatsappResult[]> {
  if (!config.reciboPagoWhatsappEnabled) return [];
  try {
    const [cliente] = await db
      .select({ numeroSifco: creditos.numero_credito_sifco, nombre: usuarios.nombre })
      .from(creditos)
      .innerJoin(usuarios, eq(usuarios.usuario_id, creditos.usuario_id))
      .where(eq(creditos.credito_id, params.creditoId))
      .limit(1);
    return await enviarPorBoleta(params, {
      boletaDe,
      enviar: (pagoId) =>
        enviarReciboPagoWhatsappBestEffort({
          pagoId,
          numeroSifco: cliente?.numeroSifco ?? null,
          clienteNombre: cliente?.nombre ?? "",
        }),
    });
  } catch (error) {
    console.error(
      `⚠️ No se pudo enviar recibo de pago por WhatsApp para pagos ${params.pagoIds.join(",")} (NO afecta la validación):`,
      error instanceof Error ? error.message : error,
    );
    return [];
  }
}
