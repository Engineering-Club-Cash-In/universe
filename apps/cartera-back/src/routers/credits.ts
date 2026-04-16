// routes/inversionistas.ts
import { Elysia, t } from "elysia";
import {
  actualizarEstadoCredito,
  cancelCredit,
  getCreditoByNumero,
  getCreditosIncobrables,
  getCreditosWithUserByMesAnio,
  mergeCreditosAndUpdate,
  resetCredit,
  getCreditStats,
  toggleCancelacionActivo,
  actualizarNitCredito,
} from "../controllers/credits";
import { getCuotasPorDiaYAsesor, upsertEfectividadAsesores, getEfectividadAsesores } from "../controllers/paymentsByAdvisor";
import { z } from "zod";
import { getCreditWithCancellationDetails } from "../controllers/cancelCredit";
import puppeteer from "puppeteer";
import { promises as fs } from "fs";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  buildCancelationWorkbook,
  renderCancelationHTML,
} from "../utils/functions/generalFunctions";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  buildCancelationWorkbookDetailedGreen,
  fetchImageBase64,
  renderCancelationHTMLDetailedGreen,
} from "../utils/functions/internReportCancelations";
import {
  buildCostDetailWorkbookPeach,
  renderCostDetailHTMLPeach,
} from "../utils/functions/reportCancelationCosts";
import { authMiddleware } from "./midleware";
import { getCreditosWithUserByMesAnioExcel } from "../controllers/reports";
import { insertCredit } from "../controllers/createCredit";
import {  updateAllInstallments, updateCredit, recalculateQuota, recalcularPagosCredito, calculateInvestorQuotas, repararTotalRestante } from "../controllers/updateCredit";
import { updateDueDates, updateSingleDueDate, fixCreditosWithoutFebruary, updateDueDatesFromJson, cambiarFechaInicio, getHistorialCambioFecha } from "../controllers/updateDueDate";
import { creditos, cuotas_credito } from "../database/db";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../database"; 

const MontoAdicionalSchema = z.object({
  concepto: z.string().min(1, "concepto requerido"),
  monto: z.number({ invalid_type_error: "monto debe ser numérico" }),
});

const mergeCreditSchema = t.Object({
  numero_credito_origen: t.String({
    minLength: 1,
    description: "Número de crédito SIFCO que será absorbido (se cancela)"
  }),
  numero_credito_destino: t.String({
    minLength: 1,
    description: "Número de crédito SIFCO que quedará activo"
  })
});
const RouterBodySchema = z.object({
  creditId: z.coerce.number().int().positive(),
  motivo: z.string().optional(),
  observaciones: z.string().optional(),
  monto_cancelacion: z.number().optional(),
  accion: z.enum([
    "CANCELAR",
    "ACTIVAR",
    "INCOBRABLE",
    "PENDIENTE_CANCELACION",
    "EN_CONVENIO",
    "MOROSO"
  ]),
  montosAdicionales: z.array(MontoAdicionalSchema).optional(),
  traspaso: z.number().optional(),
  garantia_mobiliaria: z.number().optional(),
  otros: z.number().optional(),
  cuotas_atrasadas: z.number().int().min(0).optional(),
});
export const creditRouter = new Elysia()
 
//.use(authMiddleware)
  // Crear nuevo crédito
.post("/newCredit", async ({ body, set }) => {
  const result = await insertCredit({ body, set });
  if (result && typeof result === 'object' && 'status' in result) {
    set.status = result.status as number;
  }
  return result;
})
  .post("/updateCredit", updateCredit)
  .post("/calculate-investor-quotas", calculateInvestorQuotas)
  // Obtener crédito por query param ?numero_credito_sifco=XXXX
  .get("/credito", async ({ query, set }) => {
    const { numero_credito_sifco } = query;
    if (!numero_credito_sifco) {
      set.status = 400;
      return { message: "Falta el parámetro 'numero_credito_sifco'" };
    }
    const result = await getCreditoByNumero(numero_credito_sifco);
    if (
      typeof result === "object" &&
      result !== null &&
      "message" in result &&
      result.message === "Crédito no encontrado"
    )
      set.status = 404;
    if (
      typeof result === "object" &&
      result !== null &&
      "error" in result &&
      result.error
    )
      set.status = 500;
    return result;
  })
.get("/getAllCredits", async ({ query, set }) => {
  // Extraer query params
  const {
    mes,
    anio,
    page = "1",
    perPage = "10",
    numero_credito_sifco,
    estado,
    excel,
    asesor_id,
    nombre_usuario,
    email_asesor,        // 🆕 NUEVO
    cuotas_atrasadas,    // 🆕 NUEVO
    proximidad_pago,     // 🆕 NUEVO
    is_vehiculo_propio,
    inversionista_ids,
  } = query as Record<string, string>;

  // Validar parámetros requeridos
  if (!mes || !anio || !estado) {
    set.status = 400;
    return { message: "Faltan parámetros 'mes', 'anio' y/o 'estado'." };
  }

  // Convertir a número (ya que query params vienen como string)
  const mesNum = Number(mes);
  const anioNum = Number(anio);
  const pageNum = Number(page);
  const perPageNum = Number(perPage);
  const numeroCreditoSifco = numero_credito_sifco
    ? String(numero_credito_sifco)
    : undefined;
  const estadoParam = String(estado) as
    | "ACTIVO"
    | "CANCELADO"
    | "INCOBRABLE"
    | "PENDIENTE_CANCELACION"
    | "EN_CONVENIO"
    | "MOROSO"
    | "CAIDO";
  
  // Convertir asesor_id a número si existe
  const asesorIdNum = asesor_id ? Number(asesor_id) : undefined;
  
  // Nombre de usuario (string)
  const nombreUsuarioParam = nombre_usuario ? String(nombre_usuario) : undefined;

  // 🆕 Email del asesor (string)
  const emailAsesorParam = email_asesor ? String(email_asesor) : undefined;

  // 🆕 Cuotas atrasadas (número)
  const cuotasAtrasadasNum = cuotas_atrasadas ? Number(cuotas_atrasadas) : undefined;

  // 🆕 Proximidad de pago (enum)
  const proximidadPagoParam = proximidad_pago
    ? (String(proximidad_pago) as "TODAY" | "WEEK" | "TWO_WEEKS" | "MONTH" | "DUEMONTH")
    : undefined;

  // Filtro vehiculo propio
  const isVehiculoPropioParam = is_vehiculo_propio === "true" ? true : undefined;

  // Array de inversionistas (viene como "1,2,3")
  const inversionistaIdsArray = inversionista_ids
    ? inversionista_ids.split(",").map(Number).filter((n) => !isNaN(n))
    : undefined;

  // Validaciones
  if (
    isNaN(mesNum) ||
    mesNum < 0 ||
    mesNum > 12 ||
    isNaN(anioNum) ||
    anioNum < 0
  ) {
    set.status = 400;
    return { message: "Parámetros 'mes' y/o 'anio' inválidos." };
  }

  // Validar asesor_id si se envía
  if (asesor_id && isNaN(asesorIdNum!)) {
    set.status = 400;
    return { message: "Parámetro 'asesor_id' debe ser un número válido." };
  }

  // 🆕 Validar cuotas_atrasadas si se envía
  if (cuotas_atrasadas && isNaN(cuotasAtrasadasNum!)) {
    set.status = 400;
    return { message: "Parámetro 'cuotas_atrasadas' debe ser un número válido." };
  }

  // 🆕 Validar proximidad_pago si se envía
  if (proximidad_pago && !["TODAY", "WEEK", "TWO_WEEKS", "MONTH", "DUEMONTH"].includes(proximidad_pago)) {
    set.status = 400;
    return { 
      message: "Parámetro 'proximidad_pago' debe ser: TODAY, WEEK, TWO_WEEKS, MONTH o DUEMONTH" 
    };
  }

  // Llamar servicio
  try {
    if (excel === "true") {
      // 👉 Generar y subir Excel
      const result = await getCreditosWithUserByMesAnioExcel({
        mes: mesNum,
        anio: anioNum,
        page: pageNum,
        perPage: perPageNum,
        numero_credito_sifco: numeroCreditoSifco,
        estado: estadoParam,
        asesor_id: asesorIdNum,
        nombre_usuario: nombreUsuarioParam,
        email_asesor: emailAsesorParam,
        cuotas_atrasadas: cuotasAtrasadasNum,
        proximidad_pago: proximidadPagoParam,
        is_vehiculo_propio: isVehiculoPropioParam,
        inversionista_ids: inversionistaIdsArray,
        excel: true,
      });
      set.status = 200;
      return result;
    } else {
      // 👉 Llamada normal
      const result = await getCreditosWithUserByMesAnio(
        mesNum,
        anioNum,
        pageNum,
        perPageNum,
        numeroCreditoSifco,
        estadoParam,
        asesorIdNum,
        nombreUsuarioParam,
        emailAsesorParam,
        cuotasAtrasadasNum,
        proximidadPagoParam,
        isVehiculoPropioParam,
        inversionistaIdsArray
      );
      set.status = 200;
      return result;
    }
  } catch (error) {
    set.status = 500;
    return { message: "Error obteniendo créditos", error: String(error) };
  }
})

  .post("/cancelCredit", async ({ body, set }) => {
    // Validar que venga el creditId en el body
    const { creditId } = body as { creditId?: number };
    if (!creditId || isNaN(Number(creditId))) {
      set.status = 400;
      return { message: "Falta o es inválido el parámetro 'creditId'" };
    }
    try {
      const result = await cancelCredit(Number(creditId));
      // Si el resultado tiene error, devolver status adecuado
      if ("error" in result && result.error) {
        set.status = 500;
        return result;
      }
      if ("message" in result && result.message === "Crédito no encontrado.") {
        set.status = 404;
      }
      return result;
    } catch (error) {
      set.status = 500;
      return { message: "Error cancelando crédito", error: String(error) };
    }
  })

  // 🔥 Toggle estado activo de cancelación
  .post(
    "/cancelacion/toggle-activo",
    async ({ body, set }) => {
      const { creditId, activo } = body;
      try {
        const result = await toggleCancelacionActivo({ creditId, activo });
        if (!result.success) {
          set.status = 400;
          return result;
        }
        return result;
      } catch (error) {
        set.status = 500;
        return { message: "Error actualizando estado de cancelación", error: String(error) };
      }
    },
    {
      body: t.Object({
        creditId: t.Number(),
        activo: t.Boolean(),
      }),
    }
  )

  .post("/creditAction", async ({ body, set }) => {
    // 1) Validación de body
    const parse = RouterBodySchema.safeParse(body);
    if (!parse.success) {
      set.status = 400;
      return {
        message: "[ERROR] Parámetros inválidos",
        issues: parse.error.flatten(),
      };
    }

    const {
      creditId,
      motivo,
      observaciones,
      monto_cancelacion,
      accion,
      montosAdicionales,
      traspaso,
      garantia_mobiliaria,
      otros,
      cuotas_atrasadas,
    } = parse.data;

    // 2) Reglas de negocio: acciones que requieren motivo + monto
    const requiereMotivoYMonto =
      accion === "CANCELAR" ||
      accion === "PENDIENTE_CANCELACION" ||
      accion === "INCOBRABLE"
      || accion === "EN_CONVENIO"
      || accion === "MOROSO"
        

    if (requiereMotivoYMonto && (!motivo || monto_cancelacion == null)) {
      set.status = 400;
      return {
        message:
          "[ERROR] Para esta acción debes enviar 'motivo' y 'monto_cancelacion'.",
      };
    }

    // 3) Ejecutar servicio
    try {
      const result = await actualizarEstadoCredito({
        creditId,
        motivo,
        observaciones,
        monto_cancelacion,
        accion,
        // Nuevo: pasar montos adicionales (opcional)
        montosAdicionales,
        traspaso,
        garantia_mobiliaria,
        otros,
        cuotas_atrasadas,
      });

      if (!result.ok) set.status = 400; // error del servicio
      return result;
    } catch (error) {
      set.status = 500;
      return {
        message: "[ERROR] Error actualizando estado del crédito",
        error: String(error),
      };
    }
  })
  /**
   * Ruta para obtener créditos incobrables con paginación y filtro opcional por número de crédito SIFCO.
   * Query params: page, perPage, numero_credito_sifco
   */
  .get("/incobrables", async ({ query, set }) => {
    const {
      page = "1",
      perPage = "20",
      numero_credito_sifco,
    } = query as Record<string, string>;

    const pageNum = Number(page);
    const perPageNum = Number(perPage);

    if (isNaN(pageNum) || pageNum < 1 || isNaN(perPageNum) || perPageNum < 1) {
      set.status = 400;
      return { message: "Parámetros 'page' y/o 'perPage' inválidos." };
    }

    try {
      // Importa el controlador donde corresponda
      const result = await getCreditosIncobrables(
        pageNum,
        perPageNum,
        numero_credito_sifco
      );
      set.status = result.ok ? 200 : 500;
      return result;
    } catch (error) {
      set.status = 500;
      return {
        message: "Error obteniendo créditos incobrables",
        error: String(error),
      };
    }
  })
  .post("/resetCredit", async ({ body, set }) => {
    // Valida los parámetros
    const { creditId, montoIncobrable, montoBoleta, url_boletas, cuota, banco_id, numeroAutorizacion } =
      body as {
        creditId?: number;
        montoIncobrable?: number;
        montoBoleta?: number | string;
        url_boletas?: string[];
        cuota?: number;
        banco_id?: number;
        numeroAutorizacion?: string;
      };

    // Validaciones mínimas
    if (
      !creditId ||
      isNaN(Number(creditId)) ||
      montoBoleta === undefined ||
      isNaN(Number(montoBoleta)) ||
      !Array.isArray(url_boletas) ||
      cuota === undefined ||
      isNaN(Number(cuota)) ||
      !banco_id ||
      isNaN(Number(banco_id))
    ) {
      set.status = 400;
      return { message: "Faltan o son inválidos los parámetros requeridos." };
    }

    try {
      const result = await resetCredit({
        creditId: Number(creditId),
        montoIncobrable:
          montoIncobrable !== undefined ? Number(montoIncobrable) : undefined,
        montoBoleta: montoBoleta,
        url_boletas: url_boletas,
        cuota: Number(cuota),
        banco_id: Number(banco_id),
        numeroAutorizacion,
      });
      set.status = 200;
      return result;
    } catch (error) {
      set.status = 500;
      return { message: "Error reiniciando el crédito", error: String(error) };
    }
  })
  .get("/credit/cancelation-report", async ({ query, set }) => {
    const { numero_sifco, pdf, excel, format } = query as Record<
      string,
      string | undefined
    >;

    if (!numero_sifco) {
      set.status = 400;
      return { message: "El parámetro 'numero_sifco' es obligatorio." };
    }

    let outFormat: "pdf" | "excel" = "pdf";
    if (format === "excel" || excel === "true") outFormat = "excel";
    if (format === "pdf" || pdf === "true") outFormat = "pdf";
    if (pdf === "true" && excel === "true") {
      set.status = 400;
      return { message: "Elige solo uno: 'pdf=true' o 'excel=true'." };
    }

    // 1) Datos
    const res = await getCreditWithCancellationDetails(numero_sifco);
    if (!res.success) {
      set.status = 404;
      return { message: "Crédito no encontrado." };
    }
    const data = res.data;

    // 2) Generar archivo según formato
    let fileBuffer: Buffer;
    let filename: string;
    let contentType: string;

    if (outFormat === "excel") {
      fileBuffer = await buildCancelationWorkbook(data, {
        logoUrl: process.env.LOGO_URL || undefined,
      });
      filename = `cancelacion_${data.header.numero_credito_sifco}_${Date.now()}.xlsx`;
      contentType =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    } else {
      const logoUrl = process.env.LOGO_URL || "";
      const html = renderCancelationHTML(data, logoUrl);
      const browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
      const pagePDF = await browser.newPage();
      await pagePDF.setContent(html, { waitUntil: "networkidle0" });
      const pdfData = await pagePDF.pdf({
        format: "A4",
        landscape: false,
        printBackground: true,
        margin: { top: "12mm", bottom: "12mm", left: "10mm", right: "10mm" },
      });
      fileBuffer = Buffer.from(pdfData);
      await browser.close();

      filename = `cancelacion_${data.header.numero_credito_sifco}_${Date.now()}.pdf`;
      contentType = "application/pdf";
    }

    // 3) Upload a S3/R2
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
        Bucket: process.env.BUCKET_REPORTS as string,
        Key: filename,
        Body: fileBuffer,
        ContentType: contentType,
      })
    );

    // 4) URL pública o pre-signed
    let url: string;
    if (process.env.URL_PUBLIC_R2_REPORTS) {
      url = `${process.env.URL_PUBLIC_R2_REPORTS}/${filename}`;
    } else {
      url = await getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: process.env.BUCKET_REPORTS as string,
          Key: filename,
        }),
        { expiresIn: 60 * 60 * 24 }
      );
    }

    return {
      ok: true,
      format: outFormat,
      url,
      filename,
      size: fileBuffer.length,
    };
  })
  .get("/credit/cancelation-report-intern", async ({ query, set }) => {
    const { numero_sifco, pdf, excel, format } = query as Record<
      string,
      string | undefined
    >;
    if (!numero_sifco) {
      set.status = 400;
      return { message: "El parámetro 'numero_sifco' es obligatorio." };
    }

    // formato
    let outFormat: "pdf" | "excel" = "pdf";
    if (format === "excel" || excel === "true") outFormat = "excel";
    if (format === "pdf" || pdf === "true") outFormat = "pdf";
    if (pdf === "true" && excel === "true") {
      set.status = 400;
      return { message: "Elige solo uno: 'pdf=true' o 'excel=true'." };
    }

    // 1) Data
    const res = await getCreditWithCancellationDetails(numero_sifco);
    if (!res.success) {
      set.status = 404;
      return { message: "Crédito no encontrado." };
    }
    const data = res.data;

    // 2) Generar archivo
    let fileBuffer: Buffer;
    let filename: string;
    let contentType: string;

    if (outFormat === "excel") {
      const logoBase64 = null; // el builder ya admite base64 si quieres: fetch y pásalo
      fileBuffer = await buildCancelationWorkbookDetailedGreen(data, {
        logoBase64,
      });
      filename = `cancelacion_detallada_${data.header.numero_credito_sifco}_${Date.now()}.xlsx`;
      contentType =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    } else {
      const logoUrl = process.env.LOGO_URL || "";
      const html = renderCancelationHTMLDetailedGreen(data, logoUrl);

      const browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
      const pagePDF = await browser.newPage();
      await pagePDF.setContent(html, { waitUntil: "networkidle0" });
      const pdfData = await pagePDF.pdf({
        format: "A4",
        landscape: false,
        printBackground: true,
        margin: { top: "12mm", bottom: "12mm", left: "10mm", right: "10mm" },
      });
      await browser.close();

      fileBuffer = Buffer.from(pdfData);
      filename = `cancelacion_detallada_${data.header.numero_credito_sifco}_${Date.now()}.pdf`;
      contentType = "application/pdf";
    }

    // 3) Upload R2
    const Bucket = process.env.BUCKET_REPORTS as string;
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
        Bucket,
        Key: filename,
        Body: fileBuffer,
        ContentType: contentType,
      })
    );

    // 4) URL pública o presignada (24h)
    let url: string;
    if (process.env.URL_PUBLIC_R2_REPORTS) {
      const base = process.env.URL_PUBLIC_R2_REPORTS.replace(/\/+$/, "");
      url = `${base}/${encodeURIComponent(filename)}`;
    } else {
      url = await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket, Key: filename }),
        { expiresIn: 60 * 60 * 24 }
      );
    }

    // 5) Respuesta final
    return {
      ok: true,
      format: outFormat,
      url,
      filename,
      size: fileBuffer.length,
    };
  })
  .get("/credit/cost-detail-report", async ({ query, set }) => {
    const { numero_sifco, pdf, excel, format } = query as Record<
      string,
      string | undefined
    >;

    if (!numero_sifco) {
      set.status = 400;
      return { message: "El parámetro 'numero_sifco' es obligatorio." };
    }

    // formato (mutuamente excluyente)
    let outFormat: "pdf" | "excel" = "pdf";
    if (format === "excel" || excel === "true") outFormat = "excel";
    if (format === "pdf" || pdf === "true") outFormat = "pdf";
    if (pdf === "true" && excel === "true") {
      set.status = 400;
      return { message: "Elige solo uno: 'pdf=true' o 'excel=true'." };
    }

    // 1) Datos
    const res = await getCreditWithCancellationDetails(numero_sifco);
    if (!res.success) {
      set.status = 404;
      return { message: "Crédito no encontrado." };
    }
    const data = res.data;

    // 2) Generar archivo (tema durazno)
    let fileBuffer: Buffer;
    let filename: string;
    let contentType: string;

    if (outFormat === "excel") {
      const logoBase64 = await fetchImageBase64(
        process.env.LOGO_URL || undefined
      );
      fileBuffer = await buildCostDetailWorkbookPeach(data, { logoBase64 });
      filename = `detalle_costos_${data.header.numero_credito_sifco}_${Date.now()}.xlsx`;
      contentType =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    } else {
      const html = renderCostDetailHTMLPeach(data, process.env.LOGO_URL || "");
      const browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle0" });
      const pdfData = await page.pdf({
        format: "A4",
        landscape: false,
        printBackground: true,
        margin: { top: "12mm", bottom: "12mm", left: "10mm", right: "10mm" },
      });
      await browser.close();

      fileBuffer = Buffer.from(pdfData);
      filename = `detalle_costos_${data.header.numero_credito_sifco}_${Date.now()}.pdf`;
      contentType = "application/pdf";
    }

    // 3) Upload a R2
    const Bucket = process.env.BUCKET_REPORTS as string;
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
        Bucket,
        Key: filename,
        Body: fileBuffer,
        ContentType: contentType,
      })
    );

    // 4) URL pública o presignada (24h)
    let url: string;
    if (process.env.URL_PUBLIC_R2_REPORTS) {
      const base = process.env.URL_PUBLIC_R2_REPORTS.replace(/\/+$/, "");
      url = `${base}/${encodeURIComponent(filename)}`;
    } else {
      url = await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket, Key: filename }),
        { expiresIn: 60 * 60 * 24 }
      );
    }

    // 5) Respuesta
    return {
      ok: true,
      format: outFormat,
      url,
      filename,
      size: fileBuffer.length,
    };
  })

/**
 * POST /api/installments/update-all
 * Actualiza las cuotas de todos los créditos o uno específico
 * Body (opcional): { numero_credito_sifco?: string }
 */
.post('/update-all', async ({ body, set }) => {
  try {
    const { numero_credito_sifco } = body;

    await updateAllInstallments({ numero_credito_sifco });

    set.status = 200;
    return {
      success: true,
      message: numero_credito_sifco 
        ? `Crédito ${numero_credito_sifco} actualizado correctamente`
        : 'Todos los créditos actualizados correctamente',
    };
  } catch (error) {
    console.error('Error en update-all:', error);
    set.status = 500;
    return {
      success: false,
      message: 'Error al actualizar las cuotas',
      error: error instanceof Error ? error.message : 'Error desconocido',
    };
  }
}, {
  body: t.Object({
    numero_credito_sifco: t.Optional(t.String())
  })
})
.post(
    "/merge",
    async ({ body, set }) => {
      try {
        console.log("📨 Solicitud de fusión recibida:");
        console.log(`   Origen: ${body.numero_credito_origen}`);
        console.log(`   Destino: ${body.numero_credito_destino}`);
        console.log("");

        // Validar que no sean el mismo crédito
        if (body.numero_credito_origen === body.numero_credito_destino) {
          set.status = 400;
          return {
            success: false,
            message: "El crédito origen y destino no pueden ser el mismo",
            error: "SAME_CREDIT"
          };
        }

        // Ejecutar la fusión
        const resultado = await mergeCreditosAndUpdate({
          numero_credito_origen: body.numero_credito_origen,
          numero_credito_destino: body.numero_credito_destino
        });

        set.status = 200;
        return resultado;

      } catch (error: any) {
        console.error("❌ Error en el endpoint de fusión:", error);

        // Manejar errores específicos
        if (error.message?.includes("no encontrado")) {
          set.status = 404;
          return {
            success: false,
            message: error.message,
            error: "CREDIT_NOT_FOUND"
          };
        }

        // Error genérico
        set.status = 500;
        return {
          success: false,
          message: "Error al fusionar créditos",
          error: error.message || "Unknown error"
        };
      }
    },
    {
      body: mergeCreditSchema,
      detail: {
        summary: "Fusionar dos créditos",
        description: `
          Fusiona dos créditos Pool en uno solo.
          
          **Proceso:**
          1. Suma los capitales de ambos créditos
          2. Recalcula intereses, IVA y deuda total
          3. Traslada inversionistas del crédito origen al destino
          4. Marca el crédito origen como CANCELADO
          5. Actualiza las cuotas del crédito destino
          
          **Nota:** El crédito DESTINO es el que quedará activo con todos los valores consolidados.
        `,
        tags: ["Créditos"]
      },
      response: {
        200: t.Object({
          success: t.Boolean(),
          message: t.String(),
          nueva_cuota: t.Number(),
          creditoFinal: t.Object({
            numero_credito: t.String(),
            credito_id: t.Number(),
            capital_total: t.String(),
            cuota: t.String(),
            deuda_total: t.String(),
            total_inversionistas: t.Number(),
            credito_cancelado: t.String()
          })
        }),
        400: t.Object({
          success: t.Boolean(),
          message: t.String(),
          error: t.String()
        }),
        404: t.Object({
          success: t.Boolean(),
          message: t.String(),
          error: t.String()
        }),
        500: t.Object({
          success: t.Boolean(),
          message: t.String(),
          error: t.String()
        })
      }
    }
  )
  .get("/ultima-cuota-pagada", async ({ query, set }) => {
  const { numero_credito_sifco } = query;
  
  if (!numero_credito_sifco) {
    set.status = 400;
    return { message: "Falta el parámetro 'numero_credito_sifco'" };
  }

  try {
    // 1️⃣ Buscar el crédito
    const creditoData = await db
      .select()
      .from(creditos)
      .where(eq(creditos.numero_credito_sifco, numero_credito_sifco))
      .limit(1);

    if (creditoData.length === 0) {
      set.status = 404;
      return { 
        message: "Crédito no encontrado",
        numero_credito_sifco 
      };
    }

    const creditoId = creditoData[0].credito_id;

    // 2️⃣ Buscar la última cuota pagada (pagado = true)
    const ultimaCuotaPagada = await db
      .select({
        cuota_id: cuotas_credito.cuota_id,
        numero_cuota: cuotas_credito.numero_cuota,
        fecha_vencimiento: cuotas_credito.fecha_vencimiento,
        pagado: cuotas_credito.pagado,  
      })
      .from(cuotas_credito)
      .where(
        and(
          eq(cuotas_credito.credito_id, creditoId),
          eq(cuotas_credito.pagado, true)
        )
      )
      .orderBy(desc(cuotas_credito.numero_cuota)) // 👈 De mayor a menor
      .limit(1);

    // 3️⃣ Si no hay cuotas pagadas
    if (ultimaCuotaPagada.length === 0) {
      return {
        numero_credito_sifco,
        credito_id: creditoId,
        ultima_cuota_pagada: null,
        mensaje: "No hay cuotas pagadas aún"
      };
    }

    // 4️⃣ Retornar la info
    return {
      numero_credito_sifco,
      credito_id: creditoId,
      ultima_cuota_pagada: ultimaCuotaPagada[0].numero_cuota,
      info_cuota: ultimaCuotaPagada[0]
    };

  } catch (error) {
    console.error("[ultima-cuota-pagada] Error:", error);
    set.status = 500;
    return { 
      message: "Error consultando crédito", 
      error: String(error) 
    };
  }
})  // 🔥 Endpoint simple: ruta quemada, solo llamar

  // ========================================
  // ENDPOINT: ESTADÍSTICAS DE CRÉDITOS
  // ========================================
  .get("/stats", async ({ query }) => {
    const { email } = query;
    const stats = await getCreditStats(email);
    return stats;
  }, {
    query: t.Object({
      email: t.Optional(t.String({ description: "Email del asesor para filtrar solo sus créditos" })),
    }),
    detail: {
      summary: "Obtener estadísticas de créditos",
      description: `
        Obtiene estadísticas agregadas de los créditos, incluyendo:
        
        **Campos generales:**
        - totalCreditos: Total de créditos activos/morosos/en convenio
        - efectividad: Porcentaje de créditos SIN cuotas atrasadas
        
        **Por cuotas atrasadas (0, 1, 2, 3, 4):**
        - Cantidad de créditos
        - Porcentaje respecto al total
        - Suma del capital
        - Suma de mora
        
        **Por estado (Cancelado, Incobrable):**
        - Cantidad de créditos
        - Porcentaje respecto al total de cancelados+incobrables
        - Suma del capital
        - Suma de mora (si aplica)
        
        **Filtro opcional:**
        Si se proporciona el email del asesor, solo se muestran los créditos asignados a ese asesor.
        Si no se proporciona, se muestran todos los créditos.
      `,
      tags: ["Créditos", "Estadísticas"],
    },
    response: {
      200: t.Object({
        totalCreditos: t.Number(),
        efectividad: t.String(),
        porCuotasAtrasadas: t.Object({
          "0": t.Object({
            cantidad: t.Number(),
            porcentaje: t.String(),
            sumaCapital: t.String(),
            sumaMora: t.String(),
          }),
          "1": t.Object({
            cantidad: t.Number(),
            porcentaje: t.String(),
            sumaCapital: t.String(),
            sumaMora: t.String(),
          }),
          "2": t.Object({
            cantidad: t.Number(),
            porcentaje: t.String(),
            sumaCapital: t.String(),
            sumaMora: t.String(),
          }),
          "3": t.Object({
            cantidad: t.Number(),
            porcentaje: t.String(),
            sumaCapital: t.String(),
            sumaMora: t.String(),
          }),
          "4": t.Object({
            cantidad: t.Number(),
            porcentaje: t.String(),
            sumaCapital: t.String(),
            sumaMora: t.String(),
          }),
        }),
        porEstado: t.Object({
          cancelado: t.Object({
            cantidad: t.Number(),
            porcentaje: t.String(),
            sumaCapital: t.String(),
            sumaMora: t.String(),
          }),
          incobrable: t.Object({
            cantidad: t.Number(),
            porcentaje: t.String(),
            sumaCapital: t.String(),
            sumaMora: t.String(),
          }),
        }),
      }),
    },
  })
  // ========================================
  // ENDPOINT: ACTUALIZAR FECHAS DE VENCIMIENTO
  // ========================================
  .post("/update-due-dates", updateDueDates, {
    body: t.Object({
      creditos: t.Array(
        t.Object({
          numero_credito_sifco: t.String({ minLength: 1 }),
          dia_pago: t.Number({ minimum: 1, maximum: 31 }),
        })
      ),
    }),
    detail: {
      summary: "Actualizar fechas de vencimiento (batch)",
      description: `
        Actualiza el día de vencimiento de las cuotas NO PAGADAS para múltiples créditos.

        **Proceso:**
        1. Recibe un array de {numero_credito_sifco, dia_pago}
        2. Por cada crédito, busca las cuotas donde pagado = false
        3. Actualiza fecha_vencimiento cambiando solo el día
        4. Si el día excede los días del mes, usa el último día del mes

        **Ejemplo de body:**
        \`\`\`json
        {
          "creditos": [
            {"numero_credito_sifco": "01010214113080", "dia_pago": 15},
            {"numero_credito_sifco": "01010214104860", "dia_pago": 30}
          ]
        }
        \`\`\`
      `,
      tags: ["Créditos", "Cuotas"],
    },
  })
  .post("/update-single-due-date", updateSingleDueDate, {
    body: t.Object({
      numero_credito_sifco: t.String({ minLength: 1 }),
      dia_pago: t.Number({ minimum: 1, maximum: 31 }),
    }),
    detail: {
      summary: "Actualizar fecha de vencimiento (individual)",
      description: "Actualiza el día de vencimiento para un solo crédito",
      tags: ["Créditos", "Cuotas"],
    },
  })
  .post("/recalculate-quota", recalculateQuota, {
    body: t.Object({
      numero_credito_sifco: t.String({ minLength: 1 }),
    }),
    detail: {
      summary: "Recalcular cuota mensual con fórmula PMT",
      description: "Recalcula la cuota mensual usando la fórmula PMT de Excel basándose en el capital actual, tasa de interés, plazo, seguro, GPS y membresías del crédito. Actualiza el crédito y todas las cuotas pendientes.",
      tags: ["Créditos", "Cuotas"],
    },
  })
  // ========================================
  // ENDPOINT: RECALCULAR PAGOS DESDE CUOTA
  // ========================================
  .post("/recalcular-pagos", async ({ body, set }: any) => {
    try {
      const { numero_credito_sifco, numero_cuota } = body;
      await recalcularPagosCredito({ numero_credito_sifco, numero_cuota });
      set.status = 200;
      return { success: true, message: `Pagos recalculados para ${numero_credito_sifco}` };
    } catch (error: any) {
      set.status = 500;
      return { success: false, error: error.message };
    }
  }, {
    body: t.Object({
      numero_credito_sifco: t.String({ minLength: 1 }),
      numero_cuota: t.Optional(t.Number()),
    }),
    detail: {
      summary: "Recalcular pagos desde una cuota",
      description: "Recalcula abonos y restantes de los pagos. Si se pasa numero_cuota, procesa desde esa cuota (pagadas y no pagadas). Si no, solo procesa las no pagadas.",
      tags: ["Créditos", "Cuotas"],
    },
  })
  // ========================================
  // ENDPOINT: REPARAR total_restante DE LOS PAGOS
  // ========================================
  .post("/reparar-total-restante", async ({ body, set }: any) => {
    try {
      const { numero_credito_sifco, capital_inicial } = body;
      const result = await repararTotalRestante({
        numero_credito_sifco,
        capital_inicial,
      });
      set.status = 200;
      return { success: true, ...result };
    } catch (error: any) {
      console.error("❌ Error en /reparar-total-restante:", error);
      set.status = 500;
      return { success: false, error: error.message };
    }
  }, {
    body: t.Object({
      numero_credito_sifco: t.String({ minLength: 1 }),
      capital_inicial: t.Optional(t.Union([t.Number(), t.String()])),
    }),
    detail: {
      summary: "Reparar total_restante de los pagos de un crédito",
      description:
        "Recalcula y reescribe SOLO el campo total_restante de los pagos desde la cuota 0 hasta la última cuota pagada, amortizando teóricamente. Si no se pasa capital_inicial, se usa el total_restante del pago de la cuota 0 (desembolso) como ancla. No toca abonos, capital_restante, pagado ni ningún otro campo.",
      tags: ["Créditos", "Cuotas"],
    },
  })
  // ========================================
  // ENDPOINT: ARREGLAR CRÉDITOS SIN FEBRERO
  // ========================================
  .post("/fix-february", async ({ query, set }) => {
    const anio = query.anio ? Number(query.anio) : 2026;
    return fixCreditosWithoutFebruary({ anio, set });
  }, {
    query: t.Object({
      anio: t.Optional(t.String()),
    }),
    detail: {
      summary: "Arreglar créditos sin cuota en febrero",
      description: "Busca créditos activos/morosos/en_convenio que no tienen cuota en febrero del año especificado y recalcula sus fechas de vencimiento basándose en la última cuota pagada.",
      tags: ["Créditos", "Cuotas"],
    },
  })
  // ========================================
  // ENDPOINT: ACTUALIZAR FECHAS DESDE JSON
  // ========================================
  .post("/update-due-dates-from-json", async ({ set }) => {
    return updateDueDatesFromJson({ set });
  }, {
    detail: {
      summary: "Actualizar fechas de vencimiento desde JSON",
      description: "Lee resultado_ultimos_pagos.json, extrae el día del campo 'pago' y actualiza fecha_vencimiento de TODAS las cuotas. También actualiza fecha_pago solo si ya tiene valor.",
      tags: ["Créditos", "Cuotas"],
    },
  })
  // ========================================
  // ENDPOINT: CUOTAS POR DÍA Y ASESOR
  // ========================================
  .get("/cuotas-por-dia", async ({ query, set }) => {
    const { dia, mes, anio, asesor_id } = query as Record<string, string>;

    if (!dia || !mes || !anio) {
      set.status = 400;
      return { message: "Faltan parámetros requeridos: 'dia', 'mes', 'anio'" };
    }

    const diaNum = Number(dia);
    const mesNum = Number(mes);
    const anioNum = Number(anio);

    if (isNaN(diaNum) || diaNum < 1 || diaNum > 31) {
      set.status = 400;
      return { message: "El parámetro 'dia' debe ser un número entre 1 y 31" };
    }
    if (isNaN(mesNum) || mesNum < 1 || mesNum > 12) {
      set.status = 400;
      return { message: "El parámetro 'mes' debe ser un número entre 1 y 12" };
    }
    if (isNaN(anioNum) || anioNum < 2000) {
      set.status = 400;
      return { message: "El parámetro 'anio' debe ser un año válido" };
    }

    const asesorIdNum = asesor_id ? Number(asesor_id) : undefined;
    if (asesor_id && isNaN(asesorIdNum!)) {
      set.status = 400;
      return { message: "El parámetro 'asesor_id' debe ser un número válido" };
    }

    try {
      const result = await getCuotasPorDiaYAsesor(diaNum, mesNum, anioNum, asesorIdNum);
      if (!result.ok) set.status = 500;
      return result;
    } catch (error) {
      set.status = 500;
      return { message: "Error obteniendo cuotas por día", error: String(error) };
    }
  })
  // ========================================
  // ENDPOINT: UPSERT EFECTIVIDAD ASESORES
  // ========================================
  .get("/efectividad-asesores", async ({ query, set }) => {
    const { dia, mes, anio } = query as Record<string, string>;

    if (!dia || !mes || !anio) {
      set.status = 400;
      return { message: "Faltan parámetros requeridos: 'dia', 'mes', 'anio'" };
    }

    const diaNum = Number(dia);
    const mesNum = Number(mes);
    const anioNum = Number(anio);

    if (isNaN(diaNum) || diaNum < 1 || diaNum > 31) {
      set.status = 400;
      return { message: "El parámetro 'dia' debe ser un número entre 1 y 31" };
    }
    if (isNaN(mesNum) || mesNum < 1 || mesNum > 12) {
      set.status = 400;
      return { message: "El parámetro 'mes' debe ser un número entre 1 y 12" };
    }
    if (isNaN(anioNum) || anioNum < 2000) {
      set.status = 400;
      return { message: "El parámetro 'anio' debe ser un año válido" };
    }

    try {
      const result = await upsertEfectividadAsesores(diaNum, mesNum, anioNum);
      if (!result.ok) set.status = 500;
      return result;
    } catch (error) {
      set.status = 500;
      return { message: "Error actualizando efectividad", error: String(error) };
    }
  })
  // ========================================
  // ENDPOINT: CONSULTAR EFECTIVIDAD ASESORES
  // ========================================
  .get("/efectividad-asesores/consulta", async ({ query, set }) => {
    const { dia, mes, anio, asesor_id } = query as Record<string, string>;

    if (!mes || !anio) {
      set.status = 400;
      return { message: "Faltan parámetros requeridos: 'mes', 'anio'" };
    }

    const mesNum = Number(mes);
    const anioNum = Number(anio);
    const diaNum = dia ? Number(dia) : undefined;

    if (dia && (isNaN(diaNum!) || diaNum! < 1 || diaNum! > 31)) {
      set.status = 400;
      return { message: "El parámetro 'dia' debe ser un número entre 1 y 31" };
    }
    if (isNaN(mesNum) || mesNum < 1 || mesNum > 12) {
      set.status = 400;
      return { message: "El parámetro 'mes' debe ser un número entre 1 y 12" };
    }
    if (isNaN(anioNum) || anioNum < 2000) {
      set.status = 400;
      return { message: "El parámetro 'anio' debe ser un año válido" };
    }

    const asesorIdNum = asesor_id ? Number(asesor_id) : undefined;
    if (asesor_id && isNaN(asesorIdNum!)) {
      set.status = 400;
      return { message: "El parámetro 'asesor_id' debe ser un número válido" };
    }

    try {
      const result = await getEfectividadAsesores(mesNum, anioNum, asesorIdNum, diaNum);
      if (!result.ok) set.status = 500;
      return result;
    } catch (error) {
      set.status = 500;
      return { message: "Error consultando efectividad", error: String(error) };
    }
  })
  .post(
    "/actualizar-nit",
    async ({ body, set }) => {
      try {
        const result = await actualizarNitCredito(body);
        if (!result.success) set.status = 404;
        return result;
      } catch (error) {
        set.status = 500;
        return { success: false, message: "Error actualizando NIT", error: String(error) };
      }
    },
    {
      body: t.Object({
        numero_credito_sifco: t.String(),
        nit: t.String(),
      }),
      detail: {
        tags: ["Créditos"],
        summary: "Actualizar NIT del usuario de un crédito",
      },
    }
  )
  // ========================================
  // ENDPOINT: CAMBIAR FECHA DE INICIO
  // ========================================
  .post(
    "/cambiar-fecha-inicio",
    async ({ body, set }) => {
      return cambiarFechaInicio({ body, set });
    },
    {
      body: t.Object({
        numero_credito_sifco: t.String(),
        nueva_fecha_inicio: t.String(),
        changed_by: t.String(),
        razon: t.String(),
      }),
      detail: {
        tags: ["Créditos"],
        summary: "Cambiar fecha de inicio de un crédito",
        description:
          "Cambia la fecha de inicio (cuota 0) y recalcula fecha_vencimiento de todas las cuotas. No modifica montos ni abonos. Guarda historial del cambio.",
      },
    }
  )
  // ========================================
  // ENDPOINT: HISTORIAL CAMBIO FECHA
  // ========================================
  .get(
    "/historial-cambio-fecha/:numero_credito_sifco",
    async ({ params, set }) => {
      return getHistorialCambioFecha({
        numero_credito_sifco: params.numero_credito_sifco,
        set,
      });
    },
    {
      detail: {
        tags: ["Créditos"],
        summary: "Obtener historial de cambios de fecha de inicio",
      },
    }
  )