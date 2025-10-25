import { Elysia, t } from "elysia";
import { 
  getAllPagosWithCreditAndInversionistas,
  getPayments, 
  liquidatePagosCreditoInversionistas,
  falsePayment,
  getPagosConInversionistas,
} from "../controllers/payments"; 
import { z } from "zod";
import { mapPagosPorCreditos } from "../migration/migration";
import { authMiddleware } from "./midleware";
import { exportPagosConInversionistasExcel, exportPagosToExcel } from "../controllers/reports";
import { aplicarPagoAlCredito, insertPayment } from "../controllers/registerPayment";
import { eq } from "drizzle-orm";
import { db } from "../database";
import { pagos_credito } from "../database/db";
import { reversePayment } from "../controllers/reversePayment";

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
  const { numero_credito_sifco, excel } = query as {
    numero_credito_sifco?: string;
    excel?: string;
  };

  if (!numero_credito_sifco) {
    set.status = 400;
    return { message: "Falta el parámetro 'numero_credito_sifco'" };
  }

  try {
    if (excel === "true") {
      // 🚀 Generar Excel y devolver URL
      const result = await exportPagosToExcel(numero_credito_sifco);
      set.status = 200;
      return result; // { excelUrl: "https://..." }
    } else {
      // 🔎 Consulta normal JSON
      const pagos = await getAllPagosWithCreditAndInversionistas(
        numero_credito_sifco
      );

      if (!pagos || pagos.length === 0) {
        set.status = 404;
        return { message: "No se encontraron pagos para el crédito" };
      }

      set.status = 200;
      return pagos;
    }
  } catch (error) {
    console.error("❌ Error en /paymentByCredit:", error);
    set.status = 500;
    return { message: "Error consultando pagos", error: String(error) };
  }
})
  .use(authMiddleware)

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
  .get(
    "/reportes/pagos-inversionistas",
    async ({ query, set }) => {
      try {
        // 🧠 Extraer parámetros validados
        const {
          page,
          pageSize,
          numeroCredito,
          dia,
          mes,
          anio,
          inversionistaId,
          excel,
          usuarioNombre,
          validationStatus
        } = query;

        // ✅ Si viene excel=true, generamos el reporte Excel
        if (excel === true) {
          const result = await exportPagosConInversionistasExcel({
            page,
            pageSize,
            numeroCredito,
            dia,
            mes,
            anio,
            inversionistaId,
            usuarioNombre,validationStatus
          });
          set.status = 200;
          return {
            message: "📊 Reporte Excel generado correctamente",
            ...result,
          };
        }

        // ✅ Si no, devolvemos la data JSON normal
        const data = await getPagosConInversionistas({
          page,
          pageSize,
          numeroCredito,
          dia,
          mes,
          anio,
          inversionistaId,
          usuarioNombre
        });

        set.status = 200;
        return {
          status: "📄 Datos de pagos obtenidos correctamente",
          ...data,
        };
      } catch (error: any) {
        console.error("❌ Error en /reportes/pagos-inversionistas:", error);
        set.status = 500;
        return {
          success: false,
          error: error.message || "Error generando reporte de pagos",
        };
      }
    },
    {
      detail: {
        summary: "Obtiene pagos con inversionistas o genera Excel",
        description:
          "Si `excel=true`, genera y sube un reporte Excel completo a R2. Si no, devuelve JSON con los datos de pagos e inversionistas.",
        tags: ["Pagos", "Reportes", "Excel"],
      },
      query: t.Object({
        page: t.Optional(t.Integer({ minimum: 1, default: 1 })),
        pageSize: t.Optional(t.Integer({ minimum: 1, maximum: 1000, default: 20 })),
        numeroCredito: t.Optional(t.String({ minLength: 1 })),
        dia: t.Optional(t.Integer({ minimum: 1, maximum: 31 })),
        mes: t.Optional(t.Integer({ minimum: 1, maximum: 12 })),
        anio: t.Optional(t.Integer({ minimum: 2000, maximum: 2100 })),
        inversionistaId: t.Optional(t.Integer({ minimum: 1 })),
        excel: t.Optional(t.Boolean({ default: false })),
        usuarioNombre: t.Optional(t.String({ minLength: 1 })),
        validationStatus: t.Optional(t.String({ minLength: 1 })),
      }),
      response: {
        200: t.Object({
          success: t.Boolean(),
          message: t.String(),
          total: t.Optional(t.Number()),
          excelUrl: t.Optional(t.String()),
          data: t.Optional(t.Array(t.Any())),
        }),
        500: t.Object({
          success: t.Literal(false),
          error: t.String(),
        }),
      },
    }
  )
.post(
  "/aplicar-pago",
  async ({ query, set }) => {
    try {
      // Validar que pago_id esté presente
      if (!query.pago_id) {
        set.status = 400;
        return {
          success: false,
          message: "El parámetro pago_id es requerido",
        };
      }

      // Validar que pago_id sea un número válido
      const pagoId = parseInt(query.pago_id);
      
      if (isNaN(pagoId) || pagoId <= 0) {
        set.status = 400;
        return {
          success: false,
          message: "El ID del pago debe ser un número válido mayor a 0",
        };
      }

      // Verificar que el pago existe antes de aplicarlo
      const [pagoExiste] = await db
        .select()
        .from(pagos_credito)
        .where(eq(pagos_credito.pago_id, pagoId))
        .limit(1);

      if (!pagoExiste) {
        set.status = 404;
        return {
          success: false,
          message: `No se encontró el pago con ID ${pagoId}`,
        };
      }

      // Verificar que el pago no esté ya validado
      if (pagoExiste.validationStatus === 'validated') {
        set.status = 400;
        return {
          success: false,
          message: "Este pago ya ha sido validado previamente",
        };
      }

      // Aplicar el pago
      const resultado = await aplicarPagoAlCredito(pagoId);

      set.status = 200;
      return resultado;

    } catch (error) {
      console.error("Error en el endpoint aplicar-pago:", error);
      set.status = 500;
      return {
        success: false,
        message: error instanceof Error ? error.message : "Error al aplicar el pago al crédito",
      };
    }
  },
  {
    query: t.Object({
      pago_id: t.String(),
    }),
  }
)