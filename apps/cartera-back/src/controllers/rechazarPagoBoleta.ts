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

import Big from "big.js";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../database";
import {
  boletas,
  creditos,
  pagos_credito,
  usuarios,
} from "../database/db/schema";
import {
  esPagoDelBotCobros,
  notificarRechazoPagoBot,
} from "../services/crm.service";
import { withPaymentAdvisoryLock } from "../utils/paymentAdvisoryLock";
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
      monto_boleta: pagos_credito.monto_boleta,
      validation_status: pagos_credito.validationStatus,
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

  // El SIFCO se lee ANTES del reverso, para el aviso. El dueño, para el
  // saldo a favor de abajo.
  const [credito] = await db
    .select({
      numero_credito_sifco: creditos.numero_credito_sifco,
      usuario_id: creditos.usuario_id,
    })
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

  // Un pago del bot SIN boleta viva puede ser dos cosas, y solo una se
  // rechaza. El huérfano legítimo de §4.1 (insertPayment murió antes de
  // escribir su fila de `boletas`) tiene monto y estado aplicables. Pero un
  // "Revertir" normal también deja esta silueta: borra las filas de `boletas`
  // y resetea el pago a `no_required` con monto 0 — con `registerBy` todavía
  // diciendo bot. Rechazar ESO reversaría Q0 y le mandaría al cliente el
  // aviso de una boleta que ya se resolvió por otro camino.
  if (urlsDeLaBoleta.length === 0) {
    const montoDelPago = new Big(pago.monto_boleta ?? 0);
    if (pago.validation_status === "no_required" || montoDelPago.lte(0)) {
      set.status = 409;
      return {
        success: false,
        message:
          "Ese pago ya no respalda ninguna boleta viva (probablemente ya se revirtió por el camino normal): no hay nada que rechazar ni que avisar.",
      };
    }
  }

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

  // 1 · Los reversos, con el handler de siempre — TODO EL LOTE bajo el mismo
  // candado por crédito que toma `insertPayment`. Sin él, un pago entrando al
  // mismo crédito entre la foto del saldo y su escritura final se pisaría en
  // silencio (los reversos pasan minutos en facturas e inversionistas). Un
  // pago de OTRO crédito del mismo usuario todavía puede colarse: esa
  // exposición ya la tiene `reversePayment` solo —lee y escribe el saldo sin
  // ningún candado por usuario— y este endpoint no la agranda ni la achica.
  //
  // Sobre el saldo a favor, dos hechos del sistema que este endpoint NO puede
  // arreglar sin tocar lo que D-38 prohíbe: `registerPayment` le acredita al
  // saldo solo el SOBRANTE de la boleta (lo que no cupo en cuotas), pero
  // estampa el monto COMPLETO en cada fila, y cada `reversePayment` resta ese
  // monto entero (con piso en cero). O sea: hasta UNA reversión puede restar
  // de más, y N hermanos restarían N veces. Cuánto aportó la boleta de verdad
  // no es reconstruible (no se persiste, y armarlo desde monto_aplicado/mora/
  // convenio sería inventar contabilidad sobre estampas con bugs conocidos).
  // Lo único que no inventa nada: dejar el efecto neto EXACTO de una reversión
  // del sistema. Se fotografía el saldo después del PRIMER reverso y al final
  // se restaura ahí — los N−1 descuentos extra desaparecen y el resultado es
  // el mismo que conta obtiene hoy reversando un pago de una sola fila. Si
  // `reversePayment` corrige su fórmula algún día, esto la hereda gratis.
  type CorteAMedias = {
    resultadoReverso: unknown;
    revertidos: number[];
    saldoRestaurado: boolean;
    pagoFallido: number;
  };

  const leerSaldo = async (): Promise<string | null> => {
    if (!credito?.usuario_id) return null;
    const [duenio] = await db
      .select({ saldo_a_favor: usuarios.saldo_a_favor })
      .from(usuarios)
      .where(eq(usuarios.usuario_id, credito.usuario_id))
      .limit(1);
    return duenio?.saldo_a_favor ?? null;
  };

  const resultadoLote = await withPaymentAdvisoryLock(
    credito_id,
    async (): Promise<{ corte: CorteAMedias } | { revertidos: number[] }> => {
      const conCorreccion =
        pagosARevertir.length > 1 && Boolean(credito?.usuario_id);
      const saldoAntesDeRevertir = conCorreccion ? await leerSaldo() : null;
      let saldoTrasPrimerReverso: string | null = null;

      const revertidos: number[] = [];
      for (const id of pagosARevertir) {
        const setInterno: { status?: number } = {};
        const resultadoReverso = await reversePayment({
          body: { credito_id, pago_id: id },
          set: setInterno,
        });

        if (setInterno.status && setInterno.status >= 400) {
          set.status = setInterno.status;

          // El corte a medias arregla el saldo RESTAURÁNDOLO a la foto
          // inicial: deducción neta CERO en este intento, y el descuento
          // único queda para el intento que complete la boleta. Si acá se
          // restara algo, el reintento restaría OTRA vez — los hermanos ya
          // reversados pierden sus filas de `boletas` y el próximo request
          // ni los ve. Cada camino descuenta la boleta exactamente una vez:
          // completo de un tiro (corrección de abajo), o parcial+reintento
          // (neta cero ahora, una resta al completar — incluso si al
          // reintento le queda un solo hermano y el descuento lo hace el
          // propio reversePayment).
          let saldoRestaurado = true;
          if (
            revertidos.length > 0 &&
            saldoAntesDeRevertir !== null &&
            credito?.usuario_id
          ) {
            try {
              await db
                .update(usuarios)
                .set({ saldo_a_favor: saldoAntesDeRevertir })
                .where(eq(usuarios.usuario_id, credito.usuario_id));
            } catch (error) {
              saldoRestaurado = false;
              console.error(
                `[RechazarPagoBoleta] no se pudo restaurar el saldo a favor tras el corte a medias:`,
                error,
              );
            }
          }

          return {
            corte: {
              resultadoReverso,
              revertidos,
              saldoRestaurado,
              pagoFallido: id,
            },
          };
        }
        revertidos.push(id);

        // La foto que manda: lo que el PRIMER reverso dejó en el saldo.
        if (conCorreccion && revertidos.length === 1) {
          saldoTrasPrimerReverso = await leerSaldo();
        }
      }

      // La corrección del doble descuento: el saldo vuelve a lo que dejó el
      // primer reverso, como si los hermanos nunca lo hubieran tocado.
      if (
        conCorreccion &&
        saldoTrasPrimerReverso !== null &&
        credito?.usuario_id
      ) {
        await db
          .update(usuarios)
          .set({ saldo_a_favor: saldoTrasPrimerReverso })
          .where(eq(usuarios.usuario_id, credito.usuario_id));

        console.log(
          `[RechazarPagoBoleta] saldo a favor restaurado a Q${saldoTrasPrimerReverso} (lo que dejó el primer reverso; los otros ${revertidos.length - 1} no lo tocan)`,
        );
      }

      return { revertidos };
    },
  );

  if ("corte" in resultadoLote) {
    const { resultadoReverso, revertidos, saldoRestaurado, pagoFallido } =
      resultadoLote.corte;
    return {
      ...(typeof resultadoReverso === "object" && resultadoReverso !== null
        ? resultadoReverso
        : {}),
      success: false,
      message: revertidos.length
        ? `⚠️ Se revirtieron los pagos ${revertidos.join(", ")} pero el ${pagoFallido} falló: la boleta quedó a medias, NO se notificó al cliente.${
            saldoRestaurado
              ? " El saldo a favor quedó restaurado (la boleta se descuenta cuando se complete el rechazo)."
              : " ⚠️ Y NO se pudo restaurar el saldo a favor: revisalo a mano antes de reintentar."
          } Resolvé el pago ${pagoFallido} y volvé a rechazar.`
        : `El reverso del pago ${pagoFallido} falló: no se revirtió nada ni se notificó al cliente.`,
      pagos_revertidos: revertidos,
      pago_fallido: pagoFallido,
    };
  }

  const revertidos = resultadoLote.revertidos;

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
