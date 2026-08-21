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
 * Hace dos cosas, en este orden: reversa TODOS los pagos de la boleta —una
 * boleta que cubrió dos cuotas creó dos filas— LLAMANDO AL `reversePayment`
 * EXISTENTE por cada uno, sin tocarlo (D-38), y le avisa al CRM esperando la
 * respuesta, porque avisar es el punto de todo el botón.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Solo ADMIN y CONTA, igual que el resto de acciones contables sobre pagos.
 */

import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../database";
import { boletas, creditos, pagos_credito } from "../database/db/schema";
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

  // La boleta es UNA pero sus pagos pueden ser VARIOS: una boleta que alcanza
  // para dos cuotas atrasadas crea dos filas de `pagos_credito`, cada una
  // colgada de la misma URL. Rechazar "el pago" es rechazar la boleta entera:
  // reversar solo la fila seleccionada dejaría a las hermanas aplicadas
  // mientras el cliente recibe "tu pago no se acreditó" — mora y saldo
  // mintiendo en direcciones opuestas. Se buscan los hermanos por la URL.
  const urlsDeLaBoleta = (
    await db
      .select({ url: boletas.url_boleta })
      .from(boletas)
      .where(and(eq(boletas.pago_id, pago_id), isNotNull(boletas.url_boleta)))
  )
    .map((f) => f.url)
    .filter((url): url is string => url !== null && url.trim() !== "");

  // Sin filas de `boletas` (un huérfano de §4.1) no hay con qué buscar
  // hermanos: se reversa solo el pago señalado.
  const hermanos = urlsDeLaBoleta.length
    ? await db
        .selectDistinct({
          pago_id: boletas.pago_id,
          registerBy: pagos_credito.registerBy,
          credito_id: pagos_credito.credito_id,
        })
        .from(boletas)
        .innerJoin(pagos_credito, eq(pagos_credito.pago_id, boletas.pago_id))
        .where(inArray(boletas.url_boleta, urlsDeLaBoleta))
    : [];

  // Si la misma URL cuelga de un pago que NO es del bot o de OTRO crédito,
  // este botón no tiene autoridad para reversarlo — y reversar solo una parte
  // es justo el estado mentiroso de arriba. Se corta entero y lo ve una
  // persona.
  const fueraDeAlcance = hermanos.filter(
    (h) => !esPagoDelBotCobros(h.registerBy) || h.credito_id !== credito_id,
  );
  if (fueraDeAlcance.length > 0) {
    set.status = 409;
    return {
      success: false,
      message:
        "La boleta de ese pago también respalda pagos que no son del bot o son de otro crédito: revisalo manualmente antes de rechazar.",
      pagos_fuera_de_alcance: fueraDeAlcance.map((h) => h.pago_id),
    };
  }

  const pagosARevertir = [
    ...new Set([pago_id, ...hermanos.map((h) => h.pago_id)]),
  ].sort((a, b) => b - a); // el más nuevo primero, como en un reverso a mano

  // 1 · Los reversos, con el handler de siempre. `setInterno` captura su
  // estado sin ensuciar el nuestro: si uno falla, se corta ahí, se informa
  // qué quedó a medias y NO se avisa nada — el mensaje de "no se acreditó"
  // solo puede salir cuando ya no queda nada aplicado.
  const revertidos: number[] = [];
  for (const id of pagosARevertir) {
    const setInterno: { status?: number } = {};
    const resultadoReverso = await reversePayment({
      body: { credito_id, pago_id: id },
      set: setInterno,
    });

    if (setInterno.status && setInterno.status >= 400) {
      set.status = setInterno.status;
      return {
        ...(typeof resultadoReverso === "object" ? resultadoReverso : {}),
        success: false,
        message: revertidos.length
          ? `⚠️ Se revirtieron los pagos ${revertidos.join(", ")} pero el ${id} falló: la boleta quedó a medias, NO se notificó al cliente. Resolvé el pago ${id} y volvé a rechazar.`
          : `El reverso del pago ${id} falló: no se revirtió nada ni se notificó al cliente.`,
        pagos_revertidos: revertidos,
        pago_fallido: id,
      };
    }
    revertidos.push(id);
  }

  // 2 · El aviso, esperando la respuesta: es el punto del botón. Si no llega,
  // los reversos YA ESTÁN HECHOS y eso se le dice a conta con todas las letras —
  // le toca avisar por otro medio, no apretar de nuevo.
  const notificado = await notificarRechazoPagoBot({
    pagoId: pago_id,
    creditoId: credito_id,
    numeroSifco: credito?.numero_credito_sifco ?? null,
    motivo,
    usuario: user.email ?? user.nombre ?? null,
  });

  const cuantos =
    revertidos.length === 1
      ? "Pago revertido"
      : `${revertidos.length} pagos de la boleta revertidos`;

  return {
    success: true,
    message: notificado
      ? `${cuantos} y cliente notificado.`
      : `⚠️ ${cuantos}, pero NO se pudo notificar al cliente: avisale por otro medio.`,
    notificacion_enviada: notificado,
    pagos_revertidos: revertidos,
    motivo,
  };
};
