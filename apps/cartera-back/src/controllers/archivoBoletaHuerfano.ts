/**
 * Borrar de R2 un archivo de boleta que NO respalda ningún pago.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PARA QUÉ: la retención de PII del bot de cobros (D-14, §10).
 *
 * El bot sube la foto de la boleta a R2 en cuanto la lectura sirve, ANTES de
 * que el cliente confirme. Si nunca confirma, el CRM purga su borrador a los
 * 7 días — pero la foto quedaba en R2 para siempre, y con la fila borrada se
 * perdía la única llave para reclamarla.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * La única regla, y es innegociable: si la llave aparece en `boletas` —el
 * respaldo de un pago real— NO se borra, pase lo que pase. `/upload` renombra
 * todo a `uuid.ext`, así que no hay prefijo que distinga una boleta del bot de
 * cualquier otro documento: el guard es la referencia, no el nombre.
 */

import { sql } from "drizzle-orm";
import { db } from "../database";
import { boletas } from "../database/db/schema";
import { deleteDocumentoFromR2 } from "../utils/functions/uploadsFiles";

// `any` como el resto de los handlers de Elysia del proyecto: el tipado fino
// del contexto lo pelea la inferencia del router.
// biome-ignore lint/suspicious/noExplicitAny: patrón de la casa
export async function borrarArchivoBoletaHuerfano({ query, set }: any) {
  const key = String(query?.key ?? "").trim();

  // Una llave de /upload es `uuid.ext`: nada de rutas, barras ni comodines.
  // Esto también corta cualquier intento de borrar por fuera del patrón.
  if (!/^[0-9a-f-]{36}(\.[A-Za-z0-9]{1,8})?$/i.test(key)) {
    set.status = 400;
    return {
      success: false,
      codigo: "LLAVE_INVALIDA",
      message: "La llave no tiene la forma de un archivo subido por /upload.",
    };
  }

  const [referencia] = await db
    .select({ id: boletas.id })
    .from(boletas)
    .where(
      sql`${boletas.url_boleta} = ${key} OR ${boletas.url_boleta} LIKE ${`%${key}`}`,
    )
    .limit(1);

  if (referencia) {
    set.status = 409;
    return {
      success: false,
      codigo: "ARCHIVO_RESPALDA_UN_PAGO",
      message:
        "Esa boleta está amarrada a un pago registrado: el respaldo de plata que entró no se borra.",
    };
  }

  try {
    await deleteDocumentoFromR2(key);
  } catch (error) {
    console.error(`[archivoBoletaHuerfano] no se pudo borrar ${key}:`, error);
    set.status = 502;
    return {
      success: false,
      codigo: "R2_NO_DISPONIBLE",
      message: "No se pudo borrar el archivo. Reintentar.",
    };
  }

  return { success: true };
}
