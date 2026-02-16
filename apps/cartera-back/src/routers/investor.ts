// routes/inversionistas.ts
import { Elysia, t } from "elysia";
import {
  getInvestors,
  insertInvestor,
  getInvestorsWithCredits,
  resumeInvestor,
  liquidateByInvestorId,
  liquidateByInvestorSchema,
  generarHTMLReporte,
  updateInvestor,
  resumenGlobalInversionistas,
  getLiquidaciones,
  getInvestorPerformance,
  TipoConsulta, // 🆕 NUEVO: Tipo para validación de consultas
  reversePagosEspejoPorInversionista,
  TipoConsulta, // 🆕 NUEVO: Tipo para validación de consultas
} from "../controllers/investor";
import { InversionistaReporte, RespuestaReporte } from "../utils/interface";
import puppeteer from "puppeteer";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { authMiddleware } from "./midleware";
import { obtenerCreditosConPagosPendientes } from "../controllers/payments";
import { createBoleta, getBoletaById, getAllBoletas, getBoletasPendientes, updateBoleta, marcarBoletaComoProcesada, marcarBoletaComoPendiente, deleteBoleta, getBoletasStats } from "../controllers/liquidateInvestor";
// 🔥 IMPORTAR SERVICIO DE BOLETAS
 

export const inversionistasRouter = new Elysia()
  .post("/investor", insertInvestor)
  .get("/investor", getInvestors)
  .post("/investor/update", updateInvestor)
  .get("/getInvestorsWithFullCredits", getInvestorsWithCredits)
  .get(
    "/getInvestors",
    async ({ query, set }) => {
      const {
        id,
        dpi,
        page = "1",
        perPage = "10",
        numeroCreditoSifco,
        nombreUsuario,
        incluirLiquidados = "false",
        numeroCuota,
        tipo = "originales", // 🆕 NUEVO: Permite consultar originales, espejos o ambas
      } = query as Record<string, string | undefined>;

      const pageNum = Number(page);
      const perPageNum = Number(perPage);

      if (isNaN(pageNum) || isNaN(perPageNum)) {
        set.status = 400;
        return { message: "Parámetros 'page' y/o 'perPage' inválidos." };
      }

      if (!id && !dpi) {
        set.status = 400;
        return {
          message: "Debe proporcionar al menos 'id' o 'dpi' para buscar al inversionista.",
        };
      }

      const incluirLiquidadosBool = incluirLiquidados === "true";
      const numeroCuotaNum = numeroCuota ? Number(numeroCuota) : undefined;
      
      if (numeroCuota && isNaN(numeroCuotaNum!)) {
        set.status = 400;
        return { message: "El parámetro 'numeroCuota' debe ser numérico." };
      }

      const result = await resumeInvestor(
        id ? Number(id) : undefined,
        pageNum,
        perPageNum,
        numeroCreditoSifco,
        nombreUsuario,
        dpi,
        incluirLiquidadosBool,
        numeroCuotaNum,
        tipo as "originales" | "espejos" | "ambas" // 🆕 NUEVO: Pasar tipo a la función
      );

      return result;
    },
    {
      query: t.Object({
        id: t.Optional(t.String()),
        dpi: t.Optional(t.String()),
        page: t.Optional(t.String()),
        perPage: t.Optional(t.String()),
        numeroCreditoSifco: t.Optional(t.String()),
        nombreUsuario: t.Optional(t.String()),
        incluirLiquidados: t.Optional(t.String()),
        numeroCuota: t.Optional(t.String()),
        tipo: t.Optional(t.Union([
          t.Literal("originales"),
          t.Literal("espejos"),
          t.Literal("ambas")
        ])), // 🆕 NUEVO: Validación del parámetro tipo
      }),
      detail: {
        summary: "Obtiene el resumen de un inversionista con sus créditos y pagos",
        description: "Permite consultar datos de tablas originales, espejo o ambas usando el parámetro 'tipo'. Por defecto consulta 'originales'.",
        tags: ["Inversionistas"],
      },
    }
  )
  .post(
    "/liquidate-inversionista-pagos",
    async ({ body, set }) => {
      try {
        console.log("[liquidate-inversionista-pagos] Request body:", body);
        const bodyData = body && typeof body === 'object' ? body : {};
        const parseResult = liquidateByInvestorSchema.safeParse(bodyData);
        
        if (!parseResult.success) {
          set.status = 400;
          return {
            message: "Validation failed",
            errors: parseResult.error.flatten().fieldErrors,
          };
        }

        const { inversionista_id } = parseResult.data;

        if (!inversionista_id) {
          console.warn("⚠️ ¡ALERTA! Se va a liquidar TODOS los pagos del sistema");
        }

        const result = await liquidateByInvestorId(inversionista_id);
        set.status = 200;
        return result;
      } catch (error) {
        console.error("[liquidate-inversionista-pagos] Error:", error);
        set.status = 500;
        return {
          message: "Internal server error",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    {
      body: t.Optional(t.Object({
        inversionista_id: t.Optional(t.Number()),
      })),
      detail: {
        summary: "Liquida todos los pagos de un inversionista",
        tags: ["Pagos/Inversionistas"],
      },
    }
  )
  .post("/investor/pdf", async ({ body, set }) => {
    const { id, page = 1, perPage = 1 } = body as { 
      id?: number; 
      page?: number; 
      perPage?: number 
    };
    
    console.log("Generando PDF para inversionista ID:", id);
    const pageNum = Number(page);
    const perPageNum = Number(perPage);

    if ((page && isNaN(pageNum)) || (perPage && isNaN(perPageNum))) {
      set.status = 400;
      return { message: "Parámetros 'page' y/o 'perPage' inválidos." };
    }

    if (!id || isNaN(Number(id))) {
      set.status = 400;
      return { message: "El parámetro 'id' es obligatorio y debe ser numérico." };
    }

    const result = await resumeInvestor(Number(id), pageNum, perPageNum);
    console.log("Datos obtenidos para el reporte:", result);

    if (!result.inversionistas.length) {
      set.status = 404;
      return { message: "Inversionista no encontrado." };
    }

    const inversionista = result.inversionistas[0];
    const logoUrl = import.meta.env.LOGO_URL || "";
    const html = generarHTMLReporte(inversionista as any, logoUrl);

    const browser = await puppeteer.launch({ 
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });
    
    const pagePDF = await browser.newPage();
    await pagePDF.setContent(html, { waitUntil: "networkidle0" });

    const pdfBuffer = await pagePDF.pdf({
      printBackground: true,
      width: "2500px",
      height: "980px",
      landscape: false,
      margin: { top: 20, bottom: 20, left: 8, right: 8 },
    });

    await browser.close();

    const filename = `reporte_inversionista_${id}.pdf`;
    const s3 = new S3Client({
      endpoint: process.env.BUCKET_REPORTS_URL,
      region: "auto",
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
      },
    });
    
    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.BUCKET_REPORTS,
        Key: filename,
        Body: pdfBuffer,
        ContentType: "application/pdf",
      })
    );

    const url = `${process.env.URL_PUBLIC_R2_REPORTS}/${filename}`;

    return {
      success: true,
      url,
      filename,
    };
  })
  .get(
    "/resumen-global",
    async ({ query }) => {
      const { inversionistaId, mes, anio, excel } = query;

      const result = await resumenGlobalInversionistas(
        inversionistaId ? Number(inversionistaId) : undefined,
        mes ? Number(mes) : undefined,
        anio ? Number(anio) : undefined,
        excel === "true"
      );

      return result;
    },
    {
      query: t.Object({
        inversionistaId: t.Optional(t.String()),
        mes: t.Optional(t.String()),
        anio: t.Optional(t.String()),
        excel: t.Optional(t.String()),
      }),
    }
  )
  .post(
    "/generateFalsePayments",
    async ({ body, set }) => {
      try {
        const { inversionistaId, generateFalsePayment } = body;

        console.log(`🔍 Procesando pagos pendientes para inversionista ${inversionistaId}`);
        console.log(`🎯 Generar pagos: ${generateFalsePayment}`);

        const resultado = await obtenerCreditosConPagosPendientes(
          inversionistaId,
          generateFalsePayment
        );

        if (!resultado.success) {
          set.status = 500;
          return {
            success: false,
            error: resultado.error,
          };
        }

        set.status = 200;
        return {
          success: true,
          message: generateFalsePayment 
            ? "✅ Pagos generados correctamente" 
            : "📄 Datos obtenidos correctamente",
          inversionistaId: resultado.inversionistaId ?? inversionistaId,
          totalCreditosConPagos: resultado.totalCreditosConCuotas ?? 0,
          pagosGenerados: resultado.pagosGenerados ?? false,
          data: resultado.data ?? [],
        };

      } catch (error: any) {
        console.error("❌ Error en POST /pagos-pendientes/generar:", error);
        set.status = 500;
        return {
          success: false,
          error: error.message || "Error al procesar pagos pendientes",
        };
      }
    },
    {
      detail: {
        summary: "Generar pagos pendientes para un inversionista",
        tags: ["Pagos Pendientes"],
      },
      body: t.Object({
        inversionistaId: t.Number({
          description: "ID del inversionista",
          minimum: 1,
        }),
        generateFalsePayment: t.Boolean({
          description: "Si es true, genera los pagos en pagos_credito_inversionistas",
          default: false,
        }),
      }),
      response: {
        200: t.Object({
          success: t.Boolean(),
          message: t.String(),
          inversionistaId: t.Number(),
          totalCreditosConPagos: t.Number(),
          pagosGenerados: t.Boolean(),
          data: t.Array(t.Any()),
        }),
        500: t.Object({
          success: t.Literal(false),
          error: t.String(),
        }),
      },
    }
  )
  .post(
    "/reversePagosEspejo",
    async ({ body, set }) => {
      try {
        const { inversionistaId } = body;

        console.log(`🔄 Revirtiendo pagos espejo para inversionista ${inversionistaId}`);

        const resultado = await reversePagosEspejoPorInversionista(inversionistaId);

        set.status = 200;
        return {
          ...resultado,
          success: true,
          message: "✅ Pagos espejo revertidos correctamente",
        };
      } catch (error: any) {
        console.error("❌ Error en POST /reversePagosEspejo:", error);
        set.status = 500;
        return {
          success: false,
          error: error.message || "Error al revertir pagos espejo",
        };
      }
    },
    {
      detail: {
        summary: "Revertir todos los pagos espejo de un inversionista",
        tags: ["Pagos Espejo"],
      },
      body: t.Object({
        inversionistaId: t.Number({
          description: "ID del inversionista",
          minimum: 1,
        }),
      }),
    }
  )
  .get(
    "/liquidaciones",
    async ({ query, set }) => {
      try {
        const { inversionista_id, liquidacion_id, dpi, page, perPage } = query;

        const result = await getLiquidaciones({
          inversionista_id: inversionista_id
            ? Number(inversionista_id)
            : undefined,
          liquidacion_id: liquidacion_id ? Number(liquidacion_id) : undefined,
          dpi: dpi || undefined,
          page: page ? Number(page) : 1,
          perPage: perPage ? Number(perPage) : 10,
        });

        set.status = 200;
        return result;
      } catch (error) {
        console.error("[GET /liquidaciones] Error:", error);
        set.status = 500;
        return {
          message: "Error al obtener liquidaciones",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    {
      query: t.Object({
        inversionista_id: t.Optional(t.String()),
        liquidacion_id: t.Optional(t.String()),
        dpi: t.Optional(t.String()),
        page: t.Optional(t.String()),
        perPage: t.Optional(t.String()),
      }),
      detail: {
        summary: "Obtener liquidaciones con sus pagos",
        tags: ["Liquidaciones"],
      },
    }
  )
  .get(
    "/inversionistas/rendimiento",
    async ({ query, set }) => {
      try {
        const { dpi } = query;

        if (!dpi) {
          set.status = 400;
          return {
            success: false,
            message: "El parámetro 'dpi' es obligatorio",
          };
        }

        const result = await getInvestorPerformance(dpi);

        set.status = 200;
        return {
          success: true,
          data: result,
        };
      } catch (error) {
        console.error("[GET /inversionistas/rendimiento] Error:", error);
        set.status = 500;
        return {
          success: false,
          message: "Error al obtener rendimiento",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    {
      query: t.Object({
        dpi: t.String(),
      }),
      detail: {
        summary: "Obtener rendimiento de inversionista por DPI",
        tags: ["Inversionistas"],
      },
    }
  )
  // ============================================
  // 🔥 CRUD DE BOLETAS
  // ============================================
  .post(
    "/boletas",
    async ({ body, set }) => {
      try {
        console.log("📝 [POST /boletas] Body:", body);

        const boleta = await createBoleta({
          ...body,
          subido_por: body.subido_por?.toString(),
        });

        set.status = 201;
        return {
          success: true,
          message: "Boleta creada exitosamente",
          data: boleta,
        };
      } catch (error) {
        console.error("❌ [POST /boletas] Error:", error);
        set.status = 500;
        return {
          success: false,
          message: "Error al crear boleta",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    {
      body: t.Object({
        inversionista_id: t.Number({ minimum: 1 }),
        boleta_url: t.String({ minLength: 1 }),
        monto_boleta: t.Optional(t.String()),
        notas: t.Optional(t.String()),
        subido_por: t.Optional(t.Number()),
      }),
      detail: {
        summary: "Crear nueva boleta de pago",
        description: "Crea una boleta con estado PENDIENTE por defecto",
        tags: ["Boletas"],
      },
    }
  )
  .get(
    "/boletas/:id",
    async ({ params, set }) => {
      try {
        const { id } = params;
        console.log(`🔍 [GET /boletas/${id}]`);

        const boleta = await getBoletaById(Number(id));

        set.status = 200;
        return {
          success: true,
          data: boleta,
        };
      } catch (error) {
        console.error(`❌ [GET /boletas/${params.id}] Error:`, error);
        set.status = 404;
        return {
          success: false,
          message: error instanceof Error ? error.message : "Boleta no encontrada",
        };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      detail: {
        summary: "Obtener boleta por ID",
        tags: ["Boletas"],
      },
    }
  )
  .get(
    "/boletas",
    async ({ query, set }) => {
      try {
        const { inversionista_id, estado, limit, offset } = query;
        console.log("📋 [GET /boletas] Query:", query);

        const boletas = await getAllBoletas({
          inversionista_id: inversionista_id ? Number(inversionista_id) : undefined,
          estado: estado as "PENDIENTE" | "PROCESADO" | undefined,
          limit: limit ? Number(limit) : undefined,
          offset: offset ? Number(offset) : undefined,
        });

        set.status = 200;
        return {
          success: true,
          data: boletas,
          total: boletas.length,
        };
      } catch (error) {
        console.error("❌ [GET /boletas] Error:", error);
        set.status = 500;
        return {
          success: false,
          message: "Error al listar boletas",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    {
      query: t.Object({
        inversionista_id: t.Optional(t.String()),
        estado: t.Optional(t.Union([t.Literal("PENDIENTE"), t.Literal("PROCESADO")])),
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
      detail: {
        summary: "Listar boletas con filtros",
        tags: ["Boletas"],
      },
    }
  )
  .get(
    "/boletas/pendientes",
    async ({ query, set }) => {
      try {
        const { inversionista_id } = query;
        console.log("📋 [GET /boletas/pendientes] Query:", query);

        const boletas = await getBoletasPendientes(
          inversionista_id ? Number(inversionista_id) : undefined
        );

        set.status = 200;
        return {
          success: true,
          data: boletas,
          total: boletas.length,
        };
      } catch (error) {
        console.error("❌ [GET /boletas/pendientes] Error:", error);
        set.status = 500;
        return {
          success: false,
          message: "Error al obtener boletas pendientes",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    {
      query: t.Object({
        inversionista_id: t.Optional(t.String()),
      }),
      detail: {
        summary: "Obtener boletas pendientes",
        tags: ["Boletas"],
      },
    }
  )
  .patch(
    "/boletas/:id",
    async ({ params, body, set }) => {
      try {
        const { id } = params;
        console.log(`✏️ [PATCH /boletas/${id}] Body:`, body);

        const boleta = await updateBoleta(Number(id), body);

        set.status = 200;
        return {
          success: true,
          message: "Boleta actualizada exitosamente",
          data: boleta,
        };
      } catch (error) {
        console.error(`❌ [PATCH /boletas/${params.id}] Error:`, error);
        set.status = 500;
        return {
          success: false,
          message: error instanceof Error ? error.message : "Error al actualizar boleta",
        };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        boleta_url: t.Optional(t.String()),
        estado: t.Optional(t.Union([t.Literal("PENDIENTE"), t.Literal("PROCESADO")])),
        monto_boleta: t.Optional(t.String()),
        notas: t.Optional(t.String()),
        fecha_procesado: t.Optional(t.Date()),
      }),
      detail: {
        summary: "Actualizar boleta",
        tags: ["Boletas"],
      },
    }
  )
  .post(
    "/boletas/:id/procesar",
    async ({ params, set }) => {
      try {
        const { id } = params;
        console.log(`🔄 [POST /boletas/${id}/procesar]`);

        const boleta = await marcarBoletaComoProcesada(Number(id));

        set.status = 200;
        return {
          success: true,
          message: "Boleta marcada como PROCESADA",
          data: boleta,
        };
      } catch (error) {
        console.error(`❌ [POST /boletas/${params.id}/procesar] Error:`, error);
        set.status = 500;
        return {
          success: false,
          message: error instanceof Error ? error.message : "Error al procesar boleta",
        };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      detail: {
        summary: "Marcar boleta como PROCESADA",
        tags: ["Boletas"],
      },
    }
  )
  .post(
    "/boletas/:id/revertir",
    async ({ params, set }) => {
      try {
        const { id } = params;
        console.log(`🔄 [POST /boletas/${id}/revertir]`);

        const boleta = await marcarBoletaComoPendiente(Number(id));

        set.status = 200;
        return {
          success: true,
          message: "Boleta marcada como PENDIENTE",
          data: boleta,
        };
      } catch (error) {
        console.error(`❌ [POST /boletas/${params.id}/revertir] Error:`, error);
        set.status = 500;
        return {
          success: false,
          message: error instanceof Error ? error.message : "Error al revertir boleta",
        };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      detail: {
        summary: "Marcar boleta como PENDIENTE",
        tags: ["Boletas"],
      },
    }
  )
  .delete(
    "/boletas/:id",
    async ({ params, set }) => {
      try {
        const { id } = params;
        console.log(`🗑️ [DELETE /boletas/${id}]`);

        const boleta = await deleteBoleta(Number(id));

        set.status = 200;
        return {
          success: true,
          message: "Boleta eliminada exitosamente",
          data: boleta,
        };
      } catch (error) {
        console.error(`❌ [DELETE /boletas/${params.id}] Error:`, error);
        set.status = 500;
        return {
          success: false,
          message: error instanceof Error ? error.message : "Error al eliminar boleta",
        };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      detail: {
        summary: "Eliminar boleta",
        description: "Solo se pueden eliminar boletas con estado PENDIENTE",
        tags: ["Boletas"],
      },
    }
  )
  .get(
    "/boletas/stats",
    async ({ query, set }) => {
      try {
        const { inversionista_id } = query;
        console.log("📊 [GET /boletas/stats] Query:", query);

        const stats = await getBoletasStats(
          inversionista_id ? Number(inversionista_id) : undefined
        );

        set.status = 200;
        return {
          success: true,
          data: stats,
        };
      } catch (error) {
        console.error("❌ [GET /boletas/stats] Error:", error);
        set.status = 500;
        return {
          success: false,
          message: "Error al obtener estadísticas",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    {
      query: t.Object({
        inversionista_id: t.Optional(t.String()),
      }),
      detail: {
        summary: "Obtener estadísticas de boletas",
        tags: ["Boletas"],
      },
    }
  );