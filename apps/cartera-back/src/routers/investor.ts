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
} from "../controllers/investor";
import { InversionistaReporte, RespuestaReporte } from "../utils/interface";
import puppeteer from "puppeteer"; 
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export const inversionistasRouter = new Elysia()
  .post("/investor", insertInvestor)
  .get("/investor", getInvestors)
  .get("/getInvestorsWithFullCredits", getInvestorsWithCredits)
  .get(
    "/getInvestors",
    async ({ query, set }) => {
      // Extraer los query params
      const {
        id,
        page = "1",
        perPage = "10",
      } = query as Record<string, string | undefined>;

      // Paginación
      const pageNum = Number(page);
      const perPageNum = Number(perPage);

      if ((page && isNaN(pageNum)) || (perPage && isNaN(perPageNum))) {
        set.status = 400;
        return { message: "Parámetros 'page' y/o 'perPage' inválidos." };
      }

      // Validar que el id sea numérico si viene
      if (id && isNaN(Number(id))) {
        set.status = 400;
        return { message: "El parámetro 'id' debe ser numérico." };
      }

      // Aquí llamas tu función con los filtros
      const result = await resumeInvestor(
        id ? Number(id) : undefined,
        pageNum,
        perPageNum
      );

      return result;
    },
    {
      // Tipado/validación de los query params
      query: t.Object({
        id: t.Optional(t.String()),
        page: t.Optional(t.String()),
        perPage: t.Optional(t.String()),
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
  const { id, page = "1", perPage = "1" } = query as Record<string, string | undefined>;

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

  const result: RespuestaReporte = await resumeInvestor(Number(id), pageNum, perPageNum);

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
});
