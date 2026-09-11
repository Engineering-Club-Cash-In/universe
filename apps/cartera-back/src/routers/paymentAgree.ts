// src/routes/paymentAgreements.routes.ts
import { Elysia, t } from "elysia";
import { createPaymentAgreement, getPaymentAgreements, updateConvenioStatus, listPaymentAgreements, getConvenioCuotas, resolverPlatformUserIdPorEmail } from "../controllers/paymentAgreement";
import { ConvenioDecisionError, decidirConvenio } from "../controllers/convenioDecision";
import { db } from "../database";
import { convenioDecisiones } from "../database/db/schema";
import { desc, eq } from "drizzle-orm";
import { authMiddleware } from "./midleware";

// CB-033 — Gate de rol server-side para decidir un convenio (aprobar/
// rechazar). authMiddleware solo autentica (verifica el JWT), no autoriza.
//
// La decisión se reserva a SUPERVISORES; CONTA deja de decidir (antes podía,
// vía carteraFront) — es lo que hace verdadera la frase "el supervisor
// reemplaza el paso de conta" del ticket.
//
// Dos identidades distintas encajan acá, y NO son intercambiables:
//  1. La cuenta de SERVICIO del CRM (`CRM_SERVICE_USER_ID`, un
//     platform_users.id concreto en cartera) — es el token con el que el CRM
//     llama a esta API, no un humano. Ya validó el rol del supervisor real
//     en su propio sistema (cobrosSupervisorProcedure) y viaja acá con
//     `decidido_por_email` en el body para nombrarlo — SOLO esta cuenta
//     puede fijar ese campo (ver requireConvenioDecisionRole).
//  2. Un `ADMIN` humano de cartera, actuando por sí mismo desde carteraFront.
//
// El rol de cartera (ADMIN/ASESOR/CONTA) no distingue "CRM actuando por un
// supervisor" de "un contador decidiendo directo" — por eso el (1) se
// identifica por id de usuario, no por rol.
const CRM_SERVICE_USER_ID = process.env.CRM_SERVICE_USER_ID
  ? Number.parseInt(process.env.CRM_SERVICE_USER_ID, 10)
  : null;

function esCuentaDeServicioCRM(user: any): boolean {
  return CRM_SERVICE_USER_ID != null && user?.id === CRM_SERVICE_USER_ID;
}

function requireConvenioDecisionRole(
  user: any,
  set: any,
): { ok: true } | { ok: false; body: { success: false; message: string; error: string } } {
  if (esCuentaDeServicioCRM(user)) return { ok: true };
  if (user?.role === "ADMIN") return { ok: true };
  set.status = 403;
  return {
    ok: false,
    body: {
      success: false,
      message: "No autorizado. Solo un supervisor (vía CRM) o un administrador de cartera pueden decidir convenios.",
      error: "convenio_decision_no_autorizado",
    },
  };
}

export const paymentAgreementsRouter = new Elysia({ prefix: "/payment-agreements" })
  .use(authMiddleware)
  // CREATE - Crear convenio de pago
  .post(
    "/",
    async ({ body, set }) => {
      try {
        // CB-032: el CRM crea convenios desde la Ficha 360 y no conoce el id de
        // platform_users del asesor — manda su correo de login. Se resuelve acá
        // y el controlador sigue recibiendo `created_by` numérico como siempre
        // (carteraFront lo manda directo). Si viene el id, gana el id.
        let createdBy = body.created_by;
        if (createdBy == null) {
          if (!body.created_by_email) {
            set.status = 400;
            return {
              success: false,
              message: "Se requiere created_by o created_by_email",
              error: "created_by_required",
            };
          }
          createdBy = await resolverPlatformUserIdPorEmail(body.created_by_email);
          if (createdBy == null) {
            set.status = 400;
            return {
              success: false,
              message: `El usuario ${body.created_by_email} no existe en cartera (platform_users); no se puede atribuir el convenio`,
              error: "created_by_not_found",
            };
          }
        }

        const { created_by_email: _emailCreador, ...rest } = body;
        const result = await createPaymentAgreement({ ...rest, created_by: createdBy });

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
        // Uno de los dos. `created_by` = id de platform_users (carteraFront);
        // `created_by_email` = correo de login (CRM, CB-032), se resuelve arriba.
        created_by: t.Optional(t.Number()),
        created_by_email: t.Optional(t.String({ minLength: 3 })),
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
    // CB-033: este endpoint ahora DELEGA en decidirConvenio (mismo servicio
    // que /:convenio_id/decidir) — ver updateConvenioStatus en
    // paymentAgreement.ts para la ventana de compatibilidad transitoria
    // (motivo/operacion_id opcionales hasta que carteraFront los mande).
    "/toggle-status",
    async ({ body, set, user }: any) => {
      const gate = requireConvenioDecisionRole(user, set);
      if (!gate.ok) return gate.body;

      try {
        const result = await updateConvenioStatus(body.convenio_id, body.activo, {
          motivo: body.motivo,
          operacionId: body.operacion_id,
          actuadoPor: user.id,
          actuadoPorEmail: user.email,
        });

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
        // TODO CB-033 paso 3: hacer ambos obligatorios (t.String() sin
        // Optional) cuando carteraFront ya los mande siempre — ver
        // updateConvenioStatus para la ventana de compatibilidad.
        motivo: t.Optional(t.String()),
        operacion_id: t.Optional(t.String({ format: "uuid" })),
      }),
      detail: {
        summary: "Toggle payment agreement status",
        description: "Activate or deactivate a payment agreement (CB-033: requiere rol de supervisor/admin; delega en decidirConvenio)",
        tags: ["Payment Agreements"],
      },
    }
  )

  // CB-033 — Decidir (aprobar/rechazar) un convenio pendiente de aprobación.
  // Es el endpoint que usa el CRM (cobrosSupervisorProcedure); el viejo
  // /toggle-status delega en el mismo servicio para no duplicar lógica.
  .post(
    "/:convenio_id/decidir",
    async ({ params, body, set, user }: any) => {
      const gate = requireConvenioDecisionRole(user, set);
      if (!gate.ok) return gate.body;

      const convenioId = Number.parseInt(params.convenio_id, 10);
      if (!Number.isInteger(convenioId) || convenioId < 1) {
        set.status = 400;
        return { success: false, message: "convenio_id inválido", error: "convenio_id_invalido" };
      }

      // Solo la cuenta de servicio del CRM puede atribuir la decisión a otra
      // persona (`decidido_por_email`). Cualquier otro llamante que lo mande
      // es un intento de suplantación — se rechaza, no se ignora en silencio.
      if (body.decidido_por_email && !esCuentaDeServicioCRM(user)) {
        set.status = 400;
        return {
          success: false,
          message: "Solo la cuenta de servicio del CRM puede atribuir la decisión a otra persona.",
          error: "decidido_por_email_no_permitido",
        };
      }
      if (esCuentaDeServicioCRM(user) && !body.decidido_por_email) {
        set.status = 400;
        return {
          success: false,
          message: "Falta decidido_por_email: la cuenta de servicio del CRM debe nombrar al supervisor que decidió.",
          error: "decidido_por_email_requerido",
        };
      }

      try {
        const resultado = await decidirConvenio({
          convenioId,
          decision: body.decision,
          motivo: body.motivo,
          operacionId: body.operacion_id,
          origen: "crm",
          actuadoPor: user.id,
          actuadoPorEmail: user.email,
          decididoPorEmail: body.decidido_por_email ?? user.email,
        });

        set.status = 200;
        return { success: true, ...resultado };
      } catch (error) {
        if (error instanceof ConvenioDecisionError) {
          set.status = error.httpStatus;
          return { success: false, message: error.message, error: error.code };
        }
        console.error("[POST /payment-agreements/:convenio_id/decidir] Error:", error);
        set.status = 500;
        return {
          success: false,
          message: "Internal server error",
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
    {
      params: t.Object({ convenio_id: t.String() }),
      body: t.Object({
        decision: t.Union([t.Literal("aprobado"), t.Literal("rechazado")]),
        motivo: t.Optional(t.String()),
        operacion_id: t.String({ format: "uuid" }),
        decidido_por_email: t.Optional(t.String()),
      }),
      detail: {
        summary: "Decide (approve/reject) a pending payment agreement",
        description: "CB-033: transactional approve/reject with idempotency, audit trail, and role gate",
        tags: ["Payment Agreements"],
      },
    }
  )

  // CB-033 — Historial de decisiones POR CRÉDITO (no por convenio: el
  // rechazo borra el convenio, así que consultar por convenio_id perdería
  // el historial justo del caso que hay que auditar — ver decision 6 en
  // 06-ficha-360.md §3.5).
  .get(
    "/decisiones",
    async ({ query, set }) => {
      const creditoId = Number.parseInt(query.credito_id, 10);
      if (!Number.isInteger(creditoId) || creditoId < 1) {
        set.status = 400;
        return { success: false, message: "credito_id inválido" };
      }

      try {
        const filas = await db
          .select()
          .from(convenioDecisiones)
          .where(eq(convenioDecisiones.creditoId, creditoId))
          .orderBy(desc(convenioDecisiones.decididoEn));

        set.status = 200;
        return { success: true, data: filas };
      } catch (error) {
        console.error("[GET /payment-agreements/decisiones] Error:", error);
        set.status = 500;
        return {
          success: false,
          message: "Internal server error",
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
    {
      query: t.Object({ credito_id: t.String() }),
      detail: {
        summary: "Get convenio decision history for a credit",
        description: "CB-033: append-only decision log, survives convenio deletion on rejection",
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
            // CB-033: pendiente de aprobación = activo=false AND completado=false.
            // "inactive" no alcanza para esa cola: un convenio completado también
            // queda activo=false — ver listPaymentAgreements.
            t.Literal("pending"),
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