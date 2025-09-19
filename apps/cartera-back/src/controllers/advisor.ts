// controllers/advisors.ts
import { db } from '../database/index';
import { asesores } from '../database/db/schema';
import { eq } from 'drizzle-orm';
export const insertAdvisor = async ({ body, set }: any) => {
  try {
    let asesoresToInsert = [];

    // Permitir objeto único o array
    if (Array.isArray(body)) {
      asesoresToInsert = body;
    } else if (typeof body === 'object') {
      asesoresToInsert = [body];
    }

    // Validar que todos tengan nombre
    const isValid = asesoresToInsert.every(a => a.nombre);
    if (!isValid || asesoresToInsert.length === 0) {
      set.status = 400;
      return { message: 'Todos los asesores deben tener nombre.' };
    }

    // Insertar
    const inserted = await db
      .insert(asesores)
      .values(asesoresToInsert.map(({ nombre, activo }) => ({
        nombre,
        activo: typeof activo !== 'undefined' ? activo : true
      })))
      .returning();

    set.status = 201;
    return inserted;
  } catch (error) {
    set.status = 500;
    return { message: 'Error inserting advisors', error: String(error) };
  }
};
  

/**
 * Busca un asesor por nombre. Si no existe, lo crea.
 * @param nombre Nombre del asesor
 * @param activo Estado del asesor (por default: true)
 * @returns Asesor encontrado o recién creado
 */
export const findOrCreateAdvisorByName = async (
  nombre: string,
  activo: boolean = true
) => {
  // Buscar asesor por nombre exacto
  const existingAdvisor = await db
    .select()
    .from(asesores)
    .where(eq(asesores.nombre, nombre))
    .limit(1);

  if (existingAdvisor.length > 0) {
    return existingAdvisor[0];
  }

  // Si no existe, crear asesor
  const [newAdvisor] = await db
    .insert(asesores)
    .values({
      nombre,
      activo
    })
    .returning();

  return newAdvisor;
};

// GET: Obtener asesores (uno o todos, usando id o nombre como filtro)
export const getAdvisors = async ({ query, set }: any) => {
  try {
    // Por id
    if (query.id) {
      const result = await db
        .select()
        .from(asesores)
        .where(eq(asesores.asesor_id, query.id));
      set.status = result.length ? 200 : 404;
      return result.length ? result[0] : { message: "Asesor no encontrado" };
    }

    // Por nombre
    if (query.nombre) {
      const result = await db
        .select()
        .from(asesores)
        .where(eq(asesores.nombre, query.nombre));
      set.status = result.length ? 200 : 404;
      return result.length ? result : { message: "Asesor no encontrado" };
    }

    // Si no hay filtro, regresa todos
    const all = await db.select().from(asesores);
    set.status = 200;
    return all;

  } catch (error) {
    set.status = 500;
    return { message: 'Error fetching advisors', error: String(error) };
  }
};