/**
 * Barrido de las cuentas Nexa pendientes (job `retry_nexa_accounts`, cada 15
 * minutos). Los recibos de Nexa los barre otro job (`retry_nexa_receipts`).
 *
 *   1. Cuentas pendientes: filas de la automatización (`cuenta_solicitada_at`)
 *      sin token, porque nexa-server falló cuando el CRM la pidió. Se vuelve a
 *      pedir con el DPI guardado, hasta 10 intentos.
 *   2. Cuentas sin avisar: ya tienen token pero el cliente no la recibió en la
 *      bienvenida (la cuenta llegó tarde, la bienvenida falló o está apagada).
 *      Se le pide al CRM el mensaje aparte y, si salió, se marca avisada. Se
 *      espera 15 minutos desde el último cambio para no pisarse con la
 *      bienvenida que la está mandando.
 *
 * Las filas del piloto (insertadas a mano, sin `cuenta_solicitada_at`) no se
 * tocan. Nunca lanza.
 */

import { and, asc, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import config from "../config";
import { db } from "../database";
import { asesores, creditos, nexa_credit_bindings, usuarios } from "../database/db";
import { notifyCuentaNexaWhatsapp } from "../services/crm.service";
import { cuentaNexaDeps, solicitarCuentaNexa } from "./nexaCuentaCliente";

const MAX_INTENTOS_CUENTA = 10;
const LIMITE = 50;

export async function reintentarCuentasNexaPendientes(): Promise<{
  cuentasReintentadas: number;
  cuentasCreadas: number;
  avisosEnviados: number;
}> {
  const resumen = {
    cuentasReintentadas: 0,
    cuentasCreadas: 0,
    avisosEnviados: 0,
  };

  if (config.nexaCuentaAutomaticaEnabled) {
    try {
      // 1. Cuentas sin token.
      const sinToken = await db
        .select({ numeroSifco: creditos.numero_credito_sifco })
        .from(nexa_credit_bindings)
        .innerJoin(creditos, eq(creditos.credito_id, nexa_credit_bindings.credito_id))
        .where(and(
          isNotNull(nexa_credit_bindings.cuenta_solicitada_at),
          isNull(nexa_credit_bindings.nexa_token),
          lt(nexa_credit_bindings.cuenta_intentos, MAX_INTENTOS_CUENTA),
          lt(nexa_credit_bindings.updated_at, sql`now() - interval '10 minutes'`),
        ))
        .orderBy(asc(nexa_credit_bindings.updated_at))
        .limit(LIMITE);
      for (const { numeroSifco } of sinToken) {
        resumen.cuentasReintentadas += 1;
        const r = await solicitarCuentaNexa({ numeroSifco }, cuentaNexaDeps);
        if (r.estado === "lista") resumen.cuentasCreadas += 1;
      }

      // 2. Cuentas con token que el cliente no recibió.
      const sinAviso = await db
        .select({
          creditoId: nexa_credit_bindings.credito_id,
          numeroSifco: creditos.numero_credito_sifco,
          token: nexa_credit_bindings.nexa_token,
          clienteNombre: usuarios.nombre,
          asesorNombre: asesores.nombre,
          asesorTelefono: asesores.telefono,
        })
        .from(nexa_credit_bindings)
        .innerJoin(creditos, eq(creditos.credito_id, nexa_credit_bindings.credito_id))
        .innerJoin(usuarios, eq(usuarios.usuario_id, creditos.usuario_id))
        .leftJoin(asesores, eq(asesores.asesor_id, creditos.asesor_id))
        .where(and(
          isNotNull(nexa_credit_bindings.cuenta_solicitada_at),
          isNotNull(nexa_credit_bindings.nexa_token),
          isNull(nexa_credit_bindings.cuenta_notificada_at),
          lt(nexa_credit_bindings.updated_at, sql`now() - interval '15 minutes'`),
        ))
        .orderBy(asc(nexa_credit_bindings.updated_at))
        .limit(LIMITE);
      for (const fila of sinAviso) {
        if (!fila.token) continue;
        const aviso = await notifyCuentaNexaWhatsapp({
          numeroSifco: fila.numeroSifco,
          token: fila.token,
          clienteNombre: fila.clienteNombre,
          asesorNombre: fila.asesorNombre,
          asesorTelefono: fila.asesorTelefono,
        });
        if (aviso.success) {
          resumen.avisosEnviados += 1;
          await db
            .update(nexa_credit_bindings)
            .set({ cuenta_notificada_at: new Date(), updated_at: new Date() })
            .where(eq(nexa_credit_bindings.credito_id, fila.creditoId));
        } else {
          // Corre el reloj para no reintentar el mismo aviso en cada vuelta.
          await db
            .update(nexa_credit_bindings)
            .set({ updated_at: new Date() })
            .where(eq(nexa_credit_bindings.credito_id, fila.creditoId));
        }
      }
    } catch (error) {
      console.error(
        "⚠️ Barrido de cuentas Nexa falló:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  return resumen;
}
