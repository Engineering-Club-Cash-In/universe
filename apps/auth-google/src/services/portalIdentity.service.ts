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
 * `true` si el error es un choque contra un índice único de Postgres.
 *
 * En las escrituras de abajo solo se toca `users.dpi`, así que un 23505 aquí
 * solo puede venir de la unicidad del DPI.
 */
const esViolacionDeUnicidad = (error: unknown): boolean => {
  const code = (error as { code?: unknown })?.code;

  if (code === "23505") {
    return true;
  }

  return (
    error instanceof Error &&
    /duplicate key value violates unique constraint/i.test(error.message)
  );
};

/**
 * Reserva del DPI sobre una cuenta concreta.
 *
 * `previousDpi` es lo que había antes, para poder deshacerla; `claimedNow`
 * distingue la reserva que hizo ESTA petición de la que la cuenta ya traía.
 */
export type DpiClaim = {
  dpi: string;
  previousDpi: string | null;
  claimedNow: boolean;
};

/**
 * Reserva el DPI para la cuenta indicada de forma ATÓMICA.
 *
 * Un `SELECT` previo no sirve para esto: dos registros simultáneos con el mismo
 * DPI libre lo pasan los dos, los dos siguen hasta CRM/cartera y el perdedor
 * revienta al final contra la restricción única, con un 500 genérico y la
 * cuenta a medias. Aquí la exclusión la da el índice único: se ESCRIBE el DPI
 * antes de cualquier efecto externo y quien pierde la carrera recibe 23505, que
 * se traduce a `DpiAlreadyTakenError` (409).
 *
 * Si la cuenta ya tiene ese mismo DPI, la reserva se reconoce como propia en
 * vez de chocar consigo misma: es lo que permite reintentar un registro que
 * quedó a medias.
 */
export async function claimDpi(
  userId: string,
  dpi: string,
): Promise<DpiClaim> {
  const normalized = normalizeDpi(dpi);

  if (!normalized) {
    throw new DpiFormatError();
  }

  const [current] = await db
    .select({ id: users.id, role: users.role, dpi: users.dpi })
    .from(users)
    .where(eq(users.id, userId));

  if (!current) {
    throw new Error("Usuario no encontrado");
  }

  // Se guarda ANTES de escribir: es lo que hay que devolver si la reserva se
  // deshace, y leerlo después de la escritura sería leer el valor nuevo.
  const previousDpi = current.dpi ?? null;

  // Ya es suya: no hay nada que reservar ni que deshacer después.
  if (previousDpi === normalized) {
    return { dpi: normalized, previousDpi: normalized, claimedNow: false };
  }

  try {
    await db
      .update(users)
      .set({ dpi: normalized, updatedAt: new Date() })
      .where(eq(users.id, userId));
  } catch (error) {
    if (esViolacionDeUnicidad(error)) {
      throw new DpiAlreadyTakenError();
    }

    throw error;
  }

  return { dpi: normalized, previousDpi, claimedNow: true };
}

/**
 * Deshace una reserva hecha por esta misma petición, para que un registro que
 * no llegó a completarse no deje el DPI bloqueado.
 *
 * No propaga el fallo a propósito: se invoca desde el camino de error y tapar
 * la causa original con el fallo de la limpieza sería peor. Si la liberación
 * falla, el DPI queda reservado en la cuenta de quien lo pidió, y el modo de
 * fallo es benigno: su propio reintento reconoce la reserva como propia
 * (`claimedNow: false`) y sigue adelante.
 */
export async function releaseDpiClaim(
  userId: string,
  claim: DpiClaim,
): Promise<void> {
  if (!claim.claimedNow) {
    return;
  }

  try {
    await db
      .update(users)
      .set({ dpi: claim.previousDpi, updatedAt: new Date() })
      .where(eq(users.id, userId));
  } catch (error) {
    console.error(
      `[ERROR] No se pudo liberar la reserva del DPI de la cuenta ${userId}; queda reservado y el titular puede reintentar sobre él.`,
      error,
    );
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

  // El DPI que queda EN VIGOR, no solo el que escribió esta llamada: cuando el
  // registro ya lo reservó con `claimDpi`, aquí no hay nada que escribir y
  // devolver `null` haría parecer que la cuenta se quedó sin DPI.
  let appliedDpi: string | null = current.dpi;
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
