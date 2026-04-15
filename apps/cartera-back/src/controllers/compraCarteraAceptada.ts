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
} from "../database/db";
import z from "zod";
import { sendCompraCarteraAcceptedNotification } from "@cci/email";

const JWT_SECRET = process.env.JWT_SECRET || "supersecreto";

// ID fijo de CUBE INVESTMENTS S.A. (siempre va primero en el pool)
const CUBE_INVESTMENT_ID = 86;

// ================================================================
// DESTINATARIOS DEL CORREO "COMPRA DE CARTERA ACEPTADA"
// Lista hardcodeada solicitada por negocio: TO + CC.
// ================================================================
const COMPRA_CARTERA_ACEPTADA_RECIPIENTS = {
  to: [
    "info@clubcashin.com",
    "contabilidad@sepresta.com",
    "arturo.a@sepresta.com",
    "juridico2@sepresta.com",
    "richard.kachler@clubcashin.com",
    "andres@sepresta.com",
    "juridico@sepresta.com",
    "asistentejuridico@sepresta.com",
    "doris.analiss@sepresta.com",
    "lucia.s@clubcashin.com",
    "diego.a@sepresta.com",
    "sara.r@sepresta.com",
  ],
  cc: [
    "diego.l@clubcashin.com",
    "guillermo.v@sepresta.com",
    "pablo.z@clubcashin.com",
  ],
};

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

    // ── 3. Traer la composición del pool (todos los inversionistas
    //      de los créditos seleccionados, agregados por inversionista) ──
    const inversionistasRows = await db
      .select({
        inversionista_id: creditos_inversionistas.inversionista_id,
        inversionista_nombre: inversionistas.nombre,
        monto_aportado: creditos_inversionistas.monto_aportado,
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

    // Agregar montos por inversionista (sumando entre todos los créditos)
    const poolMap = new Map<number, { nombre: string; monto: Big }>();
    for (const row of inversionistasRows) {
      const prev = poolMap.get(row.inversionista_id);
      const monto = new Big(row.monto_aportado);
      if (prev) {
        prev.monto = prev.monto.plus(monto);
      } else {
        poolMap.set(row.inversionista_id, {
          nombre: row.inversionista_nombre,
          monto,
        });
      }
    }

    // CUBE primero, luego el resto en el orden que vinieron
    const pool = Array.from(poolMap.entries())
      .sort(([idA], [idB]) => {
        if (idA === CUBE_INVESTMENT_ID) return -1;
        if (idB === CUBE_INVESTMENT_ID) return 1;
        return 0;
      })
      .map(([, v]) => ({
        inversionista_nombre: v.nombre,
        capital: v.monto.toFixed(2),
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
    // Pasamos a "completado" todos los rows de los créditos que estén
    // actualmente en "pendiente_revision". Los demás status no se tocan.
    const updateRes = await db
      .update(creditos_inversionistas_espejo)
      .set({ status: "completado", updated_at: new Date() })
      .where(
        and(
          inArray(creditos_inversionistas_espejo.credito_id, creditoIds),
          eq(creditos_inversionistas_espejo.status, "pendiente_revision"),
        ),
      )
      .returning({
        credito_id: creditos_inversionistas_espejo.credito_id,
        inversionista_id: creditos_inversionistas_espejo.inversionista_id,
      });

    // ── 5. Mandar el correo (destinatarios fijos por negocio) ──
    const mailRes = await sendCompraCarteraAcceptedNotification({
      to: COMPRA_CARTERA_ACEPTADA_RECIPIENTS.to,
      cc: COMPRA_CARTERA_ACEPTADA_RECIPIENTS.cc,
      creditos: creditosRows.map((c) => ({
        numero_credito_sifco: c.numero_credito_sifco,
        cliente_nombre: c.cliente_nombre,
        capital: new Big(c.capital).toFixed(2),
        observaciones: c.observaciones,
      })),
      pool,
      notasAdicionales: notas_adicionales,
      usuarioNombre,
      usuarioEmail,
    });

    set.status = 200;
    return {
      success: true,
      message: `Notificación enviada a ${COMPRA_CARTERA_ACEPTADA_RECIPIENTS.to.length} destinatario(s) + ${COMPRA_CARTERA_ACEPTADA_RECIPIENTS.cc.length} en CC`,
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
