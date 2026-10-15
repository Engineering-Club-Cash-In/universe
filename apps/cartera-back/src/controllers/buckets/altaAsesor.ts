import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../database";
import { SQL_CARTERA_SCHEMA as schema } from "../../database/db/schema";
import { decidirAltaAsesor } from "../../lib/alta-asesor";
import { normalizeEmail } from "../../utils/functions/email";
import { exigirActorRegistrado, TrasladoConflict } from "./trasladosCartera";

// ─────────────────────────────────────────────────────────────────────────────
// COBROS-02 · Alta de asesor desde «Mi equipo» del CRM (Figma «05 · Alta y Baja
// de Asesor»). En UNA transacción: el asesor (`asesores`, con `email_cash_in` =
// su correo del CRM) y su pool (`asesor_bucket`) según el nivel que eligió el
// supervisor. Es idempotente por correo: repetirlo con el mismo pool no escribe
// nada, así que el CRM puede reintentar el alta completa si un paso posterior
// (la cartera inicial) falla.
//
// No crea login de cartera (`platform_users`): el asesor de cobros entra al CRM,
// no a cartera. La cartera inicial la mueve el CRM después con la reasignación en
// bloque (S6), que valida el pool que se crea aquí.
// ─────────────────────────────────────────────────────────────────────────────

/** Capacidad por defecto de una fila nueva del pool (la misma de la columna). */
const CAPACIDAD_POR_DEFECTO = 300;

export const solicitudAltaAsesorSchema = z.object({
  nombre: z.string().trim().min(1, "El nombre es obligatorio").max(100),
  email: z.string().trim().email("Correo inválido").max(150),
  buckets: z
    .array(z.number().int().min(0).max(5))
    .min(1, "Indique al menos un bucket")
    .max(6)
    .refine((b) => new Set(b).size === b.length, "Buckets repetidos"),
  /** Correo del usuario del CRM que lo supervisa (migración 0027). */
  supervisorEmail: z.string().trim().email("Correo del supervisor inválido").max(150).optional(),
  /** Capacidad de cada bucket nuevo del pool (bucket → cuentas). Sin dato: 300. */
  capacidades: z
    .record(z.string().regex(/^[0-5]$/), z.number().int().min(1).max(2000))
    .optional(),
  actorEmail: z.string().email(),
});

export type ResultadoAltaAsesor = {
  success: true;
  asesor_id: number;
  nombre: string;
  email_cash_in: string;
  buckets: number[];
  supervisor_email: string | null;
  accion: "creado" | "reactivado" | "vinculado" | "existente";
};

export async function altaAsesorCobros(raw: unknown): Promise<ResultadoAltaAsesor> {
  const entrada = solicitudAltaAsesorSchema.parse(raw);
  const email = normalizeEmail(entrada.email);
  if (!email) throw new TrasladoConflict("Correo inválido");
  const buckets = [...entrada.buckets].sort((a, b) => a - b);
  const supervisor = normalizeEmail(entrada.supervisorEmail) ?? null;
  await exigirActorRegistrado(db, entrada.actorEmail);

  return db.transaction(async (tx) => {
    // Dos altas del mismo correo (doble clic, reintento) se serializan aquí.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`alta-asesor:${email}`}))`);
    const candidatos = (
      await tx.execute<{ asesor_id: number; activo: boolean | null; nombre: string }>(sql`
        SELECT asesor_id, activo, nombre FROM ${schema}.asesores
        WHERE lower(trim(email_cash_in)) = ${email}
        ORDER BY asesor_id
        FOR UPDATE`)
    ).rows;
    const ids = candidatos.map((c) => Number(c.asesor_id));
    const pool = ids.length
      ? (
          await tx.execute<{ asesor_id: number; bucket: number; activo: boolean }>(sql`
            SELECT asesor_id, bucket, activo FROM ${schema}.asesor_bucket
            WHERE asesor_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
            ORDER BY id
            FOR UPDATE`)
        ).rows
      : [];
    const decision = decidirAltaAsesor({
      buckets,
      candidatos: candidatos.map((c) => ({
        asesor_id: Number(c.asesor_id),
        activo: c.activo,
        poolActivo: pool.filter((p) => Number(p.asesor_id) === Number(c.asesor_id) && p.activo).map((p) => Number(p.bucket)),
        poolInactivo: pool.filter((p) => Number(p.asesor_id) === Number(c.asesor_id) && !p.activo).map((p) => Number(p.bucket)),
      })),
    });
    if (decision.accion === "conflicto") throw new TrasladoConflict(decision.mensaje);
    if (decision.accion === "existente") {
      const fila = candidatos.find((c) => Number(c.asesor_id) === decision.asesorId);
      // Reintento del alta: lo único que puede haber cambiado es el supervisor.
      if (supervisor) {
        await tx.execute(sql`
          UPDATE ${schema}.asesores SET supervisor_email = ${supervisor}
          WHERE asesor_id = ${decision.asesorId}
            AND supervisor_email IS DISTINCT FROM ${supervisor}`);
      }
      // Sin supervisor en el reintento, se responde el que ya tiene guardado.
      const [guardado] = (
        await tx.execute<{ supervisor_email: string | null }>(sql`
          SELECT supervisor_email FROM ${schema}.asesores
          WHERE asesor_id = ${decision.asesorId}`)
      ).rows;
      return {
        success: true as const,
        asesor_id: decision.asesorId,
        nombre: fila?.nombre ?? entrada.nombre,
        email_cash_in: email,
        buckets,
        supervisor_email: guardado?.supervisor_email ?? supervisor,
        accion: "existente" as const,
      };
    }

    let asesorId: number;
    if (decision.accion === "crear") {
      const [nuevo] = (
        await tx.execute<{ asesor_id: number }>(sql`
          INSERT INTO ${schema}.asesores (nombre, email_cash_in, activo, activo_para_creditos, supervisor_email)
          VALUES (${entrada.nombre}, ${email}, true, true, ${supervisor})
          RETURNING asesor_id`)
      ).rows;
      asesorId = Number(nuevo.asesor_id);
    } else {
      asesorId = decision.asesorId;
      // Reactivar (o vincular a un activo sin pool): vuelve al balanceo con el
      // nombre que registró el supervisor.
      await tx.execute(sql`
        UPDATE ${schema}.asesores
        SET activo = true, activo_para_creditos = true, nombre = ${entrada.nombre},
          supervisor_email = COALESCE(${supervisor}, supervisor_email)
        WHERE asesor_id = ${asesorId}`);
      // La baja también apagó su login ASESOR de cartera (trasladosCartera, con
      // `desactivarOrigen`): el alta lo vuelve a encender, simétrico a la baja.
      await tx.execute(sql`
        UPDATE ${schema}.platform_users SET is_active = true
        WHERE asesor_id = ${asesorId} AND role = 'ASESOR' AND NOT is_active`);
      // La baja dejó la marca `ausente` en su traslado (createCredit no le asigna
      // créditos con ella): el alta la apaga.
      await tx.execute(sql`
        UPDATE ${schema}.operaciones_traslado_cartera
        SET solicitud = solicitud || '{"ausente": false}'::jsonb
        WHERE asesor_origen_id = ${asesorId} AND estado = 'confirmada'
          AND solicitud->>'desactivarOrigen' = 'true' AND solicitud->>'ausente' = 'true'`);
    }

    // Pool EXACTAMENTE con los buckets del nivel: se encienden (o crean) los
    // pedidos y se apagan los demás. Una fila que ya existía conserva su capacidad.
    for (const bucket of buckets) {
      const capacidad = entrada.capacidades?.[String(bucket)] ?? CAPACIDAD_POR_DEFECTO;
      await tx.execute(sql`
        INSERT INTO ${schema}.asesor_bucket (asesor_id, bucket, activo, capacidad_base)
        VALUES (${asesorId}, ${bucket}, true, ${capacidad})
        ON CONFLICT (asesor_id, bucket) DO UPDATE SET activo = true, updated_at = now()`);
    }
    await tx.execute(sql`
      UPDATE ${schema}.asesor_bucket SET activo = false, updated_at = now()
      WHERE asesor_id = ${asesorId} AND activo
        AND bucket NOT IN (${sql.join(buckets.map((b) => sql`${b}`), sql`, `)})`);

    return {
      success: true as const,
      asesor_id: asesorId,
      nombre: entrada.nombre,
      email_cash_in: email,
      buckets,
      supervisor_email: supervisor,
      accion:
        decision.accion === "crear"
          ? ("creado" as const)
          : decision.accion === "reactivar"
            ? ("reactivado" as const)
            : ("vinculado" as const),
    };
  });
}
