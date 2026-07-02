// controllers/advisors.ts
import { db } from '../database/index';
import { asesores, creditos, moras_credito, platform_users, usuarios } from '../database/db/schema';
import { and, eq, like, or, sql } from 'drizzle-orm';
import bcrypt from "bcrypt";
import Big from 'big.js';
// 🔥 Mismo valor normalizado (trim + minúsculas) para asesores.email_cash_in y platform_users.email:
// los filtros de cobro (reportes.ts, /stats) comparan por igualdad exacta contra el email de sesión.
import { normalizeEmail } from '../utils/functions/email';

export const insertAdvisor = async ({ body, set }: any) => {
  try {
    let asesoresToInsert: any[] = [];

    // Permitir objeto único o array
    if (Array.isArray(body)) {
      asesoresToInsert = body;
    } else if (typeof body === "object") {
      asesoresToInsert = [body];
    }

    // Validar que todos tengan nombre y correo
    const isValid = asesoresToInsert.every(
      (a) => a.nombre && normalizeEmail(a.email) && a.password
    );
    if (!isValid || asesoresToInsert.length === 0) {
      set.status = 400;
      return {
        message: "Todos los asesores deben tener nombre, email y password.",
      };
    }

    // 🔥 Asesor + login en una sola transacción: sin ella, un fallo en platform_users
    // (email duplicado UNIQUE) dejaba asesores huérfanos sin login que sí entraban al balanceo.
    const insertedAdvisors = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(asesores)
        .values(
          asesoresToInsert.map(({ nombre, activo, telefono, activo_para_creditos, email }) => ({ // 🔥 Agregado telefono
            nombre,
            telefono: telefono?.trim() || null, // 🔥 NUEVO: Limpia o pone null
            // 🔥 Los reportes/correos de cobro leen asesores.email_cash_in, no platform_users.email
            emailCashIn: normalizeEmail(email) || null,
            activo: typeof activo !== "undefined" ? activo : true,
            // 🔥 default true: el asesor entra al balanceo salvo que se indique lo contrario.
            // Solo un boolean explícito lo cambia (null/otros tipos caen a true; la columna es NOT NULL).
            activo_para_creditos: typeof activo_para_creditos === "boolean" ? activo_para_creditos : true,
          }))
        )
        .returning();

      // Insertar en platform_users (uno por cada asesor)
      for (let i = 0; i < inserted.length; i++) {
        const asesor = inserted[i];
        const { email, password } = asesoresToInsert[i];

        await tx.insert(platform_users).values({
          email: normalizeEmail(email)!,
          password_hash: await bcrypt.hash(password, 10),
          role: "ASESOR",
          is_active: true,
          asesor_id: asesor.asesor_id,
        });
      }

      return inserted;
    });

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
          telefono: asesores.telefono, // 🔥 NUEVO
          activo: asesores.activo,
          activo_para_creditos: asesores.activo_para_creditos, // 🔥 flag balanceo
          email: platform_users.email,
          is_active: platform_users.is_active,
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
          telefono: asesores.telefono, // 🔥 NUEVO
          activo: asesores.activo,
          activo_para_creditos: asesores.activo_para_creditos, // 🔥 flag balanceo
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
        telefono: asesores.telefono, // 🔥 NUEVO
        activo: asesores.activo,
        activo_para_creditos: asesores.activo_para_creditos, // 🔥 flag balanceo
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
    const { id } = query;

    if (!id) {
      set.status = 400;
      return { message: "El parámetro 'id' es obligatorio." };
    }

    if (!body || Object.keys(body).length === 0) {
      set.status = 400;
      return { message: "Debe proporcionar campos para actualizar." };
    }

    const { nombre, telefono, activo, email, password, activo_para_creditos } = body; // ✅ Ya tiene telefono
    // 🔥 email normalizado UNA vez: el mismo valor va a asesores.email_cash_in y platform_users.email
    const emailNorm = normalizeEmail(email);

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
    const asesorId = user.asesor_id;

    // 2. Cambios para asesores
    const advisorChanges = {
      ...(nombre !== undefined ? { nombre } : {}),
      ...(telefono !== undefined ? { telefono } : {}), // ✅ Ya tiene telefono
      // 🔥 Mantener email_cash_in en sync con platform_users.email (lo leen los reportes de cobro)
      ...(emailNorm ? { emailCashIn: emailNorm } : {}),
      ...(activo !== undefined ? { activo } : {}),
      ...(activo_para_creditos !== undefined ? { activo_para_creditos } : {}), // 🔥 flag balanceo
    };

    // 3. Preparar update para platform_users
    const updateUser: any = {};
    if (emailNorm) updateUser.email = emailNorm;
    if (password) {
      updateUser.password_hash = await bcrypt.hash(password, 10);
    }
    if (typeof activo !== "undefined") updateUser.is_active = activo;

    // 🔥 Ambas tablas en una sola transacción: sin ella, un fallo en platform_users
    // (email UNIQUE) dejaba email_cash_in ya cambiado y el login con el email viejo.
    const updatedAdvisor = await db.transaction(async (tx) => {
      // .set({}) vacío tira "No values to set" (ej. body solo con password)
      const updated =
        Object.keys(advisorChanges).length > 0
          ? await tx
              .update(asesores)
              .set(advisorChanges)
              .where(eq(asesores.asesor_id, asesorId))
              .returning()
          : await tx
              .select()
              .from(asesores)
              .where(eq(asesores.asesor_id, asesorId));

      if (Object.keys(updateUser).length > 0) {
        await tx
          .update(platform_users)
          .set(updateUser)
          .where(eq(platform_users.id, Number(id)));
      }

      return updated;
    });

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
export async function getCreditosPorAsesorController(
  numero_credito_sifco?: string,
  email_asesor?: string  
) {
  try {
    console.log(`🚀 Fetching créditos por asesor | numero_credito_sifco: ${numero_credito_sifco}, email_asesor: ${email_asesor}`);

    // 1️⃣ Fetch all active advisors con su email
    const condicionesAsesor = [eq(asesores.activo, true)];
    
    // 🔥 Filtrar por email si se proporciona
    if (email_asesor && email_asesor.length > 0) {
      console.log(`🔎 Filtrando por email de asesor: ${email_asesor}`);
      condicionesAsesor.push(sql`${platform_users.email} ILIKE ${`%${email_asesor}%`}`);
    }

    const listaAsesores = await db
      .select({
        asesor_id: asesores.asesor_id,
        nombre: asesores.nombre,
        telefono: asesores.telefono,
        activo: asesores.activo,
        email: platform_users.email, // 🔥 EMAIL DEL ASESOR
      })
      .from(asesores)
      .leftJoin(
        platform_users,
        eq(asesores.asesor_id, platform_users.asesor_id)
      )
      .where(and(...condicionesAsesor));

    console.log(`👥 Asesores encontrados: ${listaAsesores.length}`);

    // 2️⃣ Procesar cada asesor
    const resultados = await Promise.all(
      listaAsesores.map(async (asesor) => {
        try {
          // Condiciones dinámicas para créditos
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

          console.log(`📊 Créditos para asesor ${asesor.nombre}: ${listaCreditos.length}`);

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
            email: asesor.email || "N/A", // 🔥 EMAIL DEL ASESOR
            total_creditos: listaCreditos.length,
            total_capital: totalCapital.toFixed(2),
            total_deuda: totalDeuda.toFixed(2),
            total_mora: totalMora.toFixed(2),
            total_cuotas_atrasadas: totalCuotasAtrasadas,
            creditos_al_dia: creditosAlDia,
            creditos_morosos: creditosMorosos,
            creditos: listaCreditos,
          };
        } catch (asesorError) {
          console.error(`❌ Error procesando asesor ${asesor.nombre}:`, asesorError);
          // 🔥 Retornar datos vacíos si falla un asesor específico
          return {
            asesor_id: asesor.asesor_id,
            asesor: asesor.nombre,
            email: asesor.email || "N/A",
            total_creditos: 0,
            total_capital: "0.00",
            total_deuda: "0.00",
            total_mora: "0.00",
            total_cuotas_atrasadas: 0,
            creditos_al_dia: 0,
            creditos_morosos: 0,
            creditos: [],
            error: `Error procesando asesor: ${asesorError}`,
          };
        }
      })
    );

    console.log(`✅ Resultados generados para ${resultados.length} asesores`);
    return resultados;

  } catch (error) {
    console.error("❌ Error general en getCreditosPorAsesorController:", error);
    throw new Error(`Error obteniendo créditos por asesor: ${error}`);
  }
}



interface AsesorConCarga {
  asesor_id: number;
  nombre: string; 
  total_creditos: number;
  capital_total: string;
}

export async function getAsesorConMenorCarga(): Promise<number> {
  try {
    console.log("🔍 Buscando asesor con menor carga de capital...");

    // 1️⃣ Obtener todos los asesores activos
    const asesoresActivos = await db
      .select({
        asesor_id: asesores.asesor_id,
        nombre: asesores.nombre,
      })
      .from(asesores)
      .where(
        and(
          eq(asesores.activo, true),
          // 🔥 Solo asesores marcados para recibir créditos (reemplaza el hardcode != 'Gerencia')
          eq(asesores.activo_para_creditos, true)
        )
      );

    if (asesoresActivos.length === 0) {
      throw new Error("No hay asesores activos disponibles");
    }

    console.log(`👥 Asesores activos encontrados: ${asesoresActivos.length}`);

    // 2️⃣ Calcular carga de capital por cada asesor
    const asesoresConCarga: AsesorConCarga[] = await Promise.all(
      asesoresActivos.map(async (asesor) => {
        // Obtener todos los créditos ACTIVOS del asesor
         const creditosAsesor = await db
          .select({
            capital: creditos.capital,
            statusCredit: creditos.statusCredit,
          })
          .from(creditos)
          .where(
            and(
              eq(creditos.asesor_id, asesor.asesor_id),
              or(
                eq(creditos.statusCredit, "ACTIVO"),
                eq(creditos.statusCredit, "MOROSO")
              )
            )
          );


        // Sumar el capital total
        let capitalTotal = new Big(0);
        creditosAsesor.forEach((c) => {
          capitalTotal = capitalTotal.plus(c.capital || 0);
        });

        return {
          asesor_id: asesor.asesor_id,
          nombre: asesor.nombre,
          total_creditos: creditosAsesor.length,
          capital_total: capitalTotal.toFixed(2),
        };
      })
    );

    // 3️⃣ Ordenar por capital total (menor a mayor)
    asesoresConCarga.sort((a, b) => {
      return new Big(a.capital_total).cmp(new Big(b.capital_total));
    });

    console.log("📊 Carga de asesores:");
    asesoresConCarga.forEach((a) => {
      console.log(
        `   - ${a.nombre}: ${a.total_creditos} créditos, Capital: Q${a.capital_total}`
      );
    });

    // 4️⃣ Retornar el ID del asesor con menor carga
    const asesorSeleccionado = asesoresConCarga[0];
    console.log(
      `✅ Asesor seleccionado: ${asesorSeleccionado.nombre} (ID: ${asesorSeleccionado.asesor_id})`
    );

    return asesorSeleccionado.asesor_id;
  } catch (error) {
    console.error("❌ Error obteniendo asesor con menor carga:", error);
    throw new Error(`Error en load balancing de asesores: ${error}`);
  }
}

export const getCreditosCRM = async ({ set }: any) => {
  try {
    const resultado = await db
      .select({
        credito_id: creditos.credito_id,
        numero_credito_sifco: creditos.numero_credito_sifco,
        nombre_cliente: usuarios.nombre,
        asesor_id: creditos.asesor_id,
        asesor_nombre: asesores.nombre,
      })
      .from(creditos)
      .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
      .innerJoin(asesores, eq(creditos.asesor_id, asesores.asesor_id))
      .where(
        and(
          like(creditos.numero_credito_sifco, "%CRM%"),
          eq(asesores.nombre, "Gerencia"),
          or(
            eq(creditos.statusCredit, "ACTIVO"),
            eq(creditos.statusCredit, "MOROSO"),
            eq(creditos.statusCredit, "PENDIENTE_CANCELACION"),
            eq(creditos.statusCredit, "EN_CONVENIO")
          )
        )
      );

    set.status = 200;
    return {
      success: true,
      total: resultado.length,
      data: resultado,
    };
  } catch (error) {
    console.error("❌ Error getCreditosCRM:", error);
    set.status = 500;
    return { success: false, message: "Error obteniendo créditos CRM", error: String(error) };
  }
};

export const updateCreditAdvisor = async ({ body, set }: any) => {
  try {
    const { credito_id, nombre_asesor } = body;

    if (!credito_id || !nombre_asesor) {
      set.status = 400;
      return { success: false, message: "credito_id y nombre_asesor son requeridos" };
    }

    const asesor = await findOrCreateAdvisorByName(nombre_asesor);
    if (!asesor) {
      set.status = 404;
      return { success: false, message: `No se pudo encontrar/crear asesor: ${nombre_asesor}` };
    }

    const updated = await db
      .update(creditos)
      .set({ asesor_id: asesor.asesor_id })
      .where(
        and(
          eq(creditos.credito_id, credito_id),
          like(creditos.numero_credito_sifco, "%CRM%")
        )
      )
      .returning({ credito_id: creditos.credito_id, asesor_id: creditos.asesor_id });

    if (updated.length === 0) {
      set.status = 404;
      return { success: false, message: `Crédito ${credito_id} no encontrado o no es CRM` };
    }

    set.status = 200;
    return {
      success: true,
      message: `Asesor actualizado a "${asesor.nombre}" para crédito ${credito_id}`,
      data: updated[0],
    };
  } catch (error) {
    console.error("❌ Error updateCreditAdvisor:", error);
    set.status = 500;
    return { success: false, message: "Error actualizando asesor", error: String(error) };
  }
};
