import Big from "big.js";
import { randomBytes, randomUUID } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { db } from "../database";
import {
  creditos,
  estados_cuenta_cancelacion,
  estados_cuenta_cancelacion_enlaces,
  estados_cuenta_cancelacion_envios,
  moras_credito,
  usuarios,
} from "../database/db/schema";
import { enviarWhatsappPorCrm, obtenerContactosDelCrm } from "../services/crmEstadoCuenta.service";
import { getAllPagosWithCreditAndInversionistas } from "./payments";
import {
  applyEstadoCuentaRunningCapital,
  buildEstadoCuentaTableHeader,
  renderEstadoCuentaPaymentRow,
  shouldIncludeEstadoCuentaPayment,
  sortEstadoCuentaPayments,
} from "./reports";
import { launchBrowser } from "../utils/functions/browser";
import type { HistorialPagosRenderizado } from "./estadoCuentaCancelacionHtml";
import type {
  DocumentoEstadoCuenta,
  EnlaceEstadoCuenta,
  EnvioEstadoCuenta,
  EstadoCuentaCancelacionDeps,
  EstadoEnvio,
  FuenteTelefono,
} from "./estadoCuentaCancelacionService";
import type {
  DesgloseEstadoCuentaCancelacion,
  EntradaEstadoCuentaCancelacion,
} from "./estadoCuentaCancelacionCalculo";

// ================================================================
// Implementación real de las dependencias del estado de cuenta de
// cancelación: Postgres (drizzle), R2, Puppeteer y el CRM (teléfonos y
// WhatsApp).
//
// El PDF va al mismo bucket de reportes (BUCKET_REPORTS) pero con una clave
// UUID y SOLO se sirve por nuestra API: el endpoint autenticado o el enlace
// `/ec/<código>` que vence. Nunca se arma ni se devuelve la URL pública
// (URL_PUBLIC_R2_REPORTS) de estos archivos.
//
// El historial reutiliza, sin modificarlos, los helpers del estado de cuenta
// existente (`exportPagosToExcel`): mismo filtro, orden y saldo corrido.
// ================================================================

const LOGO_URL_DEFAULT =
  "https://pub-8081c8d6e5e743f9adfc9e0db92e5a88.r2.dev/reports/logo-cashin.png";

let s3: S3Client | null = null;
const r2 = () =>
  (s3 ??= new S3Client({
    endpoint: process.env.BUCKET_REPORTS_URL,
    region: "auto",
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
    },
  }));
const bucket = () => process.env.BUCKET_REPORTS as string;

const sumar = (filas: any[], campos: string[]) =>
  filas
    .reduce(
      (acc, fila) => campos.reduce((a, c) => a.plus(new Big(String(fila[c] ?? 0) || "0")), acc),
      new Big(0)
    )
    .toFixed(2);

async function cargarHistorial(
  numeroCreditoSifco: string,
  capitalActual: string | null
): Promise<HistorialPagosRenderizado> {
  // Puede devolver cero filas (crédito sin pagos): el documento lo soporta.
  const pagosData = await getAllPagosWithCreditAndInversionistas(numeroCreditoSifco);
  const elegibles = pagosData
    .filter(({ pago }) => shouldIncludeEstadoCuentaPayment(pago))
    .map(({ pago }) => pago);
  const ordenados = applyEstadoCuentaRunningCapital(sortEstadoCuentaPayments(elegibles), capitalActual);

  return {
    encabezadoHtml: buildEstadoCuentaTableHeader(),
    filasHtml: ordenados.map((pago, i) => renderEstadoCuentaPaymentRow(pago, i)),
    totales: {
      capital: sumar(ordenados, ["abono_capital"]),
      interes: sumar(ordenados, ["abono_interes"]),
      iva: sumar(ordenados, ["abono_iva_12"]),
      servicios: sumar(ordenados, ["abono_seguro", "abono_gps", "membresias_pago"]),
      mora: sumar(ordenados, ["mora"]),
      montoAplicado: sumar(ordenados, ["monto_aplicado"]),
    },
  };
}

async function generarPdf(html: string): Promise<Buffer> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      format: "A4",
      landscape: true,
      printBackground: true,
      margin: { top: "10mm", bottom: "10mm", left: "8mm", right: "8mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

type FilaDocumento = typeof estados_cuenta_cancelacion.$inferSelect;
type FilaEnvio = typeof estados_cuenta_cancelacion_envios.$inferSelect;

const aDocumento = (f: FilaDocumento): DocumentoEstadoCuenta => ({
  id: f.id,
  creditoId: f.credito_id,
  numeroCreditoSifco: f.numero_credito_sifco,
  clienteNombre: f.cliente_nombre,
  fechaCorteGT: String(f.fecha_corte_gt),
  generadoAt: new Date(f.generado_at),
  generadoPorId: f.generado_por_id,
  montoCancelacion: String(f.monto_cancelacion),
  entrada: f.entrada_json as EntradaEstadoCuentaCancelacion,
  desglose: f.desglose_json as DesgloseEstadoCuentaCancelacion,
  pdfKey: f.pdf_key,
  pdfSha256: f.pdf_sha256,
});

type FilaEnlace = typeof estados_cuenta_cancelacion_enlaces.$inferSelect;

const aEnlace = (f: FilaEnlace): EnlaceEstadoCuenta => ({
  id: f.id,
  documentoId: f.documento_id,
  codigoSha256: f.codigo_sha256,
  creadoPorId: f.creado_por_id,
  creadoAt: new Date(f.creado_at),
  venceAt: new Date(f.vence_at),
  revocadoAt: f.revocado_at ? new Date(f.revocado_at) : null,
  aperturas: f.aperturas,
});

const VIGENCIA_ENLACE_DIAS_DEFAULT = 3;

const aEnvio = (f: FilaEnvio): EnvioEstadoCuenta => ({
  id: f.id,
  documentoId: f.documento_id,
  enlaceId: f.enlace_id,
  canal: "WHATSAPP",
  destinatarioTelefono: f.destinatario_telefono,
  destinatarioFuente: f.destinatario_fuente as FuenteTelefono,
  solicitadoPorId: f.solicitado_por_id,
  estado: f.estado as EstadoEnvio,
  proveedor: f.proveedor,
  proveedorMensajeId: f.proveedor_mensaje_id,
  errorResumen: f.error_resumen,
  solicitadoAt: f.solicitado_at ? new Date(f.solicitado_at) : null,
  finalizadoAt: f.finalizado_at ? new Date(f.finalizado_at) : null,
});

export const estadoCuentaCancelacionDeps: EstadoCuentaCancelacionDeps = {
  async cargarCredito(creditoId) {
    // Crédito y cliente aparte de los pagos: la consulta de pagos puede venir vacía.
    const [r] = await db
      .select({
        creditoId: creditos.credito_id,
        numeroCreditoSifco: creditos.numero_credito_sifco,
        statusCredit: creditos.statusCredit,
        capital: creditos.capital,
        interes: creditos.cuota_interes,
        iva: creditos.iva_12,
        membresias: creditos.membresias,
        seguro: creditos.seguro_10_cuotas,
        gps: creditos.gps,
        clienteNombre: usuarios.nombre,
      })
      .from(creditos)
      .leftJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
      .where(eq(creditos.credito_id, creditoId))
      .limit(1);
    if (!r) return null;

    // Misma lectura de mora que `cancelCredit`: la activa del crédito.
    const [mora] = await db
      .select({ monto: moras_credito.monto_mora })
      .from(moras_credito)
      .where(and(eq(moras_credito.credito_id, creditoId), eq(moras_credito.activa, true)));

    return {
      creditoId: r.creditoId,
      numeroCreditoSifco: r.numeroCreditoSifco,
      clienteNombre: r.clienteNombre ?? "—",
      statusCredit: String(r.statusCredit),
      montos: {
        capital: r.capital,
        interes: r.interes,
        iva: r.iva,
        membresias: r.membresias,
        seguro: r.seguro,
        gps: r.gps,
        mora: mora?.monto ?? null,
      },
    };
  },

  cargarHistorial,
  generarPdf,

  async subirPdf(key, bytes) {
    await r2().send(
      new PutObjectCommand({ Bucket: bucket(), Key: key, Body: bytes, ContentType: "application/pdf" })
    );
  },

  async borrarPdf(key) {
    await r2().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
  },

  async descargarPdf(key) {
    const obj = await r2().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
    if (!obj.Body) throw new Error(`Objeto vacío en R2: ${key}`);
    return Buffer.from(await obj.Body.transformToByteArray());
  },

  async insertarDocumento(doc) {
    await db.insert(estados_cuenta_cancelacion).values({
      id: doc.id,
      credito_id: doc.creditoId,
      numero_credito_sifco: doc.numeroCreditoSifco,
      cliente_nombre: doc.clienteNombre,
      fecha_corte_gt: doc.fechaCorteGT,
      generado_at: doc.generadoAt,
      generado_por_id: doc.generadoPorId,
      monto_cancelacion: doc.montoCancelacion,
      entrada_json: doc.entrada,
      desglose_json: doc.desglose,
      pdf_key: doc.pdfKey,
      pdf_sha256: doc.pdfSha256,
    });
  },

  async buscarDocumento(documentoId, creditoId) {
    const [f] = await db
      .select()
      .from(estados_cuenta_cancelacion)
      .where(
        and(
          eq(estados_cuenta_cancelacion.id, documentoId),
          eq(estados_cuenta_cancelacion.credito_id, creditoId)
        )
      )
      .limit(1);
    return f ? aDocumento(f) : null;
  },

  async buscarEnvio(intentoId) {
    const [f] = await db
      .select()
      .from(estados_cuenta_cancelacion_envios)
      .where(eq(estados_cuenta_cancelacion_envios.id, intentoId))
      .limit(1);
    return f ? aEnvio(f) : null;
  },

  async crearEnvio(envio) {
    const filas = await db
      .insert(estados_cuenta_cancelacion_envios)
      .values({
        id: envio.id,
        documento_id: envio.documentoId,
        canal: envio.canal,
        destinatario_telefono: envio.destinatarioTelefono,
        destinatario_fuente: envio.destinatarioFuente,
        solicitado_por_id: envio.solicitadoPorId,
        estado: envio.estado,
      })
      .onConflictDoNothing({ target: estados_cuenta_cancelacion_envios.id })
      .returning({ id: estados_cuenta_cancelacion_envios.id });
    return filas.length > 0;
  },

  async finalizarEnvio(intentoId, cambios) {
    await db
      .update(estados_cuenta_cancelacion_envios)
      .set({
        estado: cambios.estado,
        proveedor: cambios.proveedor,
        proveedor_mensaje_id: cambios.proveedorMensajeId,
        error_resumen: cambios.errorResumen,
        finalizado_at: cambios.finalizadoAt,
        enlace_id: cambios.enlaceId,
      })
      .where(eq(estados_cuenta_cancelacion_envios.id, intentoId));
  },

  obtenerContactos: (numeroCreditoSifco) => obtenerContactosDelCrm(numeroCreditoSifco),
  enviarWhatsapp: (params) => enviarWhatsappPorCrm(params),

  async crearEnlace(enlace) {
    await db.insert(estados_cuenta_cancelacion_enlaces).values({
      id: enlace.id,
      documento_id: enlace.documentoId,
      codigo_sha256: enlace.codigoSha256,
      creado_por_id: enlace.creadoPorId,
      creado_at: enlace.creadoAt,
      vence_at: enlace.venceAt,
    });
  },

  async buscarEnlacePorHash(codigoSha256) {
    const [f] = await db
      .select({ enlace: estados_cuenta_cancelacion_enlaces, documento: estados_cuenta_cancelacion })
      .from(estados_cuenta_cancelacion_enlaces)
      .innerJoin(
        estados_cuenta_cancelacion,
        eq(estados_cuenta_cancelacion.id, estados_cuenta_cancelacion_enlaces.documento_id)
      )
      .where(eq(estados_cuenta_cancelacion_enlaces.codigo_sha256, codigoSha256))
      .limit(1);
    return f ? { enlace: aEnlace(f.enlace), documento: aDocumento(f.documento) } : null;
  },

  async registrarApertura(enlaceId, cuando) {
    await db
      .update(estados_cuenta_cancelacion_enlaces)
      .set({
        aperturas: sql`${estados_cuenta_cancelacion_enlaces.aperturas} + 1`,
        primera_apertura_at: sql`coalesce(${estados_cuenta_cancelacion_enlaces.primera_apertura_at}, ${cuando})`,
        ultima_apertura_at: cuando,
      })
      .where(eq(estados_cuenta_cancelacion_enlaces.id, enlaceId));
  },

  enlaceBaseUrl: () => process.env.ESTADO_CUENTA_ENLACE_BASE_URL?.trim() || null,
  vigenciaEnlaceDias: () => {
    const dias = Number(process.env.ESTADO_CUENTA_ENLACE_VIGENCIA_DIAS);
    return Number.isFinite(dias) && dias > 0 ? dias : VIGENCIA_ENLACE_DIAS_DEFAULT;
  },
  generarCodigo: () => randomBytes(16).toString("base64url"),

  ahora: () => new Date(),
  nuevoId: () => randomUUID(),
  logoUrl: () => process.env.LOGO_URL || LOGO_URL_DEFAULT,
};
