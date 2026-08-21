/**
 * El botón "Pago no válido — notificar al cliente" (D-39).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LA INTENCIÓN SE DECLARA, NO SE ADIVINA.
 *
 * `reversePayment` es una herramienta de reparación interna: cuadres de pools,
 * renumeraciones, reaplicaciones. Un reverso NO dice si la boleta del cliente
 * era mala o si solo se movió plata por dentro, así que ningún aviso puede
 * colgarse de él. Este endpoint existe para el único caso en que conta quiere
 * decirle algo al cliente: "tu boleta no era válida".
 *
 * Hace dos cosas, en este orden: reversa el pago LLAMANDO AL `reversePayment`
 * EXISTENTE —sin tocarlo, D-38— y le avisa al CRM, esperando la respuesta,
 * porque avisar es el punto de todo el botón.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Solo ADMIN y CONTA, igual que el resto de acciones contables sobre pagos.
 */

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../database";
import { creditos, pagos_credito } from "../database/db/schema";
import {
  esPagoDelBotCobros,
  notificarRechazoPagoBot,
} from "../services/crm.service";
import { reversePayment } from "./reversePayment";

export const rechazarPagoBoletaSchema = z.object({
  credito_id: z.number().int().positive(),
  pago_id: z.number().int().positive(),
  // El motivo es obligatorio A PROPÓSITO: es la diferencia entre este botón y
  // un reverso cualquiera. Queda en la respuesta, en el log y en el aviso.
  motivo: z.string().trim().min(5, "El motivo debe explicar por qué se rechaza"),
});

// biome-ignore lint/suspicious/noExplicitAny: patrón de la casa para handlers
export const rechazarPagoBoleta = async ({ body, set, user }: any) => {
  if (!user || !["ADMIN", "CONTA"].includes(user.role)) {
    set.status = 403;
    return {
      success: false,
      message: "Solo ADMIN y CONTA pueden rechazar un pago del bot.",
    };
  }

  const parseResult = rechazarPagoBoletaSchema.safeParse(body);
  if (!parseResult.success) {
    set.status = 400;
    return {
      success: false,
      message: "Validation failed",
      errors: parseResult.error.flatten().fieldErrors,
    };
  }

  const { credito_id, pago_id, motivo } = parseResult.data;

  // Solo pagos del bot: para cualquier otro pago este botón ni aparece en el
  // front, y del lado del server tampoco pasa — un rechazo notificado sobre un
  // pago que el cliente no subió por WhatsApp sería un mensaje de la nada.
  const [pago] = await db
    .select({
      registerBy: pagos_credito.registerBy,
      credito_id: pagos_credito.credito_id,
    })
    .from(pagos_credito)
    .where(eq(pagos_credito.pago_id, pago_id))
    .limit(1);

  if (!pago) {
    set.status = 404;
    return { success: false, message: "El pago no existe." };
  }

  if (!esPagoDelBotCobros(pago.registerBy)) {
    set.status = 409;
    return {
      success: false,
      message:
        "Ese pago no lo subió el cliente por el bot: revertilo por el camino normal.",
    };
  }

  if (pago.credito_id !== credito_id) {
    set.status = 409;
    return { success: false, message: "El pago no es de ese crédito." };
  }

  // El SIFCO se lee ANTES del reverso, para el aviso.
  const [credito] = await db
    .select({ numero_credito_sifco: creditos.numero_credito_sifco })
    .from(creditos)
    .where(eq(creditos.credito_id, credito_id))
    .limit(1);

  // 1 · El reverso, con el handler de siempre. `setInterno` captura su estado
  // sin ensuciar el nuestro: si falla, se propaga tal cual y NO se avisa nada.
  const setInterno: { status?: number } = {};
  const resultadoReverso = await reversePayment({
    body: { credito_id, pago_id },
    set: setInterno,
  });

  if (setInterno.status && setInterno.status >= 400) {
    set.status = setInterno.status;
    return resultadoReverso;
  }

  // 2 · El aviso, esperando la respuesta: es el punto del botón. Si no llega,
  // el reverso YA ESTÁ HECHO y eso se le dice a conta con todas las letras —
  // le toca avisar por otro medio, no apretar de nuevo.
  const notificado = await notificarRechazoPagoBot({
    pagoId: pago_id,
    creditoId: credito_id,
    numeroSifco: credito?.numero_credito_sifco ?? null,
    motivo,
    usuario: user.email ?? user.nombre ?? null,
  });

  return {
    success: true,
    message: notificado
      ? "Pago revertido y cliente notificado."
      : "⚠️ Pago revertido, pero NO se pudo notificar al cliente: avisale por otro medio (el CRM no respondió).",
    notificacion_enviada: notificado,
    motivo,
  };
};
