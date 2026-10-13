// El user de la sesión se restaura de localStorage y su `id` es admin_id/asesor_id
// (no el de platform_users que devuelve verify), así que no se reemplaza por la
// respuesta del servidor. Lo único que se compara es el rol: si el servidor dice
// otro, la sesión se cierra para volver a iniciar con el rol vigente.

/** Rol que trae el payload de un JWT. Sin verificar la firma: solo para comparar. */
export function rolDelToken(token: unknown): string | null {
  if (typeof token !== "string") return null;
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const rol = JSON.parse(atob(base64))?.role;
    return typeof rol === "string" ? rol : null;
  } catch {
    return null;
  }
}

/** true si el servidor informa un rol y no es el guardado. Sin rol informado, no decide. */
export function rolCambio(rolGuardado: string | null | undefined, rolVigente: unknown): boolean {
  return typeof rolVigente === "string" && rolVigente !== "" && rolVigente !== rolGuardado;
}

/**
 * Para el refresh automático del interceptor: true si el rol del token rotado no es el del
 * `user` guardado en localStorage (se recibe el texto crudo; si no se puede leer, cuenta como
 * sin rol guardado). Mismo criterio que `rolCambio`.
 */
export function debeCerrarSesionPorRol(userGuardado: string | null, accessToken: unknown): boolean {
  let rolGuardado: string | undefined;
  try {
    rolGuardado = JSON.parse(userGuardado ?? "null")?.role;
  } catch {
    rolGuardado = undefined;
  }
  return rolCambio(rolGuardado, rolDelToken(accessToken));
}
