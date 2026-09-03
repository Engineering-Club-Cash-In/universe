/**
 * Escrituras de identidad (rol y DPI) sobre la cuenta del portal.
 *
 * Estos campos dejaron de aceptarse desde el cliente (`input: false` en
 * lib/auth.ts). Todo cambio pasa por aquí, siempre contra el userId que sale
 * de la sesión, nunca contra uno enviado en el body.
 */

import { and, eq, ne } from "drizzle-orm";

import { db } from "../db/connection";
import { users } from "../db/schema";
import {
  normalizeDpi,
  resolveRoleAfterRegistration,
  type PortalUserType,
} from "../lib/portalIdentity";

export class DpiFormatError extends Error {
  constructor() {
    super("El DPI debe tener exactamente 13 dígitos");
    this.name = "DpiFormatError";
  }
}

export class DpiAlreadyTakenError extends Error {
  constructor() {
    super("El DPI ya está registrado en otra cuenta");
    this.name = "DpiAlreadyTakenError";
  }
}

/**
 * Comprueba que el DPI esté libre para la cuenta indicada y devuelve su forma
 * normalizada. Lanza `DpiFormatError` o `DpiAlreadyTakenError`.
 *
 * Existe como paso independiente para poder detectar el conflicto ANTES de los
 * efectos externos del registro (CRM/cartera). No es un endpoint: se llama
 * siempre dentro de un flujo con sesión y contra el `userId` de esa sesión, así
 * que no reintroduce el oráculo público de DPIs que se eliminó.
 */
export async function assertDpiAvailable(
  userId: string,
  dpi: string,
): Promise<string> {
  const normalized = normalizeDpi(dpi);

  if (!normalized) {
    throw new DpiFormatError();
  }

  // La columna es única; se comprueba antes para poder devolver un 409 claro
  // en vez de un error de constraint.
  const [taken] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.dpi, normalized), ne(users.id, userId)));

  if (taken) {
    throw new DpiAlreadyTakenError();
  }

  return normalized;
}

/**
 * Fija el DPI de la cuenta indicada. `userId` debe venir de la sesión.
 */
export async function setUserDpi(userId: string, dpi: string): Promise<string> {
  const normalized = await assertDpiAvailable(userId, dpi);

  await db
    .update(users)
    .set({ dpi: normalized, updatedAt: new Date() })
    .where(eq(users.id, userId));

  return normalized;
}

/**
 * Aplica en la cuenta de la sesión el resultado de un registro que el servidor
 * ya validó: fija el DPI y, si corresponde, asciende el rol.
 *
 * El rol se decide con `resolveRoleAfterRegistration`, que nunca asigna un rol
 * fuera de los de autoservicio ni pisa uno administrativo.
 */
export async function applyRegistrationOutcome(
  userId: string,
  userType: PortalUserType,
  dpi: string | null | undefined,
): Promise<{ dpi: string | null; role: PortalUserType | null }> {
  const [current] = await db
    .select({ id: users.id, role: users.role, dpi: users.dpi })
    .from(users)
    .where(eq(users.id, userId));

  if (!current) {
    throw new Error("Usuario no encontrado");
  }

  let appliedDpi: string | null = null;
  const normalized = normalizeDpi(dpi);

  if (normalized && normalized !== current.dpi) {
    await setUserDpi(userId, normalized);
    appliedDpi = normalized;
  }

  const nextRole = resolveRoleAfterRegistration(current.role, userType);

  if (nextRole) {
    await db
      .update(users)
      .set({ role: nextRole, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  return { dpi: appliedDpi, role: nextRole };
}
