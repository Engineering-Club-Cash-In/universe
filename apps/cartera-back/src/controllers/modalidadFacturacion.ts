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
  const monto = String(montoAportado);

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
  const monto = String(montoAportado);

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
