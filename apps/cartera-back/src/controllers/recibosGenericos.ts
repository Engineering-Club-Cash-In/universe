import { eq, and, gte, lte, desc } from "drizzle-orm";
import { db } from "../database";
import {
  recibos_genericos,
  recibo_generico_montos,
} from "../database/db";
import puppeteer from "puppeteer";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const LOGO_URL = process.env.LOGO_URL || "https://pub-8081c8d6e5e743f9adfc9e0db92e5a88.r2.dev/reports/logo-cashin.png";

// ── CREATE ──
export async function createReciboGenerico(data: {
  nombre: string;
  observaciones?: string;
  fecha?: string;
  moneda?: string;
  montos: { concepto: string; monto: string }[];
}) {
  const [recibo] = await db
    .insert(recibos_genericos)
    .values({
      nombre: data.nombre,
      observaciones: data.observaciones,
      ...(data.fecha ? { fecha: new Date(data.fecha) } : {}),
      ...(data.moneda ? { moneda: data.moneda } : {}),
    })
    .returning();

  if (data.montos.length > 0) {
    await db.insert(recibo_generico_montos).values(
      data.montos.map((m) => ({
        recibo_id: recibo.id,
        concepto: m.concepto,
        monto: m.monto,
      }))
    );
  }

  const montos = await db
    .select()
    .from(recibo_generico_montos)
    .where(eq(recibo_generico_montos.recibo_id, recibo.id));

  return { ...recibo, montos };
}

// ── GET ALL (filtro por fecha) ──
export async function getRecibosGenericos(filters?: {
  fecha_desde?: string;
  fecha_hasta?: string;
}) {
  const conditions = [];

  if (filters?.fecha_desde) {
    conditions.push(gte(recibos_genericos.fecha, new Date(filters.fecha_desde)));
  }
  if (filters?.fecha_hasta) {
    conditions.push(lte(recibos_genericos.fecha, new Date(filters.fecha_hasta)));
  }

  const recibos = await db
    .select()
    .from(recibos_genericos)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(recibos_genericos.fecha));

  const result = await Promise.all(
    recibos.map(async (r) => {
      const montos = await db
        .select()
        .from(recibo_generico_montos)
        .where(eq(recibo_generico_montos.recibo_id, r.id));
      return { ...r, montos };
    })
  );

  return result;
}

// ── GET BY ID ──
export async function getReciboGenericoById(id: number) {
  const [recibo] = await db
    .select()
    .from(recibos_genericos)
    .where(eq(recibos_genericos.id, id));

  if (!recibo) return null;

  const montos = await db
    .select()
    .from(recibo_generico_montos)
    .where(eq(recibo_generico_montos.recibo_id, id));

  return { ...recibo, montos };
}

// ── UPDATE ──
export async function updateReciboGenerico(
  id: number,
  data: {
    nombre?: string;
    observaciones?: string;
    moneda?: string;
    montos?: { concepto: string; monto: string }[];
  }
) {
  const updateFields: Record<string, any> = {};
  if (data.nombre !== undefined) updateFields.nombre = data.nombre;
  if (data.observaciones !== undefined) updateFields.observaciones = data.observaciones;
  if (data.moneda !== undefined) updateFields.moneda = data.moneda;

  if (Object.keys(updateFields).length > 0) {
    await db
      .update(recibos_genericos)
      .set(updateFields)
      .where(eq(recibos_genericos.id, id));
  }

  if (data.montos !== undefined) {
    await db
      .delete(recibo_generico_montos)
      .where(eq(recibo_generico_montos.recibo_id, id));

    if (data.montos.length > 0) {
      await db.insert(recibo_generico_montos).values(
        data.montos.map((m) => ({
          recibo_id: id,
          concepto: m.concepto,
          monto: m.monto,
        }))
      );
    }
  }

  return getReciboGenericoById(id);
}

// ── DELETE ──
export async function deleteReciboGenerico(id: number) {
  const [deleted] = await db
    .delete(recibos_genericos)
    .where(eq(recibos_genericos.id, id))
    .returning();

  return deleted ?? null;
}

// ── GENERAR PDF Y SUBIR A R2 ──
export async function generateReciboGenericoPDF(reciboId: number) {
  const recibo = await getReciboGenericoById(reciboId);
  if (!recibo) {
    throw new Error(`No se encontró el recibo con ID ${reciboId}`);
  }

  const simbolo = recibo.moneda === "USD" ? "$" : "Q";
  const formatQ = (n: number) =>
    `${simbolo}${n.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const fechaRecibo = recibo.fecha
    ? new Date(recibo.fecha).toLocaleDateString("es-GT", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "N/A";

  const totalMonto = recibo.montos.reduce(
    (sum, m) => sum + Number(m.monto || 0),
    0
  );

  const desgloseRows = recibo.montos
    .map((m) => `<tr><td>${m.concepto}</td><td>${formatQ(Number(m.monto))}</td></tr>`)
    .join("");

  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: 'Segoe UI', Arial, sans-serif; background: #f5f5f5; padding: 40px; }
      .recibo {
        max-width: 500px;
        margin: 0 auto;
        background: #fff;
        border-radius: 12px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.08);
        overflow: hidden;
      }
      .header {
        background: linear-gradient(135deg, #1F4E79, #2E75B6);
        color: #fff;
        padding: 30px 30px 25px;
        text-align: center;
      }
      .header img { width: 120px; margin-bottom: 12px; }
      .header h1 { font-size: 20px; font-weight: 600; margin-bottom: 4px; }
      .header p { font-size: 12px; opacity: 0.85; }
      .badge {
        display: inline-block;
        background: rgba(255,255,255,0.2);
        padding: 4px 14px;
        border-radius: 20px;
        font-size: 11px;
        margin-top: 10px;
        letter-spacing: 0.5px;
      }
      .body { padding: 25px 30px; }
      .info-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
        margin-bottom: 20px;
      }
      .info-item {
        background: #f8fafc;
        border-radius: 8px;
        padding: 10px 12px;
      }
      .info-item.full { grid-column: 1 / -1; }
      .info-label {
        font-size: 10px;
        color: #8899a6;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 2px;
      }
      .info-value {
        font-size: 13px;
        color: #1a1a2e;
        font-weight: 500;
      }
      .divider {
        border: none;
        border-top: 1px dashed #e0e0e0;
        margin: 20px 0;
      }
      .desglose h3 {
        font-size: 13px;
        color: #1F4E79;
        margin-bottom: 10px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .desglose table { width: 100%; border-collapse: collapse; }
      .desglose td {
        padding: 8px 0;
        font-size: 13px;
        color: #333;
      }
      .desglose td:last-child { text-align: right; font-weight: 500; }
      .desglose tr:not(:last-child) td { border-bottom: 1px solid #f0f0f0; }
      .total-row {
        background: linear-gradient(135deg, #1F4E79, #2E75B6);
        border-radius: 8px;
        padding: 14px 16px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 16px;
      }
      .total-row span:first-child {
        color: rgba(255,255,255,0.85);
        font-size: 13px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .total-row span:last-child {
        color: #fff;
        font-size: 20px;
        font-weight: 700;
      }
      .footer {
        background: #f8fafc;
        padding: 16px 30px;
        text-align: center;
        border-top: 1px solid #eee;
      }
      .footer p { font-size: 10px; color: #999; }
      ${recibo.observaciones ? `.obs { background: #fffbeb; border-left: 3px solid #f59e0b; padding: 10px 12px; border-radius: 0 6px 6px 0; margin-top: 16px; font-size: 12px; color: #92400e; }` : ""}
    </style>
  </head>
  <body>
    <div class="recibo">
      <div class="header">
        <img src="${LOGO_URL}" alt="Cash-In" />
        <h1>Recibo</h1>
        <p>Club Cash-In</p>
        <div class="badge">No. ${recibo.id}</div>
      </div>
      <div class="body">
        <div class="info-grid">
          <div class="info-item full">
            <div class="info-label">Nombre</div>
            <div class="info-value">${recibo.nombre}</div>
          </div>
          <div class="info-item full">
            <div class="info-label">Fecha</div>
            <div class="info-value">${fechaRecibo}</div>
          </div>
        </div>

        <hr class="divider" />

        <div class="desglose">
          <h3>Detalle</h3>
          <table>
            ${desgloseRows}
          </table>
        </div>

        <div class="total-row">
          <span>Total</span>
          <span>${formatQ(totalMonto)}</span>
        </div>

        ${recibo.observaciones ? `<div class="obs">${recibo.observaciones}</div>` : ""}
      </div>
      <div class="footer">
        <p>Este documento es un recibo generado por el sistema de Club Cash-In.</p>
        <p>Generado el ${new Date().toLocaleDateString("es-GT", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
      </div>
    </div>
  </body>
  </html>`;

  // Generar PDF con Puppeteer
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });
  const pdfData = await page.pdf({
    format: "A4",
    printBackground: true,
    margin: { top: "10mm", bottom: "10mm", left: "10mm", right: "10mm" },
  });
  await browser.close();

  // Subir a R2
  const fileBuffer = Buffer.from(pdfData);
  const filename = `recibos/recibo_generico_${reciboId}_${Date.now()}.pdf`;
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
      ContentType: "application/pdf",
    })
  );

  const url = `${process.env.URL_PUBLIC_R2_REPORTS}/${filename}`;
  console.log("✅ Recibo genérico PDF subido:", url);

  return { pdfUrl: url };
}
