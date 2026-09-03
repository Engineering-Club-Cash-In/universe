/**
 * Reglas de identidad del portal: qué rol puede quedarse una cuenta y cómo se
 * normaliza el DPI.
 *
 * El rol NO se acepta desde el cliente. El portal solo puede provocar el
 * ascenso a los roles de autoservicio, y siempre como consecuencia de un
 * registro que el servidor ya validó.
 */

/** Roles que el portal puede asignarse por autoservicio. */
export const PORTAL_USER_TYPES = ["CLIENT", "INVESTOR"] as const;

export type PortalUserType = (typeof PORTAL_USER_TYPES)[number];

/**
 * `true` solo si el valor es exactamente uno de los roles de autoservicio.
 * Cualquier otro rol (ADMIN, SELLER, DEBTOR) queda fuera por definición.
 */
export function isPortalUserType(value: unknown): value is PortalUserType {
  return (
    typeof value === "string" &&
    (PORTAL_USER_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Decide qué rol debe persistirse tras un registro validado por el servidor.
 * Devuelve `null` cuando no corresponde ningún cambio.
 *
 * Reglas:
 * - Solo se asciende desde CLIENT, que es el rol por defecto.
 * - Nunca se degrada un INVESTOR.
 * - Nunca se toca un rol que no sea de autoservicio (ADMIN, SELLER, DEBTOR):
 *   un flujo del portal no tiene por qué reescribir un rol administrativo.
 */
export function resolveRoleAfterRegistration(
  currentRole: string | null | undefined,
  requestedType: PortalUserType,
): PortalUserType | null {
  if (!isPortalUserType(requestedType)) {
    return null;
  }

  // Un rol ajeno al portal se respeta tal cual.
  if (!isPortalUserType(currentRole)) {
    return null;
  }

  // Solo el rol por defecto puede ascender, y solo a INVESTOR.
  if (currentRole === "CLIENT" && requestedType === "INVESTOR") {
    return "INVESTOR";
  }

  return null;
}

/**
 * Normaliza un DPI a sus 13 dígitos. Devuelve `null` si no cumple el formato.
 */
export function normalizeDpi(dpi: string | null | undefined): string | null {
  if (typeof dpi !== "string") {
    return null;
  }

  const cleaned = dpi.replace(/[\s-]/g, "");

  return /^\d{13}$/.test(cleaned) ? cleaned : null;
}
