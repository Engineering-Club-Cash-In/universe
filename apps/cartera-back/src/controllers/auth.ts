 
import { eq } from "drizzle-orm";
import bcrypt from "bcrypt";
import { admins, asesores, conta_users, platform_users } from "../database/db";
import { db } from "../database";
import jwt from "jsonwebtoken";
export async function createAdminService(data: {
  nombre: string;
  apellido: string;
  email: string;
  telefono?: string;
  password: string;
}) {
  // 1. Hashear contraseña
  const passwordHash = await bcrypt.hash(data.password, 10);

  // 2. Insertar admin
  const [newAdmin] = await db
    .insert(admins)
    .values({
      nombre: data.nombre,
      apellido: data.apellido,
      email: data.email,
      telefono: data.telefono ?? null,
    })
    .returning();

  // 3. Insertar en platform_users
  await db.insert(platform_users).values({
    email: data.email,
    password_hash: passwordHash,
    role: "ADMIN",
    admin_id: newAdmin.admin_id,
  });

  return newAdmin;
}
export async function createPlatformUserService(data: {
  email: string;
  password: string;
  role: "ADMIN" | "ASESOR";
  admin_id?: number;
  asesor_id?: number;
}) {
  // 1. Hashear contraseña
  const passwordHash = await bcrypt.hash(data.password, 10);

  // 2. Crear usuario
  const [newUser] = await db
    .insert(platform_users)
    .values({
      email: data.email,
      password_hash: passwordHash,
      role: data.role,
      admin_id: data.admin_id ?? null,
      asesor_id: data.asesor_id ?? null,
    })
    .returning();

  return newUser;}


 
const JWT_SECRET = process.env.JWT_SECRET || "supersecreto"; // ⚠️ ponelo en tu .env
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "supersecreto";
export async function loginService(email: string, password: string) {
  // 1. Buscar usuario por email
  const [user] = await db
    .select()
    .from(platform_users)
    .where(eq(platform_users.email, email))
    .limit(1);

  if (!user) {
    throw new Error("Credenciales inválidas");
  }

  // 2. Validar contraseña
  const isValid = await bcrypt.compare(password, user.password_hash);
  if (!isValid) {
    throw new Error("Credenciales inválidas");
  }

  // 3. Cargar info extra según rol
  let extraInfo: any = {};
  if (user.role === "ADMIN" && user.admin_id) {
    const [admin] = await db
      .select({
        id: admins.admin_id,
        nombre: admins.nombre,
        apellido: admins.apellido,
      })
      .from(admins)
      .where(eq(admins.admin_id, user.admin_id));
    extraInfo = admin;
  }
  if (user.role === "ASESOR" && user.asesor_id) {
    const [asesor] = await db
      .select({
        id: asesores.asesor_id,
        nombre: asesores.nombre,
      })
      .from(asesores)
      .where(eq(asesores.asesor_id, user.asesor_id));
    extraInfo = asesor;
  }

  // 4. Generar Access Token (30m)
  const accessToken = jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      admin_id: user.admin_id,
      asesor_id: user.asesor_id,
    },
    JWT_SECRET,
    { expiresIn: "30m" }
  );

  // 5. Generar Refresh Token (7 días)
  const refreshToken = jwt.sign(
    {
      id: user.id,
      role: user.role,
    },
    JWT_REFRESH_SECRET,
    { expiresIn: "7d" }
  );

  return {
    accessToken,
    refreshToken,
    user: { ...user, ...extraInfo },
  };
}



export function verifyTokenService(token: string) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Generar un nuevo token con tiempo extendido
    const newToken = jwt.sign(
      typeof decoded === 'string' ? { data: decoded } : { ...decoded }, // Copiar el payload del token actual
      JWT_SECRET,
      { expiresIn: '1h' } // O el tiempo que necesites: '2h', '30m', '7d', etc.
    );
    
    return { 
      valid: true, 
      decoded,
      newToken // Devolver el nuevo token con tiempo extendido
    };
  } catch (err) {
    return { 
      valid: false, 
      error: "Token inválido o expirado" 
    };
  }
}

/**
 * Crear usuario de contabilidad + usuario en plataforma
 * - Usa transacción: si falla platform_users, se revierte conta_users
 */
export async function createContaService(data: {
  nombre: string;
 
  email: string;
  telefono?: string;
  password: string;
}) {
  try {
    return await db.transaction(async (tx) => {
      console.log("➡️ Iniciando creación de conta:", data.email);

      const passwordHash = await bcrypt.hash(data.password, 10);

      // 1. Insertar en conta_users
      const [newConta] = await tx
        .insert(conta_users)
        .values({
          nombre: data.nombre, 
          email: data.email,
          telefono: data.telefono ?? null,
        })
        .returning();

      console.log("✅ Conta creado:", newConta);

      if (!newConta?.conta_id) {
        throw new Error("❌ Error: conta_id no devuelto por la inserción");
      }
      console.log("🔍 conta_id obtenido:", newConta.conta_id);
      // 2. Insertar en platform_users
      const [newUser] = await tx
        .insert(platform_users)
        .values({
          email: data.email,
          password_hash: passwordHash,
          role: "CONTA",
          conta_id: newConta.conta_id,
        })
        .returning();

      console.log("✅ Usuario de plataforma creado:", newUser);

      return newConta;
    });
  } catch (error: any) {
    console.error("❌ Error en createContaService:", error);
    throw new Error(error.message || "Error creando usuario de contabilidad");
  }
}

/**
 * Actualizar usuario de contabilidad (profile + platform_users)
 */
export async function updateContaUserService(
  platformUserId: number,
  updates: {
    email?: string;
    password?: string;
    is_active?: boolean;
    nombre?: string;
  }
) {
  try {
    return await db.transaction(async (tx) => {
      console.log("➡️ Actualizando conta desde platformUser:", platformUserId, updates);

      // 1. Buscar usuario en platform_users
      const [user] = await tx
        .select()
        .from(platform_users)
        .where(eq(platform_users.id, platformUserId))
        .limit(1);

      if (!user) throw new Error("Usuario de contabilidad no encontrado");

      console.log("🔎 Usuario encontrado en platform_users:", user);

      // 2. Actualizar platform_users
      const userUpdates: any = {};
      if (updates.email) userUpdates.email = updates.email;
      if (updates.password)
        userUpdates.password_hash = await bcrypt.hash(updates.password, 10);
      if (typeof updates.is_active !== "undefined")
        userUpdates.is_active = updates.is_active;

      if (Object.keys(userUpdates).length > 0) {
        await tx
          .update(platform_users)
          .set(userUpdates)
          .where(eq(platform_users.id, user.id));

        console.log("✅ Platform_users actualizado:", userUpdates);
      }

      // 3. Actualizar conta_users usando el conta_id que trae platform_users
      const contaUpdates: any = {};
      if (updates.nombre) contaUpdates.nombre = updates.nombre;
      if (updates.email) contaUpdates.email = updates.email;

      if (Object.keys(contaUpdates).length > 0 && user.conta_id) {
        await tx
          .update(conta_users)
          .set(contaUpdates)
          .where(eq(conta_users.conta_id, user.conta_id));

        console.log("✅ Conta_users actualizado:", contaUpdates);
      }

      return { message: "Usuario de contabilidad actualizado correctamente" };
    });
  } catch (error: any) {
    console.error("❌ Error en updateContaUserService:", error);
    throw new Error(error.message || "Error actualizando usuario de contabilidad");
  }
}
/**
 * Obtener usuarios de plataforma (excepto admins)
 */
export async function getPlatformUsersService() {
  try {
    console.log("➡️ Cargando usuarios de plataforma...");

    const users = await db.select().from(platform_users);

    const enrichedUsers = await Promise.all(
      users.map(async (user) => {
        if (user.role === "ASESOR" && user.asesor_id) {
          const [asesor] = await db
            .select()
            .from(asesores)
            .where(eq(asesores.asesor_id, user.asesor_id));
          return { ...user, profile: asesor };
        }
        if (user.role === "CONTA" && user.conta_id) {
          const [conta] = await db
            .select()
            .from(conta_users)
            .where(eq(conta_users.conta_id, user.conta_id));
          return { ...user, profile: conta };
        }
        // Excluir admins
        return null;
      })
    );

    const filtered = enrichedUsers.filter(Boolean);
    console.log("✅ Usuarios de plataforma obtenidos:", filtered.length);

    return filtered;
  } catch (error: any) {
    console.error("❌ Error en getPlatformUsersService:", error);
    throw new Error(error.message || "Error obteniendo usuarios de plataforma");
  }
}
 

