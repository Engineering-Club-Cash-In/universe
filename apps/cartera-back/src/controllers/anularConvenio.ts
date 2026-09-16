import { and, eq, isNull, sql } from "drizzle-orm";
import Big from "big.js";
import { db } from "../database";
import {
  convenios_pago,
  creditos,
  platform_users,
  SQL_CARTERA_SCHEMA,
} from "../database/db/schema";
import { CREDITO_ASESOR_LOCK_NAMESPACE } from "../lib/buckets-job-locks";
import { contarCuotasVencidasReales, createMora } from "./latefee";

// ─────────────────────────────────────────────────────────────────────────────
// COBROS-02 · Fase 3 — DESHACER un convenio YA APROBADO.
//
// No confundir con RECHAZAR (convenioDecision.ts). Son dos cosas distintas y por
// eso son dos funciones distintas:
//
//   · Rechazar es decidir sobre un convenio que NUNCA estuvo vigente. Ahí el
//     borrado duro es correcto: no hubo acuerdo, no hay nada que conservar.
//   · Deshacer es cancelar un acuerdo que el cliente SÍ firmó y dejó de pagar.
//     Ahí borrar destruye el plan de cuotas y la traza de lo que sí pagó — por
//     eso la decisión 10 del plan 08 pide soft delete.
//
// Efecto financiero: el mismo que el rechazo, porque la pregunta es la misma
// ("¿cuánto debe este crédito si el convenio no existiera?"). Se recuenta el
// atraso REAL y se recrea la mora, o se deja ACTIVO si ya no debe nada. Las
// cuotas del convenio y los pagos que se le aplicaron NO se tocan: quedan
// colgando del convenio anulado, que es donde tienen sentido.
//
// El bucket se suelta solo: al volver a MOROSO, el motor de las 23:59 vuelve a
// derivarlo de las cuotas atrasadas y escribe la transición contra la fila
// `CONGELADO` que dejó el convenio. No hay nada que "descongelar" a mano.
// ─────────────────────────────────────────────────────────────────────────────

export type AnularConvenioResultado =
  | {
      success: true;
      convenio_id: number;
      credito_id: number;
      /** Status con el que quedó el crédito tras deshacer. */
      status_credito: "MOROSO" | "ACTIVO";
      /** Cuotas vencidas reales recontadas al deshacer (0 si quedó ACTIVO). */
      cuotas_atrasadas: number;
    }
  | { success: false; message: string; status: number };

/** Igual que en la recuperación: lanzar es lo único que revierte la transacción. */
class AnulacionAbortada extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AnulacionAbortada";
  }
}

export async function anularConvenio(params: {
  convenio_id: number;
  motivo: string;
  /** Correo de quien lo pidió; se resuelve a platform_users para la bitácora. */
  usuario_email?: string;
  /**
   * PRECONDICIÓN de dueño, revalidada acá adentro contra el dueño REAL.
   *
   * Quien autorizó del lado del CRM verificó, en OTRA request, que el crédito
   * era de esa persona. Entre esa verificación y esta escritura el motor o un
   * supervisor pueden haberlo reasignado, y sin precondición el asesor que ya
   * lo perdió deshacía igual el convenio (review de Codex, P1 — es la misma
   * carrera que la recuperación de vehículo ya cerraba así).
   *
   * Va vacío cuando quien llama ve toda la cartera (admin / supervisor): ahí no
   * hay dueño esperado que exigir.
   */
  asesor_esperado_email?: string;
}): Promise<AnularConvenioResultado> {
  const motivo = (params.motivo ?? "").trim();
  if (motivo.length < 5) {
    return {
      success: false,
      status: 400,
      message: "[ERROR] Deshacer un convenio requiere un motivo de al menos 5 caracteres.",
    };
  }

  try {
    return await db.transaction(async (tx) => {
      // Exclusión mutua por UPDATE condicional, no read-then-write: dos clics
      // simultáneos no pueden anular dos veces ni pisar una decisión en curso.
      // `anulado_at IS NULL` es lo que hace la operación idempotente-segura, y
      // `activo = true` la acota a convenios VIGENTES: uno pendiente de
      // aprobación se rechaza, no se deshace.
      let usuarioId: number | null = null;
      const correo = params.usuario_email?.trim().toLowerCase();
      if (correo) {
        const [u] = await tx
          .select({ id: platform_users.id })
          .from(platform_users)
          .where(sql`lower(trim(${platform_users.email})) = ${correo}`)
          .limit(1);
        usuarioId = u?.id ?? null;
      }

      // ── Exclusión: el lock por crédito, el mismo que toman la reasignación
      // de asesor y la recuperación de vehículo.
      //
      // Hace falta leer el crédito para saber sobre qué bloquear, así que esa
      // primera lectura es solo para eso: la decisión NO se toma con ella.
      const [delConvenio] = await tx
        .select({ credito_id: convenios_pago.credito_id })
        .from(convenios_pago)
        .where(eq(convenios_pago.convenio_id, params.convenio_id))
        .limit(1);
      if (!delConvenio) {
        throw new AnulacionAbortada(
          404,
          `[ERROR] No se encontró el convenio ${params.convenio_id}`,
        );
      }
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(${CREDITO_ASESOR_LOCK_NAMESPACE}, ${delConvenio.credito_id})`,
      );

      // ── Dueño esperado: la condición viaja DENTRO del UPDATE, no en un
      // SELECT previo (review de Codex, P1).
      //
      // Un `SELECT` y después un `UPDATE` son dos statements: bajo READ
      // COMMITTED una reasignación puede commitear entre los dos y el asesor
      // que ya perdió el crédito pasaba igual el chequeo. Poniendo el predicado
      // en el WHERE del propio UPDATE, la comprobación y la escritura son el
      // mismo acto: o el crédito sigue siendo suyo en el instante en que se
      // escribe, o no se escribe nada.
      //
      // Se compara por `email_cash_in`, el mismo puente por correo con el que
      // el CRM decide la propiedad, con los dos lados normalizados.
      const esperado = params.asesor_esperado_email?.trim().toLowerCase();
      const condicionDueno = esperado
        ? sql`AND EXISTS (
            SELECT 1
            FROM ${SQL_CARTERA_SCHEMA}.creditos c
            JOIN ${SQL_CARTERA_SCHEMA}.asesores a ON a.asesor_id = c.asesor_id
            WHERE c.credito_id = ${SQL_CARTERA_SCHEMA}.convenios_pago.credito_id
              AND lower(trim(a.email_cash_in)) = ${esperado}
          )`
        : sql``;

      const anuladoRes = await tx.execute<{ convenio_id: number; credito_id: number }>(sql`
        UPDATE ${SQL_CARTERA_SCHEMA}.convenios_pago
           SET activo = false,
               anulado_at = now(),
               anulado_por = ${usuarioId},
               motivo_anulacion = ${motivo},
               updated_at = now()
         WHERE convenio_id = ${params.convenio_id}
           AND activo = true
           AND completado = false
           AND anulado_at IS NULL
           ${condicionDueno}
        RETURNING convenio_id, credito_id, status_credito_previo
      `);
      const anulado = anuladoRes.rows?.[0] as
        | {
            convenio_id: number;
            credito_id: number;
            status_credito_previo: string | null;
          }
        | undefined;

      if (!anulado) {
        // No se distingue "ya no está vigente" de "ya no es tuyo" a propósito:
        // averiguarlo pedía otra lectura y las dos respuestas llevan a lo
        // mismo — recargar la vista.
        throw new AnulacionAbortada(
          409,
          esperado
            ? "[ERROR] No se pudo deshacer el convenio: o ya no está vigente (deshecho, completado o pendiente de aprobación), o el crédito se reasignó a otro asesor. Actualizá la vista e intentá de nuevo."
            : "[ERROR] El convenio no está vigente: puede que ya se haya deshecho, completado, o que todavía esté pendiente de aprobación (en ese caso se rechaza, no se deshace).",
        );
      }

      // ¿Cuánto debe el crédito ahora que el convenio no cuenta? Mismo recuento
      // que usa el rechazo — la pregunta es idéntica.
      const cuotasAtrasadas = await contarCuotasVencidasReales(
        anulado.credito_id,
        "MOROSO",
        tx,
      );

      if (cuotasAtrasadas > 0) {
        const [{ capital } = { capital: "0" }] = await tx
          .select({ capital: creditos.capital })
          .from(creditos)
          .where(eq(creditos.credito_id, anulado.credito_id));

        // Misma fórmula que el motor: capital × 1.12% × cuotas atrasadas.
        const montoMora = new Big(capital).times("0.0112").times(cuotasAtrasadas);

        await tx
          .update(creditos)
          .set({ statusCredit: "MOROSO" })
          .where(eq(creditos.credito_id, anulado.credito_id));

        const resultMora = await createMora(
          {
            credito_id: anulado.credito_id,
            monto_mora: Number(montoMora.toFixed(2)),
            cuotas_atrasadas: cuotasAtrasadas,
            origen: "API_MANUAL",
            motivo: `Convenio deshecho: ${motivo}`,
            usuario_id: usuarioId ?? undefined,
          },
          tx,
        );

        // `createMora` devuelve {success:false} en vez de lanzar. Drizzle solo
        // revierte si la callback LANZA: sin este throw quedaría comiteado el
        // convenio anulado sin la mora recreada — un crédito que no le debe
        // nada a nadie (mismo criterio que convenioDecision.ts).
        if (!resultMora.success) {
          throw new Error(
            `No se pudo recrear la mora del crédito ${anulado.credito_id} al deshacer el convenio: ${resultMora.message}`,
          );
        }

        return {
          success: true as const,
          convenio_id: anulado.convenio_id,
          credito_id: anulado.credito_id,
          status_credito: "MOROSO" as const,
          cuotas_atrasadas: cuotasAtrasadas,
        };
      }

      await tx
        .update(creditos)
        .set({ statusCredit: "ACTIVO" })
        .where(eq(creditos.credito_id, anulado.credito_id));

      return {
        success: true as const,
        convenio_id: anulado.convenio_id,
        credito_id: anulado.credito_id,
        status_credito: "ACTIVO" as const,
        cuotas_atrasadas: 0,
      };
    });
  } catch (err) {
    if (err instanceof AnulacionAbortada) {
      return { success: false, status: err.status, message: err.message };
    }
    console.error("[ANULAR-CONVENIO] ⚠️ Error deshaciendo el convenio:", err);
    return {
      success: false,
      status: 500,
      message:
        err instanceof Error
          ? `[ERROR] ${err.message}`
          : "[ERROR] No se pudo deshacer el convenio",
    };
  }
}
