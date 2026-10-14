/**
 * Borrado en R2 del comprobante PNG de un pago Nexa cuando se borra el pago (CAÍDO, reducción de
 * plazo, ajuste con SIFCO). Aparte de nexaBoletaImagen.ts para no arrastrar Puppeteer ni la BD.
 *
 * Solo en producción (config.environment: el LOG_ENVIRONMENT que el deploy hornea en la imagen).
 * DEV y local comparten el bucket y pueden tener URLs de PROD en `boletas`: ahí, solo un log.
 * Fuera a propósito: reversePayment (solo anula filas de eventos `failed`, que no tienen
 * comprobante, y placeholders en cero) y las herramientas de administración recalculateFromJson,
 * processFromExcelFull y migration.ts. Queda expuesto: la URL ya entregada sirve hasta el borrado,
 * más lo que retenga la caché del CDN.
 */
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import config from "../config";
import { s3 } from "../utils/functions/uploadsFiles";

export const conTope = <T>(trabajo: Promise<T>, ms: number): Promise<T> => new Promise<T>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`tiempo agotado (${ms} ms)`)), ms);
  trabajo.then(
    (valor) => { clearTimeout(timer); resolve(valor); },
    (error) => { clearTimeout(timer); reject(error); },
  );
});

/** Misma ruta que la subida (nexaBoletaImagen.ts): el cliente `s3` y R2_BUCKET. */
export const borrarObjetoBoletaNexa = async (key: string) => {
  await s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
};

/** La key desde `boletas-nexa/`, sin depender de URL_PUBLIC_R2 (puede cambiar). Otra cosa: null. */
export function keyDeUrlBoletaNexa(url: string): string | null {
  const inicio = url.indexOf("boletas-nexa/");
  const key = inicio < 0 ? "" : url.slice(inicio);
  return /^boletas-nexa\/[0-9a-f-]{36}\.png$/.test(key) ? key : null;
}

const log = (nivel: "info" | "error", extra: Record<string, unknown>) =>
  console[nivel](JSON.stringify({ level: nivel, paso: "borrar_r2_tras_borrar_pago", ...extra }));

const depsReales = {
  produccion: () => config.environment === "production",
  borrar: borrarObjetoBoletaNexa,
  timeoutMs: 30_000,
};

/** Best-effort: nunca rechaza; uno por uno con tope; si falla, queda la key en el log para borrarlo a mano. */
export async function borrarComprobantesNexaDeR2BestEffort(urls: readonly string[], deps = depsReales) {
  try {
    const keys = urls.map(keyDeUrlBoletaNexa).filter((key): key is string => key !== null);
    // No es un PNG generado por cartera (p. ej. una boleta subida a mano): nunca se borra.
    if (keys.length < urls.length) {
      log("error", { event: "nexa.boleta_imagen.error", error: "url no reconocida", ignoradas: urls.length - keys.length });
    }
    if (keys.length === 0) return;
    if (!deps.produccion()) {
      log("info", { event: "nexa.boleta_imagen.r2_no_borrado", motivo: "fuera_de_produccion", cantidad: keys.length });
      return;
    }
    for (const key of keys) {
      try {
        await conTope(deps.borrar(key), deps.timeoutMs);
      } catch (error) {
        log("error", { event: "nexa.boleta_imagen.error", key, error: error instanceof Error ? error.message : String(error) });
      }
    }
  } catch (error) {
    log("error", { event: "nexa.boleta_imagen.error", error: String(error) });
  }
}
