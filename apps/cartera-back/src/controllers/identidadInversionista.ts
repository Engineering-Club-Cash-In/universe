import { db } from "../database/index";
import { inversionistas } from "../database/db/schema";
import { asc, eq, or, sql } from "drizzle-orm";
import {
  normalizarDpiParaComparar,
  esEmpresaRepresentada,
} from "../utils/functions/provisionamientoPortal";

/**
 * ¿Quién es la PERSONA detrás de este DPI o de este correo?
 *
 * Lo usa el alta del CRM: cuando conta escribe un DPI o un correo que ya
 * existe, no está duplicando por error — está por dar de alta la empresa de
 * alguien que ya es inversionista. Antes eso rebotaba con "ya existe" y conta
 * tenía que inventarse un correo, que es justo lo que llenó producción de
 * correos falsos.
 *
 * Devuelve siempre a la PERSONA, no a la fila que casó. Si el correo que
 * escribieron es el de una sociedad, se salta a su representante: el humano es
 * el que puede representar a otra empresa, la sociedad no.
 */

export interface IdentidadInversionista {
  /** La persona: la fila con DPI propio. */
  inversionista_id: number;
  nombre: string;
  /** Correo con el que esta persona entra al portal. Puede ser null. */
  email: string | null;
  /** Su DPI, normalizado (dígitos, sin ceros a la izquierda). */
  dpi: string;
  /** Cómo se llegó a ella: por el dato escrito, o por la sociedad que lo tenía. */
  via: "directo" | "representante_de_la_sociedad";
  /** Razón social de la sociedad por la que se llegó, cuando `via` no es directo. */
  sociedad: string | null;
}

type Fila = typeof inversionistas.$inferSelect;

/** La fila que casó con lo que escribieron, o null. */
const buscarFila = async (
  dpi: string | null,
  email: string | null,
): Promise<Fila | null> => {
  const condiciones = [];

  const dpiNormalizado = normalizarDpiParaComparar(dpi);
  if (dpiNormalizado !== null) {
    // `dpi` es bigint: se compara numéricamente. Un DPI de más de 18 dígitos no
    // puede existir en la columna, así que no se intenta castear.
    if (dpiNormalizado.length <= 18) {
      condiciones.push(eq(inversionistas.dpi, Number(dpiNormalizado)));
    }
    // También puede ser el DPI de alguien que solo figura como representante.
    // Se compara como TEXTO sin ceros a la izquierda, igual que
    // `normalizarDpiParaComparar`: `dpi_rep_legal` admite 20 dígitos y un
    // bigint topa en 19, así que castear podría desbordar.
    condiciones.push(
      sql`NULLIF(ltrim(regexp_replace(coalesce(${inversionistas.dpi_rep_legal}, ''), '\\D', '', 'g'), '0'), '') = ${dpiNormalizado}`,
    );
  }

  const emailLimpio = (email ?? "").trim().toLowerCase();
  if (emailLimpio) {
    condiciones.push(sql`lower(${inversionistas.email}) = ${emailLimpio}`);
  }

  if (condiciones.length === 0) return null;

  const filas = await db
    .select()
    .from(inversionistas)
    .where(or(...condiciones))
    // El orden ES la decisión: un correo puede ser de varias filas (89 y 97
    // comparten uno en producción) y sin desempate ganaba la que Postgres
    // devolviera primero.
    //
    // 1. La persona primero: si el dato casa con una sociedad Y con su
    //    representante, interesa el humano.
    // 2. Entre filas sin DPI propio, la que al menos apunta a un representante.
    //    Es justo el caso de 89 y 97: ninguna es una persona y solo una tiene
    //    `dpi_rep_legal`, así que quedarse con la otra devolvía `null` y el CRM
    //    no detectaba nada — el alta de la empresa rebotaba como duplicada.
    // 3. Por id, para que el resultado no dependa nunca del orden físico.
    .orderBy(
      sql`${inversionistas.dpi} IS NULL`,
      sql`NULLIF(btrim(coalesce(${inversionistas.dpi_rep_legal}, '')), '') IS NULL`,
      asc(inversionistas.inversionista_id),
    )
    .limit(1);

  return filas[0] ?? null;
};

/** La fila personal de un representante, buscada por su DPI. */
const buscarPersonaPorDpi = async (
  dpiNormalizado: string,
): Promise<Fila | null> => {
  if (dpiNormalizado.length > 18) return null;

  const filas = await db
    .select()
    .from(inversionistas)
    .where(eq(inversionistas.dpi, Number(dpiNormalizado)))
    .limit(1);

  return filas[0] ?? null;
};

export const buscarIdentidad = async (
  dpi: string | null,
  email: string | null,
): Promise<IdentidadInversionista | null> => {
  const fila = await buscarFila(dpi, email);
  if (!fila) return null;

  // Casó con una sociedad: la persona es su representante.
  if (esEmpresaRepresentada(fila)) {
    const dpiRep = normalizarDpiParaComparar(fila.dpi_rep_legal);
    if (!dpiRep) return null;

    const persona = await buscarPersonaPorDpi(dpiRep);
    // Sin fila personal no hay a quién señalar. Se devuelve null en vez de
    // inventar una identidad a partir de un DPI suelto.
    if (!persona) return null;

    return {
      inversionista_id: persona.inversionista_id,
      nombre: persona.nombre,
      email: persona.email,
      dpi: dpiRep,
      via: "representante_de_la_sociedad",
      sociedad: fila.nombre,
    };
  }

  const dpiPropio = normalizarDpiParaComparar(fila.dpi);
  // Una fila sin DPI propio y sin representante no identifica a nadie: no se
  // puede usar como representante de una empresa nueva.
  if (!dpiPropio) return null;

  return {
    inversionista_id: fila.inversionista_id,
    nombre: fila.nombre,
    email: fila.email,
    dpi: dpiPropio,
    via: "directo",
    sociedad: null,
  };
};
