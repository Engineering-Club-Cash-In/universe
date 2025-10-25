import { z } from "zod";
import { creditos, usuarios } from "../database/db/schema";
import { db } from "../database";
import { eq, inArray, and } from "drizzle-orm"; // Import eq for query conditions
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
        saldo_a_favor: "0",
      })
      .returning();

    return newUser;
  } catch (error) {
    // Log detallado para depuración
    console.error("[findOrCreateUserByName] Error:", error);

    // Puedes lanzar el error para que lo capture el controlador superior
    throw error;
  }
};

export interface UsuarioConCreditosSifco {
  usuario_id: number;
  nombre: string;
  nit?: string | null;
  categoria?: string | null;
  como_se_entero?: string | null;
  saldo_a_favor: string;
  numeros_credito_sifco: string[];
}

export async function getUsersWithSifco(user?: any): Promise<UsuarioConCreditosSifco[]> {
  try {
    // 🔐 Obtener info del usuario
    const isAdmin = user?.role === "ADMIN";
    const asesorId = user?.asesor_id;

    console.log("👤 Usuario autenticado:", { role: user?.role, asesor_id: asesorId, isAdmin });

    // 📌 Construir condiciones dinámicas
    const conditions: any[] = [
      inArray(creditos.statusCredit, ["ACTIVO", "PENDIENTE_CANCELACION", "MOROSO"])
    ];
    console.log(asesorId)
    // 🔒 Si NO es admin y tiene asesor_id, filtrar solo sus créditos
if (!isAdmin && asesorId !== null && asesorId !== undefined) {
      console.log(`🔒 Usuario es asesor. Filtrando por asesor_id: ${asesorId}`);
      conditions.push(eq(creditos.asesor_id, asesorId));
    } else if (isAdmin) {
      console.log(`✅ Usuario es ADMIN. Mostrando todos los créditos`);
    } else {
      console.log(`⚠️ Usuario sin asesor_id asignado. Mostrando todos los créditos`);
    }

    // 1. Hacemos INNER JOIN para traer solo usuarios CON crédito
    const rows = await db
      .select({
        usuario_id: usuarios.usuario_id,
        nombre: usuarios.nombre,
        nit: usuarios.nit,
        categoria: usuarios.categoria,
        como_se_entero: usuarios.como_se_entero,
        saldo_a_favor: usuarios.saldo_a_favor,
        numero_credito_sifco: creditos.numero_credito_sifco,
      })
      .from(usuarios)
      .innerJoin(creditos, eq(usuarios.usuario_id, creditos.usuario_id))
      .where(and(...conditions));

    console.log(`📊 Registros encontrados: ${rows.length}`);

    // 2. Agrupamos los SIFCOs por usuario
    const agrupado: Record<number, UsuarioConCreditosSifco> = {};

    for (const row of rows) {
      if (!agrupado[row.usuario_id]) {
        agrupado[row.usuario_id] = {
          usuario_id: row.usuario_id,
          nombre: row.nombre,
          nit: row.nit,
          categoria: row.categoria,
          como_se_entero: row.como_se_entero,
          saldo_a_favor: row.saldo_a_favor,
          numeros_credito_sifco: [],
        };
      }
      agrupado[row.usuario_id].numeros_credito_sifco.push(
        row.numero_credito_sifco
      );
    }

    const result = Object.values(agrupado);
    console.log(`✅ Usuarios agrupados: ${result.length}`);

    return result;
  } catch (error) {
    console.error("[ERROR] getUsersWithSifco:", error);
    throw new Error("No se pudieron obtener los usuarios con créditos SIFCO.");
  }
}
 