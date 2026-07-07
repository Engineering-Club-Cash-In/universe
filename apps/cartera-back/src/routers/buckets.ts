// routes/buckets.ts — COBROS-02 · endpoints del motor de buckets (histórico).
import { Elysia, t } from "elysia";
import { authMiddleware } from "./midleware";
import {
  getBucketsHistorial,
  getBucketsHistorialCredito,
} from "../controllers/buckets/bucketsHistorial";

// Gate de rol server-side: el histórico expone data de TODOS los créditos
// (igual criterio que el historial de mora). authMiddleware solo autentica.
const requireBucketsRole = (user: any, set: any): boolean => {
  if (!user || !["ADMIN", "CONTA"].includes(user.role)) {
    set.status = 403;
    return false;
  }
  return true;
};
const NO_AUTORIZADO = {
  success: false,
  message: "[ERROR] No autorizado (requiere ADMIN o CONTA)",
};

export const bucketsRouter = new Elysia()
  .use(authMiddleware)

  // Histórico de transiciones de bucket, paginado y con filtros + resumen.
  .get(
    "/buckets/historial",
    async ({ query, set, user }: any) => {
      if (!requireBucketsRole(user, set)) return NO_AUTORIZADO;
      try {
        return await getBucketsHistorial({
          desde: query.desde,
          hasta: query.hasta,
          tipo_evento: query.tipo_evento,
          origen: query.origen,
          bucket_nuevo: query.bucket_nuevo,
          bucket_anterior: query.bucket_anterior,
          credito_id: query.credito_id ? Number(query.credito_id) : undefined,
          numero_credito_sifco: query.numero_credito_sifco,
          nombre_usuario: query.nombre_usuario,
          asesor: query.asesor,
          status_credito: query.status_credito,
          pago_id: query.pago_id ? Number(query.pago_id) : undefined,
          page: query.page ? Number(query.page) : 1,
          pageSize: query.pageSize ? Number(query.pageSize) : 20,
        });
      } catch (err) {
        set.status = 500;
        return {
          success: false,
          message: "[ERROR] No se pudo obtener el histórico de buckets",
          error: String(err),
        };
      }
    },
    {
      query: t.Object({
        desde: t.Optional(t.String()),
        hasta: t.Optional(t.String()),
        tipo_evento: t.Optional(t.String()),
        origen: t.Optional(t.String()),
        bucket_nuevo: t.Optional(t.String()),
        bucket_anterior: t.Optional(t.String()),
        credito_id: t.Optional(t.String()),
        numero_credito_sifco: t.Optional(t.String()),
        nombre_usuario: t.Optional(t.String()),
        asesor: t.Optional(t.String()),
        status_credito: t.Optional(t.String()),
        pago_id: t.Optional(t.String()),
        page: t.Optional(t.String()),
        pageSize: t.Optional(t.String()),
      }),
    },
  )

  // Drill-down: historial completo de un crédito.
  .get(
    "/buckets/historial/credito/:credito_id",
    async ({ params, set, user }: any) => {
      if (!requireBucketsRole(user, set)) return NO_AUTORIZADO;
      try {
        const creditoId = Number(params.credito_id);
        if (!Number.isInteger(creditoId) || creditoId <= 0) {
          set.status = 400;
          return { success: false, message: "[ERROR] credito_id inválido" };
        }
        return await getBucketsHistorialCredito({ credito_id: creditoId });
      } catch (err) {
        set.status = 500;
        return {
          success: false,
          message: "[ERROR] No se pudo obtener el histórico del crédito",
          error: String(err),
        };
      }
    },
  );
