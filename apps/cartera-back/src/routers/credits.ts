// routes/inversionistas.ts
import { Elysia } from 'elysia';
import { actualizarEstadoCredito, cancelCredit, getCreditoByNumero,  getCreditosIncobrables,  getCreditosWithUserByMesAnio, insertCredit, resetCredit, updateCredit } from '../controllers/credits';
import { z } from 'zod';
import { getCreditWithCancellationDetails } from '../controllers/cancelCredit';
import puppeteer from 'puppeteer';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { renderCancelationHTML } from '../utils/functions/generalFunctions';
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
const MontoAdicionalSchema = z.object({
  concepto: z.string().min(1, "concepto requerido"),
  monto: z.number({ invalid_type_error: "monto debe ser numérico" }),
 
});

const RouterBodySchema = z.object({
  creditId: z.coerce.number().int().positive(),
  motivo: z.string().optional(),
  observaciones: z.string().optional(),
  monto_cancelacion: z.number().optional(),
  accion: z.enum(["CANCELAR", "ACTIVAR", "INCOBRABLE", "PENDIENTE_CANCELACION"]),
  montosAdicionales: z.array(MontoAdicionalSchema).optional(),
});
export const creditRouter = new Elysia()

  // Crear nuevo crédito
  .post('/newCredit', insertCredit)
   .put('/updateCredit', updateCredit)
  // Obtener crédito por query param ?numero_credito_sifco=XXXX
  .get('/credito', async ({ query, set }) => {
    const { numero_credito_sifco } = query;
    if (!numero_credito_sifco) {
      set.status = 400;
      return { message: "Falta el parámetro 'numero_credito_sifco'" };
    }
    const result = await getCreditoByNumero(numero_credito_sifco);
    if (typeof result === 'object' && result !== null && 'message' in result && result.message === "Crédito no encontrado") set.status = 404;
    if (typeof result === 'object' && result !== null && 'error' in result && result.error) set.status = 500;
    return result;
  })  .get('/getAllCredits', async ({ query, set }) => {
  // Extraer query params
  const {
    mes,
    anio,
    page = 1,
    perPage = 10,
    numero_credito_sifco,
    estado // 👈 obligatorio
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
  const numeroCreditoSifco = numero_credito_sifco ? String(numero_credito_sifco) : undefined;
  const estadoParam = String(estado) as "ACTIVO" | "CANCELADO" | "INCOBRABLE" | "PENDIENTE_CANCELACION";

  if (
    isNaN(mesNum) || mesNum < 0 || mesNum > 12 ||
    isNaN(anioNum) || anioNum < 0
  ) {
    set.status = 400;
    return { message: "Parámetros 'mes' y/o 'anio' inválidos." };
  }

  // Llamar servicio
  try {
    const result = await getCreditosWithUserByMesAnio(
      mesNum,
      anioNum,
      pageNum,
      perPageNum,
      numeroCreditoSifco,
      estadoParam // 👈 pásalo aquí (obligatorio)
    );
    set.status = 200;
    return result;
  } catch (error) {
    set.status = 500;
    return { message: "Error obteniendo créditos", error: String(error) };
  }
})

  .post('/cancelCredit', async ({ body, set }) => {
  // Validar que venga el creditId en el body
  const { creditId } = body as { creditId?: number };
  if (!creditId || isNaN(Number(creditId))) {
    set.status = 400;
    return { message: "Falta o es inválido el parámetro 'creditId'" };
  }
  try {
    const result = await cancelCredit(Number(creditId));
    // Si el resultado tiene error, devolver status adecuado
    if ('error' in result && result.error) {
      set.status = 500;
      return result;
    }
    if ('message' in result && result.message === "Crédito no encontrado.") {
      set.status = 404;
    }
    return result;
  } catch (error) {
    set.status = 500;
    return { message: "Error cancelando crédito", error: String(error) };
  }
}).
post("/creditAction", async ({ body, set }) => {
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
  } = parse.data;

  // 2) Reglas de negocio: acciones que requieren motivo + monto
  const requiereMotivoYMonto =
    accion === "CANCELAR" ||
    accion === "PENDIENTE_CANCELACION" ||
    accion === "INCOBRABLE";

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
  .get('/incobrables', async ({ query, set }) => {
    const {
      page = "1",
      perPage = "20",
      numero_credito_sifco
    } = query as Record<string, string>;

    const pageNum = Number(page);
    const perPageNum = Number(perPage);

    if (isNaN(pageNum) || pageNum < 1 || isNaN(perPageNum) || perPageNum < 1) {
      set.status = 400;
      return { message: "Parámetros 'page' y/o 'perPage' inválidos." };
    }

    try {
      // Importa el controlador donde corresponda
      const result = await getCreditosIncobrables(pageNum, perPageNum, numero_credito_sifco);
      set.status = result.ok ? 200 : 500;
      return result;
    } catch (error) {
      set.status = 500;
      return { message: "Error obteniendo créditos incobrables", error: String(error) };
    }
  })
.post('/resetCredit', async ({ body, set }) => {
  // Valida los parámetros
  const { creditId, montoIncobrable, montoBoleta, url_boletas, cuota } = body as {
    creditId?: number;
    montoIncobrable?: number;
    montoBoleta?: number | string;
    url_boletas?: string[];
    cuota?: number;
  };

  // Validaciones mínimas
  if (
    !creditId || isNaN(Number(creditId)) ||
    montoBoleta === undefined || isNaN(Number(montoBoleta)) ||
    !Array.isArray(url_boletas) ||
    cuota === undefined || isNaN(Number(cuota))
  ) {
    set.status = 400;
    return { message: "Faltan o son inválidos los parámetros requeridos." };
  }

  try {
    const result = await resetCredit({
      creditId: Number(creditId),
      montoIncobrable: montoIncobrable !== undefined ? Number(montoIncobrable) : undefined,
      montoBoleta: montoBoleta,
      url_boletas: url_boletas,
      cuota: Number(cuota),
    });
    set.status = 200;
    return result;
  } catch (error) {
    set.status = 500;
    return { message: "Error reiniciando el crédito", error: String(error) };
  }
})
.get("/credit/cancelation-report", async ({ query, set }) => {
  const { numero_sifco } = query as Record<string, string | undefined>;

  if (!numero_sifco) {
    set.status = 400;
    return { message: "El parámetro 'numero_sifco' es obligatorio." };
  }

  // 1) Datos
  const res = await getCreditWithCancellationDetails(numero_sifco);
  if (!res.success) {
    set.status = 404;
    return { message: "Crédito no encontrado." };
  }
  const data = res.data;

  // 2) HTML
  const logoUrl = process.env.LOGO_URL || "";
  const html = renderCancelationHTML(data, logoUrl);

  // 3) PDF (Puppeteer)
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const pagePDF = await browser.newPage();
  await pagePDF.setContent(html, { waitUntil: "networkidle0" });

  // A4 apaisado o tamaño personalizado; ajusta si quieres calcar el Excel
  const pdfBuffer = await pagePDF.pdf({
    format: "A4",
    landscape: false,
    printBackground: true,
    margin: { top: "12mm", bottom: "12mm", left: "10mm", right: "10mm" },
  });

  await browser.close();

  // 4) Upload a S3/R2
  const filename = `cancelacion_${data.header.numero_credito_sifco}_${Date.now()}.pdf`;

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
      Body: pdfBuffer,
      ContentType: "application/pdf",
    })
  );

  // 5) URL pública o pre-signed
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
      { expiresIn: 60 * 60 * 24 } // 24h
    );
  }

  return {
    ok: true,
    url,
    filename,
    size: pdfBuffer.length,
  };
});

 