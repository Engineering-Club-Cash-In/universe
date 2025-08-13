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

export const liquidatePaymentsSchema = z.object({
  pago_id: z.number().int().positive(),
  credito_id: z.number().int().positive(),
  cuota: z.union([z.string(), z.number()]).optional(),
});
const falsePaymentSchema = z.object({
  pago_id: z.number(),
  credito_id: z.number(),
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
    const { mes, anio, page, perPage } = query;

    if (!mes || !anio) {
      set.status = 400;
      return { message: "Faltan parámetros obligatorios 'mes' y 'anio'" };
    }

    try {
      const result = await getPayments(
        Number(mes),
        Number(anio),
        page ? Number(page) : 1,
        perPage ? Number(perPage) : 10
      );
      return result;
    } catch (error) {
      set.status = 500;
      return {
        message: "Error consultando pagos por mes/año",
        error: String(error),
      };
    }
  }) .post(
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
  ) .post("/false-payment", async ({ body, set }) => {
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
  });

  
 