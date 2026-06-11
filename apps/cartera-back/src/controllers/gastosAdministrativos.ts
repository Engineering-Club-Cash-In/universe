import { and, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "../database";
import { gastos_administrativos } from "../database/db/schema";

// ============================================================================
// 🧾 GASTOS ADMINISTRATIVOS (manuales, itemizados por día)
//    Para el reporte diario de facturación: "Otros cobros" = Otros ingresos −
//    SUM(gastos del día). Se guardan varios por día (concepto + monto).
// ============================================================================

export async function crearGastoAdministrativo(input: {
  fecha: string; // "YYYY-MM-DD" (America/Guatemala)
  concepto: string;
  monto: number | string;
  created_by?: number | null;
}) {
  const [row] = await db
    .insert(gastos_administrativos)
    .values({
      fecha: input.fecha,
      concepto: input.concepto,
      monto: String(input.monto),
      created_by: input.created_by ?? null,
    })
    .returning();
  return { success: true, data: row };
}

export async function listarGastosAdministrativos(opts: {
  fechaInicio?: string;
  fechaFin?: string;
}) {
  const where = [];
  if (opts.fechaInicio)
    where.push(gte(gastos_administrativos.fecha, opts.fechaInicio));
  if (opts.fechaFin) where.push(lte(gastos_administrativos.fecha, opts.fechaFin));

  const rows = await db
    .select()
    .from(gastos_administrativos)
    .where(where.length ? and(...where) : undefined)
    .orderBy(
      desc(gastos_administrativos.fecha),
      desc(gastos_administrativos.id)
    );

  return { success: true, data: rows };
}

export async function eliminarGastoAdministrativo(id: number) {
  const [row] = await db
    .delete(gastos_administrativos)
    .where(eq(gastos_administrativos.id, id))
    .returning();
  if (!row) return { success: false, message: "Gasto no encontrado" };
  return { success: true, data: row };
}
