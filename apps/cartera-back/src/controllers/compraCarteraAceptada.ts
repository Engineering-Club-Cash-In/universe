import Big from "big.js";
import { and, eq, inArray } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { db } from "../database";
import {
  admins,
  asesores,
  creditos,
  creditos_inversionistas,
  creditos_inversionistas_espejo,
  inversionistas,
  platform_users,
  usuarios,
  pagos_credito,
} from "../database/db";
import z from "zod";
import { sendCompraCarteraAcceptedNotification } from "@cci/email";
import { getVehicleDetailsBySifco } from "../services/crm.service";
import {
  calcularExpiracionCompraCartera,
  formatFechaLargaGT,
  nowGT,
} from "../utils/functions/businessDays";
import { COMPRA_CARTERA_RECIPIENTS } from "../utils/functions/compraCarteraRecipients";

const JWT_SECRET = process.env.JWT_SECRET || "supersecreto";

// ID fijo de CUBE INVESTMENTS S.A. (siempre va primero en el pool)
const CUBE_INVESTMENT_ID = 86;

// Destinatarios fijos (compartidos con el correo de expiración): ver
// src/utils/functions/compraCarteraRecipients.ts

const compraCarteraAceptadaSchema = z.object({
  creditos: z
    .array(z.number().int().positive())
    .min(1, "Debe enviar al menos un crédito"),
  notas_adicionales: z.string().optional(),
});

// ================================================================
// COMPRA DE CARTERA ACEPTADA
// Endpoint para notificar que la compra de cartera fue aceptada.
// Recibe uno o varios credito_id, arma el resumen (cliente, capital,
// observaciones y composición del pool) y manda el correo.
// NO modifica nada en la base de datos.
// ================================================================
export const compraCarteraAceptada = async ({ body, set, request }: any) => {
  try {
    // ── 1. Validar body ──
    const parseResult = compraCarteraAceptadaSchema.safeParse(body);
    if (!parseResult.success) {
      set.status = 400;
      return {
        success: false,
        message: "Validation failed",
        errors: parseResult.error.flatten().fieldErrors,
      };
    }
    const { creditos: creditoIds, notas_adicionales } = parseResult.data;

    // ── 2. Traer datos de los créditos + cliente ──
    const creditosRows = await db
      .select({
        credito_id: creditos.credito_id,
        numero_credito_sifco: creditos.numero_credito_sifco,
        capital: creditos.capital,
        observaciones: creditos.observaciones,
        cliente_nombre: usuarios.nombre,
      })
      .from(creditos)
      .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
      .where(inArray(creditos.credito_id, creditoIds));

    if (creditosRows.length === 0) {
      set.status = 404;
      return {
        success: false,
        message: "No se encontraron los créditos solicitados",
      };
    }

    // ── 3. Traer la composición del pool POR CRÉDITO ──
    const inversionistasRows = await db
      .select({
        credito_id: creditos_inversionistas.credito_id,
        inversionista_id: creditos_inversionistas.inversionista_id,
        inversionista_nombre: inversionistas.nombre,
        monto_aportado: creditos_inversionistas.monto_aportado,
        porcentaje_participacion_inversionista:
          creditos_inversionistas.porcentaje_participacion_inversionista,
      })
      .from(creditos_inversionistas)
      .innerJoin(
        inversionistas,
        eq(
          creditos_inversionistas.inversionista_id,
          inversionistas.inversionista_id,
        ),
      )
      .where(inArray(creditos_inversionistas.credito_id, creditoIds));

    // Index rápido para pool por crédito: Map<credito_id, rows[]>
    const rowsPorCredito = new Map<
      number,
      Array<{
        inversionista_id: number;
        inversionista_nombre: string;
        monto: Big;
        porcentajeInversion: Big;
      }>
    >();
    for (const row of inversionistasRows) {
      const list = rowsPorCredito.get(row.credito_id) ?? [];
      list.push({
        inversionista_id: row.inversionista_id,
        inversionista_nombre: row.inversionista_nombre,
        monto: new Big(row.monto_aportado),
        porcentajeInversion: new Big(
          row.porcentaje_participacion_inversionista,
        ),
      });
      rowsPorCredito.set(row.credito_id, list);
    }

    // Pool por crédito en el orden que vinieron los créditos en creditosRows.
    // Dentro de cada pool, CUBE va primero.
    const pool = creditosRows.map((c) => ({
      numero_credito_sifco: c.numero_credito_sifco,
      cliente_nombre: c.cliente_nombre,
      rows: (rowsPorCredito.get(c.credito_id) ?? [])
        .sort((a, b) => {
          if (a.inversionista_id === CUBE_INVESTMENT_ID) return -1;
          if (b.inversionista_id === CUBE_INVESTMENT_ID) return 1;
          return 0;
        })
        .map((r) => ({
          inversionista_nombre: r.inversionista_nombre,
          capital: r.monto.toFixed(2),
        })),
    }));

    // ── 4. Resolver quién aceptó (JWT, opcional) ──
    let usuarioEmail: string | undefined;
    let usuarioNombre: string | undefined;

    try {
      const authHeader = request?.headers?.get?.("Authorization");
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.replace("Bearer ", "").trim();
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        usuarioEmail = decoded.email ?? decoded.correo ?? undefined;

        if (usuarioEmail) {
          const [pu] = await db
            .select({
              admin_id: platform_users.admin_id,
              asesor_id: platform_users.asesor_id,
            })
            .from(platform_users)
            .where(eq(platform_users.email, usuarioEmail));

          if (pu?.admin_id) {
            const [a] = await db
              .select({ nombre: admins.nombre, apellido: admins.apellido })
              .from(admins)
              .where(eq(admins.admin_id, pu.admin_id));
            if (a) usuarioNombre = `${a.nombre} ${a.apellido}`.trim();
          } else if (pu?.asesor_id) {
            const [s] = await db
              .select({ nombre: asesores.nombre })
              .from(asesores)
              .where(eq(asesores.asesor_id, pu.asesor_id));
            if (s) usuarioNombre = s.nombre;
          }
        }
      }
    } catch (jwtErr) {
      console.warn(
        "[compraCarteraAceptada] No se pudo resolver el usuario desde el JWT:",
        jwtErr,
      );
    }


    // ── 4.5. Marcar el espejo como aceptado ──
    // Pasamos a "pendiente_revision" todos los rows de los créditos que estén
    // actualmente en "pendiente_compra_cartera". Registramos cuándo y quién.
    const ahora = nowGT();
    const updateRes = await db
      .update(creditos_inversionistas_espejo)
      .set({
        status: "pendiente_revision",
        updated_at: ahora,
        aceptada_at: ahora,
        aceptada_por: usuarioEmail ?? null,
      })
      .where(
        and(
          inArray(creditos_inversionistas_espejo.credito_id, creditoIds),
          eq(creditos_inversionistas_espejo.status, "pendiente_compra_cartera"),
        ),
      )
      .returning({
        credito_id: creditos_inversionistas_espejo.credito_id,
        inversionista_id: creditos_inversionistas_espejo.inversionista_id,
      });

    // ── 4.5.1 Apagar bandera_reinversion de los créditos aceptados ──
    // Ya no hay que redirigir intereses a CUBE: el espejo pasó a
    // pendiente_revision y el nuevo inversionista empieza a cobrar.
    if (updateRes.length > 0) {
      const creditosAfectados = Array.from(
        new Set(updateRes.map((r) => r.credito_id)),
      );
      await db
        .update(creditos)
        .set({ bandera_reinversion: false })
        .where(inArray(creditos.credito_id, creditosAfectados));
    }

    // ── 4.6. Armar el header "VENTA DE CARTERA" a partir del inversionista
    //         que acaba de pasar de pendiente_revision → completado.
    //         Si hay exactamente 1 target, mostramos su Modalidad, Factura
    //         y Repartición. Si hay 0 o más de 1, omitimos el header. ──
    const targetIds = Array.from(
      new Set(
        updateRes
          .map((r) => r.inversionista_id)
          .filter((id) => id !== CUBE_INVESTMENT_ID),
      ),
    );

    let operacionInfo:
      | {
          inversionistaNombre: string;
          monto: string;
          modalidad: string;
          factura: string;
          porcentajeInversionista: string;
          porcentajeCube: string;
        }
      | undefined;

    if (targetIds.length === 1) {
      const targetId = targetIds[0];
      const [targetInv] = await db
        .select({
          nombre: inversionistas.nombre,
          tipo_reinversion: inversionistas.tipo_reinversion,
          emite_factura: inversionistas.emite_factura,
        })
        .from(inversionistas)
        .where(eq(inversionistas.inversionista_id, targetId));

      // Sumamos el monto total del target entre todos los créditos
      // y calculamos su % de inversión ponderado por monto.
      let targetMontoTotal = new Big(0);
      let targetInversionPonderada = new Big(0);
      for (const rows of rowsPorCredito.values()) {
        for (const r of rows) {
          if (r.inversionista_id === targetId) {
            targetMontoTotal = targetMontoTotal.plus(r.monto);
            targetInversionPonderada = targetInversionPonderada.plus(
              r.porcentajeInversion.times(r.monto),
            );
          }
        }
      }

      if (targetInv && targetMontoTotal.gt(0)) {
        const porcInv = targetInversionPonderada.div(targetMontoTotal);
        const porcCube = new Big(100).minus(porcInv);

        const modalidadMap: Record<string, string> = {
          sin_reinversion: "Sin Reinversión",
          reinversion_capital: "Reinversión de Capital",
          reinversion_interes: "Reinversión de Interés",
          reinversion_total: "Reinversión Total",
          reinversion_variable: "Reinversión Variable",
          reinversion_combinada: "Reinversión Combinada",
        };

        operacionInfo = {
          inversionistaNombre: targetInv.nombre,
          monto: targetMontoTotal.toFixed(2),
          modalidad:
            modalidadMap[targetInv.tipo_reinversion] ??
            targetInv.tipo_reinversion,
          factura: targetInv.emite_factura ? "Propia" : "No emite",
          porcentajeInversionista: porcInv.toFixed(2),
          porcentajeCube: porcCube.toFixed(2),
        };
      }
    }

    // ── 5. Mandar el correo (destinatarios fijos por negocio) ──
    const creditosParaEmail = await Promise.all(
      creditosRows.map(async (c) => {
        const vehicleRes = await getVehicleDetailsBySifco(c.numero_credito_sifco);
        console.log(vehicleRes.data);     
        return {
          numero_credito_sifco: c.numero_credito_sifco,
          cliente_nombre: c.cliente_nombre,
          capital: new Big(c.capital).toFixed(2),
          observaciones: vehicleRes.data?.vehicle
            ? `${vehicleRes.data.vehicle.model}\n${vehicleRes.data.vehicle.year} | ${vehicleRes.data.vehicle.make} | ${vehicleRes.data.vehicle.licensePlate} `
            : c.observaciones,
        };
      }),
    );

    const { expira, diaBaja } = calcularExpiracionCompraCartera(ahora);

    const mailRes = await sendCompraCarteraAcceptedNotification({
      to: COMPRA_CARTERA_RECIPIENTS.to,
      cc: COMPRA_CARTERA_RECIPIENTS.cc,
      creditos: creditosParaEmail,
      pool,
      operacionInfo,
      notasAdicionales: notas_adicionales,
      usuarioNombre,
      usuarioEmail,
      expiracion: {
        fechaExpiraLabel: formatFechaLargaGT(expira),
        fechaBajaLabel: formatFechaLargaGT(diaBaja),
      },
    });

    set.status = 200;
    return {
      success: true,
      message: `Notificación enviada a ${COMPRA_CARTERA_RECIPIENTS.to.length} destinatario(s) + ${COMPRA_CARTERA_RECIPIENTS.cc.length} en CC`,
      creditos_notificados: creditosRows.length,
      pool_size: pool.length,
      espejo_actualizados: updateRes.length,
      email: mailRes,
    };
  } catch (error) {
    console.error("[compraCarteraAceptada] Error:", error);
    set.status = 500;
    return {
      success: false,
      message: "Error al notificar la aceptación de compra de cartera",
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
