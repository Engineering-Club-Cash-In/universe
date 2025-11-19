import { eq } from "drizzle-orm";
import { db } from "../db/connection";
import { userProfiles, users, type UserProfile } from "../db/schema";
import { randomUUID } from "crypto";

/**
 * Service para manejar operaciones de perfil de usuario
 */
export class ProfileService {
  /**
   * Obtiene o crea el perfil de un usuario
   */
  static async getOrCreateProfile(userId: string): Promise<UserProfile> {
    // Verificar que el usuario existe
    const user = await db.select().from(users).where(eq(users.id, userId));
    if (user.length === 0) {
      throw new Error("Usuario no encontrado");
    }

    // Buscar perfil existente
    const existingProfile = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId));

    if (existingProfile.length > 0) {
      return existingProfile[0];
    }

    // Crear nuevo perfil
    const newProfile = await db
      .insert(userProfiles)
      .values({
        id: randomUUID(),
        userId,
        dpi: null,
        phone: null,
        address: null,
        profileCompleted: false,
      })
      .returning();

    return newProfile[0];
  }

  /**
   * Actualiza el DPI del usuario
   */
  static async updateDpi(userId: string, dpi: string): Promise<UserProfile> {
    const profile = await this.getOrCreateProfile(userId);

    const updated = await db
      .update(userProfiles)
      .set({
        dpi,
        profileCompleted: this.isProfileComplete(dpi, profile.phone, profile.address),
        updatedAt: new Date(),
      })
      .where(eq(userProfiles.userId, userId))
      .returning();

    return updated[0];
  }

  /**
   * Actualiza el teléfono del usuario
   */
  static async updatePhone(
    userId: string,
    phone: string
  ): Promise<UserProfile> {
    const profile = await this.getOrCreateProfile(userId);

    const updated = await db
      .update(userProfiles)
      .set({
        phone,
        profileCompleted: this.isProfileComplete(profile.dpi, phone, profile.address),
        updatedAt: new Date(),
      })
      .where(eq(userProfiles.userId, userId))
      .returning();

    return updated[0];
  }

  /**
   * Actualiza la dirección del usuario
   */
  static async updateAddress(
    userId: string,
    address: string
  ): Promise<UserProfile> {
    const profile = await this.getOrCreateProfile(userId);

    const updated = await db
      .update(userProfiles)
      .set({
        address,
        profileCompleted: this.isProfileComplete(profile.dpi, profile.phone, address),
        updatedAt: new Date(),
      })
      .where(eq(userProfiles.userId, userId))
      .returning();

    return updated[0];
  }

  /**
   * Obtiene el perfil de un usuario
   */
  static async getProfile(userId: string): Promise<UserProfile | null> {
    const profile = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId));

    return profile.length > 0 ? profile[0] : null;
  }

  /**
   * Verifica si el perfil está completo (tiene DPI, teléfono y dirección)
   */
  private static isProfileComplete(
    dpi: string | null,
    phone: string | null,
    address: string | null
  ): boolean {
    return !!dpi && !!phone && !!address;
  }
}
