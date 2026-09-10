/**
 * Nombre de la cookie de sesión de Better Auth.
 *
 * Vive aquí (y no en `lib/auth.ts`) porque lo necesitan dos consumidores: la
 * propia configuración de Better Auth y la defensa anti-CSRF, que tiene que
 * reconocer cuándo el navegador está adjuntando credenciales de forma
 * ambiental. Si los dos valores se separaran, la defensa dejaría de disparar.
 */
export const SESSION_COOKIE_PREFIX = "better-auth";

/**
 * Nombre real de la cookie según el prefijo de seguridad que le ponga el
 * navegador. `__Secure-` aparece cuando `useSecureCookies` está activo
 * (producción); `__Host-` se contempla por si la configuración cambia.
 */
const SESSION_COOKIE_NAME = new RegExp(
  `(?:^|;)\\s*(?:__Secure-|__Host-)?${SESSION_COOKIE_PREFIX}\\.`,
);

/**
 * `true` si la petición trae la cookie de sesión del portal.
 *
 * Es el disparador de la comprobación de origen: una petición SIN cookie no
 * puede ser víctima de CSRF (no hay credencial que el navegador adjunte solo),
 * y las llamadas servicio-a-servicio —que se autorizan con una cabecera
 * explícita— caen justo en ese caso.
 */
export function hasSessionCookie(
  cookieHeader: string | null | undefined,
): boolean {
  if (typeof cookieHeader !== "string" || cookieHeader.length === 0) {
    return false;
  }

  return SESSION_COOKIE_NAME.test(cookieHeader);
}
