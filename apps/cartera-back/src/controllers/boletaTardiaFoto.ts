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
  llavesYaUsadas: (credito_id: number, intento_id: string, llaves: string[]) => Promise<string[]>;
  ahora?: () => Date;
  timeoutMs?: number;
};
export type RechazoFoto = { status: 400 | 503; message: string };

export const EDAD_MAXIMA_FOTO_MS = 24 * 3_600_000;
export const TIMEOUT_FOTO_MS = 5_000;
export const MENSAJE_FOTO_NO_VERIFICADA = "No se pudo verificar la foto de la boleta; intente de nuevo o registre sin condonación";
const SUBIR_DE_NUEVO = "Suba la foto de la boleta de nuevo y vuelva a intentar.";
const rechazo = (message: string): RechazoFoto => ({ status: 400, message });
const rechazoOnull = (mensaje: string | null): RechazoFoto | null => (mensaje ? rechazo(mensaje) : null);
const noVerificada: RechazoFoto = { status: 503, message: MENSAJE_FOTO_NO_VERIFICADA };

const noExiste = (e: unknown) => {
  const x = e as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  return x?.name === "NotFound" || x?.name === "NoSuchKey" || x?.$metadata?.httpStatusCode === 404;
};

const problemaDeLaFoto = (m: MetadatosFoto, ahora: Date): string | null => {
  if (!m.ContentLength || m.ContentLength <= 0) return `La foto de la boleta está vacía. ${SUBIR_DE_NUEVO}`;
  const tipo = (m.ContentType ?? "").toLowerCase();
  if (!(tipo.startsWith("image/") || tipo === "application/pdf")) return `La foto de la boleta debe ser una imagen o un PDF. ${SUBIR_DE_NUEVO}`;
  if (!(m.LastModified instanceof Date) || ahora.getTime() - m.LastModified.getTime() > EDAD_MAXIMA_FOTO_MS) {
    return `La foto de la boleta se subió hace más de 24 horas. ${SUBIR_DE_NUEVO}`;
  }
  return null;
};

/** `null` = todas las fotos pasan. Cualquier duda (R2 caído, timeout, base caída) falla cerrado con 503. */
export async function verificarFotoBoleta(
  e: { credito_id: number; intento_id: string; llaves: string[] },
  deps: DepsFotoBoleta,
): Promise<RechazoFoto | null> {
  const llaves = [...new Set(e.llaves)];
  const ahora = (deps.ahora ?? (() => new Date()))();
  try {
    if ((await deps.llavesYaUsadas(e.credito_id, e.intento_id, llaves)).length > 0) {
      return rechazo(`La foto de la boleta ya se usó en otro pago. ${SUBIR_DE_NUEVO}`);
    }
  } catch {
    return noVerificada;
  }
  const resultados = await Promise.all(llaves.map(async (llave): Promise<RechazoFoto | null> => {
    try {
      return rechazoOnull(problemaDeLaFoto(await deps.head(llave, AbortSignal.timeout(deps.timeoutMs ?? TIMEOUT_FOTO_MS)), ahora));
    } catch (error) {
      return noExiste(error) ? rechazo(`La foto de la boleta no se encontró en el servidor. ${SUBIR_DE_NUEVO}`) : noVerificada;
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
const llavesYaUsadasReal: DepsFotoBoleta["llavesYaUsadas"] = async (credito_id, intento_id, llaves) => {
  const base = import.meta.env.URL_PUBLIC_R2 ?? "";
  const filas = await db.select({ url: boletas.url_boleta }).from(boletas)
    .innerJoin(pagos_credito, eq(pagos_credito.pago_id, boletas.pago_id))
    .where(and(
      inArray(boletas.url_boleta, llaves.flatMap((l) => [l, `${base}${l}`])),
      eq(pagos_credito.paymentFalse, false),
      // IS DISTINCT FROM: un intento NULL (pago normal) del mismo crédito SÍ cuenta como otro pago.
      or(sql`${pagos_credito.credito_id} IS DISTINCT FROM ${credito_id}`, sql`${pagos_credito.boletaTardiaIntentoId} IS DISTINCT FROM ${intento_id}::uuid`),
    ));
  return llaves.filter((l) => filas.some((f) => f.url === l || f.url === `${base}${l}`));
};

export const depsFotoReales = (): DepsFotoBoleta => ({ head: headReal, llavesYaUsadas: llavesYaUsadasReal });
