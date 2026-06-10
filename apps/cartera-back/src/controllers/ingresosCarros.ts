import { and, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "../database";
import { ingresos_carros } from "../database/db/schema";

// ============================================================================
// 🚗 INGRESOS POR CARROS (manuales, itemizados por día)
//    Columna "Ingreso Carros" del Excel. El snapshot suma por día.
// ============================================================================

export async function crearIngresoCarro(input: {
  fecha: string; // "YYYY-MM-DD" (America/Guatemala)
  concepto: string;
  monto: number | string;
  created_by?: number | null;
}) {
  const [row] = await db
    .insert(ingresos_carros)
    .values({
      fecha: input.fecha,
      concepto: input.concepto,
      monto: String(input.monto),
      created_by: input.created_by ?? null,
    })
    .returning();
  return { success: true, data: row };
}

export async function listarIngresosCarros(opts: {
  fechaInicio?: string;
  fechaFin?: string;
}) {
  const where = [];
  if (opts.fechaInicio) where.push(gte(ingresos_carros.fecha, opts.fechaInicio));
  if (opts.fechaFin) where.push(lte(ingresos_carros.fecha, opts.fechaFin));

  const rows = await db
    .select()
    .from(ingresos_carros)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(ingresos_carros.fecha), desc(ingresos_carros.id));

  return { success: true, data: rows };
}

export async function eliminarIngresoCarro(id: number) {
  const [row] = await db
    .delete(ingresos_carros)
    .where(eq(ingresos_carros.id, id))
    .returning();
  if (!row) return { success: false, message: "Ingreso no encontrado" };
  return { success: true, data: row };
}
