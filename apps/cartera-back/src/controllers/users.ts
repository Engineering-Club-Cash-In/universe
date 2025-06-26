import { z } from "zod";
import { usuarios } from "../database/db/schema";
import { db } from "../database";
import { eq } from "drizzle-orm"; // Import eq for query conditions
export enum CategoriaUsuario {
  CV_VEHICULO_NUEVO = "CV Vehículo nuevo",
  VEHICULO = "Vehículo",
  CV_VEHICULO = "CV Vehículo",
}
const usuarioSchema = z.object({
    nombre: z.string().max(200),
    nit: z.string().max(30).optional().nullable(),
    categoria: z.nativeEnum(CategoriaUsuario),
    como_se_entero: z.string().max(100).optional().nullable(),
});

export const insertUsers = async ({ body, set }: any) => {
    try {
    const parseResult = usuarioSchema.safeParse(body);

    if (!parseResult.success) {
        set.status = 400;
        return {
        message: "Validation failed",
        errors: parseResult.error.flatten().fieldErrors,
        };
    }

    const usuarioData = parseResult.data;

    const [newUsuario] = await db
      .insert(usuarios)
      .values({
        ...usuarioData,
      })
      .returning();

    set.status = 201;
    return newUsuario;
  } catch (error) {
    set.status = 500;
    return { message: "Error inserting usuario", error: String(error) };
    }
};

 

/**
 * Busca un usuario por nombre. Si no existe, lo crea con los valores recibidos.
 * @param nombre Nombre completo del usuario
 * @param categoria Categoría del usuario (puede ser null)
 * @param nit NIT del usuario (puede ser null)
 * @param como_se_entero Cómo se enteró el usuario (puede ser null)
 * @returns Usuario encontrado o recién creado
 */
export const findOrCreateUserByName = async (
  nombre: string,
  categoria: string | null,
  nit: string | null,
  como_se_entero: string | null
) => {
  try {
    // Buscar usuario por nombre exacto
    const existingUser = await db
      .select()
      .from(usuarios)
      .where(eq(usuarios.nombre, nombre))
      .limit(1);

    if (existingUser.length > 0) {
      return existingUser[0];
    }

    // Si no existe, crear usuario
    const [newUser] = await db
      .insert(usuarios)
      .values({
        nombre,
        categoria,
        nit,
        como_se_entero,
        saldo_a_favor: "0"
      })
      .returning();

    return newUser;
  } catch (error) {
    // Log detallado para depuración
    console.error('[findOrCreateUserByName] Error:', error);

    // Puedes lanzar el error para que lo capture el controlador superior
    throw error;
  }
};
