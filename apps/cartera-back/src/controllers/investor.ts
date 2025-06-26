// app.ts (o donde declares tus rutas Elysia)
import { Elysia } from 'elysia';
import { db } from '../database/index'
import { inversionistas } from '../database/db/schema'
import { eq } from 'drizzle-orm';
export const insertInvestor = async ({ body, set }: any) => {
  try {
    let inversionistasToInsert = [];

    // Permitir un solo objeto o un arreglo
    if (Array.isArray(body)) {
      inversionistasToInsert = body;
    } else if (typeof body === 'object') {
      inversionistasToInsert = [body];
    }
 
 
    // Validación: todos deben tener nombre y emite_factura
    const isValid = inversionistasToInsert.every(
      inv => inv.nombre && typeof inv.emite_factura !== 'undefined'
    );
    if (!isValid || inversionistasToInsert.length === 0) {
      set.status = 400;
      return { message: 'Todos los inversionistas deben tener nombre y emite_factura.' };
    }

    // Puedes incluir 'categoria_pago' si tu modelo lo espera
    const inserted = await db
      .insert(inversionistas)
      .values(inversionistasToInsert.map(({ nombre, emite_factura, categoria_pago }) => ({
        nombre,
        emite_factura,
        categoria_pago: categoria_pago ?? null
      })))
      .returning();

    set.status = 201;
    return inserted;
  } catch (error) {
    set.status = 500;
    return { message: 'Error inserting investors', error: String(error) };
  }
};

// GET: Obtener inversionistas (uno o todos)
export const getInvestors = async ({ query, set }: any) => {
  try {
    // Si quieres buscar por ID
    if (query.id) {
      const result = await db
        .select()
        .from(inversionistas)
        .where(eq(inversionistas.inversionista_id, query.id));
      set.status = result.length ? 200 : 404;
      return result.length ? result[0] : { message: "Inversionista no encontrado" };
    }

    // Si quieres buscar por nombre
    if (query.nombre) {
      const result = await db
        .select()
        .from(inversionistas)
        .where(eq(inversionistas.nombre, query.nombre));
      set.status = result.length ? 200 : 404;
      return result.length ? result : { message: "Inversionista no encontrado" };
    }

    // Si no hay query, trae todos
    const all = await db.select().from(inversionistas);
    set.status = 200;
    return all;

  } catch (error) {
    set.status = 500;
    return { message: 'Error al consultar inversionistas', error: String(error) };
  }
};