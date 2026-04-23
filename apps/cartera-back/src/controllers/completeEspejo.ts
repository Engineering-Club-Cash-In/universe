import { db } from "../database";
import {
  creditos_inversionistas_espejo,
  creditos_inversionistas,
  creditos,
  inversionistas,
} from "../database/db";
import { eq, inArray, and } from "drizzle-orm";
import z from "zod";
import jwt from "jsonwebtoken";
import { sendPlainEmail } from "@cci/email";
import { INVESTOR_STATUS_CHANGE_RECIPIENTS } from "../utils/functions/investorStatusRecipients";

const JWT_SECRET = process.env.JWT_SECRET || "supersecreto";

// ========================================
// SCHEMA DE VALIDACIÓN
// ========================================

const completeEspejoSchema = z.object({
  creditos: z.union([
    z.number().int().positive(),
    z.array(z.number().int().positive()).min(1),
  ]),
  inversionista_id: z.number().int().positive().optional(),
});

// ========================================
// CONTROLLER
// ========================================

export const completeEspejo = async ({ body, set, request }: any) => {
  try {
    const parseResult = completeEspejoSchema.safeParse(body);
    if (!parseResult.success) {
      set.status = 400;
      return {
        message: "Validation failed",
        errors: parseResult.error.flatten().fieldErrors,
      };
    }

    const { creditos: creditosInput, inversionista_id } = parseResult.data;

    // Normalizar a array
    const creditoIds = Array.isArray(creditosInput)
      ? creditosInput
      : [creditosInput];

    const resultados: any[] = [];

    await db.transaction(async (tx) => {
      for (const credito_id of creditoIds) {
        const whereConditions = inversionista_id
          ? and(
              eq(creditos_inversionistas_espejo.credito_id, credito_id),
              eq(creditos_inversionistas_espejo.inversionista_id, inversionista_id),
            )
          : eq(creditos_inversionistas_espejo.credito_id, credito_id);

        const updated = await tx
          .update(creditos_inversionistas_espejo)
          .set({
            status: "completado",
            fecha_inicio_participacion: new Date().toISOString().split('T')[0],
            updated_at: new Date(),
          })
          .where(whereConditions)
          .returning({
            id: creditos_inversionistas_espejo.id,
            credito_id: creditos_inversionistas_espejo.credito_id,
            inversionista_id: creditos_inversionistas_espejo.inversionista_id,
            status: creditos_inversionistas_espejo.status,
          });

        const whereConditionsPadre = inversionista_id
          ? and(
              eq(creditos_inversionistas.credito_id, credito_id),
              eq(creditos_inversionistas.inversionista_id, inversionista_id),
            )
          : eq(creditos_inversionistas.credito_id, credito_id);

        await tx
          .update(creditos_inversionistas)
          .set({
            fecha_inicio_participacion: new Date().toISOString().split('T')[0],
          })
          .where(whereConditionsPadre);

        resultados.push({
          credito_id,
          registros_actualizados: updated.length,
          detalle: updated,
        });

        console.log(
          `✅ Crédito ${credito_id} - ${updated.length} registros espejo marcados como completado`,
        );
      }
    });

    const totalActualizados = resultados.reduce(
      (acc, r) => acc + r.registros_actualizados,
      0,
    );

    // ========================================================================
    // CORREO DE NOTIFICACIÓN
    // ========================================================================
    // Se manda solo si hubo al menos un registro actualizado.
    // Va a la misma lista hardcodeada que los cambios de status del
    // inversionista (INVESTOR_STATUS_CHANGE_RECIPIENTS).
    let correos_enviados = 0;
    let correos_fallidos = 0;

    if (totalActualizados > 0) {
      try {
        // Resolver ejecutor desde el JWT (opcional, best-effort)
        let usuarioEmail: string | undefined;
        let usuarioNombre: string | undefined;
        try {
          const authHeader = request?.headers?.get?.("Authorization");
          if (authHeader?.startsWith("Bearer ")) {
            const token = authHeader.replace("Bearer ", "").trim();
            const decoded = jwt.verify(token, JWT_SECRET) as any;
            usuarioEmail = decoded.email ?? decoded.correo ?? undefined;
            usuarioNombre = decoded.nombre ?? decoded.name ?? undefined;
          }
        } catch (jwtErr) {
          console.warn("[completeEspejo] No se pudo resolver el usuario del JWT:", jwtErr);
        }

        // Datos de los créditos para la tabla del correo
        const creditosInfo = await db
          .select({
            credito_id: creditos.credito_id,
            numero_credito_sifco: creditos.numero_credito_sifco,
          })
          .from(creditos)
          .where(inArray(creditos.credito_id, creditoIds));
        const sifcoPorCredito = new Map(
          creditosInfo.map((c) => [c.credito_id, c.numero_credito_sifco]),
        );

        // Nombre del inversionista si el completar fue filtrado por uno solo
        let inversionistaNombre: string | undefined;
        if (inversionista_id) {
          const [invRow] = await db
            .select({ nombre: inversionistas.nombre })
            .from(inversionistas)
            .where(eq(inversionistas.inversionista_id, inversionista_id));
          inversionistaNombre = invRow?.nombre;
        }

        const fechaGT = new Date().toLocaleString("es-GT", {
          timeZone: "America/Guatemala",
        });

        const filasCreditos = resultados
          .map((r) => {
            const sifco = sifcoPorCredito.get(r.credito_id) ?? "—";
            return `
              <tr>
                <td style="padding:6px 10px; border:1px solid #e5e7eb;">${sifco}</td>
                <td style="padding:6px 10px; border:1px solid #e5e7eb;">${r.credito_id}</td>
                <td style="padding:6px 10px; border:1px solid #e5e7eb; text-align:right;">${r.registros_actualizados}</td>
              </tr>
            `;
          })
          .join("");

        const subject = inversionista_id
          ? `Compra de cartera aceptada por contabilidad — ${inversionistaNombre ?? `Inversionista ${inversionista_id}`}`
          : `Compra de cartera aceptada por contabilidad — ${creditoIds.length} crédito(s)`;

        const html = `
          <div style="font-family: Arial, sans-serif; color:#111;">
            <h2 style="margin-bottom: 8px;">Compra de cartera <strong style="color:#16a34a;">ACEPTADA POR CONTABILIDAD</strong></h2>
            <p>Los registros espejo de los créditos listados fueron marcados como <strong>completado</strong>.</p>
            <table style="border-collapse: collapse; margin-top: 8px;">
              ${inversionista_id
                ? `<tr><td style="padding:4px 8px;"><strong>Inversionista:</strong></td><td style="padding:4px 8px;">${inversionistaNombre ?? "(desconocido)"} (ID: ${inversionista_id})</td></tr>`
                : `<tr><td style="padding:4px 8px;"><strong>Alcance:</strong></td><td style="padding:4px 8px;">Todos los inversionistas de los créditos listados</td></tr>`}
              <tr><td style="padding:4px 8px;"><strong>Créditos:</strong></td><td style="padding:4px 8px;">${creditoIds.length}</td></tr>
              <tr><td style="padding:4px 8px;"><strong>Registros actualizados:</strong></td><td style="padding:4px 8px;"><strong>${totalActualizados}</strong></td></tr>
              <tr><td style="padding:4px 8px;"><strong>Fecha (GT):</strong></td><td style="padding:4px 8px;">${fechaGT}</td></tr>
              ${usuarioNombre || usuarioEmail
                ? `<tr><td style="padding:4px 8px;"><strong>Aceptada por:</strong></td><td style="padding:4px 8px;">${[usuarioNombre, usuarioEmail].filter(Boolean).join(" — ")}</td></tr>`
                : `<tr><td style="padding:4px 8px;"><strong>Aceptada por:</strong></td><td style="padding:4px 8px;">Contabilidad</td></tr>`}
            </table>

            <h3 style="margin-top:16px;">Detalle por crédito</h3>
            <table style="border-collapse: collapse; margin-top: 4px; min-width: 420px;">
              <thead>
                <tr style="background:#f3f4f6;">
                  <th style="padding:6px 10px; border:1px solid #e5e7eb; text-align:left;">SIFCO</th>
                  <th style="padding:6px 10px; border:1px solid #e5e7eb; text-align:left;">Crédito ID</th>
                  <th style="padding:6px 10px; border:1px solid #e5e7eb; text-align:right;">Registros completados</th>
                </tr>
              </thead>
              <tbody>${filasCreditos}</tbody>
            </table>

            <p style="margin-top:16px; color:#555; font-size:12px;">Correo automático — Club Cash In / Cartera.</p>
          </div>
        `;

        const mailResults = await Promise.allSettled(
          INVESTOR_STATUS_CHANGE_RECIPIENTS.map((to) =>
            sendPlainEmail(to, subject, html),
          ),
        );

        correos_enviados = mailResults.filter(
          (r) => r.status === "fulfilled" && (r as any).value?.success,
        ).length;
        correos_fallidos = INVESTOR_STATUS_CHANGE_RECIPIENTS.length - correos_enviados;

        if (correos_fallidos > 0) {
          console.warn(
            `[completeEspejo] ${correos_fallidos} correo(s) fallaron de ${INVESTOR_STATUS_CHANGE_RECIPIENTS.length}`,
            mailResults,
          );
        }
      } catch (mailErr) {
        console.error("[completeEspejo] Error enviando correo:", mailErr);
      }
    }

    set.status = 200;
    return {
      success: true,
      message: `${totalActualizados} registros marcados como completado`,
      resultados,
      correos_enviados,
      correos_fallidos,
      total_destinatarios: INVESTOR_STATUS_CHANGE_RECIPIENTS.length,
    };
  } catch (error) {
    console.error("[completeEspejo] Error:", error);
    set.status = 500;
    return {
      success: false,
      message: "Error al completar registros espejo",
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
