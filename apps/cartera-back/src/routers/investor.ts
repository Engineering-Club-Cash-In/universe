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
} from "../controllers/investor";
import { InversionistaReporte, RespuestaReporte } from "../utils/interface";
import puppeteer from "puppeteer";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { authMiddleware } from "./midleware";
import { obtenerCreditosConPagosPendientes } from "../controllers/payments";
 

export const inversionistasRouter = new Elysia()
 
  .post("/investor", insertInvestor)
  .get("/investor", getInvestors)
  .post("/investor/update", updateInvestor) // 👈 update usando POST
  .get("/getInvestorsWithFullCredits", getInvestorsWithCredits)
  .get(
  "/getInvestors",
  async ({ query, set }) => {
    const {
      id,
      dpi, // 🆕 Filtro por DPI
      page = "1",
      perPage = "10",
      numeroCreditoSifco,
      nombreUsuario,
      incluirLiquidados = "false", // 🆕 Incluir pagos liquidados
      numeroCuota, // 🆕 Filtrar por número de cuota
    } = query as Record<string, string | undefined>;

    // ✅ Validaciones
    const pageNum = Number(page);
    const perPageNum = Number(perPage);

    if (isNaN(pageNum) || isNaN(perPageNum)) {
      set.status = 400;
      return { message: "Parámetros 'page' y/o 'perPage' inválidos." };
    }

    // 🆕 Validar que al menos uno de id o dpi esté presente
    if (!id && !dpi) {
      set.status = 400;
      return {
        message: "Debe proporcionar al menos 'id' o 'dpi' para buscar al inversionista.",
      };
    }

    // 🆕 Convertir incluirLiquidados a boolean
    const incluirLiquidadosBool = incluirLiquidados === "true";

    // 🆕 Convertir numeroCuota a número si existe
    const numeroCuotaNum = numeroCuota ? Number(numeroCuota) : undefined;
    if (numeroCuota && isNaN(numeroCuotaNum!)) {
      set.status = 400;
      return { message: "El parámetro 'numeroCuota' debe ser numérico." };
    }

    // 🚀 Llamar función con TODOS los filtros
    const result = await resumeInvestor(
      id ? Number(id) : undefined, // 🆕 Ahora opcional
      pageNum,
      perPageNum,
      numeroCreditoSifco,
      nombreUsuario,
      dpi, // 🆕 DPI
      incluirLiquidadosBool, // 🆕 Incluir liquidados
      numeroCuotaNum // 🆕 Número de cuota
    );

    return result;
  },
  {
    query: t.Object({
      id: t.Optional(t.String()), // 🆕 Ahora opcional
      dpi: t.Optional(t.String()), // 🆕 Nuevo parámetro
      page: t.Optional(t.String()),
      perPage: t.Optional(t.String()),
      numeroCreditoSifco: t.Optional(t.String()),
      nombreUsuario: t.Optional(t.String()),
      incluirLiquidados: t.Optional(t.String()), // 🆕 "true" o "false"
      numeroCuota: t.Optional(t.String()), // 🆕 Número de cuota
    }),
    detail: {
      summary: "Obtiene el resumen de un inversionista con sus créditos y pagos",
      description: `
        Retorna información detallada de un inversionista específico (por ID o DPI) 
        incluyendo sus créditos asociados y pagos pendientes o liquidados.
        
        Parámetros opcionales:
        - id: ID numérico del inversionista
        - dpi: DPI del inversionista
        - incluirLiquidados: "true" para incluir pagos liquidados, "false" (default) solo NO_LIQUIDADO
        - numeroCuota: Filtrar pagos por número de cuota específico
        - numeroCreditoSifco: Filtrar por número de crédito SIFCO
        - nombreUsuario: Filtrar por nombre del usuario/cliente
      `,
      tags: ["Inversionistas"],
    },
  }
)

.post(
  "/liquidate-inversionista-pagos",
  async ({ body, set }) => {
    try {
      console.log("[liquidate-inversionista-pagos] Request body:", body);

      // 🆕 Si el body está vacío o undefined, usar objeto vacío
      const bodyData = body && typeof body === 'object' ? body : {};

      // Validar con Zod
      const parseResult = liquidateByInvestorSchema.safeParse(bodyData);
      if (!parseResult.success) {
        set.status = 400;
        return {
          message: "Validation failed",
          errors: parseResult.error.flatten().fieldErrors,
        };
      }

      const { inversionista_id } = parseResult.data;

      // 🆕 Mensaje de advertencia si no se envía ID
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
      summary: "Liquida todos los pagos de un inversionista (o de TODOS si no se envía ID)",
      description: `
        Cambia el estado de los pagos de "NO_LIQUIDADO" a "LIQUIDADO".
        
        ⚠️ IMPORTANTE:
        - Si se envía inversionista_id: Liquida solo los pagos de ese inversionista
        - Si NO se envía inversionista_id: Liquida TODOS los pagos del sistema
        
        Solo afecta pagos con estado "NO_LIQUIDADO".
      `,
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
  // Validaciones...
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
      '--disable-dev-shm-usage', // Previene problemas de memoria compartida
      '--disable-gpu' // Opcional, útil en algunos entornos
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

  /** 🚀 SUBIR A R2 */
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
        excel: t.Optional(t.String()), // "true" | "false"
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

      // Llamar al servicio
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
      description: `
        Obtiene todos los créditos con pagos pendientes de un inversionista.
        Si generateFalsePayment=true, genera los registros en pagos_credito_inversionistas.
      `,
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
).get(
  "/liquidaciones",
  async ({ query, set }) => {
    try {
      const { inversionista_id, liquidacion_id, dpi, page, perPage } = query;

      const result = await getLiquidaciones({
        inversionista_id: inversionista_id
          ? Number(inversionista_id)
          : undefined,
        liquidacion_id: liquidacion_id ? Number(liquidacion_id) : undefined,
        dpi: dpi || undefined, // 🆕
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
      dpi: t.Optional(t.String()), // 🆕
      page: t.Optional(t.String()),
      perPage: t.Optional(t.String()),
    }),
    detail: {
      summary: "Obtener liquidaciones con sus pagos",
      description: `
        Retorna liquidaciones con todos sus pagos asociados.
        
        Filtros disponibles:
        - inversionista_id: Filtrar por ID del inversionista
        - liquidacion_id: Obtener liquidación específica
        - dpi: Filtrar por DPI del inversionista
        - page: Número de página (default: 1)
        - perPage: Registros por página (default: 10)
      `,
      tags: ["Liquidaciones"],
    },
  }
);