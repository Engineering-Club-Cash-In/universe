import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "../database";
import { boletas, pagos_credito } from "../database/db";

/**
 * La condonación por boleta tardía perdona plata con la foto como único control antifraude. `url_boletas` solo se valida por
 * FORMA (registerPaymentPolicy); acá se comprueba que la foto EXISTA en R2, que sea reciente y que no sea de otro pago.
 */
export type MetadatosFoto = { ContentLength?: number; ContentType?: string; LastModified?: Date };
export type HeadFoto = (llave: string, signal: AbortSignal) => Promise<MetadatosFoto>;
export type DepsFotoBoleta = {
  head: HeadFoto;
  /** Llaves (de `llaves`) que ya cuelgan de OTRO pago vivo, sin contar las filas del mismo crédito con el mismo intento. */
  llavesYaUsadas: (credito_id: number, intento_id: string, llaves: string[], signal: AbortSignal) => Promise<string[]>;
  ahora?: () => Date;
  timeoutMs?: number;
};
export type MotivoFoto = "no_existe" | "vacia" | "tipo_invalido" | "vieja" | "reusada" | "error_r2" | "timeout" | "error_base" | "demasiadas";
/** `detalle` va al log estructurado (nunca al cliente): solo metadatos del objeto o `name`/status del error; jamás mensajes de error, credenciales ni URLs. */
export type RechazoFoto = { status: 400 | 503; message: string; motivo: MotivoFoto; llave?: string; detalle?: Record<string, unknown> };

/** Mismo tope que el formulario de pago (carteraFront hooks/registerPayment.ts: "hasta 3 archivos de boleta"). */
export const MAX_FOTOS_BOLETA = 3;
export const EDAD_MAXIMA_FOTO_MS = 24 * 3_600_000;
export const TIMEOUT_FOTO_MS = 5_000;
export const TIMEOUT_CONSULTA_REUSO = "3s";
export const MENSAJE_FOTO_NO_VERIFICADA = "No se pudo verificar la foto de la boleta; intente de nuevo o registre sin condonación";
const SUBIR_DE_NUEVO = "Suba la foto de la boleta de nuevo y vuelva a intentar.";
const MENSAJE_FORMATO = "La foto de la boleta debe ser una imagen (.jpg, .jpeg, .png) o un PDF.";
const MENSAJE_REUSO = "Esta boleta ya está asociada a otro pago; verifique la boleta antes de condonar.";
const rechazo = (motivo: MotivoFoto, message: string, llave: string, detalle?: Record<string, unknown>): RechazoFoto => ({ status: 400, message, motivo, llave, detalle });
const noVerificada = (motivo: MotivoFoto, llave?: string, detalle?: Record<string, unknown>): RechazoFoto => ({ status: 503, message: MENSAJE_FOTO_NO_VERIFICADA, motivo, llave, detalle });

type ErrorSdk = { name?: string; $metadata?: { httpStatusCode?: number } } | null;
const noExiste = (e: unknown) => {
  const x = e as ErrorSdk;
  return x?.name === "NotFound" || x?.name === "NoSuchKey" || x?.$metadata?.httpStatusCode === 404;
};
const detalleError = (e: unknown) => ({ error_name: (e as ErrorSdk)?.name ?? null, http_status: (e as ErrorSdk)?.$metadata?.httpStatusCode ?? null });

/** Sin tipo útil (R2 guarda octet-stream o nada) solo vale si la extensión de la llave es de imagen/PDF. */
const EXTENSION_ADMITIDA = /\.(jpe?g|png|pdf)$/i;
const tipoAdmitido = (tipo: string, llave: string) =>
  tipo.startsWith("image/") || tipo === "application/pdf" || ((tipo === "" || tipo === "application/octet-stream") && EXTENSION_ADMITIDA.test(llave));

const problemaDeLaFoto = (m: MetadatosFoto, llave: string, ahora: Date): RechazoFoto | null => {
  const detalle = { content_type: m.ContentType ?? null, content_length: m.ContentLength ?? null, last_modified: m.LastModified instanceof Date ? m.LastModified.toISOString() : null };
  if (!m.ContentLength || m.ContentLength <= 0) return rechazo("vacia", `La foto de la boleta está vacía. ${SUBIR_DE_NUEVO}`, llave, detalle);
  if (!tipoAdmitido((m.ContentType ?? "").toLowerCase(), llave)) return rechazo("tipo_invalido", MENSAJE_FORMATO, llave, detalle);
  if (!(m.LastModified instanceof Date) || ahora.getTime() - m.LastModified.getTime() > EDAD_MAXIMA_FOTO_MS) {
    return rechazo("vieja", `La foto de la boleta se subió hace más de 24 horas. ${SUBIR_DE_NUEVO}`, llave, detalle);
  }
  return null;
};

/** Corta una espera que no respeta señales (p. ej. conseguir conexión del pool). */
const conTope = <T>(p: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>;
  const tope = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error("tope"), { name: "TimeoutError" })), ms); });
  return Promise.race([p, tope]).finally(() => clearTimeout(timer));
};

/** `null` = todas las fotos pasan. Cualquier duda (R2 caído, timeout, base caída) falla cerrado con 503. */
export async function verificarFotoBoleta(
  e: { credito_id: number; intento_id: string; llaves: string[] },
  deps: DepsFotoBoleta,
): Promise<RechazoFoto | null> {
  // Antes de deduplicar, consultar la base o lanzar HEADs: el tope cuenta las llaves crudas (4 copias de una también se rechazan).
  if (e.llaves.length > MAX_FOTOS_BOLETA) {
    return { status: 400, motivo: "demasiadas", message: `Se permiten hasta ${MAX_FOTOS_BOLETA} fotos de la boleta por pago; quite las sobrantes y vuelva a intentar.`, detalle: { cantidad: e.llaves.length } };
  }
  const llaves = [...new Set(e.llaves)];
  const ahora = (deps.ahora ?? (() => new Date()))();
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_FOTO_MS;
  try {
    const usadas = await conTope(deps.llavesYaUsadas(e.credito_id, e.intento_id, llaves, AbortSignal.timeout(timeoutMs)), timeoutMs);
    if (usadas.length > 0) return rechazo("reusada", MENSAJE_REUSO, usadas[0]);
  } catch (error) {
    return noVerificada((error as ErrorSdk)?.name === "TimeoutError" ? "timeout" : "error_base", undefined, detalleError(error));
  }
  const resultados = await Promise.all(llaves.map(async (llave): Promise<RechazoFoto | null> => {
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      return problemaDeLaFoto(await deps.head(llave, signal), llave, ahora);
    } catch (error) {
      if (noExiste(error)) return rechazo("no_existe", `La foto de la boleta no se encontró en el servidor. ${SUBIR_DE_NUEVO}`, llave, detalleError(error));
      return noVerificada(signal.aborted ? "timeout" : "error_r2", llave, detalleError(error));
    }
  }));
  // Si alguna no se pudo verificar manda el 503 (reintentable); si no, el primer 400.
  return resultados.find((r) => r?.status === 503) ?? resultados.find((r) => r !== null) ?? null;
}

const headReal: HeadFoto = async (llave, signal) => {
  // Mismo cliente S3/R2 que la subida (`POST /upload`): misma config y misma Key (la llave tal cual, sin prefijo propio).
  const { s3 } = await import("../utils/functions/uploadsFiles");
  return s3.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: llave }), { abortSignal: signal });
};

/** `boletas.url_boleta` guarda `URL_PUBLIC_R2 + llave`; se acepta también la llave sola por si alguna fila vieja la trae así. */
const llavesYaUsadasReal: DepsFotoBoleta["llavesYaUsadas"] = async (credito_id, intento_id, llaves, signal) => {
  const base = import.meta.env.URL_PUBLIC_R2 ?? "";
  // Transacción de solo lectura con tope propio: si la consulta se cuelga, el 503 llega antes de que la petición se quede esperando.
  const filas = await db.transaction(async (tx) => {
    signal.throwIfAborted(); // pg-pool no deja sacar de la cola el pedido de conexión: si el tope venció esperando, se suelta sin consultar.
    await tx.execute(sql`SELECT set_config('statement_timeout', ${TIMEOUT_CONSULTA_REUSO}, true)`);
    return tx.select({ url: boletas.url_boleta }).from(boletas)
    .innerJoin(pagos_credito, eq(pagos_credito.pago_id, boletas.pago_id))
    .where(and(
      inArray(boletas.url_boleta, llaves.flatMap((l) => [l, `${base}${l}`])),
      eq(pagos_credito.paymentFalse, false),
      // IS DISTINCT FROM: un intento NULL (pago normal) del mismo crédito SÍ cuenta como otro pago.
      or(sql`${pagos_credito.credito_id} IS DISTINCT FROM ${credito_id}`, sql`${pagos_credito.boletaTardiaIntentoId} IS DISTINCT FROM ${intento_id}::uuid`),
    ));
  }, { accessMode: "read only" });
  return llaves.filter((l) => filas.some((f) => f.url === l || f.url === `${base}${l}`));
};

export const depsFotoReales = (): DepsFotoBoleta => ({ head: headReal, llavesYaUsadas: llavesYaUsadasReal });
