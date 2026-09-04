/**
 * Cuándo se puede dar por bueno el rol que trae la cuenta del portal.
 *
 * `CLIENT` es el rol POR DEFECTO con el que Better Auth crea toda cuenta nueva,
 * así que por sí solo no dice nada: es indistinguible de "el registro nunca se
 * completó". Tratarlo como una elección del titular es lo que dejaba a un
 * inversionista fallido clasificado como cliente para siempre — el formulario
 * de recuperación escondía el selector de tipo y reintentaba el alta como
 * CLIENT, sin ninguna forma de corregirlo desde la interfaz.
 *
 * La evidencia de que el registro sí terminó es el DPI: solo lo escribe el
 * servidor, y solo dentro de un registro validado. `INVESTOR`, en cambio, no se
 * asigna solo, así que vale como evidencia por sí mismo.
 */

type UsuarioDelPortal = {
  role?: string;
  dpi?: string;
};

export const rolFueEstablecido = (
  user: UsuarioDelPortal | null | undefined,
): boolean => {
  if (!user) {
    return false;
  }

  if (user.role === "INVESTOR") {
    return true;
  }

  if (user.role === "CLIENT") {
    return Boolean(user.dpi?.trim());
  }

  // Cualquier otro rol no es de autoservicio; se comporta como antes.
  return false;
};
