// ============================================================
// Backfill de facturas certificadas en SAT pero NO guardadas en la BD.
// Fuente de verdad: SAT (GET_DOCUMENT por UUID vía COFIDI).
//
// USO:
//   bun run src/scripts/backfill-facturas-faltantes.ts            (dry-run: consulta + parsea + matchea, NO inserta)
//   bun run src/scripts/backfill-facturas-faltantes.ts --insert   (inserta en facturas_electronicas)
//
// Requiere env CUBE_COFIDI_URL + credenciales por emisor.
// SUPABASE_DB_URL debe apuntar a la BD destino (LOCAL para probar).
// ============================================================
import { XMLParser } from "fast-xml-parser";
import { and, eq, inArray, sql } from "drizzle-orm";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { db } from "../database";
import { facturas_electronicas, pagos_credito, cuotas_credito } from "../database/db";
import { SATClientService } from "../cofidi/satClientService";
import { generarHTMLFacturaPro } from "../cofidi/functions";
import { launchBrowser } from "../utils/functions/browser";
import {
  SAT_CONFIG,
  SE_PRESTA_SAT_CONFIG,
  AMJK_SAT_CONFIG,
  CREACION_IMAGEN_SAT_CONFIG,
  GRUPO_BATRO_SAT_CONFIG,
  AUTOCASH_SAT_CONFIG,
} from "../utils/functions/const";

const INSERT = process.argv.includes("--insert");
const PDF = process.argv.includes("--pdf");

// UUIDs reportados por conta (en SAT, faltan en la BD).
const UUIDS: string[] = [
  "5086B80E-15C8-4C50-B8BB-D207F448F8FC",
  "C86DAB89-6341-4D13-B916-C3A7990265A2",
];

// Overrides de pago_id verificados a mano (cuando hay >1 candidato por venc).
// El script exige que el override esté entre los candidatos antes de usarlo.
const PAGO_ID_OVERRIDE: Record<string, number> = {
  // SOC ITZEP Q931.98: 2 candidatos (144733 real Q4300, 126720 Q10). Mismo lote
  // de certificación que la factura 17744 del pago 144733 (10:35 vs 10:36).
  "5086B80E-15C8-4C50-B8BB-D207F448F8FC": 144733,
};

const nitDeConfig = (cfg: any): string => cfg.entity ?? cfg.nit;

// Solo configs con credenciales presentes (GRUPO_BATRO puede faltar en .env).
const SAT_CONFIGS = [
  ["CUBE", SAT_CONFIG],
  ["SE_PRESTA", SE_PRESTA_SAT_CONFIG],
  ["AMJK", AMJK_SAT_CONFIG],
  ["CREACION_IMAGEN", CREACION_IMAGEN_SAT_CONFIG],
  ["GRUPO_BATRO", GRUPO_BATRO_SAT_CONFIG],
  ["AUTOCASH", AUTOCASH_SAT_CONFIG],
].filter(([, cfg]: any) => cfg.requestor && cfg.endpointUrl) as [string, any][];

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

const convertirAGuatemala = (fechaSAT: string): Date => {
  const fecha = new Date(fechaSAT);
  fecha.setHours(fecha.getHours() - 6);
  return fecha;
};

// Consulta un UUID probando cada emisor hasta que uno lo encuentre.
async function traerDeSat(uuid: string) {
  for (const [nombre, cfg] of SAT_CONFIGS) {
    const client = new SATClientService(
      {
        requestor: cfg.requestor,
        user: cfg.requestor,
        userName: cfg.userName,
        entity: nitDeConfig(cfg),
      },
      cfg.endpointUrl
    );
    try {
      const r = await client.obtenerPorUUID(uuid);
      if (r.encontrado && r.xmlCertificado) {
        const xml = Buffer.from(r.xmlCertificado, "base64").toString("utf-8");
        return { emisorProbado: nombre, xml };
      }
    } catch (e) {
      console.log(`   · ${nombre}: error consulta (${(e as Error).message})`);
    }
  }
  return null;
}

function parseFactura(xml: string) {
  const parsed = parser.parse(xml);
  const dte = parsed["dte:GTDocumento"]["dte:SAT"]["dte:DTE"];
  const datosEmision = dte["dte:DatosEmision"];
  const certificacion = dte["dte:Certificacion"];
  const datosGenerales = datosEmision["dte:DatosGenerales"];
  const emisor = datosEmision["dte:Emisor"];
  const receptor = datosEmision["dte:Receptor"];
  const totales = datosEmision["dte:Totales"];
  const numAut = certificacion["dte:NumeroAutorizacion"];

  // Complemento cambiario -> fecha de vencimiento del abono (link al pago).
  let vencimientos: string[] = [];
  const complementosXML = datosEmision["dte:Complementos"];
  if (complementosXML) {
    const complemento = complementosXML["dte:Complemento"];
    const abonosData = complemento?.["cfc:AbonosFacturaCambiaria"]?.["cfc:Abono"];
    const abonos = abonosData ? (Array.isArray(abonosData) ? abonosData : [abonosData]) : [];
    vencimientos = abonos.map((a: any) => a["cfc:FechaVencimiento"]).filter(Boolean);
  }

  const items = (Array.isArray(datosEmision["dte:Items"]["dte:Item"])
    ? datosEmision["dte:Items"]["dte:Item"]
    : [datosEmision["dte:Items"]["dte:Item"]]
  ).map((it: any) => it["dte:Descripcion"]);

  return {
    serie: numAut["@_Serie"],
    numero: String(numAut["@_Numero"]),
    uuid: numAut["#text"],
    tipo_documento: datosGenerales["@_Tipo"],
    monto_total: parseFloat(totales["dte:GranTotal"]),
    monto_iva: parseFloat(
      totales["dte:TotalImpuestos"]["dte:TotalImpuesto"]["@_TotalMontoImpuesto"]
    ),
    emisor_nit: emisor["@_NITEmisor"],
    emisor_nombre: emisor["@_NombreEmisor"],
    receptor_nit: receptor["@_IDReceptor"],
    receptor_nombre: receptor["@_NombreReceptor"],
    fecha_emision: datosGenerales["@_FechaHoraEmision"],
    fecha_certificacion_raw: certificacion["dte:FechaHoraCertificacion"],
    vencimientos,
    descripciones: items,
  };
}

// Construye el objeto DatosFactura para el HTML (idéntico a cofidi paso 5).
function buildDatos(xml: string) {
  const parsed = parser.parse(xml);
  const dte = parsed["dte:GTDocumento"]["dte:SAT"]["dte:DTE"];
  const datosEmision = dte["dte:DatosEmision"];
  const certificacion = dte["dte:Certificacion"];
  const datosGenerales = datosEmision["dte:DatosGenerales"];
  const emisor = datosEmision["dte:Emisor"];
  const receptor = datosEmision["dte:Receptor"];
  const totales = datosEmision["dte:Totales"];
  const numAut = certificacion["dte:NumeroAutorizacion"];
  const itemsXML = Array.isArray(datosEmision["dte:Items"]["dte:Item"])
    ? datosEmision["dte:Items"]["dte:Item"]
    : [datosEmision["dte:Items"]["dte:Item"]];

  let abonos: any[] = [];
  const complementosXML = datosEmision["dte:Complementos"];
  if (complementosXML) {
    const complemento = complementosXML["dte:Complemento"];
    const abonosData = complemento?.["cfc:AbonosFacturaCambiaria"]?.["cfc:Abono"];
    const arr = abonosData ? (Array.isArray(abonosData) ? abonosData : [abonosData]) : [];
    abonos = arr.map((a: any) => ({
      numero: a["cfc:NumeroAbono"],
      fechaVencimiento: a["cfc:FechaVencimiento"],
      monto: parseFloat(a["cfc:MontoAbono"]),
    }));
  }

  return {
    tipo: datosGenerales["@_Tipo"],
    serie: numAut["@_Serie"],
    numero: String(numAut["@_Numero"]),
    uuid: numAut["#text"],
    fechaEmision: datosGenerales["@_FechaHoraEmision"],
    fechaCertificacion: certificacion["dte:FechaHoraCertificacion"],
    emisor: {
      nit: emisor["@_NITEmisor"],
      nombre: emisor["@_NombreEmisor"],
      nombreComercial: emisor["@_NombreComercial"],
      // Objeto completo: el HTML lee direccion["dte:Direccion"], ["dte:Municipio"]
      // y ["dte:Departamento"]. Pasar solo el string interno los deja en undefined.
      direccion: emisor["dte:DireccionEmisor"],
    },
    receptor: {
      nit: receptor["@_IDReceptor"],
      nombre: receptor["@_NombreReceptor"],
      direccion: receptor["dte:DireccionReceptor"]?.["dte:Direccion"],
    },
    items: itemsXML.map((item: any) => ({
      numeroLinea: item["@_NumeroLinea"],
      cantidad: item["dte:Cantidad"],
      unidad: item["dte:UnidadMedida"],
      descripcion: item["dte:Descripcion"],
      precioUnitario: parseFloat(item["dte:PrecioUnitario"]),
      total: parseFloat(item["dte:Total"]),
    })),
    totales: {
      iva: parseFloat(totales["dte:TotalImpuestos"]["dte:TotalImpuesto"]["@_TotalMontoImpuesto"]),
      granTotal: parseFloat(totales["dte:GranTotal"]),
    },
    abonos,
    certificador: {
      nit: certificacion["dte:NITCertificador"],
      nombre: certificacion["dte:NombreCertificador"],
    },
  };
}

// Regenera el PDF desde el XML y lo sube a R2 (idéntico a cofidi pasos 5-7).
// Devuelve la URL pública (misma convención que el pdf_url guardado).
async function generarYSubirPdf(xml: string): Promise<string> {
  const datos = buildDatos(xml);
  const logoUrl = process.env.LOGO_URL || "";
  const html = generarHTMLFacturaPro(datos as any, logoUrl);

  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });
  const pdfBuffer = await page.pdf({
    format: "A4",
    printBackground: true,
    margin: { top: "20px", bottom: "20px", left: "20px", right: "20px" },
  });
  await browser.close();

  const filename = `factura_${datos.serie}_${datos.numero}.pdf`;
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

  return `${process.env.URL_PUBLIC_R2_REPORTS}/${filename}`;
}

// Match pago_id (opción a): por crédito del cliente + fecha_vencimiento del abono.
async function matchPagoId(f: ReturnType<typeof parseFactura>) {
  // Créditos conocidos del cliente (por sus facturas ya guardadas).
  const creditosCliente = await db
    .select({ credito_id: pagos_credito.credito_id })
    .from(facturas_electronicas)
    .innerJoin(pagos_credito, eq(pagos_credito.pago_id, facturas_electronicas.pago_id))
    .where(eq(facturas_electronicas.receptor_nit, f.receptor_nit))
    .groupBy(pagos_credito.credito_id);
  const creditoIds = creditosCliente.map((c) => c.credito_id).filter((x): x is number => x != null);

  if (creditoIds.length === 0) return { candidatos: [], creditoIds };
  if (f.vencimientos.length === 0) return { candidatos: [], creditoIds };

  const vencDates = f.vencimientos.map((v) => v.split("T")[0]);

  const candidatos = await db
    .select({
      pago_id: pagos_credito.pago_id,
      credito_id: pagos_credito.credito_id,
      cuota_id: pagos_credito.cuota_id,
      numero_cuota: cuotas_credito.numero_cuota,
      fecha_vencimiento: cuotas_credito.fecha_vencimiento,
      mora: pagos_credito.mora,
      ya_facturada: sql<boolean>`exists (select 1 from cartera.facturas_electronicas fe2 where fe2.pago_id = ${pagos_credito.pago_id} and fe2.monto_total = ${f.monto_total.toString()})`,
    })
    .from(pagos_credito)
    .innerJoin(cuotas_credito, eq(cuotas_credito.cuota_id, pagos_credito.cuota_id))
    .where(
      and(
        inArray(pagos_credito.credito_id, creditoIds),
        inArray(cuotas_credito.fecha_vencimiento, vencDates)
      )
    );

  return { candidatos, creditoIds, vencDates };
}

async function main() {
  console.log(`\n🧾 Backfill facturas faltantes — modo: ${INSERT ? "INSERT" : "DRY-RUN"}`);
  console.log(`   Emisores a probar: ${SAT_CONFIGS.map(([n]) => n).join(", ")}`);
  console.log(`   BD destino: ${process.env.SUPABASE_DB_URL?.replace(/:[^:@]+@/, ":****@")}\n`);

  for (const uuid of UUIDS) {
    console.log(`\n========== UUID ${uuid} ==========`);

    const yaExiste = await db
      .select({ id: facturas_electronicas.factura_id })
      .from(facturas_electronicas)
      .where(sql`upper(${facturas_electronicas.uuid}) = upper(${uuid})`);
    const existeEnBD = yaExiste.length > 0;
    if (existeEnBD) {
      console.log(`   ⏭️  Ya existe en BD (factura_id ${yaExiste[0].id}). No se re-inserta${PDF ? " (pero sí regenero PDF)" : ""}.`);
    }

    const res = await traerDeSat(uuid);
    if (!res) {
      console.log(`   ❌ No se encontró en SAT con ningún emisor.`);
      continue;
    }
    console.log(`   ✅ Encontrada en SAT (emisor probado: ${res.emisorProbado})`);

    const f = parseFactura(res.xml);
    console.log(`   📄 ${f.serie}-${f.numero} | ${f.tipo_documento} | Q${f.monto_total} (IVA Q${f.monto_iva})`);
    console.log(`      Emisor:   ${f.emisor_nit} ${f.emisor_nombre}`);
    console.log(`      Receptor: ${f.receptor_nit} ${f.receptor_nombre}`);
    console.log(`      Emisión:  ${f.fecha_emision} | Cert: ${f.fecha_certificacion_raw}`);
    console.log(`      Vencimientos abono: ${f.vencimientos.join(", ") || "(ninguno)"}`);
    console.log(`      Ítems: ${f.descripciones.join(" | ")}`);

    // Regenerar + subir PDF a R2 (independiente del pago_id).
    if (PDF) {
      try {
        const url = await generarYSubirPdf(res.xml);
        console.log(`      🧾 PDF regenerado y subido: ${url}`);
      } catch (e) {
        console.log(`      💥 Error PDF: ${(e as Error).message}`);
      }
    }

    // Si ya está en BD, el PDF ya se regeneró arriba; no se re-inserta.
    if (existeEnBD) continue;

    const { candidatos, creditoIds } = await matchPagoId(f);
    console.log(`      Créditos del cliente: ${creditoIds.join(", ") || "(ninguno)"}`);
    for (const c of candidatos) {
      console.log(
        `      🔎 candidato pago_id=${c.pago_id} credito=${c.credito_id} cuota#${c.numero_cuota} venc=${c.fecha_vencimiento} mora=${c.mora} ${c.ya_facturada ? "⚠️YA-FACTURADA-ESE-MONTO" : "✅libre"}`
      );
    }

    // Resolver pago_id: override verificado > candidato único > ambiguo (no toca).
    const override = PAGO_ID_OVERRIDE[uuid.toUpperCase()] ?? PAGO_ID_OVERRIDE[uuid];
    const candidatoIds = candidatos.map((c) => c.pago_id);
    let pagoIdElegido: number | null = null;
    if (override != null) {
      if (!candidatoIds.includes(override)) {
        console.log(`      🛑 Override pago_id=${override} NO está entre los candidatos. Se omite por seguridad.`);
        continue;
      }
      pagoIdElegido = override;
      console.log(`      ✔️ pago_id elegido (override verificado): ${pagoIdElegido}`);
    } else if (candidatos.length === 1) {
      pagoIdElegido = candidatos[0].pago_id;
      console.log(`      ✔️ pago_id elegido (candidato único): ${pagoIdElegido}`);
    } else {
      console.log(`      🛑 pago_id AMBIGUO (${candidatos.length} candidatos) y sin override. Se omite; requiere decisión manual.`);
      continue;
    }

    const pdfUrl = `${process.env.URL_PUBLIC_R2_REPORTS}/factura_${f.serie}_${f.numero}.pdf`;
    const fila = {
      pago_id: pagoIdElegido,
      serie: f.serie,
      numero: f.numero,
      uuid: f.uuid,
      tipo_documento: f.tipo_documento,
      monto_total: f.monto_total.toString(),
      monto_iva: f.monto_iva.toString(),
      pdf_url: pdfUrl,
      emisor_nit: f.emisor_nit,
      emisor_nombre: f.emisor_nombre,
      receptor_nit: f.receptor_nit,
      receptor_nombre: f.receptor_nombre,
      fecha_emision: new Date(f.fecha_emision),
      fecha_certificacion: convertirAGuatemala(f.fecha_certificacion_raw),
      status: "ACTIVA" as const,
      created_by: null,
    };

    if (!INSERT) {
      console.log(`      📝 [DRY-RUN] insertaría:`, JSON.stringify({ ...fila, fecha_emision: fila.fecha_emision.toISOString(), fecha_certificacion: fila.fecha_certificacion.toISOString() }));
      continue;
    }

    const [ins] = await db.insert(facturas_electronicas).values(fila).returning();
    console.log(`      💾 INSERTADA -> factura_id=${ins.factura_id}, pago_id=${ins.pago_id}, ${ins.serie}-${ins.numero}, Q${ins.monto_total}`);
  }

  console.log(`\n✅ Fin (${INSERT ? "INSERT" : "DRY-RUN"}).`);
  process.exit(0);
}

main().catch((e) => {
  console.error("💥 Error:", e);
  process.exit(1);
});
