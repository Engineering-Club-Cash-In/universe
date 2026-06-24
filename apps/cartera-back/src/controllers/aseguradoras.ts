import { asc, sql } from "drizzle-orm";
import { db } from "../database";
import { aseguradoras, creditos } from "../database/db/schema";
import ExcelJS from "exceljs";

type DbExecutor = Pick<typeof db, "select" | "execute" | "insert" | "update">;

/**
 * Devuelve el catálogo de aseguradoras ordenado por nombre.
 *
 * Acepta un executor opcional para facilitar el unit-testing (mock de `../database`).
 */
export async function listAseguradoras(executor: Pick<typeof db, "select"> = db): Promise<{
  data: { id: number; nombre: string }[];
}> {
  const rows = await executor
    .select({ id: aseguradoras.id, nombre: aseguradoras.nombre })
    .from(aseguradoras)
    .orderBy(asc(aseguradoras.nombre));

  return { data: rows };
}

// ─── Tipos de resultado ────────────────────────────────────────────────────────

export type ResumenAseguradora = {
  id: number;
  nombre: string;
  cantidad_creditos: number;
  monto_seguro: string;
};

// ─── resumenAseguradoras ───────────────────────────────────────────────────────

/**
 * Devuelve el resumen de aseguradoras con cantidad de créditos y monto de seguro.
 * LEFT JOIN para que aseguradoras sin créditos aparezcan con 0/0.
 */
export async function resumenAseguradoras(
  executor: Pick<typeof db, "execute"> = db
): Promise<{ data: ResumenAseguradora[] }> {
  const rows = await executor.execute<{
    id: number;
    nombre: string;
    cantidad_creditos: number;
    monto_seguro: string;
  }>(sql`
    SELECT
      a.id,
      a.nombre,
      COUNT(c.credito_id)::int          AS cantidad_creditos,
      COALESCE(SUM(c.seguro_10_cuotas), 0)::text AS monto_seguro
    FROM ${aseguradoras} a
    LEFT JOIN ${creditos} c ON c.aseguradora_id = a.id
    GROUP BY a.id, a.nombre
    ORDER BY a.nombre
  `);

  return { data: rows.rows };
}

/**
 * Genera un Buffer con el Excel del resumen de aseguradoras.
 */
export async function resumenAseguradorasExcel(
  executor: Pick<typeof db, "execute"> = db
): Promise<Buffer> {
  const { data } = await resumenAseguradoras(executor);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Resumen Aseguradoras");
  ws.columns = [
    { header: "Aseguradora", key: "nombre", width: 32 },
    { header: "Cantidad de créditos", key: "cantidad_creditos", width: 20 },
    { header: "Monto de seguro Q", key: "monto_seguro", width: 20 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const r of data) {
    ws.addRow(r);
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// ─── crearAseguradora ──────────────────────────────────────────────────────────

type CrearAseguradoraResult =
  | { success: true; data: { id: number; nombre: string } }
  | { success: false; error: string; status: number };

/**
 * Find-or-create aseguradora por nombre (case-insensitive).
 * Devuelve { success: true, data } o { success: false, error, status }.
 */
export async function crearAseguradora(
  nombre: string,
  executor: Pick<typeof db, "execute" | "insert"> = db
): Promise<CrearAseguradoraResult> {
  if (!nombre || nombre.trim() === "") {
    return { success: false, error: "El campo 'nombre' es obligatorio y no puede estar vacío.", status: 400 };
  }

  const nombreTrim = nombre.trim();

  // Buscar existente (case-insensitive)
  const existing = await executor.execute<{ id: number; nombre: string }>(sql`
    SELECT id, nombre
    FROM ${aseguradoras}
    WHERE LOWER(nombre) = LOWER(${nombreTrim})
    LIMIT 1
  `);

  if (existing.rows.length > 0) {
    return { success: true, data: existing.rows[0] };
  }

  // Insertar nueva. Si choca por unicidad (UNIQUE(nombre) o el índice funcional
  // LOWER(nombre) que evita 'GyT'/'gyt'), otra request la creó en paralelo →
  // devolver la existente. No usamos ON CONFLICT para no depender de cuál índice
  // dispara y para que el código no falle si el índice funcional aún no se aplicó.
  try {
    const inserted = await executor.execute<{ id: number; nombre: string }>(sql`
      INSERT INTO ${aseguradoras} (nombre)
      VALUES (${nombreTrim})
      RETURNING id, nombre
    `);
    return { success: true, data: inserted.rows[0] };
  } catch (error) {
    if ((error as { code?: string })?.code === "23505") {
      const reselect = await executor.execute<{ id: number; nombre: string }>(sql`
        SELECT id, nombre
        FROM ${aseguradoras}
        WHERE LOWER(nombre) = LOWER(${nombreTrim})
        LIMIT 1
      `);
      if (reselect.rows.length > 0) {
        return { success: true, data: reselect.rows[0] };
      }
    }
    throw error;
  }
}

// ─── cambiarAseguradoraCredito ─────────────────────────────────────────────────

type CambiarAseguradoraResult =
  | { success: true }
  | { success: false; error: string; status: number };

/**
 * Cambia la aseguradora de un crédito.
 * Valida que la aseguradora exista (400) y que el crédito exista (404).
 */
export async function cambiarAseguradoraCredito(
  credito_id: number,
  aseguradora_id: number,
  executor: Pick<typeof db, "execute" | "update"> = db
): Promise<CambiarAseguradoraResult> {
  // Validar aseguradora
  const aseg = await executor.execute<{ id: number }>(sql`
    SELECT id FROM ${aseguradoras} WHERE id = ${aseguradora_id} LIMIT 1
  `);
  if (aseg.rows.length === 0) {
    return { success: false, error: `Aseguradora con id ${aseguradora_id} no encontrada.`, status: 400 };
  }

  // Validar crédito
  const cred = await executor.execute<{ credito_id: number }>(sql`
    SELECT credito_id FROM ${creditos} WHERE credito_id = ${credito_id} LIMIT 1
  `);
  if (cred.rows.length === 0) {
    return { success: false, error: `Crédito con id ${credito_id} no encontrado.`, status: 404 };
  }

  // Actualizar
  await executor.execute(sql`
    UPDATE ${creditos}
    SET aseguradora_id = ${aseguradora_id}
    WHERE credito_id = ${credito_id}
  `);

  return { success: true };
}
