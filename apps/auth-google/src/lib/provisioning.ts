import { randomBytes } from "node:crypto";

/**
 * Reglas puras del provisionamiento de cuentas del portal.
 *
 * auth-google EJECUTA; no decide quién debe tener cuenta. Esa decisión vive en
 * cartera (`provisionamientoPortal.ts`), donde están `dpi_rep_legal` y el
 * correo. Aquí solo está lo que depende de la tabla de identidad: cómo se busca
 * a alguien que ya existe, qué se puede escribir y qué rol queda.
 */

/** Roles que el portal puede asignar por autoservicio. */
export const PORTAL_USER_TYPES = ["CLIENT", "INVESTOR"] as const;
export type PortalUserType = (typeof PORTAL_USER_TYPES)[number];

export function isPortalUserType(value: unknown): value is PortalUserType {
  return (
    typeof value === "string" &&
    (PORTAL_USER_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Decide qué rol debe persistirse tras un alta ya validada por el servidor.
 * `null` = no tocar nada.
 *
 * - Solo asciende desde CLIENT, que es el rol por defecto de la tabla.
 * - Nunca degrada a un INVESTOR.
 * - Nunca toca un rol ajeno al portal (ADMIN, SELLER, DEBTOR): que a un
 *   administrador le den de alta un inversionista no puede costarle su rol.
 *
 * Mismo criterio que `resolveRoleAfterRegistration` de
 * `fix/portal-escritura-por-dpi`; al mergear las ramas debe quedar UNA sola.
 */
export function resolveRoleAfterRegistration(
  currentRole: string | null | undefined,
  requestedType: PortalUserType,
): PortalUserType | null {
  if (!isPortalUserType(requestedType)) return null;

  // Un rol ajeno al portal (o ausente, o desconocido) se respeta tal cual.
  if (!isPortalUserType(currentRole)) return null;

  if (currentRole === "CLIENT" && requestedType === "INVESTOR") {
    return "INVESTOR";
  }

  return null;
}

/** Deja solo los dígitos, tolerando la basura de captura conocida. */
const soloDigitos = (valor: unknown): string | null => {
  if (typeof valor !== "string" && typeof valor !== "number") return null;
  // Espacios, guiones Y PUNTOS: las tres formas de suciedad que existen hoy en
  // "auth-google".users ('1573 66197 01', '1852752810101.').
  const limpio = String(valor).replace(/[\s.\-]/g, "");
  return /^\d+$/.test(limpio) ? limpio : null;
};

/**
 * Normalizador de LECTURA. Permisivo a propósito.
 *
 * Es más laxo que el de escritura porque su trabajo es ENCONTRAR a quien ya
 * existe, incluidas las filas sucias que ya están en producción. Si no
 * encuentra al usuario existente, el alta intenta crearlo otra vez y revienta
 * contra `users_dpi_key` en vez de reconocer que esa persona ya tenía cuenta.
 * Un falso negativo aquí es un 23505; un falso positivo no existe, porque
 * compara dígitos completos.
 *
 * Devuelve dígitos sin ceros a la izquierda, igual que el lado de cartera, para
 * que los dos hablen el mismo idioma.
 */
export function normalizarDpiParaBuscar(
  dpi: string | number | null | undefined,
): string | null {
  const digitos = soloDigitos(dpi);
  if (digitos === null) return null;
  const sinCeros = digitos.replace(/^0+/, "");
  return sinCeros === "" ? null : sinCeros;
}

/**
 * Normalizador de ESCRITURA. Estricto a propósito: exactamente 13 dígitos.
 *
 * `users.dpi` es UNIQUE y es una columna de IDENTIDAD: lo que no sea un DPI
 * entero no se escribe, se deja en NULL. Nunca cadena vacía — el slot del `''`
 * YA está ocupado en producción (`direccion@grupowad.com`) y un segundo revienta
 * con 23505, tumbando un alta por un dato que ni siquiera hacía falta.
 *
 * No quita ceros a la izquierda: aquí el valor se GUARDA, y un DPI que empieza
 * en cero conserva su cero.
 */
export function normalizarDpiParaGuardar(
  dpi: string | number | null | undefined,
): string | null {
  const digitos = soloDigitos(dpi);
  if (digitos === null) return null;
  return /^\d{13}$/.test(digitos) ? digitos : null;
}

/**
 * Contraseña inicial de una cuenta recién provisionada.
 *
 * 12 caracteres URL-safe: por encima del mínimo de 8 que exige Better Auth
 * (`lib/auth.ts`) y sin caracteres que se pierdan al copiarla desde el correo,
 * que es exactamente como va a llegarle a su dueño.
 */
export function generarPasswordPortal(): string {
  return randomBytes(9).toString("base64url");
}
