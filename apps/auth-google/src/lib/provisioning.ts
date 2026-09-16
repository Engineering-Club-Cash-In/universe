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
 * Forma canónica del DPI para el portal: dígitos, sin ceros a la izquierda.
 *
 * ES UNA SOLA para LEER y para ESCRIBIR, y eso es la corrección: antes había
 * dos criterios distintos —la lectura era permisiva y la escritura exigía 13
 * dígitos exactos— y la asimetría creaba cuentas duplicadas. Cartera manda el
 * DPI ya sin ceros a la izquierda (`inversionistas.dpi` es bigint), así que a
 * todo el que no tuviera exactamente 13 dígitos se le creaba la cuenta con
 * `users.dpi = NULL`. Desde ahí solo era encontrable por correo — y el propio
 * sistema PIDE que un humano corrija ese correo (`correo_de_cartera_distinto_
 * al_de_la_cuenta`). Corregido el correo, la corrida siguiente no lo encontraba
 * por ningún lado y le creaba una SEGUNDA cuenta con una SEGUNDA contraseña.
 *
 * Por qué esta forma y no "13 dígitos exactos":
 *
 * - Los DPI reales de producción no son todos de 13 dígitos. Hay cédulas
 *   viejas de 7 y 8 (el inversionista 187 tiene `4036613`), y son personas que
 *   existen: un criterio que las rechace las deja sin identidad para siempre.
 * - `users.dpi` trae basura de captura ('1573 66197 01', '1852752810101.',
 *   una cadena vacía). Limpiar espacios, puntos y guiones es lo que permite
 *   reconocer a esas filas en vez de intentar crearlas otra vez.
 * - Es EXACTAMENTE lo que hace la búsqueda en SQL
 *   (`ltrim(regexp_replace(...), '0')`, ver `provisioning/dpiLookup.ts`) y lo
 *   que manda cartera (`normalizarDpiParaComparar`). Los tres tienen que decir
 *   lo mismo o el sistema vuelve a partirse por la misma grieta.
 *
 * Nunca devuelve cadena vacía: `users.dpi` es UNIQUE y el slot del `''` YA
 * está ocupado en producción (`direccion@grupowad.com`); un segundo `''`
 * reventaría con 23505 y tumbaría un alta por un dato que ni hacía falta.
 *
 * RIESGO ASUMIDO: normalizar puede empatar a dos filas distintas (hoy
 * `1852752810101` lo tienen Oscar Massis y la cuenta de Inversiones Monaco, que
 * quedó capturada con el DPI de su representante). Ese empate ya existía en la
 * lectura; escribir más DPIs lo hace un poco más probable. El desenlace es un
 * `ya_tenia` contra la fila equivocada, que sale reportado como
 * `correo_de_cartera_distinto_al_de_la_cuenta`, no un acceso concedido a nadie.
 */
export function normalizarDpiPortal(
  dpi: string | number | null | undefined,
): string | null {
  const digitos = soloDigitos(dpi);
  if (digitos === null) return null;
  const sinCeros = digitos.replace(/^0+/, "");
  return sinCeros === "" ? null : sinCeros;
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
