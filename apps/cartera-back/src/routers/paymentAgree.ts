// src/routes/paymentAgreements.routes.ts
import { Elysia, t } from "elysia";
import { createPaymentAgreement, getPaymentAgreements, updateConvenioStatus, listPaymentAgreements, getConvenioCuotas } from "../controllers/paymentAgreement";
import { authMiddleware } from "./midleware";
 

export const paymentAgreementsRouter = new Elysia({ prefix: "/payment-agreements" })
  .use(authMiddleware)
  // CREATE - Crear convenio de pago
  .post(
    "/",
    async ({ body, set }) => {
      try {
        const result = await createPaymentAgreement(body);

        if (!result.success) {
          set.status = 400;
          return {
            success: false,
            message: result.message,
            error: result.error,
          };
        }

        set.status = 201;
        return result;
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          message: "Internal server error",
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
    {
      body: t.Object({
        credit_id: t.Number(),
        payment_ids: t.Array(t.Number(), { minItems: 1 }),
        total_agreement_amount: t.Number({ minimum: 0 }),
        number_of_months: t.Number({ minimum: 1 }),
        reason: t.Optional(t.String()),
        observations: t.Optional(t.String()),
        created_by: t.Number(),
      }),
      detail: {
        summary: "Create payment agreement",
        description: "Create a new payment agreement for a credit",
        tags: ["Payment Agreements"],
      },
    }
  )

  // GET ALL - Obtener convenios con filtros
  .get(
    "/",
    async ({ query, set }) => {
      try {
        const filters: any = {};

        // Parse filters from query params
        if (query.credit_id) {
          filters.credit_id = parseInt(query.credit_id);
        }

        if (query.start_date) {
          filters.start_date = new Date(query.start_date);
        }

        if (query.end_date) {
          filters.end_date = new Date(query.end_date);
        }

        if (query.year) {
          filters.year = parseInt(query.year);
        }

        if (query.month) {
          filters.month = parseInt(query.month);
        }

        if (query.day) {
          filters.day = parseInt(query.day);
        }

        if (query.status) {
          filters.status = query.status;
        }

        const result = await getPaymentAgreements(filters);

        if (!result.success) {
          set.status = 400;
          return result;
        }

        set.status = 200;
        return result;
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          message: "Internal server error",
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
    {
      query: t.Object({
        credit_id: t.Optional(t.String()),
        start_date: t.Optional(t.String()),
        end_date: t.Optional(t.String()),
        year: t.Optional(t.String()),
        month: t.Optional(t.String()),
        day: t.Optional(t.String()),
        status: t.Optional(
          t.Union([
            t.Literal("active"),
            t.Literal("completed"),
            t.Literal("inactive"),
            t.Literal("all"),
          ])
        ),
      }),
      detail: {
        summary: "Get payment agreements",
        description: "Get all payment agreements with optional filters",
        tags: ["Payment Agreements"],
      },
    }
  ).post(
    "/toggle-status",
    async ({ body, set }) => {
      try {
        const result = await updateConvenioStatus(body.convenio_id, body.activo);

        if (!result.success) {
          set.status = 400;
          return {
            success: false,
            message: result.message,
            error: result.error,
          };
        }

        set.status = 200;
        return result;
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          message: "Internal server error",
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
    {
      body: t.Object({
        convenio_id: t.Number({ minimum: 1 }),
        activo: t.Boolean(),
      }),
      detail: {
        summary: "Toggle payment agreement status",
        description: "Activate or deactivate a payment agreement",
        tags: ["Payment Agreements"],
      },
    }
  )

  // CB-027 — LISTADO paginado con joins (cliente, SIFCO, asesor). Distinto de
  // GET "/": esa no pagina y no trae estos datos, pensada para el detalle de
  // un crédito puntual, no para una tabla de todos los convenios.
  .get(
    "/listado",
    async ({ query, set }) => {
      try {
        const result = await listPaymentAgreements({
          estado: query.estado,
          numero_credito_sifco: query.numero_credito_sifco,
          nombre_usuario: query.nombre_usuario,
          asesor_id: query.asesor_id,
          email_asesor: query.email_asesor,
          page: query.page,
          perPage: query.perPage,
        });

        if (!result.success) {
          // listPaymentAgreements solo llega a success:false vía su catch
          // genérico (fallo real de DB/query) — no valida input de negocio
          // internamente, y query ya viene validado por el schema de abajo
          // (t.Numeric). Un 400 acá le diría al caller "corregí tu request"
          // cuando la causa real es un fallo de servidor.
          set.status = 500;
          return result;
        }

        set.status = 200;
        return result;
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          message: "Internal server error",
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
    {
      query: t.Object({
        estado: t.Optional(
          t.Union([
            t.Literal("active"),
            t.Literal("completed"),
            t.Literal("inactive"),
            t.Literal("all"),
          ])
        ),
        numero_credito_sifco: t.Optional(t.String()),
        nombre_usuario: t.Optional(t.String()),
        // t.Numeric() valida/coerciona vía TypeBox: un valor no numérico (o
        // NaN implícito) falla la validación del schema ANTES del handler,
        // en vez de llegar como NaN a OFFSET/LIMIT (Postgres lo ignora en
        // silencio) o negativo (Postgres lo rechaza con error crudo).
        asesor_id: t.Optional(t.Numeric({ minimum: 1 })),
        email_asesor: t.Optional(t.String()),
        page: t.Optional(t.Numeric({ minimum: 1 })),
        perPage: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
      }),
      detail: {
        summary: "List payment agreements (paginated, with client/advisor joins)",
        description: "CB-027: paginated listing for the CRM convenios table",
        tags: ["Payment Agreements"],
      },
    }
  )

  // CB-027 — plan de pagos (convenio_cuotas) de un convenio puntual.
  .get(
    "/:convenio_id/cuotas",
    async ({ params, set }) => {
      try {
        const convenioId = parseInt(params.convenio_id);
        if (!Number.isInteger(convenioId) || convenioId < 1) {
          set.status = 400;
          return { success: false, message: "convenio_id inválido" };
        }

        const result = await getConvenioCuotas(convenioId);

        if (!result.success) {
          // Mismo criterio que /listado: getConvenioCuotas solo llega a
          // success:false vía su catch genérico (fallo real de DB), no por
          // input inválido — eso ya se rechazó arriba con 400.
          set.status = 500;
          return result;
        }

        set.status = 200;
        return result;
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          message: "Internal server error",
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
    {
      params: t.Object({
        convenio_id: t.String(),
      }),
      detail: {
        summary: "Get convenio cuotas",
        description: "CB-027: payment plan installments for a payment agreement",
        tags: ["Payment Agreements"],
      },
    }
  );