// controllers/advisors.ts
import { db } from '../database/index';
import { asesores, creditos, moras_credito, platform_users } from '../database/db/schema';
import { and, eq, like, sql } from 'drizzle-orm';
import bcrypt from "bcrypt";
import Big from 'big.js';
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
  const normalizedSearch = nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

  console.log(`\n🔍 ========================================`);
  console.log(`🔍 Buscando: "${nombre}"`);
  console.log(`🔍 Normalizado: "${normalizedSearch}"`);
  console.log(`🔍 Length: ${normalizedSearch.length}`);
  console.log(`🔍 Bytes: [${Array.from(normalizedSearch).map(c => c.charCodeAt(0)).join(', ')}]`);

  const allAdvisors = await db
    .select()
    .from(asesores)
    .innerJoin(platform_users, eq(asesores.asesor_id, platform_users.asesor_id));

  console.log(`\n📋 Asesores en BD (${allAdvisors.length}):`);
  
  let encontrado = null;
  
  for (const advisor of allAdvisors) {
    const dbName = advisor.asesores.nombre
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
    
    console.log(`   - "${advisor.asesores.nombre}" → normalizado: "${dbName}" (length: ${dbName.length})`);
    console.log(`     Bytes: [${Array.from(dbName).map(c => c.charCodeAt(0)).join(', ')}]`);
    console.log(`     Match: ${dbName === normalizedSearch ? '✅ SÍ' : '❌ NO'}`);
    
    if (dbName === normalizedSearch) {
      encontrado = advisor;
    }
  }

  if (encontrado) {
    console.log(`\n✅ ENCONTRADO: ID ${encontrado.asesores.asesor_id} - "${encontrado.asesores.nombre}"`);
    console.log(`========================================\n`);
    return encontrado.asesores;
  }

  const nombreSinTildes = nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

  console.log(`\n➕ NO ENCONTRADO - Creando: "${nombreSinTildes}"`);
  console.log(`========================================\n`);

 
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
    const { id } = query; // id de platform_users

    if (!id) {
      set.status = 400;
      return { message: "El parámetro 'id' es obligatorio." };
    }

    if (!body || Object.keys(body).length === 0) {
      set.status = 400;
      return { message: "Debe proporcionar campos para actualizar." };
    }

    const { nombre, apellido, telefono, activo, email, password } = body;

    // 1. Buscar el usuario en platform_users
    const [user] = await db
      .select()
      .from(platform_users)
      .where(eq(platform_users.id, Number(id)));

    if (!user) {
      set.status = 404;
      return { message: "Usuario no encontrado en platform_users." };
    }

    if (!user.asesor_id) {
      set.status = 400;
      return { message: "El usuario no tiene un asesor_id asociado." };
    }

    // 2. Actualizar tabla asesores usando el asesor_id
    const updatedAdvisor = await db
      .update(asesores)
      .set({
        ...(nombre !== undefined ? { nombre } : {}), 
        ...(telefono !== undefined ? { telefono } : {}),
        ...(activo !== undefined ? { activo } : {}),
      })
      .where(eq(asesores.asesor_id, user.asesor_id))
      .returning();

    // 3. Preparar update para platform_users
    const updateUser: any = {};
    if (email) updateUser.email = email;
    if (password) {
      updateUser.password_hash = await bcrypt.hash(password, 10);
    }
    if (typeof activo !== "undefined") updateUser.is_active = activo;

    if (Object.keys(updateUser).length > 0) {
      await db
        .update(platform_users)
        .set(updateUser)
        .where(eq(platform_users.id, Number(id)));
    }

    set.status = 200;
    return {
      message: "Asesor actualizado correctamente",
      data: {
        advisor: updatedAdvisor[0],
        user: { ...user, ...updateUser },
      },
    };
  } catch (error: any) {
    set.status = 500;
    return {
      message: "Error actualizando asesor",
      error: error.message,
    };
  }
};


/**
 * 📘 Controller: Get credits grouped by advisor
 * --------------------------------------------
 * Fetches all active advisors and computes:
 *  - Total capital
 *  - Total debt
 *  - Credits "al día" and "morosos"
 *
 * Supports optional filtering by "numero_credito_sifco".
 * Uses Big.js for precise decimal operations.
 */
export async function getCreditosPorAsesorController(numero_credito_sifco?: string) {
  // 1️⃣ Fetch all active advisors
  const listaAsesores = await db
    .select()
    .from(asesores)
    .where(eq(asesores.activo, true));

  // 2️⃣ Procesar cada asesor
  const resultados = await Promise.all(
    listaAsesores.map(async (asesor) => {
      // Condiciones dinámicas
      const condiciones = [eq(creditos.asesor_id, asesor.asesor_id)];
      if (numero_credito_sifco) {
        condiciones.push(eq(creditos.numero_credito_sifco, numero_credito_sifco));
      }

      // 3️⃣ Traer créditos con JOIN a moras activas
      const listaCreditos = await db
        .select({
          credito_id: creditos.credito_id,
          numero_credito_sifco: creditos.numero_credito_sifco,
          capital: creditos.capital,
          deudatotal: creditos.deudatotal,
          statusCredit: creditos.statusCredit,
          monto_mora: moras_credito.monto_mora,
          cuotas_atrasadas: moras_credito.cuotas_atrasadas,
        })
        .from(creditos)
        .leftJoin(moras_credito, and(
          eq(moras_credito.credito_id, creditos.credito_id),
          eq(moras_credito.activa, true)
        ))
        .where(and(...condiciones));

      // 4️⃣ Acumuladores globales
      let totalCapital = new Big(0);
      let totalDeuda = new Big(0);
      let totalMora = new Big(0);
      let totalCuotasAtrasadas = 0;
      let creditosAlDia = 0;
      let creditosMorosos = 0;

      // 5️⃣ Iterar créditos
      for (const c of listaCreditos) {
        const capital = new Big(c.capital || 0);
        const deuda = new Big(c.deudatotal || 0);
        const mora = new Big(c.monto_mora || 0);
        const cuotas = c.cuotas_atrasadas || 0;

        totalCapital = totalCapital.plus(capital);
        totalDeuda = totalDeuda.plus(deuda);
        totalMora = totalMora.plus(mora);
        totalCuotasAtrasadas += cuotas;

        if (c.statusCredit === "ACTIVO") creditosAlDia++;
        if (c.statusCredit === "MOROSO") creditosMorosos++;
      }

      // 6️⃣ Retornar resumen por asesor
      return {
        asesor_id: asesor.asesor_id,
        asesor: asesor.nombre,
        total_creditos: listaCreditos.length,
        total_capital: totalCapital.toFixed(2),
        total_deuda: totalDeuda.toFixed(2),
        total_mora: totalMora.toFixed(2),
        total_cuotas_atrasadas: totalCuotasAtrasadas,
        creditos_al_dia: creditosAlDia,
        creditos_morosos: creditosMorosos,
        creditos: listaCreditos,
      };
    })
  );

  return resultados;
}