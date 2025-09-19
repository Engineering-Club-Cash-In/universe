import { Elysia } from "elysia";
import {
  insertPayment,
  getAllPagosWithCreditAndInversionistas,
  getPayments,
  reversePayment,
  liquidatePagosCreditoInversionistas,
  falsePayment,
} from "../controllers/payments"; 
import { z } from "zod";
import { mapPagosPorCreditos } from "../migration/migration";

export const liquidatePaymentsSchema = z.object({
  pago_id: z.number().int().positive(),
  credito_id: z.number().int().positive(),
  cuota: z.union([z.string(), z.number()]).optional(),
});

const falsePaymentSchema = z.object({
  pago_id: z.number(),
  credito_id: z.number(),
});

// ✅ Schema para sync de pagos desde SIFCO (param opcional)
const syncCreditPaymentsSchema = z.object({
  numero_credito_sifco: z.string().min(1).optional(),
});

export const paymentRouter = new Elysia()
  // Endpoint para registrar pago (ya lo tienes)
  .post("/newPayment", insertPayment)
  .post("/reversePayment", reversePayment)

  // Nuevo endpoint para buscar pagos por SIFCO y/o fecha
  .get("/paymentByCredit", async ({ query, set }) => {
    const { numero_credito_sifco } = query;

    if (!numero_credito_sifco) {
      set.status = 400;
      return { message: "Falta el parámetro 'numero_credito_sifco'" };
    }

    try {
      const pagos = await getAllPagosWithCreditAndInversionistas(numero_credito_sifco);

      if (!pagos) {
        set.status = 400;
        return { message: "No se encontraron pagos para el crédito" };
      }

      return pagos;
    } catch (error) {
      set.status = 500;
      return { message: "Error consultando pagos", error: String(error) };
    }
  })

  .get("/payments", async ({ query, set }) => {
    const { mes, anio, page, perPage, numero_credito_sifco } = query;

    if (!mes || !anio) {
      set.status = 400;
      return { message: "Faltan parámetros obligatorios 'mes' y 'anio'" };
    }

    try {
      const result = await getPayments(
        Number(mes),
        Number(anio),
        page ? Number(page) : 1,
        perPage ? Number(perPage) : 10,
        numero_credito_sifco
      );
      return result;
    } catch (error) {
      set.status = 500;
      return {
        message: "Error consultando pagos por mes/año",
        error: String(error),
      };
    }
  })

  .post(
    "/liquidate-pagos-inversionistas",
    async ({ body, set }) => {
      try {
        console.log("[liquidate-pagos-inversionistas] Request body:", body);
        // Validate with Zod
        const parseResult = liquidatePaymentsSchema.safeParse(body);
        if (!parseResult.success) {
          set.status = 400;
          return {
            message: "Validation failed",
            errors: parseResult.error.flatten().fieldErrors,
          };
        }

        const { pago_id, credito_id, cuota } = parseResult.data;
        if (cuota === undefined) {
          set.status = 400;
          return {
            message: "Validation failed",
            errors: { cuota: ["'cuota' is required"] },
          };
        }
        const result = await liquidatePagosCreditoInversionistas(
          pago_id,
          credito_id,
          cuota
        );

        set.status = 200;
        return {
          ...result,
          message: "Payments liquidated successfully",
        };
      } catch (error) {
        console.error("[liquidate-pagos-inversionistas] Error:", error);
        set.status = 500;
        return {
          message: "Internal server error",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    {
      detail: {
        summary: "Liquidate pagos_credito_inversionistas",
        tags: ["Pagos/Inversionistas"],
      },
    }
  )

  .post("/false-payment", async ({ body, set }) => {
    try {
      // Validate request body
      const { pago_id, credito_id } = falsePaymentSchema.parse(body);

      // Call the controller
      const result = await falsePayment(pago_id, credito_id);

      return result;
    } catch (error: any) {
      set.status = 400;
      return {
        message: "Failed to mark payment as false",
        error: error?.message ?? String(error),
      };
    }
  })

  // 🆕🛠️ Endpoint para sincronizar/mappear pagos de créditos desde SIFCO
  // - Si envías `numero_credito_sifco`, procesa solo ese crédito.
  // - Si NO envías nada, procesa todos los créditos en DB.
  .post(
    "/sync-credit-payments",
    async ({ body, set }) => {
      try {
        /** Validate body with Zod (numero_credito_sifco es opcional) */
        const { numero_credito_sifco } = syncCreditPaymentsSchema.parse(body ?? {});

        console.log(
          `[sync-credit-payments] Inicio${
            numero_credito_sifco ? ` (SIFCO=${numero_credito_sifco})` : " (todos los créditos)"
          }`
        );

        // Llamamos al servicio principal que:
        // - Busca en DB (Drizzle)
        // - Consulta estado de cuenta
        // - Invoca mapEstadoCuentaToPagosBig por cada crédito
        const summary = await mapPagosPorCreditos(numero_credito_sifco);

        // Tip: si tu servicio no retorna nada, puedes devolver un mensaje genérico
        set.status = 200;
        return {
          ok: true,
          message: numero_credito_sifco
            ? `Sincronización completada para crédito SIFCO=${numero_credito_sifco}`
            : "Sincronización completada para todos los créditos",
          summary: summary ?? null, // si tu servicio devuelve { ok, fail, total }
        };
      } catch (error: any) {
        console.log("[ERROR] /sync-credit-payments:", error?.message || error);
        set.status = 400;
        return {
          ok: false,
          message: "Failed to sync credit payments",
          error: error?.message ?? String(error),
        };
      }
    },
    {
      detail: {
        summary: "Sincroniza y mapea pagos de créditos desde SIFCO",
        tags: ["Pagos", "Sync"],
      },
    }
  );
