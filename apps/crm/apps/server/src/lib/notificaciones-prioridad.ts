/**
 * COBROS-02 — la alerta `bot_modo_agente` abierta es la única con un cliente
 * esperando del otro lado (pidió un humano en el bot de WhatsApp).
 *
 * El orden va EN LA CONSULTA y no solo en la web: las listas de la campanita
 * cortan en 500 filas, y si se ordenara solo por fecha, un asesor con 500
 * avisos más nuevos nunca recibiría la alerta vieja que sigue abierta — ni en
 * la lista, ni en el banner, ni en el filtro (review de Codex, PR #1627). La
 * web vuelve a ordenar igual después de combinar sus listas
 * (`apps/web/src/lib/notificaciones-cobros.ts`).
 */

import { sql } from "drizzle-orm";
import { notifications } from "../db/schema/notifications";

/**
 * Para `ORDER BY`, ascendente: 0 = cliente esperando (va primero), 1 = el
 * resto. Se completa siempre con `desc(createdAt)` detrás.
 */
export const prioridadNotificacion = sql<number>`CASE WHEN ${notifications.cobrosTipo} = 'bot_modo_agente' AND ${notifications.status} IN ('pending', 'read', 'in_progress') THEN 0 ELSE 1 END`;
