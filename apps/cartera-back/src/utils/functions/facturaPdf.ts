// ============================================================================
// PDF DE FACTURAS: generación FUERA del request
// ----------------------------------------------------------------------------
// Contexto (incidente 2026-08-07, factura 99606D3F duplicada):
// certificarFacturaHelper generaba el PDF con Puppeteer y lo subía a R2 DENTRO
// del request. El HTML trae el logo por URL remota y `waitUntil: "networkidle0"`
// no llevaba timeout, así que un R2 lento colgaba el handler ~34s. El CRM
// abortaba a los 30s y reintentaba el POST → SAT certificó la MISMA factura dos
// veces (la primera ya estaba emitida y guardada; el cliente nunca vio la
// respuesta).
//
// Este módulo saca ese trabajo del camino crítico:
//   1. El request responde apenas la factura está certificada y guardada; el
//      pdf_url es determinístico, así que la URL ya es correcta aunque el
//      archivo aparezca unos segundos después (mismo criterio que ya
//      documentaba el paso 6 de certificarFacturaHelper).
//   2. El logo se cachea como data URI: el HTML deja de depender de la red y
//      `setContent` no espera descargas.
//   3. Todo lleva timeout explícito, para que un cuelgue no deje un Chromium
//      vivo para siempre.
// ============================================================================

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { generarHTMLFacturaPro } from "../../cofidi/functions";
import { launchBrowser } from "./browser";

/** Timeout para bajar el logo la primera vez (después queda en memoria). */
const LOGO_FETCH_TIMEOUT_MS = 5000;

/** Timeout de `setContent`. Con el logo embebido no debería tardar nada. */
const SET_CONTENT_TIMEOUT_MS = 15000;

/** Timeout del render del PDF. */
const PDF_TIMEOUT_MS = 30000;

type DatosFactura = Parameters<typeof generarHTMLFacturaPro>[0];

/**
 * Cache en memoria del logo como data URI. Se guarda la PROMESA para que varias
 * facturas en paralelo compartan una sola descarga. Si la descarga falla se
 * limpia el cache y se devuelve la URL remota (el PDF sale igual, solo que el
 * render tendrá que ir a buscarla).
 */
let logoDataUriPromise: Promise<string> | null = null;

async function descargarLogoComoDataUri(logoUrl: string): Promise<string> {
  const res = await fetch(logoUrl, {
    signal: AbortSignal.timeout(LOGO_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") || "image/png";
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

export function getLogoParaPDF(logoUrl: string): Promise<string> {
  if (!logoDataUriPromise) {
    logoDataUriPromise = descargarLogoComoDataUri(logoUrl).catch((error) => {
      console.error(
        `⚠️ [facturaPdf] No se pudo embeber el logo (${logoUrl}), se usa la URL remota:`,
        (error as Error).message
      );
      logoDataUriPromise = null; // que el siguiente PDF lo reintente
      return logoUrl;
    });
  }
  return logoDataUriPromise;
}

async function generarYSubirPDF({
  datos,
  logoUrl,
  filename,
}: {
  datos: DatosFactura;
  logoUrl: string;
  filename: string;
}): Promise<void> {
  const html = generarHTMLFacturaPro(datos, await getLogoParaPDF(logoUrl));

  const browser = await launchBrowser();
  let pdfBuffer: Buffer;
  try {
    const page = await browser.newPage();
    await page.setContent(html, {
      waitUntil: "load",
      timeout: SET_CONTENT_TIMEOUT_MS,
    });
    pdfBuffer = Buffer.from(
      await page.pdf({
        format: "A4",
        printBackground: true,
        timeout: PDF_TIMEOUT_MS,
        margin: { top: "20px", bottom: "20px", left: "20px", right: "20px" },
      })
    );
  } finally {
    await browser.close();
  }

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
}

// ============================================================================
// LÍMITE DE CONCURRENCIA
// ----------------------------------------------------------------------------
// Antes de sacar el PDF del request, el trabajo pesado quedaba serializado sin
// querer: el CRM factura en un bucle secuencial y cada llamada esperaba a que
// el PDF terminara. Al pasar a fire-and-forget eso se pierde — un cierre puede
// disparar hasta 8 facturas casi a la vez, y varios cierres en paralelo lo
// multiplican. Sin freno serían N Chromium simultáneos en el contenedor.
//
// Este semáforo mantiene el trabajo acotado: los PDFs siguen saliendo del
// camino crítico (que es el punto), pero de a pocos.
// ============================================================================

const MAX_PDFS_EN_PARALELO = Number.parseInt(
  process.env.PDF_FACTURA_CONCURRENCIA || "2",
  10
);

let enCurso = 0;
const enEspera: Array<() => void> = [];

function adquirirTurno(): Promise<void> {
  if (enCurso < MAX_PDFS_EN_PARALELO) {
    enCurso++;
    return Promise.resolve();
  }
  return new Promise((resolve) => enEspera.push(resolve));
}

function liberarTurno(): void {
  // El turno se cede directo al siguiente en la cola (sin bajar el contador),
  // para que nunca se cuelen más de MAX_PDFS_EN_PARALELO.
  const siguiente = enEspera.shift();
  if (siguiente) siguiente();
  else enCurso--;
}

/**
 * Encola la generación del PDF SIN bloquear al caller (fire-and-forget).
 *
 * La factura ya está certificada en SAT y guardada en BD antes de llamar acá:
 * si el PDF falla NO se pierde el registro y se puede regenerar después con el
 * mismo filename determinístico (script backfill-facturas-faltantes).
 *
 * @param referencia texto para los logs (serie-numero / uuid / id en BD)
 */
export function generarPDFFacturaEnBackground(params: {
  datos: DatosFactura;
  logoUrl: string;
  filename: string;
  referencia: string;
}): void {
  const { referencia, ...resto } = params;
  const encolado = Date.now();

  if (enCurso >= MAX_PDFS_EN_PARALELO) {
    console.log(
      `   ⏳ PDF de ${referencia} en cola (${enCurso} generándose, ${enEspera.length + 1} esperando)`
    );
  }

  void (async () => {
    await adquirirTurno();
    const inicio = Date.now();
    try {
      await generarYSubirPDF(resto);
      console.log(
        `   ✅ PDF subido a R2: ${resto.filename} (${Date.now() - inicio}ms de render, ${Date.now() - encolado}ms desde que se encoló) [${referencia}]`
      );
    } catch (pdfError) {
      console.error(
        `⚠️ [facturaPdf] Factura ${referencia} GUARDADA en BD pero FALLÓ el PDF/R2. ` +
          `Se puede regenerar luego (mismo filename → misma URL):`,
        pdfError
      );
    } finally {
      liberarTurno();
    }
  })();
}
