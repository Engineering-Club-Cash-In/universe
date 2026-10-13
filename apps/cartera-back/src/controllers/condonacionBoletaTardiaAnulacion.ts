import type { db } from "../database";
import { anularCondonacionBoletaTardia } from "./latefee";

/**
 * Un pago de boleta tardía se INVALIDÓ (falsePayment / anularPagoMora, reversePayment), estuviera pendiente o
 * validado: la condonación del retraso se anula —la mora vuelve y el ledger queda compensado con ANULACION—.
 * Corre en la tx del llamador (que ya tiene el crédito FOR UPDATE: otra conexión se colgaría) y DESPUÉS de restituir
 * la mora legítima L. `restitucionMoraDePago` devuelve solo `pagos_credito.mora` (L); la X condonada nunca estuvo
 * ahí, así que no hay doble restitución. `reactivarMora`: si todo era retraso (L = 0) y el pago apagó la mora,
 * nadie más la reactiva. Una boleta escribe 1..N filas: invalidar cualquiera anula UNA vez, las demás no hacen nada.
 * `usuario_email`: el actor que invalida (firma la anulación); sin él, el usuario sistema. Si falla, lanza y aborta.
 */
export async function anularCondonacionPorPagoInvalidado({
  credito_id, pago_id, boleta_tardia_intento_id, accion, usuario_email, dbClient,
}: {
  credito_id: number; pago_id: number; boleta_tardia_intento_id: string | null | undefined;
  accion: "anulo" | "revirtio"; usuario_email?: string; dbClient: typeof db;
}): Promise<{ anulada: boolean; condonacion_id?: number }> {
  if (!boleta_tardia_intento_id) return { anulada: false };
  const motivo = `Condonación por boleta tardía anulada: el pago ${pago_id} se ${accion === "anulo" ? "anuló" : "revirtió"}`;
  const r = await anularCondonacionBoletaTardia({
    intento_id: boleta_tardia_intento_id, credito_id, motivo, reactivarMora: true, usuario_email, dbClient,
  });
  if (!r.anulada) return { anulada: false };
  console.warn(JSON.stringify({
    level: "warn", event: "boleta_tardia.condonacion_anulada_por_pago_invalidado",
    mensaje: motivo, credito_id, pago_id, condonacion_id: r.condonacion_id, monto_restituido: r.monto, restituida: r.restituida,
  }));
  return { anulada: true, condonacion_id: r.condonacion_id };
}

/**
 * Email de platform_users de quien invalida el pago, para firmar la anulación. Firma AUNQUE el actor esté inactivo
 * (si existe): `is_active` autoriza, no identifica. Sin id, sin fila o con la base caída cae al sistema (undefined)
 * y deja un warn con el id: invalidar un pago nunca debe fallar por esto.
 */
export async function emailVigenteDelActor(user: unknown): Promise<string | undefined> {
  const id = (user as { id?: unknown } | null | undefined)?.id;
  try {
    const { findSessionUser } = await import("./auth");
    const fila = await findSessionUser(id);
    if (fila && typeof fila.email === "string" && fila.email.trim()) return fila.email;
  } catch (error) {
    console.warn(JSON.stringify({ level: "warn", event: "boleta_tardia.actor_sin_resolver", user_id: id ?? null, error: String(error) }));
    return undefined;
  }
  console.warn(JSON.stringify({ level: "warn", event: "boleta_tardia.actor_sin_resolver", user_id: id ?? null, firma: "sistema" }));
  return undefined;
}
