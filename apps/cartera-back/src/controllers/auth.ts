 
import { eq } from "drizzle-orm";
import bcrypt from "bcrypt";
import { admins, asesores, platform_users } from "../database/db";
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

  // 4. Generar token
  const token = jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      admin_id: user.admin_id,
      asesor_id: user.asesor_id,
    },
    JWT_SECRET,
    { expiresIn: "1h" }
  );

  return { token, user: { ...user, ...extraInfo } };
}


export function verifyTokenService(token: string) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return { valid: true, decoded };
  } catch (err) {
    return { valid: false, error: "Token inválido o expirado" };
  }
}