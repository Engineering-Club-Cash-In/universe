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
  .get("/investor/pdf", async ({ query, set }) => {
    const {
      id,
      page = "1",
      perPage = "1",
    } = query as Record<string, string | undefined>;

    // Validaciones...
    const pageNum = Number(page);
    const perPageNum = Number(perPage);

    if ((page && isNaN(pageNum)) || (perPage && isNaN(perPageNum))) {
      set.status = 400;
      return { message: "Parámetros 'page' y/o 'perPage' inválidos." };
    }

    if (!id || isNaN(Number(id))) {
      set.status = 400;
      return {
        message: "El parámetro 'id' es obligatorio y debe ser numérico.",
      };
    }

    const result: RespuestaReporte = await resumeInvestor(
      Number(id),
      pageNum,
      perPageNum
    );

    if (!result.inversionistas.length) {
      set.status = 404;
      return { message: "Inversionista no encontrado." };
    }

    const inversionista: InversionistaReporte = result.inversionistas[0];

    const logoUrl = import.meta.env.LOGO_URL || "";
    const html = generarHTMLReporte(inversionista, logoUrl);

    const browser = await puppeteer.launch({ headless: true });
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
  .get("/resumen-inversionistas", async ({ query, set }) => {
  const {
    id,
    mes,
    anio,
    excel = "false",
  } = query as Record<string, string | undefined>;

  // Validaciones
  if (id && isNaN(Number(id))) {
    set.status = 400;
    return { message: "El parámetro 'id' debe ser numérico." };
  }

  if (mes && isNaN(Number(mes))) {
    set.status = 400;
    return { message: "El parámetro 'mes' debe ser numérico." };
  }

  if (anio && isNaN(Number(anio))) {
    set.status = 400;
    return { message: "El parámetro 'anio' debe ser numérico." };
  }

  const excelBool = excel === "true";

  // Llamada al servicio
  const result = await resumenGlobalInversionistas(
    id ? Number(id) : undefined,
    mes ? Number(mes) : undefined,
    anio ? Number(anio) : undefined,
    excelBool
  );

  return result;
}, {
  query: t.Object({
    id: t.Optional(t.String()),
    mes: t.Optional(t.String()),
    anio: t.Optional(t.String()),
    excel: t.Optional(t.String()),
  }),
})


