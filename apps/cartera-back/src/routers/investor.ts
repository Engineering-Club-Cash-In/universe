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
  .get(
    "/investor/pdf",
    async ({ query, set }) => {
      // Extraer los query params
      const {
        id,
        page = "1",
        perPage = "1",
      } = query as Record<string, string | undefined>;

      // Validación de query params
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

      // Obtener data del inversionista
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

      // LOGO LOCAL — usa la ruta real donde Bun tenga acceso
      const logoUrl =
        "file:///mnt/data/d1000675-1063-46e9-bb11-938f40390ca6.png";

      // Generar HTML y PDF
      const html = generarHTMLReporte(inversionista, logoUrl);

      const browser = await puppeteer.launch({ headless: true });
      const pagePDF = await browser.newPage();
      await pagePDF.setContent(html, { waitUntil: "networkidle0" });

      const pdfBuffer = await pagePDF.pdf({
       
        printBackground: true,
        width: "2500px", // <-- O el ancho que necesite tu tabla
        height: "980px", // <-- O más si tienes más filas
        landscape: false,
        margin: { top: 20, bottom: 20, left: 8, right: 8 },
      });

      await browser.close();

      set.headers = {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="reporte_inversionista_${id}.pdf"`,
      };

      return pdfBuffer;
    },
    {
      // Tipado/validación de los query params
      query: t.Object({
        id: t.String(),
        page: t.Optional(t.String()),
        perPage: t.Optional(t.String()),
      }),
      detail: {
        summary: "Descarga el PDF del reporte de un inversionista",
        tags: ["Inversionistas"],
      },
    }
  );
