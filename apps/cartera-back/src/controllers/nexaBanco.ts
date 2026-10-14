/**
 * Banco con que se registran los pagos de Nexa (columna Banco de la tabla de
 * pagos). Es la fila "Nexa" de `cartera.bancos` (en PROD, banco_id 26): se
 * busca por nombre sin importar mayúsculas y, si hubiera varias, gana la de
 * menor banco_id.
 *
 * Nunca lanza ni demora el pago: si la fila no existe, la lectura falla o
 * tarda más de 2 s (corre dentro del candado del crédito), el pago se registra
 * sin banco, como antes. Solo se recuerda el hallazgo; el
 * "no está" se vuelve a buscar en el siguiente pago, y el aviso en el log sale
 * a lo sumo una vez cada 30 minutos.
 */

import { sql } from "drizzle-orm";
import { db } from "../database";

const MINUTOS_ENTRE_AVISOS = 30;
export const TOPE_LECTURA_BANCO_NEXA_MS = 2_000;
let bancoNexaEncontrado: number | undefined;
let ultimoAviso = Number.NEGATIVE_INFINITY;

async function leerBancoNexa(): Promise<number | null> {
  const result = await db.execute(sql`
    SELECT banco_id FROM cartera.bancos
    WHERE lower(trim(nombre)) = 'nexa'
    ORDER BY banco_id
    LIMIT 1
  `);
  const fila = result.rows[0] as { banco_id?: number | string } | undefined;
  const id = Number(fila?.banco_id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function bancoNexaId(
  leer: () => Promise<number | null> = leerBancoNexa,
  ahora: number = Date.now(),
  topeMs: number = TOPE_LECTURA_BANCO_NEXA_MS,
): Promise<number | null> {
  if (bancoNexaEncontrado !== undefined) return bancoNexaEncontrado;
  let error: unknown;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const lectura = leer();
    // Si vence el tope, la lectura sigue sola: su rechazo tardío no queda suelto.
    lectura.catch(() => undefined);
    const id = await Promise.race([
      lectura,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`sin respuesta en ${topeMs} ms`)), topeMs);
      }),
    ]);
    if (id !== null) {
      bancoNexaEncontrado = id;
      return id;
    }
  } catch (e) {
    error = e;
  } finally {
    clearTimeout(timer);
  }
  if (ahora - ultimoAviso >= MINUTOS_ENTRE_AVISOS * 60_000) {
    ultimoAviso = ahora;
    console.warn(JSON.stringify({
      level: "warn",
      event: "nexa.banco.no_encontrado",
      detalle: error === undefined
        ? "No hay banco 'Nexa' en cartera.bancos: el pago se registra sin banco"
        : "No se pudo leer el banco 'Nexa': el pago se registra sin banco",
      ...(error === undefined ? {} : { error: error instanceof Error ? error.message : String(error) }),
    }));
  }
  return null;
}

/** Solo para pruebas. */
export function reiniciarBancoNexa() {
  bancoNexaEncontrado = undefined;
  ultimoAviso = Number.NEGATIVE_INFINITY;
}
