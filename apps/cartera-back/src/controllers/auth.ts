 
import { eq, sql } from "drizzle-orm";
import bcrypt from "bcrypt";
import { admins, asesores, conta_users, platform_users } from "../database/db";
import { db } from "../database";
import jwt from "jsonwebtoken";
// 🔥 platform_users.email se guarda SIEMPRE normalizado (trim+minúsculas) en todos los
// writers, para que el login case-insensitive nunca encuentre duplicados por casing
import { normalizeEmail } from "../utils/functions/email";
export async function createAdminService(data: {
  nombre: string;
  apellido: string;
  email: string;
  telefono?: string;
  password: string;
}) {
  // 1. Hashear contraseña
  const passwordHash = await bcrypt.hash(data.password, 10);

  // 2+3. Admin + login en una sola transacción: un email duplicado en
  // platform_users no debe dejar un admin huérfano sin login
  return await db.transaction(async (tx) => {
    const [newAdmin] = await tx
      .insert(admins)
      .values({
        nombre: data.nombre,
        apellido: data.apellido,
        email: normalizeEmail(data.email)!,
        telefono: data.telefono ?? null,
      })
      .returning();

    await tx.insert(platform_users).values({
      email: normalizeEmail(data.email)!,
      password_hash: passwordHash,
      role: "ADMIN",
      admin_id: newAdmin.admin_id,
    });

    return newAdmin;
  });
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
      email: normalizeEmail(data.email)!,
      password_hash: passwordHash,
      role: data.role,
      admin_id: data.admin_id ?? null,
      asesor_id: data.asesor_id ?? null,
    })
    .returning();

  return newUser;}


 
const JWT_SECRET = process.env.JWT_SECRET || "supersecreto"; // ⚠️ ponelo en tu .env
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "supersecreto";
/**
 * Hash bcrypt (cost 10) de un valor aleatorio descartado: se compara contra él
 * cuando el email no existe, para que "no existe" tarde lo mismo que "clave
 * incorrecta" y el tiempo de respuesta no revele qué cuentas existen.
 */
const HASH_SEÑUELO = "$2b$10$htxlG0Bp9OdXlrHtRS4HxOwTBczPRqqVG4n2QTYOyk7m35qCsy44a";

const HASH_BCRYPT = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

/**
 * bcrypt.compare que nunca lanza: un hash corrupto o no-bcrypt cuenta como
 * clave incorrecta. Con un hash no-bcrypt igual compara contra el señuelo:
 * bcrypt devolvería sin hacer el trabajo de cost 10 y el tiempo delataría que
 * la cuenta existe.
 */
async function claveCoincide(password: string, hash: string): Promise<boolean> {
  try {
    const valido = HASH_BCRYPT.test(hash);
    const ok = await bcrypt.compare(password, valido ? hash : HASH_SEÑUELO);
    return valido && ok;
  } catch {
    return false;
  }
}

/** Fila de platform_users para responder al cliente: NUNCA lleva password_hash. */
function sinHash<T extends { password_hash?: unknown }>(user: T): Omit<T, "password_hash"> {
  const { password_hash: _descartado, ...resto } = user;
  return resto;
}

/**
 * Usuario de plataforma VIGENTE detrás de un token: lo que el token dice (rol,
 * ids) puede estar viejo — el usuario pudo ser desactivado, borrado o cambiado
 * de rol después de emitirlo. Devuelve null si no existe. Proyección explícita:
 * jamás trae password_hash.
 */
export async function findSessionUser(id: unknown) {
  const userId = Number(id);
  if (!Number.isInteger(userId) || userId <= 0) return null;
  const [user] = await db
    .select({
      id: platform_users.id,
      email: platform_users.email,
      role: platform_users.role,
      is_active: platform_users.is_active,
      admin_id: platform_users.admin_id,
      asesor_id: platform_users.asesor_id,
      conta_id: platform_users.conta_id,
    })
    .from(platform_users)
    .where(eq(platform_users.id, userId))
    .limit(1);
  return user ?? null;
}

/** Payload de los JWT de sesión, armado SIEMPRE desde la fila vigente de la base. */
function payloadDeSesion(user: {
  id: number;
  email: string;
  role: string;
  admin_id: number | null;
  asesor_id: number | null;
}) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    admin_id: user.admin_id,
    asesor_id: user.asesor_id,
  };
}

export async function loginService(email: string, password: string) {
  // 1. Buscar usuario por email (case/espacios-insensible: los asesores nuevos
  // se guardan normalizados a minúsculas, los registros viejos pueden no estarlo)
  const [user] = await db
    .select()
    .from(platform_users)
    .where(sql`LOWER(${platform_users.email}) = ${email.trim().toLowerCase()}`)
    .limit(1);

  // 2. Validar contraseña SIEMPRE (también si no existe o está inactivo) y
  // responder el mismo mensaje en los tres casos: ni el texto ni el tiempo
  // revelan si la cuenta existe o fue desactivada.
  const isValid = await claveCoincide(password, user?.password_hash ?? HASH_SEÑUELO);
  if (!user || !isValid || !user.is_active) {
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
  const accessToken = jwt.sign(payloadDeSesion(user), JWT_SECRET, { expiresIn: "30m" });

  // 5. Generar Refresh Token (7 días)
  const refreshToken = jwt.sign(payloadDeSesion(user), JWT_REFRESH_SECRET, { expiresIn: "7d" });

  return {
    accessToken,
    refreshToken,
    // `extraInfo.id` (admin_id/asesor_id) pisa a `user.id` como siempre lo hizo:
    // el front y el CRM ya leen ese shape. Lo único que sale es el hash.
    user: { ...sinHash(user), ...extraInfo },
  };
}


/**
 * Valida un access token y lo renueva (1h). Revalida contra la base: un token
 * firmado de un usuario desactivado o borrado ya NO se renueva — sin esto,
 * encadenar /auth/verify mantenía viva para siempre la sesión de alguien dado
 * de baja. Rol e ids salen de la fila vigente, no del token.
 */
export async function verifyTokenService(token: string) {
  let decoded: any;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    return { success: false as const, error: "Token inválido o expirado" };
  }

  const user = await findSessionUser(decoded?.id);
  if (!user || !user.is_active) {
    return { success: false as const, error: "Token inválido o expirado" };
  }

  const data = payloadDeSesion(user);
  return {
    success: true as const,
    data,
    accessToken: jwt.sign(data, JWT_SECRET, { expiresIn: "1h" }),
  };
}

/**
 * Canjea un refresh token por un access token (30m) y un refresh nuevo (7d).
 * Igual que verify: revalida que el usuario siga existiendo y activo, y firma
 * con el rol VIGENTE. Firma y verifica con las MISMAS constantes con que
 * `loginService` emite el refresh.
 */
export async function refreshTokenService(refreshToken: string) {
  let decoded: any;
  try {
    decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
  } catch {
    return { success: false as const, error: "Refresh token inválido o expirado" };
  }

  const user = await findSessionUser(decoded?.id);
  if (!user || !user.is_active) {
    return { success: false as const, error: "Refresh token inválido o expirado" };
  }

  const payload = payloadDeSesion(user);
  return {
    success: true as const,
    accessToken: jwt.sign(payload, JWT_SECRET, { expiresIn: "30m" }),
    refreshToken: jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: "7d" }),
  };
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
          email: normalizeEmail(data.email)!,
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
          email: normalizeEmail(data.email)!,
          password_hash: passwordHash,
          role: "CONTA",
          conta_id: newConta.conta_id,
        })
        .returning();

      // Sin loguear la fila: trae password_hash.
      console.log("✅ Usuario de plataforma creado:", newUser?.id);

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
      // Sólo los NOMBRES de los campos: `updates` trae la contraseña nueva en claro.
      console.log("➡️ Actualizando conta desde platformUser:", platformUserId, Object.keys(updates));

      // 1. Buscar usuario en platform_users
      const [user] = await tx
        .select({
          id: platform_users.id,
          role: platform_users.role,
          conta_id: platform_users.conta_id,
        })
        .from(platform_users)
        .where(eq(platform_users.id, platformUserId))
        .limit(1);

      // Esta ruta es de CONTA: no sirve para cambiarle la clave a un ADMIN o a un
      // ASESOR (los asesores van por /updateAdvisor).
      if (!user || user.role !== "CONTA") throw new Error("Usuario de contabilidad no encontrado");

      // 2. Actualizar platform_users
      const emailNorm = normalizeEmail(updates.email);
      const userUpdates: any = {};
      if (emailNorm) userUpdates.email = emailNorm;
      if (updates.password)
        userUpdates.password_hash = await bcrypt.hash(updates.password, 10);
      if (typeof updates.is_active !== "undefined")
        userUpdates.is_active = updates.is_active;

      if (Object.keys(userUpdates).length > 0) {
        await tx
          .update(platform_users)
          .set(userUpdates)
          .where(eq(platform_users.id, user.id));

        console.log("✅ Platform_users actualizado:", Object.keys(userUpdates));
      }

      // 3. Actualizar conta_users usando el conta_id que trae platform_users
      const contaUpdates: any = {};
      if (updates.nombre) contaUpdates.nombre = updates.nombre;
      if (emailNorm) contaUpdates.email = emailNorm;

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

    // Proyección explícita: password_hash NUNCA sale de acá.
    const users = await db
      .select({
        id: platform_users.id,
        email: platform_users.email,
        role: platform_users.role,
        is_active: platform_users.is_active,
        asesor_id: platform_users.asesor_id,
        admin_id: platform_users.admin_id,
        conta_id: platform_users.conta_id,
        created_at: platform_users.created_at,
        updated_at: platform_users.updated_at,
      })
      .from(platform_users);

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
 

