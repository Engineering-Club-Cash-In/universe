/**
 * carteraExcelR2
 * ------------------------------------------------------------------
 * Descarga el "Excel" de cartera (en realidad un CSV `;`) desde R2 y lo
 * cachea localmente en /tmp. Solo lo vuelve a bajar si cambió el ETag en R2
 * o si se pide `forceRefresh`. Así podemos cambiar el archivo en R2 sin
 * rebuildear ni redesployar el server.
 *
 * El parseo/lookup reusa la lógica que ya existe en `services/excel.ts`
 * (streaming, sin cargar todo en memoria).
 *
 * NOTA (maqueta): el mapeo columna-Excel → campo-pago todavía está por
 * definir con Daniel. Ver `routers/actualizarPagosExcel.ts`.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { Readable } from "stream";
// Submódulo de streaming de exceljs (sin tipos). Se importa directo para evitar
// que se cargue el módulo csv, que requiere un plugin de dayjs no resoluble en bun.
// @ts-ignore
import WorkbookReader from "exceljs/lib/stream/xlsx/workbook-reader.js";
import { S3Client, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

// El R2_ENDPOINT del .env trae el bucket embebido en la ruta
// (.../r2.cloudflarestorage.com/payments-receipts). El SDK ya agrega el
// Bucket aparte, así que hay que usar el endpoint a NIVEL CUENTA (sin el
// bucket en el path) para no duplicarlo y caer en NoSuchKey.
const accountEndpoint = (process.env.R2_ENDPOINT ?? "").replace(/\/[^/]+\/?$/, "");
const s3 = new S3Client({
  endpoint: accountEndpoint,
  region: "auto",
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
  },
});

// Bucket y key por defecto (se pueden sobreescribir por request).
const BUCKET = process.env.R2_BUCKET as string;
const DEFAULT_KEY = process.env.CARTERA_EXCEL_KEY || "Cartera.xlsx";

// Carpeta de caché local.
const CACHE_DIR = path.join(os.tmpdir(), "cartera-excel-cache");

type DescargaResult = {
  filePath: string;
  etag: string | null;
  fromCache: boolean;
  key: string;
};

function rutaCache(key: string): { dataPath: string; etagPath: string } {
  const safe = key.replace(/[^a-zA-Z0-9._-]/g, "_");
  return {
    dataPath: path.join(CACHE_DIR, safe),
    etagPath: path.join(CACHE_DIR, `${safe}.etag`),
  };
}

/**
 * Descarga el archivo de cartera desde R2, con caché por ETag.
 * @returns ruta local al archivo descargado/cacheado.
 */
export async function descargarCarteraDeR2(opts?: {
  key?: string;
  forceRefresh?: boolean;
}): Promise<DescargaResult> {
  const key = opts?.key || DEFAULT_KEY;
  const { dataPath, etagPath } = rutaCache(key);

  fs.mkdirSync(CACHE_DIR, { recursive: true });

  // 1️⃣ ETag remoto (HeadObject, barato).
  let etagRemoto: string | null = null;
  try {
    const head = await s3.send(
      new HeadObjectCommand({ Bucket: BUCKET, Key: key }),
    );
    etagRemoto = head.ETag ?? null;
  } catch (e: any) {
    console.warn(`⚠️ HeadObject falló para ${key}: ${e?.message}`);
  }

  // 2️⃣ ¿Sirve el caché?
  if (!opts?.forceRefresh && fs.existsSync(dataPath) && etagRemoto) {
    const etagLocal = fs.existsSync(etagPath)
      ? fs.readFileSync(etagPath, "utf8").trim()
      : null;
    if (etagLocal && etagLocal === etagRemoto) {
      console.log(`📦 Cartera desde caché (etag ${etagRemoto}) → ${dataPath}`);
      return { filePath: dataPath, etag: etagRemoto, fromCache: true, key };
    }
  }

  // 3️⃣ Descargar de R2.
  console.log(`⬇️ Descargando cartera de R2: bucket=${BUCKET} key=${key}`);
  const obj = await s3.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
  );
  const body = obj.Body as Readable;
  await new Promise<void>((resolve, reject) => {
    const ws = fs.createWriteStream(dataPath);
    body.pipe(ws);
    body.on("error", reject);
    ws.on("error", reject);
    ws.on("finish", () => resolve());
  });

  const etag = obj.ETag ?? etagRemoto;
  if (etag) fs.writeFileSync(etagPath, etag);
  console.log(`✅ Cartera descargada (${fs.statSync(dataPath).size} bytes) → ${dataPath}`);

  return { filePath: dataPath, etag: etag ?? null, fromCache: false, key };
}

const HEADER_ROW = 2; // headers reales en la 2da fila (row.number es 1-based)

function norm(s: any): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

function num(v: any): number {
  if (v == null || v === "") return 0;
  const n = Number(String(v).replace(/[Q,\s]/gi, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Las celdas de cartera suelen ser fórmulas { formula, result }; saca el valor. */
function cell(x: any): any {
  return x && typeof x === "object" && "result" in x ? (x as any).result : x;
}

/** Convierte un serial de Excel a ISO yyyy-mm-dd (UTC). */
function serialAISO(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400000);
  return new Date(ms).toISOString().slice(0, 10);
}

/** Normaliza cualquier valor de fecha del Excel a ISO yyyy-mm-dd. */
export function aISO(v: any): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") return serialAISO(v);
  const s = String(v).trim();
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  const d = new Date(s);
  return isNaN(+d) ? null : d.toISOString().slice(0, 10);
}

// Pago de cartera (una cuota) extraído del Excel, ya normalizado.
export interface PagoCarteraExcel {
  mes: string; // hoja de origen
  numero_excel: number | null; // columna "#" (puede estar desfasado vs DB)
  fecha_vencimiento: string; // ISO, de la columna "Pago"
  partes: number; // cuántas filas de cartera se sumaron (1 = normal, >1 = crédito partido)
  inversionistas: string[]; // nombres de inversionista de las filas sumadas
  cuota: number; // columna "Cuota" del Excel (0 si la hoja no la trae)
  abono_capital: number;
  abono_interes: number;
  abono_iva_12: number;
  abono_interes_ci: number;
  abono_iva_ci: number;
  abono_seguro: number;
  abono_gps: number;
  membresias: number;
  membresias_pago: number;
  mora: number;
  otros: number;
  pago_del_mes: number;
  total_restante: number;
}

/**
 * Lee el .xlsx de cartera por STREAMING (exceljs WorkbookReader) — una sola
 * pasada por todo el archivo (~13s para 48MB / 100 hojas) sin cargarlo en
 * memoria, y devuelve por crédito un mapa de (fecha_vencimiento ISO → pago).
 *
 * La llave de match es la columna "Pago" del Excel (= fecha de vencimiento de
 * la cuota), NO el número de cuota (que está desfasado vs la DB).
 * Headers en la 2da fila; las celdas de valores son fórmulas (se lee .result).
 */
export async function leerPagosCarteraPorVencimiento(
  filePath: string,
  pedidos: Array<{ sifco: string; vencimientos: string[]; todos?: boolean }>,
  // Pools "raros": un mismo crédito repartido en SIFCOs distintos (no _N). Mapa
  // companion-base (14 díg) → base destino (14 díg). Las filas del companion se
  // reasignan al crédito destino y se suman como una parte más por mes.
  companionToBase?: Map<string, string>,
): Promise<Map<string, Map<string, PagoCarteraExcel>>> {
  // base SIFCO → set de MESES (yyyy-mm) deseados, o "ALL" para traer todos
  // (modo cronológico: se necesitan todas las filas del crédito).
  // El resultado se indexa por mes (yyyy-mm), porque el "Pago" del Excel y la
  // fecha_vencimiento de la DB difieren en días.
  const deseados = new Map<string, Set<string> | "ALL">();
  for (const p of pedidos) {
    const base = p.sifco.replace(/[^0-9]/g, "").padStart(14, "0");
    if (p.todos) {
      deseados.set(base, "ALL");
      continue;
    }
    const prev = deseados.get(base);
    if (prev === "ALL") continue;
    const set = (prev as Set<string>) ?? new Set<string>();
    for (const v of p.vencimientos) if (v) set.add(v.slice(0, 7));
    deseados.set(base, set);
  }

  const resultado = new Map<string, Map<string, PagoCarteraExcel>>();
  if (deseados.size === 0) return resultado;

  // Intermedio: base → venc → (raw SIFCO → fila). Dedup por raw SIFCO (cada
  // inversionista cuenta una sola vez) antes de sumar las partes.
  const intermedio = new Map<
    string,
    Map<string, Map<string, { pago: PagoCarteraExcel; inv: string }>>
  >();

  const wb = new (WorkbookReader as any)(filePath, {
    worksheets: "emit",
    sharedStrings: "cache",
    styles: "ignore",
    hyperlinks: "ignore",
    entries: "ignore",
  });

  for await (const ws of wb) {
    let col: Record<string, number> | null = null;

    for await (const row of ws) {
      const v = row.values as any[]; // 1-indexed; celdas pueden ser { formula, result }

      if (row.number === HEADER_ROW) {
        const find = (pred: (s: string) => boolean) => {
          for (let i = 0; i < v.length; i++) if (pred(norm(cell(v[i])))) return i;
          return -1;
        };
        const findExactRaw = (txt: string) => {
          for (let i = 0; i < v.length; i++) if (String(cell(v[i]) ?? "").trim() === txt) return i;
          return -1;
        };
        const sifco = find((s) => s.includes("credito sifco"));
        if (sifco === -1) {
          col = null;
          continue;
        }
        col = {
          sifco,
          inv: find((s) => s === "inversionista"),
          pago: findExactRaw("Pago"),
          num: findExactRaw("#"),
          cuota: find((s) => s === "cuota"),
          abCap: find((s) => s === "abono capital"),
          abInt: find((s) => s === "abono interes"),
          abIva: find((s) => s === "abono iva 12%"),
          abIntCI: find((s) => s === "abono interes ci"),
          abIvaCI: find((s) => s === "abono iva ci"),
          abSeg: find((s) => s === "abono seguro"),
          abGps: find((s) => s === "abono gps"),
          memb: find((s) => s === "membresias"),
          membPago: find((s) => s === "membresias pago"),
          mora: find((s) => s === "mora"),
          otros: find((s) => s === "otros"),
          pagoMes: find((s) => s === "pago del mes"),
          totRest: find((s) => s.includes("total restante")),
        };
        continue;
      }

      if (!col || col.pago === -1) continue;

      let base = String(cell(v[col.sifco]) ?? "")
        .split("_")[0]
        .replace(/[^0-9]/g, "")
        .padStart(14, "0");
      // Si este SIFCO es companion de otro crédito (pool repartido), se trata
      // como si fuera del crédito destino para que sus filas se sumen ahí.
      if (companionToBase?.has(base)) base = companionToBase.get(base)!;
      const set = deseados.get(base);
      if (!set) continue;

      const venc = aISO(cell(v[col.pago]));
      if (!venc) continue;
      const mes = venc.slice(0, 7); // yyyy-mm
      if (set !== "ALL" && !set.has(mes)) continue;

      const N = (i: number) => (i >= 0 ? num(cell(v[i])) : 0);
      const rawSifco = String(cell(v[col.sifco]) ?? "").trim();
      const inv = col.inv >= 0 ? String(cell(v[col.inv]) ?? "").trim() : "";
      const pago: PagoCarteraExcel = {
        mes: ws.name,
        numero_excel: col.num >= 0 ? num(cell(v[col.num])) : null,
        fecha_vencimiento: venc,
        partes: 1,
        inversionistas: inv ? [inv] : [],
        cuota: N(col.cuota),
        abono_capital: N(col.abCap),
        abono_interes: N(col.abInt),
        abono_iva_12: N(col.abIva),
        abono_interes_ci: N(col.abIntCI),
        abono_iva_ci: N(col.abIvaCI),
        abono_seguro: N(col.abSeg),
        abono_gps: N(col.abGps),
        membresias: N(col.memb),
        membresias_pago: N(col.membPago),
        mora: N(col.mora),
        otros: N(col.otros),
        pago_del_mes: N(col.pagoMes),
        total_restante: N(col.totRest),
      };

      if (!intermedio.has(base)) intermedio.set(base, new Map());
      const porVenc = intermedio.get(base)!;
      if (!porVenc.has(mes)) porVenc.set(mes, new Map());
      const porRaw = porVenc.get(mes)!;
      // Dedup por (raw SIFCO + inversionista): si esta fila aparece en varias
      // hojas, preferimos la que tenga abonos (cuota pagada) sobre la pendiente.
      // OJO: la llave incluye el inversionista porque un crédito "pool" puede
      // tener varios inversionistas bajo el MISMO SIFCO (sin sufijo _N); si solo
      // se usara rawSifco, una fila pisaría a la otra y no se sumarían capitales.
      const dedupKey = `${rawSifco}|${inv}`;
      const prev = porRaw.get(dedupKey);
      if (!prev || pago.abono_capital !== 0 || pago.pago_del_mes !== 0) {
        porRaw.set(dedupKey, { pago, inv });
      }
    }
  }

  // Sumar las partes (créditos partidos) en un solo pago por (base, mes).
  for (const [base, porVenc] of intermedio) {
    const mapVenc = new Map<string, PagoCarteraExcel>();
    for (const [mes, porRaw] of porVenc) {
      const partes = [...porRaw.values()];
      const sumar = (sel: (p: PagoCarteraExcel) => number) =>
        partes.reduce((acc, x) => acc + sel(x.pago), 0);
      const inversionistas = partes
        .map((x) => x.inv)
        .filter((s, i, a) => s && a.indexOf(s) === i);
      const primero = partes[0].pago;
      mapVenc.set(mes, {
        mes: primero.mes,
        numero_excel: primero.numero_excel,
        fecha_vencimiento: primero.fecha_vencimiento,
        partes: partes.length,
        inversionistas,
        cuota: sumar((p) => p.cuota),
        abono_capital: sumar((p) => p.abono_capital),
        abono_interes: sumar((p) => p.abono_interes),
        abono_iva_12: sumar((p) => p.abono_iva_12),
        abono_interes_ci: sumar((p) => p.abono_interes_ci),
        abono_iva_ci: sumar((p) => p.abono_iva_ci),
        abono_seguro: sumar((p) => p.abono_seguro),
        abono_gps: sumar((p) => p.abono_gps),
        membresias: sumar((p) => p.membresias),
        membresias_pago: sumar((p) => p.membresias_pago),
        mora: sumar((p) => p.mora),
        otros: sumar((p) => p.otros),
        pago_del_mes: sumar((p) => p.pago_del_mes),
        total_restante: sumar((p) => p.total_restante),
      });
    }
    resultado.set(base, mapVenc);
  }

  return resultado;
}
