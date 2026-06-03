// ============================================================
// Monitoreo de facturas no certificadas en SAT
// ------------------------------------------------------------
// - verificarFacturasSat(): job cada 15 min. Revisa las facturas
//   ACTIVA nuevas (desde el último cursor) y, si alguna NO está en
//   SAT, la registra en cartera.facturas_fallidas_sat.
// - reportarFacturasFallidasSat(): job cada hora. Envía un correo
//   con todas las fallidas PENDIENTE.
// ============================================================
import { db } from "../database";
import {
  facturas_electronicas,
  facturas_fallidas_sat,
  job_checkpoints,
} from "../database/db";
import { and, eq, gt, sql } from "drizzle-orm";
import { SATClientService } from "../cofidi/satClientService";
import {
  SAT_CONFIG,
  SE_PRESTA_SAT_CONFIG,
  AMJK_SAT_CONFIG,
  CREACION_IMAGEN_SAT_CONFIG,
  GRUPO_BATRO_SAT_CONFIG,
  AUTOCASH_SAT_CONFIG,
} from "../utils/functions/const";
import { sendPlainEmail } from "@cci/email";

const JOB_NAME = "verificar_facturas_sat";
// Grace para evitar falsos negativos por propagación SAT (la factura recién
// certificada puede tardar unos segundos en ser consultable).
const GRACE_MINUTES = 2;
// Reintento corto antes de marcar una factura como fallida.
const REINTENTO_MS = 2000;

// Destinatarios del correo (configurable por env, con default).
const DEFAULT_EMAILS = [
  "diego.l@clubcashin.com",
  "jalvarado@clubcashin.com",
  "daniel.r@clubcashin.com",
  "diego.a@sepresta.com",
  "lralda@clubcashin.com",
];

// ------------------------------------------------------------
// Mapa NIT emisor -> SAT config. Las configs no-CUBE usan `nit`,
// CUBE usa `entity`; se normaliza a `entity`.
// ------------------------------------------------------------
const SAT_CONFIGS: any[] = [
  SAT_CONFIG,
  SE_PRESTA_SAT_CONFIG,
  AMJK_SAT_CONFIG,
  CREACION_IMAGEN_SAT_CONFIG,
  GRUPO_BATRO_SAT_CONFIG,
  AUTOCASH_SAT_CONFIG,
];

const nitDeConfig = (cfg: any): string => cfg.entity ?? cfg.nit;

const SAT_CONFIG_POR_NIT: Record<string, any> = {};
for (const cfg of SAT_CONFIGS) {
  SAT_CONFIG_POR_NIT[nitDeConfig(cfg)] = cfg;
}

function getSatClientPorEmisor(emisorNit: string | null | undefined): SATClientService {
  const cfg = (emisorNit && SAT_CONFIG_POR_NIT[emisorNit]) || SAT_CONFIG;
  return new SATClientService(
    {
      requestor: cfg.requestor,
      user: cfg.user,
      userName: cfg.userName,
      entity: nitDeConfig(cfg),
    },
    cfg.endpointUrl
  );
}

// Consulta SAT con un reintento corto. Devuelve {encontrado, mensaje}.
async function verificarEnSat(
  uuid: string,
  emisorNit: string | null | undefined
): Promise<{ encontrado: boolean; mensaje: string }> {
  const client = getSatClientPorEmisor(emisorNit);
  try {
    let r = await client.obtenerPorUUID(uuid);
    if (!r.encontrado) {
      await new Promise((res) => setTimeout(res, REINTENTO_MS));
      r = await client.obtenerPorUUID(uuid);
    }
    return { encontrado: !!r.encontrado, mensaje: r.mensaje || "" };
  } catch (e) {
    // Un error de red NO debe marcar la factura como fallida.
    return { encontrado: true, mensaje: `error_consulta: ${(e as Error).message}` };
  }
}

// Marca como RESUELTA toda fallida PENDIENTE cuya factura ya esté ANULADA en
// la BD (así deja de aparecer en el reporte). Devuelve cuántas resolvió.
async function resolverFallidasAnuladas(): Promise<number> {
  const r: any = await db.execute(sql`
    UPDATE cartera.facturas_fallidas_sat AS ff
    SET status = 'RESUELTA', resuelta_at = now(), updated_at = now()
    FROM cartera.facturas_electronicas AS fe
    WHERE ff.factura_id = fe.factura_id
      AND ff.status = 'PENDIENTE'
      AND fe.status = 'ANULADA'
  `);
  const n = r?.rowCount ?? 0;
  if (n > 0) console.log(`🧹 [facturas_fallidas_sat] ${n} resuelta(s) por estar ANULADA en BD`);
  return n;
}

// ============================================================
// JOB 1: verificar facturas nuevas contra SAT
// ============================================================
export async function verificarFacturasSat() {
  // 0) Limpiar fallidas que ya fueron anuladas en la BD
  await resolverFallidasAnuladas();

  // 1) Cursor
  const [chk] = await db
    .select()
    .from(job_checkpoints)
    .where(eq(job_checkpoints.job_name, JOB_NAME));
  const cursor = chk?.last_factura_id ?? 0;

  // 2) Candidatos: ACTIVA, factura_id > cursor, certificadas hace >= GRACE_MINUTES
  const candidatos = await db
    .select({
      factura_id: facturas_electronicas.factura_id,
      uuid: facturas_electronicas.uuid,
      serie: facturas_electronicas.serie,
      numero: facturas_electronicas.numero,
      emisor_nit: facturas_electronicas.emisor_nit,
      emisor_nombre: facturas_electronicas.emisor_nombre,
      receptor_nit: facturas_electronicas.receptor_nit,
      receptor_nombre: facturas_electronicas.receptor_nombre,
      monto_total: facturas_electronicas.monto_total,
      fecha_certificacion: facturas_electronicas.fecha_certificacion,
    })
    .from(facturas_electronicas)
    .where(
      and(
        gt(facturas_electronicas.factura_id, cursor),
        eq(facturas_electronicas.status, "ACTIVA"),
        sql`${facturas_electronicas.fecha_certificacion} <= now() - (${GRACE_MINUTES} || ' minutes')::interval`
      )
    )
    .orderBy(facturas_electronicas.factura_id);

  // 3) Sin candidatos -> no hace nada (no toca cursor)
  if (candidatos.length === 0) {
    console.log("🧾 [verificarFacturasSat] Sin facturas nuevas para revisar");
    return { revisadas: 0, fallidas: 0 };
  }

  let fallidas = 0;
  let maxId = cursor;

  for (const f of candidatos) {
    const { encontrado, mensaje } = await verificarEnSat(f.uuid, f.emisor_nit);

    if (!encontrado) {
      fallidas++;
      console.warn(
        `❌ [verificarFacturasSat] NO está en SAT: ${f.serie}-${f.numero} (${f.uuid}) - ${mensaje}`
      );
      await db
        .insert(facturas_fallidas_sat)
        .values({
          factura_id: f.factura_id,
          uuid: f.uuid,
          serie: f.serie,
          numero: f.numero,
          emisor_nit: f.emisor_nit,
          emisor_nombre: f.emisor_nombre,
          receptor_nit: f.receptor_nit,
          receptor_nombre: f.receptor_nombre,
          monto_total: f.monto_total,
          fecha_certificacion: f.fecha_certificacion,
          mensaje_sat: mensaje,
          status: "PENDIENTE",
        })
        .onConflictDoUpdate({
          target: facturas_fallidas_sat.factura_id,
          set: {
            intentos: sql`${facturas_fallidas_sat.intentos} + 1`,
            mensaje_sat: mensaje,
            status: "PENDIENTE",
            updated_at: sql`now()`,
          },
        });
    }

    if (f.factura_id > maxId) maxId = f.factura_id;
  }

  // 4) Avanzar cursor
  await db
    .insert(job_checkpoints)
    .values({ job_name: JOB_NAME, last_factura_id: maxId })
    .onConflictDoUpdate({
      target: job_checkpoints.job_name,
      set: { last_factura_id: maxId, updated_at: sql`now()` },
    });

  console.log(
    `🧾 [verificarFacturasSat] revisadas=${candidatos.length} fallidas=${fallidas} cursor=${cursor}->${maxId}`
  );
  return { revisadas: candidatos.length, fallidas };
}

// ============================================================
// JOB 2: reportar por correo las fallidas pendientes
// ============================================================
export async function reportarFacturasFallidasSat() {
  // Quitar del reporte las que ya fueron anuladas en la BD
  await resolverFallidasAnuladas();

  const pendientes = await db
    .select()
    .from(facturas_fallidas_sat)
    .where(eq(facturas_fallidas_sat.status, "PENDIENTE"))
    .orderBy(facturas_fallidas_sat.fecha_certificacion);

  if (pendientes.length === 0) {
    console.log("📧 [reportarFacturasFallidasSat] Sin pendientes, no se envía correo");
    return { enviadas: 0 };
  }

  const destinatarios = (process.env.FACTURAS_FALLIDAS_EMAILS
    ? process.env.FACTURAS_FALLIDAS_EMAILS.split(",").map((e) => e.trim()).filter(Boolean)
    : DEFAULT_EMAILS);

  const filas = pendientes
    .map((f) => {
      const fecha = f.fecha_certificacion
        ? new Date(f.fecha_certificacion).toLocaleString("es-GT", {
            timeZone: "America/Guatemala",
          })
        : "";
      return `<tr>
        <td style="padding:6px 10px;border:1px solid #ddd;">${f.serie}-${f.numero}</td>
        <td style="padding:6px 10px;border:1px solid #ddd;font-family:monospace;font-size:12px;">${f.uuid}</td>
        <td style="padding:6px 10px;border:1px solid #ddd;">${f.emisor_nombre ?? f.emisor_nit ?? ""}</td>
        <td style="padding:6px 10px;border:1px solid #ddd;">${f.receptor_nombre ?? ""} (${f.receptor_nit ?? ""})</td>
        <td style="padding:6px 10px;border:1px solid #ddd;text-align:right;">Q${f.monto_total ?? ""}</td>
        <td style="padding:6px 10px;border:1px solid #ddd;">${fecha}</td>
        <td style="padding:6px 10px;border:1px solid #ddd;text-align:center;">${f.intentos}</td>
        <td style="padding:6px 10px;border:1px solid #ddd;">${f.mensaje_sat ?? ""}</td>
      </tr>`;
    })
    .join("");

  const html = `
    <div style="font-family:Arial,sans-serif;color:#222;">
      <h2>⚠️ Facturas no encontradas en SAT</h2>
      <p>Se detectaron <strong>${pendientes.length}</strong> factura(s) que están <strong>ACTIVA</strong> en el sistema pero <strong>no aparecen en SAT</strong>.</p>
      <table style="border-collapse:collapse;border:1px solid #ddd;font-size:13px;">
        <thead>
          <tr style="background:#f4f4f4;">
            <th style="padding:6px 10px;border:1px solid #ddd;">Serie-Número</th>
            <th style="padding:6px 10px;border:1px solid #ddd;">UUID</th>
            <th style="padding:6px 10px;border:1px solid #ddd;">Emisor</th>
            <th style="padding:6px 10px;border:1px solid #ddd;">Receptor</th>
            <th style="padding:6px 10px;border:1px solid #ddd;">Monto</th>
            <th style="padding:6px 10px;border:1px solid #ddd;">Certificación</th>
            <th style="padding:6px 10px;border:1px solid #ddd;">Intentos</th>
            <th style="padding:6px 10px;border:1px solid #ddd;">Mensaje SAT</th>
          </tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>
      <p style="color:#888;font-size:12px;margin-top:16px;">Reporte automático — Cartera Cash-In.</p>
    </div>`;

  await sendPlainEmail(
    destinatarios,
    `⚠️ ${pendientes.length} factura(s) no certificada(s) en SAT`,
    html
  );

  console.log(
    `📧 [reportarFacturasFallidasSat] correo enviado a ${destinatarios.length} destinatario(s) con ${pendientes.length} pendiente(s)`
  );
  return { enviadas: pendientes.length };
}
