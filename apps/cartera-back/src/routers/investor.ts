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
} from "../controllers/investor";
import { InversionistaReporte, RespuestaReporte } from "../utils/interface";
import puppeteer from "puppeteer";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { authMiddleware } from "./midleware";
import { obtenerCreditosConPagosPendientes } from "../controllers/payments";
 

export const inversionistasRouter = new Elysia()
  .use(authMiddleware)
  .post("/investor", insertInvestor)
  .get("/investor", getInvestors)
  .post("/investor/update", updateInvestor) // 👈 update usando POST
  .get("/getInvestorsWithFullCredits", getInvestorsWithCredits)
  .get(
    "/getInvestors",
    async ({ query, set }) => {
      const {
        id,
        page = "1",
        perPage = "10",
        numeroCreditoSifco,
        nombreUsuario,
      } = query as Record<string, string | undefined>;

      // ✅ Validaciones
      const pageNum = Number(page);
      const perPageNum = Number(perPage);

      if (isNaN(pageNum) || isNaN(perPageNum)) {
        set.status = 400;
        return { message: "Parámetros 'page' y/o 'perPage' inválidos." };
      }

      if (!id || isNaN(Number(id))) {
        set.status = 400;
        return {
          message: "El parámetro 'id' es obligatorio y debe ser numérico.",
        };
      }

      // 🚀 Llamar función con filtros
      const result = await resumeInvestor(
        Number(id), // ahora obligatorio
        pageNum,
        perPageNum,
        numeroCreditoSifco,
        nombreUsuario
      );

      return result;
    },
    {
      query: t.Object({
        id: t.String(), // 👈 obligatorio
        page: t.Optional(t.String()),
        perPage: t.Optional(t.String()),
        numeroCreditoSifco: t.Optional(t.String()),
        nombreUsuario: t.Optional(t.String()),
      }),
    }
  )
  .post(
    "/liquidate-inversionista-pagos",
    async ({ body, set }) => {
      try {
        console.log("[liquidate-inversionista-pagos] Request body:", body);

        // Validar con Zod
        const parseResult = liquidateByInvestorSchema.safeParse(body);
        if (!parseResult.success) {
          set.status = 400;
          return {
            message: "Validation failed",
            errors: parseResult.error.flatten().fieldErrors,
          };
        }

        const { inversionista_id } = parseResult.data;

        const result = await liquidateByInvestorId(inversionista_id);

        set.status = 200;
        return {
          ...result,
          message:
            "Todos los pagos del inversionista han sido liquidados correctamente",
        };
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
        excel === "true" || excel === true
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
        inversionistaId: resultado.inversionistaId,
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
);