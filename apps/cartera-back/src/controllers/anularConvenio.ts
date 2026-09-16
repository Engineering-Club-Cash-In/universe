import { and, eq, isNull, sql } from "drizzle-orm";
import Big from "big.js";
import { db } from "../database";
import {
  convenios_pago,
  creditos,
  platform_users,
} from "../database/db/schema";
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

      const [anulado] = await tx
        .update(convenios_pago)
        .set({
          activo: false,
          anulado_at: new Date(),
          anulado_por: usuarioId,
          motivo_anulacion: motivo,
          updated_at: new Date(),
        })
        .where(
          and(
            eq(convenios_pago.convenio_id, params.convenio_id),
            eq(convenios_pago.activo, true),
            eq(convenios_pago.completado, false),
            isNull(convenios_pago.anulado_at),
          ),
        )
        .returning();

      if (!anulado) {
        throw new AnulacionAbortada(
          409,
          "[ERROR] El convenio no está vigente: puede que ya se haya deshecho, completado, o que todavía esté pendiente de aprobación (en ese caso se rechaza, no se deshace).",
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
