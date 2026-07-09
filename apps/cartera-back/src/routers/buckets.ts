// routes/buckets.ts — COBROS-02 · endpoints del motor de buckets (histórico + listado).
import { Elysia, t } from "elysia";
import { authMiddleware } from "./midleware";
import {
  getBucketsHistorial,
  getBucketsHistorialCredito,
} from "../controllers/buckets/bucketsHistorial";
import { getAsesorHistorial } from "../controllers/buckets/asesorHistorial";
import { getCreditosWithUserByMesAnio } from "../controllers/credits";
import { StatusCredit } from "../database/db/schema";

// Estados DENTRO del funnel operativo (= enum de statusCredit menos
// STATUS_BUCKET_FUERA): ACTIVO/MOROSO clasifican por cuotas de la mora activa;
// INCOBRABLE entra a B5 vía `buckets.estados_incluidos`. Se pasa como
// whitelist al listado para que "sin filtro de bucket" = todo el funnel
// (nunca CANCELADO/PENDIENTE_CANCELACION/EN_CONVENIO/CAIDO).
const STATUS_FUNNEL: StatusCredit[] = [
  StatusCredit.ACTIVO,
  StatusCredit.MOROSO,
  StatusCredit.INCOBRABLE,
];

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

// ¿Algún token del CSV NO pasa la validación? Rechazar en vez de descartar en
// silencio (review Codex): `?bucket_nuevo=abc` sin esto devolvía el historial
// completo, y un tipo_evento inválido revienta en el cast al enum de PG (500).
const csvInvalido = (v: string | undefined, ok: (s: string) => boolean): boolean =>
  !!v && v.split(",").map((s) => s.trim()).filter(Boolean).some((s) => !ok(s));

const esBucket = (s: string) => /^[0-9]+$/.test(s);
const TIPOS_EVENTO = ["INICIAL", "SUBIDA", "BAJADA"];
const ORIGENES = ["PROCESO_AUTO", "API_MANUAL"];

// Fecha YYYY-MM-DD real, validada por ROUND-TRIP: se arma la fecha con los
// componentes y se verifica que no se haya movido. Date.parse NO sirve aquí:
// en Bun normaliza desbordes (2026-02-31 → 3 de marzo) y el ::date de PG sí
// los rechaza → 500 (review Codex). El regex frena el formato ('abc').
const esFecha = (s: string): boolean => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  const d = new Date(Date.UTC(y, mes - 1, dia));
  return (
    d.getUTCFullYear() === y &&
    d.getUTCMonth() === mes - 1 &&
    d.getUTCDate() === dia
  );
};

export const bucketsRouter = new Elysia()
  .use(authMiddleware)

  // Histórico de transiciones de bucket, paginado y con filtros + resumen.
  .get(
    "/buckets/historial",
    async ({ query, set, user }: any) => {
      if (!requireBucketsRole(user, set)) return NO_AUTORIZADO;
      try {
        // Validar filtros numéricos ANTES de llamar al controller: Number("abc")
        // = NaN es falsy y buildWhere lo descartaría EN SILENCIO → un typo del
        // cliente devolvería el historial completo en vez de un 400 (review Codex).
        const creditoId = query.credito_id ? Number(query.credito_id) : undefined;
        if (creditoId !== undefined && (!Number.isInteger(creditoId) || creditoId <= 0)) {
          set.status = 400;
          return { success: false, message: "[ERROR] credito_id inválido" };
        }
        const pagoId = query.pago_id ? Number(query.pago_id) : undefined;
        if (pagoId !== undefined && (!Number.isInteger(pagoId) || pagoId <= 0)) {
          set.status = 400;
          return { success: false, message: "[ERROR] pago_id inválido" };
        }
        // Fechas: validar ANTES del cast ::date de PG (review Codex).
        if (query.desde && !esFecha(query.desde)) {
          set.status = 400;
          return { success: false, message: "[ERROR] desde inválida (formato YYYY-MM-DD)" };
        }
        if (query.hasta && !esFecha(query.hasta)) {
          set.status = 400;
          return { success: false, message: "[ERROR] hasta inválida (formato YYYY-MM-DD)" };
        }
        // Rango invertido: sería un vacío silencioso — mejor avisar.
        if (query.desde && query.hasta && query.desde > query.hasta) {
          set.status = 400;
          return { success: false, message: "[ERROR] rango de fechas inválido (desde > hasta)" };
        }
        // CSVs y enums: cada token debe ser válido (no descartar en silencio).
        if (csvInvalido(query.bucket_nuevo, esBucket)) {
          set.status = 400;
          return { success: false, message: "[ERROR] bucket_nuevo inválido (CSV de enteros, ej. 0,1,5)" };
        }
        if (csvInvalido(query.bucket_anterior, esBucket)) {
          set.status = 400;
          return { success: false, message: "[ERROR] bucket_anterior inválido (CSV de enteros, ej. 0,1,5)" };
        }
        if (csvInvalido(query.tipo_evento, (s) => TIPOS_EVENTO.includes(s))) {
          set.status = 400;
          return { success: false, message: `[ERROR] tipo_evento inválido (valores: ${TIPOS_EVENTO.join(", ")})` };
        }
        if (query.origen && !ORIGENES.includes(query.origen)) {
          set.status = 400;
          return { success: false, message: `[ERROR] origen inválido (valores: ${ORIGENES.join(", ")})` };
        }
        return await getBucketsHistorial({
          desde: query.desde,
          hasta: query.hasta,
          tipo_evento: query.tipo_evento,
          origen: query.origen,
          bucket_nuevo: query.bucket_nuevo,
          bucket_anterior: query.bucket_anterior,
          credito_id: creditoId,
          numero_credito_sifco: query.numero_credito_sifco,
          nombre_usuario: query.nombre_usuario,
          asesor: query.asesor,
          status_credito: query.status_credito,
          pago_id: pagoId,
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

  // Bitácora de cambios de asesor (credito_asesor_historial), paginada y con
  // filtros + resumen. Misma validación estricta que /buckets/historial.
  .get(
    "/buckets/asesores-historial",
    async ({ query, set, user }: any) => {
      if (!requireBucketsRole(user, set)) return NO_AUTORIZADO;
      try {
        const creditoId = query.credito_id ? Number(query.credito_id) : undefined;
        if (creditoId !== undefined && (!Number.isInteger(creditoId) || creditoId <= 0)) {
          set.status = 400;
          return { success: false, message: "[ERROR] credito_id inválido" };
        }
        if (query.desde && !esFecha(query.desde)) {
          set.status = 400;
          return { success: false, message: "[ERROR] desde inválida (formato YYYY-MM-DD)" };
        }
        if (query.hasta && !esFecha(query.hasta)) {
          set.status = 400;
          return { success: false, message: "[ERROR] hasta inválida (formato YYYY-MM-DD)" };
        }
        if (query.desde && query.hasta && query.desde > query.hasta) {
          set.status = 400;
          return { success: false, message: "[ERROR] rango de fechas inválido (desde > hasta)" };
        }
        if (csvInvalido(query.bucket, esBucket)) {
          set.status = 400;
          return { success: false, message: "[ERROR] bucket inválido (CSV de enteros, ej. 0,1,5)" };
        }
        if (query.origen && !ORIGENES.includes(query.origen)) {
          set.status = 400;
          return { success: false, message: `[ERROR] origen inválido (valores: ${ORIGENES.join(", ")})` };
        }
        return await getAsesorHistorial({
          desde: query.desde,
          hasta: query.hasta,
          origen: query.origen,
          bucket: query.bucket,
          asesor_nuevo: query.asesor_nuevo,
          asesor_anterior: query.asesor_anterior,
          credito_id: creditoId,
          numero_credito_sifco: query.numero_credito_sifco,
          nombre_usuario: query.nombre_usuario,
          page: query.page ? Number(query.page) : 1,
          pageSize: query.pageSize ? Number(query.pageSize) : 20,
        });
      } catch (err) {
        set.status = 500;
        return {
          success: false,
          message: "[ERROR] No se pudo obtener el histórico de cambios de asesor",
          error: String(err),
        };
      }
    },
    {
      query: t.Object({
        desde: t.Optional(t.String()),
        hasta: t.Optional(t.String()),
        origen: t.Optional(t.String()),
        bucket: t.Optional(t.String()),
        asesor_nuevo: t.Optional(t.String()),
        asesor_anterior: t.Optional(t.String()),
        credito_id: t.Optional(t.String()),
        numero_credito_sifco: t.Optional(t.String()),
        nombre_usuario: t.Optional(t.String()),
        page: t.Optional(t.String()),
        pageSize: t.Optional(t.String()),
      }),
    },
  )

  // Listado de créditos POR BUCKET — gemelo de /getAllCredits (misma data por
  // crédito, misma paginación) pero el eje es el bucket del MOTOR: el último
  // registrado en buckets_historial. Fuente "motor" a propósito (pedido de
  // Daniel 2026-07-08): la derivación viva parpadea a B0 al registrar un pago
  // (ventana "mora apagada") y un admin viendo esto en tiempo real vería un
  // salto B2→B0 sin evento. Con el motor, el bucket solo cambia cuando el job
  // registra la transición (con su reasignación de asesor) → todo movimiento
  // tiene su fila en el historial. Fuera del funnel excluido siempre.
  .get(
    "/buckets/creditos",
    async ({ query, set, user }: any) => {
      if (!requireBucketsRole(user, set)) return NO_AUTORIZADO;
      try {
        // bucket: CSV de números del catálogo (ej. "1" o "4,5"). Sin él =
        // todo el funnel. Tokens inválidos → 400 (no descartar en silencio).
        if (csvInvalido(query.bucket, esBucket)) {
          set.status = 400;
          return { success: false, message: "[ERROR] bucket inválido (CSV de enteros, ej. 0,1,5)" };
        }
        const bucketsNumeros = query.bucket
          ? [...new Set(
              String(query.bucket)
                .split(",")
                .map((s: string) => Number(s.trim()))
                .filter((n: number) => Number.isInteger(n)),
            )]
          : undefined;

        // mes/anio de creación: opcionales, van JUNTOS (0/0 = sin filtro,
        // igual que /getAllCredits). Validar antes de castear.
        const mes = query.mes !== undefined ? Number(query.mes) : 0;
        const anio = query.anio !== undefined ? Number(query.anio) : 0;
        if (!Number.isInteger(mes) || mes < 0 || mes > 12) {
          set.status = 400;
          return { success: false, message: "[ERROR] mes inválido (1-12)" };
        }
        if (!Number.isInteger(anio) || anio < 0) {
          set.status = 400;
          return { success: false, message: "[ERROR] anio inválido" };
        }
        if ((mes === 0) !== (anio === 0)) {
          set.status = 400;
          return { success: false, message: "[ERROR] mes y anio van juntos (ambos o ninguno)" };
        }

        const asesorId = query.asesor_id ? Number(query.asesor_id) : undefined;
        if (asesorId !== undefined && (!Number.isInteger(asesorId) || asesorId <= 0)) {
          set.status = 400;
          return { success: false, message: "[ERROR] asesor_id inválido" };
        }

        // Paginación: floor ANTES de clamp (page=0.5 → 1, no OFFSET negativo).
        const pageFloor = Math.floor(Number(query.page ?? 1));
        const page = Number.isFinite(pageFloor) && pageFloor > 0 ? pageFloor : 1;
        const perPageFloor = Math.floor(Number(query.perPage ?? 10));
        const perPage =
          Number.isFinite(perPageFloor) && perPageFloor > 0
            ? Math.min(perPageFloor, 500)
            : 10;

        const result = await getCreditosWithUserByMesAnio(
          mes,
          anio,
          page,
          perPage,
          query.numero_credito_sifco?.trim() || undefined,
          undefined, // estado: el bucket ya encapsula el estado
          asesorId,
          query.nombre_usuario,
          query.email_asesor,
          undefined, // cuotas_atrasadas (escalar viejo): aquí el eje es el bucket
          undefined, // proximidad_pago
          undefined, // is_vehiculo_propio
          undefined, // inversionista_ids
          undefined, // fecha_desde
          undefined, // fecha_hasta
          undefined, // numeros_credito_sifco
          undefined, // capital_min
          undefined, // capital_max
          STATUS_FUNNEL, // solo créditos del funnel (B0-B5)
          undefined, // aseguradora_id
          undefined, // cuotas_min
          undefined, // cuotas_max
          bucketsNumeros,
        );
        return { success: true, ...result };
      } catch (err) {
        set.status = 500;
        return {
          success: false,
          message: "[ERROR] No se pudo obtener los créditos por bucket",
          error: String(err),
        };
      }
    },
    {
      query: t.Object({
        bucket: t.Optional(t.String()),
        mes: t.Optional(t.String()),
        anio: t.Optional(t.String()),
        numero_credito_sifco: t.Optional(t.String()),
        nombre_usuario: t.Optional(t.String()),
        asesor_id: t.Optional(t.String()),
        email_asesor: t.Optional(t.String()),
        page: t.Optional(t.String()),
        perPage: t.Optional(t.String()),
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
