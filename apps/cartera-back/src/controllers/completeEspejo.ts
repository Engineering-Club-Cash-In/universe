import { db } from "../database";
import {
  compras_credito_inversionista,
  creditos_inversionistas_espejo,
  creditos_inversionistas,
  creditos,
  inversionistas,
  liquidaciones,
  usuarios,
} from "../database/db";
import { eq, inArray, and, ne, desc } from "drizzle-orm";
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
  // Si viene true, el correo dice "Aceptada por el inversionista {nombre}"
  // en lugar del usuario del JWT / "Contabilidad". Útil cuando el flujo
  // se dispara desde el portal del inversionista.
  aceptada_por_inversionista: z.boolean().optional(),
  // Fecha de inicio de participación (YYYY-MM-DD) elegida manualmente al
  // confirmar una compra de cartera. Si se omite, se usa la fecha de hoy.
  // Solo afecta al camino de compra (idsOtros): la compra es un flujo aparte,
  // esporádico, que el operador fecha a mano. La reinversión la ignora porque
  // deriva su fecha de la liquidación que la generó (obtenerFechaReinversion).
  fecha_participacion: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "fecha_participacion debe tener formato YYYY-MM-DD")
    .optional(),
});

// ========================================
// FECHA DE LA REINVERSIÓN
// ========================================

/** Suma días a un YYYY-MM-DD sin pasar por zonas horarias. */
function sumarDias(ymd: string, dias: number): string {
  const [anio, mes, dia] = ymd.split("-").map(Number);
  const base = new Date(Date.UTC(anio, mes - 1, dia));
  base.setUTCDate(base.getUTCDate() + dias);
  return base.toISOString().slice(0, 10);
}

/**
 * Fecha con la que se sella una REINVERSIÓN al aceptarla.
 *
 * Una reinversión no es una operación suelta: la genera la liquidación (FASE 4
 * de liquidateByInvestorId). Su lugar en la línea de tiempo es el día siguiente
 * al de esa liquidación — se liquida el 10, el capital vuelve a trabajar el 11 —
 * y eso vale igual liquidando al día que poniéndose al corriente meses atrás:
 * si la liquidación se selló el 2026-04-10, la reinversión es del 2026-04-11
 * aunque se acepte en agosto.
 *
 * Por eso NO se toma del reloj ni se pide en un modal: se deriva de la última
 * liquidación del inversionista. Sin liquidaciones (reinversión creada a mano)
 * devuelve null y el llamador cae al instante real.
 *
 * Las compras de cartera son otro flujo — esporádico, sin liquidación detrás —
 * y siguen usando la fecha que el operador elige en el modal de confirmar.
 */
async function obtenerFechaReinversion(
  tx: any,
  inversionista_id: number,
): Promise<Date | null> {
  const [ultima] = await tx
    .select({ fecha_liquidacion: liquidaciones.fecha_liquidacion })
    .from(liquidaciones)
    .where(eq(liquidaciones.inversionista_id, inversionista_id))
    .orderBy(desc(liquidaciones.fecha_liquidacion))
    .limit(1);

  if (!ultima?.fecha_liquidacion) return null;

  // El día se lee en UTC, no en hora GT: el front manda la fecha del modal como
  // `new Date("YYYY-MM-DD").toISOString()`, o sea medianoche UTC del día elegido
  // (tableInvestors.tsx → handleConfirmarLiquidar). Leerlo en GT (UTC-6) lo
  // correría al día anterior. Es también como lo lee el resto del código, que
  // filtra con `fecha_liquidacion::date` sobre una sesión en UTC.
  const diaLiquidacion = new Date(ultima.fecha_liquidacion)
    .toISOString()
    .slice(0, 10);
  const diaSiguiente = sumarDias(diaLiquidacion, 1);
  // Mediodía UTC: la conversión a hora GT (UTC-6) no cruza la frontera del día.
  return new Date(`${diaSiguiente}T12:00:00Z`);
}

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

    const {
      creditos: creditosInput,
      inversionista_id,
      aceptada_por_inversionista,
      fecha_participacion,
    } = parseResult.data;

    // Normalizar a array
    const creditoIds = Array.isArray(creditosInput)
      ? creditosInput
      : [creditosInput];

    const resultados: any[] = [];

    await db.transaction(async (tx) => {
      // Fecha de reinversión por inversionista, cacheada entre créditos: el
      // request suele traer decenas de créditos del mismo inversionista y la
      // fecha (derivada de su última liquidación) es la misma para todos.
      const fechasReinversion = new Map<number, Date | null>();

      for (const credito_id of creditoIds) {
        const whereConditions = inversionista_id
          ? and(
              eq(creditos_inversionistas_espejo.credito_id, credito_id),
              eq(creditos_inversionistas_espejo.inversionista_id, inversionista_id),
            )
          : eq(creditos_inversionistas_espejo.credito_id, credito_id);

        // Capturar status PREVIOS antes de hacer el update.
        // Lo usamos abajo para:
        //   1) decidir la fecha de cada inversionista (pendiente_reinversion →
        //      día siguiente a su última liquidación, resto → la del modal)
        //   2) decidir el asunto/encabezado del correo
        const previos = await tx
          .select({
            inversionista_id: creditos_inversionistas_espejo.inversionista_id,
            status: creditos_inversionistas_espejo.status,
          })
          .from(creditos_inversionistas_espejo)
          .where(whereConditions);

        // Instante real (UTC). La columna es timestamptz; la conversión a
        // hora de Guatemala se hace al mostrar/consultar, no al guardar.
        const ahora = new Date();
        const fechaHoy = ahora.toISOString().split("T")[0];

        // Fecha de participación para el camino de compra (idsOtros): la que
        // el operador eligió manualmente en el modal de confirmar, o hoy si no
        // se envió ninguna. La reinversión nunca usa esta fecha.
        const fechaParticipacionCompra = fecha_participacion ?? fechaHoy;

        // ── Particionar inversionistas por status previo ──
        const idsReinversion = previos
          .filter((p) => p.status === "pendiente_reinversion")
          .map((p) => p.inversionista_id);
        const idsOtros = previos
          .filter((p) => p.status !== "pendiente_reinversion")
          .map((p) => p.inversionista_id);

        // Resolver (una vez por inversionista) la fecha de su reinversión.
        for (const invId of idsReinversion) {
          if (!fechasReinversion.has(invId)) {
            fechasReinversion.set(
              invId,
              await obtenerFechaReinversion(tx, invId),
            );
          }
        }

        // ── Update espejo: split por status previo, fecha distinta cada uno ──
        // La reinversión va inversionista por inversionista porque cada uno se
        // sella con la fecha de SU última liquidación.
        const updatedReinversion: any[] = [];
        for (const invId of idsReinversion) {
          const fechaReinv = fechasReinversion.get(invId) ?? ahora;
          const filas = await tx
            .update(creditos_inversionistas_espejo)
            .set({
              status: "completado",
              updated_at: fechaReinv,
            })
            .where(
              and(
                eq(creditos_inversionistas_espejo.credito_id, credito_id),
                eq(creditos_inversionistas_espejo.inversionista_id, invId),
              ),
            )
            .returning({
              id: creditos_inversionistas_espejo.id,
              credito_id: creditos_inversionistas_espejo.credito_id,
              inversionista_id:
                creditos_inversionistas_espejo.inversionista_id,
              status: creditos_inversionistas_espejo.status,
            });
          updatedReinversion.push(...filas);
        }

        const updatedOtros =
          idsOtros.length > 0
            ? await tx
                .update(creditos_inversionistas_espejo)
                .set({
                  status: "completado",
                  fecha_inicio_participacion: fechaParticipacionCompra,
                  updated_at: new Date(),
                })
                .where(
                  and(
                    eq(creditos_inversionistas_espejo.credito_id, credito_id),
                    inArray(
                      creditos_inversionistas_espejo.inversionista_id,
                      idsOtros,
                    ),
                  ),
                )
                .returning({
                  id: creditos_inversionistas_espejo.id,
                  credito_id: creditos_inversionistas_espejo.credito_id,
                  inversionista_id:
                    creditos_inversionistas_espejo.inversionista_id,
                  status: creditos_inversionistas_espejo.status,
                })
            : [];

        const updated = [...updatedReinversion, ...updatedOtros];

        // ── Update padre: misma partición para mantener consistencia ──
        // Para reinversión NO actualizamos fecha_inicio_participacion:
        // addInvestorToCredit ya la dejó correcta (existente o 2 meses atrás si es nuevo).

        if (idsOtros.length > 0) {
          await tx
            .update(creditos_inversionistas)
            .set({ fecha_inicio_participacion: fechaParticipacionCompra })
            .where(
              and(
                eq(creditos_inversionistas.credito_id, credito_id),
                inArray(creditos_inversionistas.inversionista_id, idsOtros),
              ),
            );
        }

        // ────────────────────────────────────────────────────────────────
        // Cerrar también el registro de compras_credito_inversionista.
        // Pasamos a "completado" cualquier registro pendiente
        // (pendiente_compra_cartera / pendiente_revision / pendiente_reinversion)
        // que coincida con el (credito_id, inversionista_id?) del request.
        // Filtramos por status != "completado" para no resellar registros
        // ya cerrados de operaciones anteriores.
        // ────────────────────────────────────────────────────────────────
        const whereConditionsCompras = inversionista_id
          ? and(
              eq(compras_credito_inversionista.credito_id, credito_id),
              eq(
                compras_credito_inversionista.inversionista_id,
                inversionista_id,
              ),
              ne(compras_credito_inversionista.status, "completado"),
            )
          : and(
              eq(compras_credito_inversionista.credito_id, credito_id),
              ne(compras_credito_inversionista.status, "completado"),
            );

        // fecha_completada de la COMPRA de cartera: se ancla a la misma fecha
        // que fecha_inicio_participacion (la elegida en el modal). Así ambos
        // campos caen en el mismo mes y los cálculos de liquidación que datan
        // la compra por fecha_completada (obtenerSumaComprasMesAnterior /
        // MesActual, calcularAjusteCompras) coinciden con el mes de participación.
        // Se ancla a mediodía para que la conversión a hora GT (UTC-6) no cruce
        // la frontera de día. Si no vino fecha del modal, cae al instante real.
        // La reinversión no usa esta fecha: deriva la suya de su liquidación
        // (ver obtenerFechaReinversion).
        const fechaCompletadaCompra = fecha_participacion
          ? new Date(`${fecha_participacion}T12:00:00Z`)
          : ahora;

        // Solo las compras de cartera quedan pendientes de facturar al
        // completarse. Las reinversiones no generan factura, así que
        // mantienen pendiente_facturar = false.
        await tx
          .update(compras_credito_inversionista)
          .set({
            status: "completado",
            fecha_completada: fechaCompletadaCompra,
            pendiente_facturar: true,
            updated_at: ahora,
          })
          .where(
            and(
              whereConditionsCompras,
              eq(compras_credito_inversionista.tipo_operacion, "compra_cartera"),
            ),
          );

        // La REINVERSIÓN se data con el día siguiente a la liquidación que la
        // generó, no con el reloj: así el calcular pagos del mes siguiente la
        // encuentra en su período real aunque el inversionista se esté poniendo
        // al corriente meses después. Se sellan TODAS las columnas de fecha
        // (created_at / fecha / fecha_completada / updated_at) con el mismo
        // instante — created_at importa porque `montoRestarValidacion` decide
        // por él si la reinversión ya está reflejada en el último histórico, y
        // dejarlo en el reloj real reventaba el cuadre con [MONTO_ESPEJO_
        // INCONSISTENTE] al calcular el segundo mes del catch-up.
        for (const invId of idsReinversion) {
          const fechaReinv = fechasReinversion.get(invId) ?? ahora;
          await tx
            .update(compras_credito_inversionista)
            .set({
              status: "completado",
              created_at: fechaReinv,
              fecha: fechaReinv,
              fecha_completada: fechaReinv,
              updated_at: fechaReinv,
            })
            .where(
              and(
                eq(compras_credito_inversionista.credito_id, credito_id),
                eq(compras_credito_inversionista.inversionista_id, invId),
                ne(compras_credito_inversionista.status, "completado"),
                eq(compras_credito_inversionista.tipo_operacion, "reinversion"),
              ),
            );
        }

        // Barrida final: reinversiones cuyo espejo ya estaba en "completado"
        // pero cuya compra quedó pendiente (estado inconsistente). No tienen
        // liquidación de referencia en este request, así que se cierran con el
        // instante real, como antes.
        await tx
          .update(compras_credito_inversionista)
          .set({
            status: "completado",
            fecha_completada: ahora,
            updated_at: ahora,
          })
          .where(
            and(
              whereConditionsCompras,
              eq(compras_credito_inversionista.tipo_operacion, "reinversion"),
            ),
          );

        resultados.push({
          credito_id,
          registros_actualizados: updated.length,
          detalle: updated,
          statuses_previos: previos.map((p) => p.status),
        });

        console.log(
          `✅ Crédito ${credito_id} - ${updated.length} registros espejo marcados como completado`,
        );
      }
    });

    // Determinar el tipo de operación que se está cerrando a partir de los
    // status previos. Usamos esto para personalizar el asunto/encabezado.
    const allPrevStatuses = resultados.flatMap((r) => r.statuses_previos);
    const huboReinversion = allPrevStatuses.includes("pendiente_reinversion");
    const huboCompraCartera = allPrevStatuses.some(
      (s) => s === "pendiente_revision" || s === "pendiente_compra_cartera",
    );
    const tipoOperacion: "reinversion" | "compra_cartera" | "otro" =
      huboReinversion && !huboCompraCartera
        ? "reinversion"
        : !huboReinversion && huboCompraCartera
          ? "compra_cartera"
          : "otro";

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

        // Datos de los créditos para la tabla del correo (incluye cliente)
        const creditosInfo = await db
          .select({
            credito_id: creditos.credito_id,
            numero_credito_sifco: creditos.numero_credito_sifco,
            cliente_nombre: usuarios.nombre,
          })
          .from(creditos)
          .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
          .where(inArray(creditos.credito_id, creditoIds));
        const sifcoPorCredito = new Map(
          creditosInfo.map((c) => [c.credito_id, c.numero_credito_sifco]),
        );
        const clientePorCredito = new Map(
          creditosInfo.map((c) => [c.credito_id, c.cliente_nombre]),
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
            const cliente = clientePorCredito.get(r.credito_id) ?? "—";
            return `
              <tr>
                <td style="padding:6px 10px; border:1px solid #e5e7eb;">${sifco}</td>
                <td style="padding:6px 10px; border:1px solid #e5e7eb;">${cliente}</td>
                <td style="padding:6px 10px; border:1px solid #e5e7eb;">${r.credito_id}</td>
                <td style="padding:6px 10px; border:1px solid #e5e7eb; text-align:right;">${r.registros_actualizados}</td>
              </tr>
            `;
          })
          .join("");

        // ── Asunto y encabezado dinámicos según tipo de operación ──
        const subjectPrefix =
          tipoOperacion === "reinversion"
            ? "Reinversión completada"
            : tipoOperacion === "compra_cartera"
              ? "Compra de cartera aceptada por contabilidad"
              : "Espejos marcados como completado";

        const headingHtml =
          tipoOperacion === "reinversion"
            ? `Reinversión <strong style="color:#16a34a;">COMPLETADA</strong>`
            : tipoOperacion === "compra_cartera"
              ? `Compra de cartera <strong style="color:#16a34a;">ACEPTADA POR CONTABILIDAD</strong>`
              : `Espejos <strong style="color:#16a34a;">COMPLETADOS</strong>`;

        const subject = inversionista_id
          ? `${subjectPrefix} — ${inversionistaNombre ?? `Inversionista ${inversionista_id}`}`
          : `${subjectPrefix} — ${creditoIds.length} crédito(s)`;

        const html = `
          <div style="font-family: Arial, sans-serif; color:#111;">
            <h2 style="margin-bottom: 8px;">${headingHtml}</h2>
            <p>Los registros espejo de los créditos listados fueron marcados como <strong>completado</strong>.</p>
            <table style="border-collapse: collapse; margin-top: 8px;">
              ${inversionista_id
                ? `<tr><td style="padding:4px 8px;"><strong>Inversionista:</strong></td><td style="padding:4px 8px;">${inversionistaNombre ?? "(desconocido)"} (ID: ${inversionista_id})</td></tr>`
                : `<tr><td style="padding:4px 8px;"><strong>Alcance:</strong></td><td style="padding:4px 8px;">Todos los inversionistas de los créditos listados</td></tr>`}
              <tr><td style="padding:4px 8px;"><strong>Créditos:</strong></td><td style="padding:4px 8px;">${creditoIds.length}</td></tr>
              <tr><td style="padding:4px 8px;"><strong>Registros actualizados:</strong></td><td style="padding:4px 8px;"><strong>${totalActualizados}</strong></td></tr>
              <tr><td style="padding:4px 8px;"><strong>Fecha (GT):</strong></td><td style="padding:4px 8px;">${fechaGT}</td></tr>
              ${aceptada_por_inversionista
                ? `<tr><td style="padding:4px 8px;"><strong>Aceptada por:</strong></td><td style="padding:4px 8px;">El inversionista ${inversionistaNombre ?? (inversionista_id ? `(ID: ${inversionista_id})` : "(desconocido)")}</td></tr>`
                : usuarioNombre || usuarioEmail
                  ? `<tr><td style="padding:4px 8px;"><strong>Aceptada por:</strong></td><td style="padding:4px 8px;">${[usuarioNombre, usuarioEmail].filter(Boolean).join(" — ")}</td></tr>`
                  : `<tr><td style="padding:4px 8px;"><strong>Aceptada por:</strong></td><td style="padding:4px 8px;">Contabilidad</td></tr>`}
            </table>

            <h3 style="margin-top:16px;">Detalle por crédito</h3>
            <table style="border-collapse: collapse; margin-top: 4px; min-width: 420px;">
              <thead>
                <tr style="background:#f3f4f6;">
                  <th style="padding:6px 10px; border:1px solid #e5e7eb; text-align:left;">SIFCO</th>
                  <th style="padding:6px 10px; border:1px solid #e5e7eb; text-align:left;">Cliente</th>
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
