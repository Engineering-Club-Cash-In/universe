import { and, asc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "../database";
import { modalidad_facturacion_spread } from "../database/db";

type DbExecutor = Pick<typeof db, "select">;

export type ModalidadFacturacion = "p2p_directa" | "factura_cube" | "factura_cube_pequeno";

export type ModalidadFacturacionSpreadRow = {
  id: number;
  monto_desde: string;
  monto_hasta: string | null;
  modalidad: ModalidadFacturacion;
  spread: string;
  tasa: string;
  created_at: Date | null;
};

/**
 * Devuelve el catálogo completo (todas las combinaciones bracket × modalidad),
 * ordenado por monto_desde y luego por modalidad.
 */
export async function listModalidadFacturacionSpread(
  executor: DbExecutor = db,
): Promise<{ data: ModalidadFacturacionSpreadRow[] }> {
  const rows = await executor
    .select()
    .from(modalidad_facturacion_spread)
    .orderBy(
      asc(modalidad_facturacion_spread.monto_desde),
      asc(modalidad_facturacion_spread.modalidad),
    );

  return { data: rows as ModalidadFacturacionSpreadRow[] };
}

/**
 * Dado un monto aportado, devuelve las 3 modalidades disponibles para ese
 * bracket (cada una con su spread y su tasa), para que el front muestre las
 * opciones. Devuelve [] si el monto no cae en ningún bracket.
 */
export async function listModalidadFacturacionByMonto(
  montoAportado: number,
  executor: DbExecutor = db,
): Promise<{ data: ModalidadFacturacionSpreadRow[] }> {
  // Normalizamos a centavos: los brackets son contiguos a 2 decimales
  // (…100000.00 / 100000.01…), así que un monto con 3+ decimales caería en el
  // hueco entre ellos. Con toFixed(2) siempre cae en un bracket.
  const monto = montoAportado.toFixed(2);

  const rows = await executor
    .select()
    .from(modalidad_facturacion_spread)
    .where(
      and(
        lte(modalidad_facturacion_spread.monto_desde, monto),
        or(
          isNull(modalidad_facturacion_spread.monto_hasta),
          gte(modalidad_facturacion_spread.monto_hasta, monto),
        ),
      ),
    )
    .orderBy(asc(modalidad_facturacion_spread.modalidad));

  return { data: rows as ModalidadFacturacionSpreadRow[] };
}

/**
 * Resuelve la fila única del catálogo para un (monto, modalidad) concreto.
 * Es la fuente de verdad para el % Inversionista de la compra: el backend la
 * usa para NO confiar en el spread que venga del front. Devuelve null si el
 * monto no cae en ningún bracket.
 */
export async function resolveModalidadFacturacionSpread(
  montoAportado: number,
  modalidad: ModalidadFacturacion,
  executor: DbExecutor = db,
): Promise<ModalidadFacturacionSpreadRow | null> {
  // Normalizamos a centavos para no caer en el hueco entre brackets contiguos
  // (ver listModalidadFacturacionByMonto).
  const monto = montoAportado.toFixed(2);

  const [row] = await executor
    .select()
    .from(modalidad_facturacion_spread)
    .where(
      and(
        eq(modalidad_facturacion_spread.modalidad, modalidad),
        lte(modalidad_facturacion_spread.monto_desde, monto),
        or(
          isNull(modalidad_facturacion_spread.monto_hasta),
          gte(modalidad_facturacion_spread.monto_hasta, monto),
        ),
      ),
    )
    .orderBy(asc(modalidad_facturacion_spread.monto_desde));

  return (row as ModalidadFacturacionSpreadRow) ?? null;
}

/**
 * Devuelve las 8 filas (una por bracket) de una modalidad, sin filtrar por
 * monto. Fuente de opciones para la anulación manual del spread: el
 * operador puede elegir cualquiera de estos 8, sin importar el monto de la
 * compra (decisión de negocio).
 */
export async function listModalidadFacturacionSpreadByModalidad(
  modalidad: ModalidadFacturacion,
  executor: DbExecutor = db,
): Promise<{ data: ModalidadFacturacionSpreadRow[] }> {
  const rows = await executor
    .select()
    .from(modalidad_facturacion_spread)
    .where(eq(modalidad_facturacion_spread.modalidad, modalidad))
    .orderBy(asc(modalidad_facturacion_spread.monto_desde));

  return { data: rows as ModalidadFacturacionSpreadRow[] };
}

/**
 * Resuelve una fila del catálogo por su id exacto — usado cuando el
 * operador anula manualmente el bracket resuelto por monto (elige uno de
 * los 8 disponibles para la modalidad). Devuelve null si el id no existe.
 */
export async function getModalidadFacturacionSpreadById(
  id: number,
  executor: DbExecutor = db,
): Promise<ModalidadFacturacionSpreadRow | null> {
  const [row] = await executor
    .select()
    .from(modalidad_facturacion_spread)
    .where(eq(modalidad_facturacion_spread.id, id));

  return (row as ModalidadFacturacionSpreadRow) ?? null;
}
