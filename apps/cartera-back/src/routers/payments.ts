import { Elysia, t } from "elysia";
import { 
  getAllPagosWithCreditAndInversionistas,
  getPayments, 
  liquidatePagosCreditoInversionistas,
  falsePayment,
  getPagosConInversionistas,
} from "../controllers/payments"; 
import { z } from "zod";
import { promises as fs } from "fs";
import { mapPagosPorCreditos } from "../migration/migration";
import { authMiddleware } from "./midleware";
import { exportPagosConInversionistasExcel, exportPagosToExcel } from "../controllers/reports";
import { actualizarCuentaPago, aplicarPagoAlCredito, insertPayment } from "../controllers/registerPayment";
import { eq } from "drizzle-orm";
import { db } from "../database";
import { pagos_credito } from "../database/db";
import { reversePayment } from "../controllers/reversePayment";
import { ajustarCuotasConSIFCO, procesarPagosSIFCODesdeJSON } from "../controllers/migratePayments";

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
        console.log(data)
        return  data
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
        numeroCredito: t.Optional(t.String()),
        dia: t.Optional(t.Integer({ minimum: 1, maximum: 31 })),
        mes: t.Optional(t.Integer({ minimum: 1, maximum: 12 })),
        anio: t.Optional(t.Integer({ minimum: 2000, maximum: 2100 })),
        inversionistaId: t.Optional(t.Integer({ minimum: 1 })),
        excel: t.Optional(t.Boolean({ default: false })),
        usuarioNombre: t.Optional(t.String()),
        validationStatus: t.Optional(t.String()),
      }),
      response: {
        200: t.Object({
          success: t.Boolean(),
          message: t.String(),
          total: t.Optional(t.Number()),
          excelUrl: t.Optional(t.String()),
          data: t.Optional(t.Array(t.Any())),
          totalPages: t.Optional(t.Number()),
          totales: t.Optional(t.Any()),
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
.post(
  "/actualizar-cuenta",
  async ({ query }) => {
    try {
      const { pagoId, cuentaEmpresaId } = query;

      // Validaciones
      if (!pagoId || !cuentaEmpresaId) {
        return {
          status: 400,
          body: {
            success: false,
            message: "❌ pagoId y cuentaEmpresaId son requeridos",
          },
        };
      }

      const pagoIdNum = parseInt(pagoId);
      const cuentaIdNum = parseInt(cuentaEmpresaId);

      if (isNaN(pagoIdNum) || isNaN(cuentaIdNum)) {
        return {
          status: 400,
          body: {
            success: false,
            message: "❌ pagoId y cuentaEmpresaId deben ser números válidos",
          },
        };
      }

      const result = await actualizarCuentaPago(pagoIdNum, cuentaIdNum);

      if (!result.success) {
        return {
          status: result.message.includes("no encontrado") ? 404 : 400,
          body: result,
        };
      }

      return {
        status: 200,
        body: result,
      };
    } catch (error: any) {
      console.error("❌ Error en POST /pagos/actualizar-cuenta:", error);
      return {
        status: 500,
        body: {
          success: false,
          message: "❌ Error interno del servidor",
          error: error.message,
        },
      };
    }
  },
  {
    query: t.Object({
      pagoId: t.String(),
      cuentaEmpresaId: t.String(),
    }),
  }
)  .post("/procesar-discrepancias", async () => {
    // 👇 Ruta quemada
    const rutaArchivo = "C:\\Users\\Kelvin Palacios\\Documents\\analis de datos\\creditosMenor20.json";

    console.log(`\n📂 Leyendo archivo: ${rutaArchivo}`);

    // Leer el archivo
    const contenido = await fs.readFile(rutaArchivo, "utf-8");
    const jsonData = JSON.parse(contenido);

    if (!jsonData.data || !jsonData.data.detalleDiscrepancias) {
      throw new Error("JSON inválido: falta 'data.detalleDiscrepancias'");
    }

    const discrepancias = jsonData.data.detalleDiscrepancias;

    console.log(`\n🚀 Procesando ${discrepancias.length} créditos desde archivo...`);

    const resultados = [];
    const errores = [];

    for (const discrepancia of discrepancias) {
      const {
        numeroPrestamo,
        cuotaEsperada,
        cuotaEncontrada,
        fechaCuota,
        plazoCompleto,
        plazoEncontrado,
        cuotasPorCrear,
      } = discrepancia;

      try {
        console.log(`\n📌 Procesando crédito: ${numeroPrestamo}`);

        await ajustarCuotasConSIFCO({
          numero_credito_sifco: numeroPrestamo,
          cuota_esperada: cuotaEsperada,
          cuota_encontrada: cuotaEncontrada,
          fecha_cuota: fechaCuota,
          plazo_completo: plazoCompleto,
          plazo_encontrado: plazoEncontrado,
          cuotas_por_crear: cuotasPorCrear,
        });

        resultados.push({
          numeroPrestamo,
          status: "success",
          mensaje: `Ajustado correctamente: ${cuotasPorCrear} cuotas creadas`,
        });

        console.log(`   ✅ Crédito ${numeroPrestamo} ajustado exitosamente`);
      } catch (error: any) {
        console.error(`   ❌ Error en crédito ${numeroPrestamo}:`, error.message);

        errores.push({
          numeroPrestamo,
          status: "error",
          mensaje: error.message,
        });
      }
    }

    console.log(`\n🎉 Proceso completado!`);
    console.log(`   ✅ Exitosos: ${resultados.length}`);
    console.log(`   ❌ Errores: ${errores.length}`);

    return {
      success: true,
      totalProcesados: discrepancias.length,
      exitosos: resultados.length,
      errores: errores.length,
      resultados,
      detalleErrores: errores,
    };
  })

  // 🔍 Endpoint para probar UN SOLO crédito (por si acaso)
  .post(
    "/ajustar-credito",
    async ({ body }) => {
      const {
        numero_credito_sifco,
        cuota_esperada,
        cuota_encontrada,
        fecha_cuota,
        plazo_completo,
        plazo_encontrado,
        cuotas_por_crear,
      } = body;

      await ajustarCuotasConSIFCO({
        numero_credito_sifco,
        cuota_esperada,
        cuota_encontrada,
        fecha_cuota,
        plazo_completo,
        plazo_encontrado,
        cuotas_por_crear,
      });

      return {
        success: true,
        mensaje: `Crédito ${numero_credito_sifco} ajustado correctamente`,
      };
    },
    {
      body: t.Object({
        numero_credito_sifco: t.String(),
        cuota_esperada: t.Number(),
        cuota_encontrada: t.Number(),
        fecha_cuota: t.String(),
        plazo_completo: t.Number(),
        plazo_encontrado: t.Number(),
        cuotas_por_crear: t.Number(),
      }),
    }
  )  .post("/procesar-desde-archivo", async () => {
    // 👇 Ruta quemada al archivo JSON
    const rutaArchivo = "C:\\Users\\Kelvin Palacios\\Documents\\analis de datos\\pagosSIFCO.json";

    console.log(`\n📂 Leyendo archivo: ${rutaArchivo}`);

    try {
      // Leer el archivo
      const contenido = await fs.readFile(rutaArchivo, "utf-8");
      const jsonData = JSON.parse(contenido);

      console.log(`📦 JSON leído exitosamente`);
      console.log(`📊 Total de elementos en el JSON: ${jsonData.length}`);

      // Procesar los pagos
      await procesarPagosSIFCODesdeJSON(jsonData);

      return {
        success: true,
        message: "Pagos procesados exitosamente desde archivo",
        archivo: rutaArchivo,
        total_creditos: jsonData.length,
      };
    } catch (error: any) {
      console.error("❌ Error leyendo o procesando archivo:", error);
      
      return {
        success: false,
        message: `Error: ${error.message}`,
        archivo: rutaArchivo,
      };
    }
  }, {
    detail: {
      tags: ["SIFCO Pagos"],
      summary: "Procesar pagos desde archivo JSON",
      description: "Lee un archivo JSON desde el sistema y procesa los pagos automáticamente",
    },
  })

  // 📤 POST - Procesar pagos desde JSON en el body (alternativa)
.post(
    "/procesar-pagos",
    async ({ set }) => {
      // 👇 Ruta quemada directamente aquí
      const rutaArchivo = "C:\\Users\\Kelvin Palacios\\Documents\\analis de datos\\resultado_ultimos_pagos.json";

      console.log(`\n📂 Leyendo archivo: ${rutaArchivo}`);

      try {
        // Leer el archivo
        const contenido = await fs.readFile(rutaArchivo, "utf-8");
        const jsonData = JSON.parse(contenido);

        console.log(`📦 JSON leído exitosamente`);
        console.log(`📊 Total de elementos en el JSON: ${jsonData.length}`);

        // Procesar los pagos
        await procesarPagosSIFCODesdeJSON(jsonData);

        return {
          success: true,
          message: "Pagos procesados exitosamente desde archivo",
          archivo: rutaArchivo,
          total_creditos: jsonData.length,
        };
      } catch (error: any) {
        console.error("❌ Error leyendo o procesando archivo:", error);
        set.status = 500;
        
        return {
          success: false,
          message: `Error: ${error.message}`,
          archivo: rutaArchivo,
        };
      }
    },
    {
      detail: {
        tags: ["SIFCO Pagos"],
        summary: "Procesar pagos desde archivo JSON",
        description: "Lee un archivo JSON desde la ruta quemada y procesa los pagos automáticamente",
      },
    }
  )

  // 🔍 POST - Procesar UN SOLO crédito (para testing)
  .post(
    "/procesar-uno",
    async ({ body, set }) => {
      try {
        console.log(`\n🎯 Procesando UN crédito: ${body.numeroCredito}`);
        
        await procesarPagosSIFCODesdeJSON([body]);

        return {
          success: true,
          message: `Crédito ${body.numeroCredito} procesado exitosamente`,
        };
      } catch (error) {
        console.error("❌ Error procesando crédito:", error);
        set.status = 500;
        return {
          success: false,
          message: error instanceof Error ? error.message : "Error desconocido",
        };
      }
    },
    {
      body: t.Object({
        numeroCredito: t.String(),
        creditos: t.Array(
          t.Object({
            numeroCredito: t.String(),
            fechaUltimoPago: t.String(),
            numeroCuota: t.String(),
            cuota: t.String(),
            montoBoleta: t.String(),
            pagado: t.String(),
          })
        ),
      }),
      detail: {
        tags: ["SIFCO Pagos"],
        summary: "Procesar un solo crédito",
        description: "Para testing - procesa un solo crédito",
      },
    }
  )
 

 