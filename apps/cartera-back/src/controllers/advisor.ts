// controllers/advisors.ts
import { db } from '../database/index';
import { asesores, platform_users } from '../database/db/schema';
import { eq } from 'drizzle-orm';
import bcrypt from "bcrypt";
export const insertAdvisor = async ({ body, set }: any) => {
  try {
    let asesoresToInsert = [];

    // Permitir objeto único o array
    if (Array.isArray(body)) {
      asesoresToInsert = body;
    } else if (typeof body === "object") {
      asesoresToInsert = [body];
    }

    // Validar que todos tengan nombre y correo
    const isValid = asesoresToInsert.every(
      (a) => a.nombre && a.email && a.password
    );
    if (!isValid || asesoresToInsert.length === 0) {
      set.status = 400;
      return {
        message: "Todos los asesores deben tener nombre, email y password.",
      };
    }

    // Insertar asesores
    const insertedAdvisors = await db
      .insert(asesores)
      .values(
        asesoresToInsert.map(({ nombre, activo }) => ({
          nombre,
          activo: typeof activo !== "undefined" ? activo : true,
        }))
      )
      .returning();

    // Insertar en platform_users (uno por cada asesor)
    for (let i = 0; i < insertedAdvisors.length; i++) {
      const asesor = insertedAdvisors[i];
      const { email, password } = asesoresToInsert[i];

      await db.insert(platform_users).values({
        email,
        password_hash: await bcrypt.hash(password, 10),
        role: "ASESOR",
        is_active: true,
        asesor_id: asesor.asesor_id,
      });
    }

    set.status = 201;
    return insertedAdvisors;
  } catch (error) {
    console.error("❌ Error insertAdvisor:", error);
    set.status = 500;
    return { message: "Error inserting advisors", error: String(error) };
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
        .select({
          asesor_id: asesores.asesor_id,
          nombre: asesores.nombre,
          activo: asesores.activo,
          email: platform_users.email,     // 👈 solo correo
          is_active: platform_users.is_active, // 👈 solo estado activo
        })
        .from(asesores)
        .leftJoin(
          platform_users,
          eq(asesores.asesor_id, platform_users.asesor_id)
        )
        .where(eq(asesores.asesor_id, Number(query.id)));

      set.status = result.length ? 200 : 404;
      return result.length ? result[0] : { message: "Asesor no encontrado" };
    }

    // Por nombre
    if (query.nombre) {
      const result = await db
        .select({
          asesor_id: asesores.asesor_id,
          nombre: asesores.nombre,
          activo: asesores.activo,
          email: platform_users.email,
          is_active: platform_users.is_active,
        })
        .from(asesores)
        .leftJoin(
          platform_users,
          eq(asesores.asesor_id, platform_users.asesor_id)
        )
        .where(eq(asesores.nombre, query.nombre));

      set.status = result.length ? 200 : 404;
      return result.length ? result : { message: "Asesor no encontrado" };
    }

    // Si no hay filtro → traer todos
    const all = await db
      .select({
        asesor_id: asesores.asesor_id,
        nombre: asesores.nombre,
        activo: asesores.activo,
        email: platform_users.email,
        is_active: platform_users.is_active,
      })
      .from(asesores)
      .leftJoin(
        platform_users,
        eq(asesores.asesor_id, platform_users.asesor_id)
      );

    set.status = 200;
    return all;
  } catch (error) {
    set.status = 500;
    return { message: "Error fetching advisors", error: String(error) };
  }
};
export const updateAdvisor = async ({ query, body, set }: any) => {
  try {
    console.log(query);
    console.log(body);
    const { id } = query;
    console.log(id);
    if (!id) {
      set.status = 400;
      return { message: "El parámetro 'id' es obligatorio." };
    }
    console.log(id);
    console.log(body);
    // Validar body
    if (!body || Object.keys(body).length === 0) {
      set.status = 400;
      return { message: "Debe proporcionar campos para actualizar." };
    }

    const { nombre, activo, email, password } = body;

    // 1. Actualizar datos en tabla asesores
    const updatedAdvisor = await db
      .update(asesores)
      .set({
        ...(nombre !== undefined ? { nombre } : {}),
        ...(activo !== undefined ? { activo } : {}),
      })
      .where(eq(asesores.asesor_id, Number(id)))
      .returning();

    if (!updatedAdvisor.length) {
      set.status = 404;
      return { message: "Asesor no encontrado." };
    }

    // 2. Si se pasa email o password → actualizar en platform_users
    if (email || password) {
      const updateUser: any = {};
      if (email) updateUser.email = email;
    if (password) {
  updateUser.password_hash = await bcrypt.hash(password, 10);
}
      await db
        .update(platform_users)
        .set(updateUser)
        .where(eq(platform_users.asesor_id, Number(id)));
    }

    set.status = 200;
    return { message: "Asesor actualizado correctamente", data: updatedAdvisor[0] };
  } catch (error: any) {
    set.status = 500;
    return { message: "Error actualizando asesor", error: error.message };
  }
};