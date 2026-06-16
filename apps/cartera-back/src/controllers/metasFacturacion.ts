import { and, desc, eq } from "drizzle-orm";
import { db } from "../database";
import { metas_facturacion } from "../database/db/schema";

// ============================================================================
// 🎯 METAS DE FACTURACIÓN (manuales, por año/mes, globales)
//    1 fila por (anio, mes). Upsert: si ya existe el mes, lo actualiza.
// ============================================================================

export async function upsertMetaFacturacion(input: {
  anio: number;
  mes: number;
  meta_mensual?: number | string;
  meta_semanal?: number | string;
  meta_diaria?: number | string;
  deuda_mensual?: number | string | null;
  deuda_semanal?: number | string | null;
  deuda_diaria?: number | string | null;
}) {
  const num = (v: any) => (v === undefined || v === null ? null : String(v));

  const values = {
    anio: input.anio,
    mes: input.mes,
    meta_mensual: num(input.meta_mensual) ?? "0",
    meta_semanal: num(input.meta_semanal) ?? "0",
    meta_diaria: num(input.meta_diaria) ?? "0",
    deuda_mensual: num(input.deuda_mensual),
    deuda_semanal: num(input.deuda_semanal),
    deuda_diaria: num(input.deuda_diaria),
    updated_at: new Date(),
  };

  const [row] = await db
    .insert(metas_facturacion)
    .values(values)
    .onConflictDoUpdate({
      target: [metas_facturacion.anio, metas_facturacion.mes],
      set: {
        meta_mensual: values.meta_mensual,
        meta_semanal: values.meta_semanal,
        meta_diaria: values.meta_diaria,
        deuda_mensual: values.deuda_mensual,
        deuda_semanal: values.deuda_semanal,
        deuda_diaria: values.deuda_diaria,
        updated_at: values.updated_at,
      },
    })
    .returning();

  return { success: true, data: row };
}

export async function getMetasFacturacion(opts: {
  anio?: number;
  mes?: number;
}) {
  const where = [];
  if (opts.anio) where.push(eq(metas_facturacion.anio, opts.anio));
  if (opts.mes) where.push(eq(metas_facturacion.mes, opts.mes));

  const rows = await db
    .select()
    .from(metas_facturacion)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(metas_facturacion.anio), desc(metas_facturacion.mes));

  return { success: true, data: rows };
}
