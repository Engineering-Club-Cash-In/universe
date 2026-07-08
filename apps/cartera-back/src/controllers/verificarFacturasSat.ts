// ============================================================
import { SQL_CARTERA_SCHEMA } from "../database/db/schema";
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
  "caja@sepresta.com",
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

type EstadoSat = "found" | "not_found" | "error";

// Consulta SAT con un reintento corto. Devuelve un estado de 3 valores:
//  - "found": la factura está en SAT.
//  - "not_found": SAT respondió que NO existe -> es una fallida real.
//  - "error": la consulta falló (red/timeout/parse). NO concluye nada: la
//    factura no se marca fallida y el cursor NO debe avanzar más allá de ella.
async function verificarEnSat(
  uuid: string,
  emisorNit: string | null | undefined
): Promise<{ estado: EstadoSat; mensaje: string }> {
  const client = getSatClientPorEmisor(emisorNit);
  try {
    let r = await client.obtenerPorUUID(uuid);
    if (!r.encontrado) {
      await new Promise((res) => setTimeout(res, REINTENTO_MS));
      r = await client.obtenerPorUUID(uuid);
    }
    return { estado: r.encontrado ? "found" : "not_found", mensaje: r.mensaje || "" };
  } catch (e) {
    // Error de red: no concluye. No marca fallida ni avanza cursor.
    return { estado: "error", mensaje: `error_consulta: ${(e as Error).message}` };
  }
}

// Marca como RESUELTA toda fallida PENDIENTE cuya factura ya esté ANULADA en
// la BD (así deja de aparecer en el reporte). Devuelve cuántas resolvió.
async function resolverFallidasAnuladas(): Promise<number> {
  const r: any = await db.execute(sql`
    UPDATE ${SQL_CARTERA_SCHEMA}.facturas_fallidas_sat AS ff
    SET status = 'RESUELTA', resuelta_at = now(), updated_at = now()
    FROM ${SQL_CARTERA_SCHEMA}.facturas_electronicas AS fe
    WHERE ff.factura_id = fe.factura_id
      AND ff.status = 'PENDIENTE'
      AND fe.status = 'ANULADA'
  `);
  const n = r?.rowCount ?? 0;
  if (n > 0) console.log(`🧹 [facturas_fallidas_sat] ${n} resuelta(s) por estar ANULADA en BD`);
  return n;
}

// Re-verifica contra SAT las fallidas que siguen PENDIENTE. Si una ya aparece
// en SAT (apareció después del grace por propagación lenta), la marca RESUELTA
// para que no genere alertas falsas para siempre. Devuelve cuántas resolvió.
async function revalidarPendientes(): Promise<number> {
  const pendientes = await db
    .select({
      factura_id: facturas_fallidas_sat.factura_id,
      uuid: facturas_fallidas_sat.uuid,
      emisor_nit: facturas_fallidas_sat.emisor_nit,
    })
    .from(facturas_fallidas_sat)
    .where(eq(facturas_fallidas_sat.status, "PENDIENTE"));

  let resueltas = 0;
  for (const p of pendientes) {
    const { estado, mensaje } = await verificarEnSat(p.uuid, p.emisor_nit);
    if (estado === "found") {
      resueltas++;
      await db
        .update(facturas_fallidas_sat)
        .set({
          status: "RESUELTA",
          resuelta_at: sql`now()`,
          updated_at: sql`now()`,
          mensaje_sat: `Apareció en SAT al revalidar (${mensaje})`,
        })
        .where(eq(facturas_fallidas_sat.factura_id, p.factura_id));
    }
  }
  if (resueltas > 0)
    console.log(`🔁 [facturas_fallidas_sat] ${resueltas} resuelta(s) al reaparecer en SAT`);
  return resueltas;
}

// ============================================================
// JOB 1: verificar facturas nuevas contra SAT
// ============================================================
export async function verificarFacturasSat() {
  // 0) Limpiar fallidas que ya fueron anuladas en la BD y re-validar las que
  //    ya aparecieron en SAT (evita alertas falsas permanentes).
  await resolverFallidasAnuladas();
  await revalidarPendientes();

  // 1) Cursor
  const [chk] = await db
    .select()
    .from(job_checkpoints)
    .where(eq(job_checkpoints.job_name, JOB_NAME));
  const cursor = chk?.last_factura_id ?? 0;

  // 2) Candidatos: ACTIVA, factura_id > cursor. El grace se valida en orden
  // dentro del loop para no saltar facturas recientes con IDs menores.
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
        eq(facturas_electronicas.status, "ACTIVA")
      )
    )
    .orderBy(facturas_electronicas.factura_id);

  // 3) Sin candidatos -> no hace nada (no toca cursor)
  if (candidatos.length === 0) {
    console.log("🧾 [verificarFacturasSat] Sin facturas nuevas para revisar");
    return { revisadas: 0, fallidas: 0 };
  }

  let fallidas = 0;
  let errores = 0;
  let revisadas = 0;
  let maxId = cursor;
  // Una vez que una consulta a SAT falla, NO avanzamos el cursor más allá de
  // esa factura: se reintentará en la próxima corrida. Así una caída de SAT no
  // hace que se salten facturas para siempre.
  let congelado = false;
  const fechaLimite = Date.now() - GRACE_MINUTES * 60 * 1000;

  for (const f of candidatos) {
    const fechaCertificacion = f.fecha_certificacion
      ? new Date(f.fecha_certificacion).getTime()
      : Number.NaN;
    if (!Number.isFinite(fechaCertificacion) || fechaCertificacion > fechaLimite) {
      console.log(
        `🧾 [verificarFacturasSat] Factura ${f.serie}-${f.numero} (${f.factura_id}) aún no es elegible por grace. Cursor detenido en ${maxId}.`
      );
      break;
    }

    revisadas++;
    const { estado, mensaje } = await verificarEnSat(f.uuid, f.emisor_nit);

    if (estado === "error") {
      errores++;
      congelado = true;
      console.warn(
        `⚠️ [verificarFacturasSat] Error consultando SAT: ${f.serie}-${f.numero} (${f.uuid}) - ${mensaje}. Se reintentará.`
      );
      continue; // no concluye: no marca fallida ni avanza cursor
    }

    if (estado === "not_found") {
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

    // Solo avanzamos el cursor mientras no haya habido un error antes (para no
    // saltarnos la factura que falló, que sigue siendo > cursor).
    if (!congelado && f.factura_id > maxId) maxId = f.factura_id;
  }

  // 4) Avanzar cursor (hasta la última factura concluyente contigua)
  if (maxId > cursor) {
    await db
      .insert(job_checkpoints)
      .values({ job_name: JOB_NAME, last_factura_id: maxId })
      .onConflictDoUpdate({
        target: job_checkpoints.job_name,
        set: { last_factura_id: maxId, updated_at: sql`now()` },
      });
  }

  console.log(
    `🧾 [verificarFacturasSat] revisadas=${revisadas} fallidas=${fallidas} errores=${errores} cursor=${cursor}->${maxId}`
  );
  return { revisadas, fallidas, errores };
}

// ============================================================
// JOB 2: reportar por correo las fallidas pendientes
// ============================================================
export async function reportarFacturasFallidasSat() {
  // Quitar del reporte las que ya fueron anuladas en la BD y las que ya
  // reaparecieron en SAT, para que el correo solo liste fallidas reales.
  await resolverFallidasAnuladas();
  await revalidarPendientes();

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
      <div style="background:#fff4f4;border:1px solid #f0c2c2;border-radius:6px;padding:12px 16px;margin:12px 0;">
        <strong>📌 Acción requerida:</strong> para que estas facturas queden registradas correctamente en SAT,
        hay que <strong>anularlas y volver a facturarlas</strong>. Una vez anuladas en el sistema, dejarán de
        aparecer en este reporte automáticamente.
      </div>
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

  const envio = await sendPlainEmail(
    destinatarios,
    `⚠️ ${pendientes.length} factura(s) no certificada(s) en SAT`,
    html
  );

  // sendPlainEmail NO lanza si Resend falla: resuelve { success:false, error }.
  // Hay que detectarlo para no reportar como enviado algo que no salió.
  if (!envio?.success) {
    console.error(
      `❌ [reportarFacturasFallidasSat] El correo NO se pudo enviar:`,
      envio?.error
    );
    throw new Error(
      `Falló el envío del reporte de facturas fallidas: ${JSON.stringify(envio?.error)}`
    );
  }

  console.log(
    `📧 [reportarFacturasFallidasSat] correo enviado a ${destinatarios.length} destinatario(s) con ${pendientes.length} pendiente(s)`
  );
  return { enviadas: pendientes.length };
}
