import { and, asc, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "../database";
import { baterias_crm_pendientes } from "../database/db";
import {
  abrirBateriaDeContratosEnCrm,
  type BateriaDeContratosInput,
} from "../services/crm.service";

/**
 * La cola de los avisos de "compra aceptada" que el CRM no recibió.
 *
 * Al aceptar una compra, cartera le avisa al CRM para que le abra a jurídico
 * la batería de contratos. Ese aviso es best-effort —la compra ya se aceptó y
 * el espejo ya se movió— y antes, si el CRM no contestaba, se perdía: la
 * compra salía de "pendientes", nadie podía volver a mandarla, y jurídico
 * nunca se enteraba. Ahora el aviso que falla queda acá con su pedido entero y
 * una tarea lo reintenta.
 *
 * Reintentar es seguro: el CRM abre una sola batería por inversionista y juego
 * de créditos, trata igual un aviso repetido, e ignora el de una aceptación
 * anterior a la que ya tiene.
 */

/** Cuántas veces se intenta antes de dejarlo: a 10 minutos, medio día. */
export const MAX_INTENTOS = 72;

/** Deja el aviso para reintentarlo. Nunca lanza: esto también es best-effort. */
export async function guardarBateriaPendiente(
  input: BateriaDeContratosInput,
  error: string | undefined,
): Promise<void> {
  try {
    await db.insert(baterias_crm_pendientes).values({
      inversionista_id: input.inversionista.id,
      payload: input,
      intentos: 1,
      ultimo_error: error ?? null,
    });
    console.warn(
      `[bateriasCrmPendientes] el aviso de ${input.inversionista.nombre} quedó para reintentar: ${error ?? "sin detalle"}`,
    );
  } catch (errorAlGuardar) {
    console.error(
      `[bateriasCrmPendientes] no se pudo guardar el aviso de ${input.inversionista.nombre} para reintentar:`,
      errorAlGuardar,
    );
  }
}

/**
 * Reintenta los avisos pendientes, del más viejo al más nuevo. Los corre la
 * tarea programada cada 10 minutos.
 */
export async function reintentarBateriasPendientes(): Promise<{
  enviados: number;
  fallidos: number;
}> {
  const pendientes = await db
    .select()
    .from(baterias_crm_pendientes)
    .where(
      and(
        isNull(baterias_crm_pendientes.enviado_at),
        lt(baterias_crm_pendientes.intentos, MAX_INTENTOS),
      ),
    )
    .orderBy(asc(baterias_crm_pendientes.created_at))
    .limit(50);

  let enviados = 0;
  let fallidos = 0;
  for (const pendiente of pendientes) {
    const res = await abrirBateriaDeContratosEnCrm(
      pendiente.payload as BateriaDeContratosInput,
    );
    if (res.success) {
      await db
        .update(baterias_crm_pendientes)
        .set({ enviado_at: new Date() })
        .where(eq(baterias_crm_pendientes.id, pendiente.id));
      enviados += 1;
      continue;
    }

    await db
      .update(baterias_crm_pendientes)
      .set({
        intentos: sql`${baterias_crm_pendientes.intentos} + 1`,
        ultimo_error: res.error ?? null,
      })
      .where(eq(baterias_crm_pendientes.id, pendiente.id));
    fallidos += 1;
    if (pendiente.intentos + 1 >= MAX_INTENTOS) {
      console.error(
        `[bateriasCrmPendientes] se deja de reintentar el aviso ${pendiente.id} (inversionista ${pendiente.inversionista_id}): ${res.error ?? "sin detalle"}. Hay que avisarle a jurídico a mano.`,
      );
    }
  }

  return { enviados, fallidos };
}
