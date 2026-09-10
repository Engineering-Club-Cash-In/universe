import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Puerta del endpoint interno de provisionamiento.
 *
 * Es la dirección cartera-back → auth-google, que hoy no existía: las
 * credenciales CARTERA_USER/CARTERA_PASSWORD son de la dirección contraria y
 * reusarlas mezclaría dos permisos distintos en un solo secreto. Una sesión de
 * Better Auth tampoco sirve: un servicio no tiene sesión.
 */

export type ResultadoSecreto = "ok" | "invalido" | "no_configurado";

/**
 * Compara en tiempo constante sobre un SHA-256, no sobre el texto.
 *
 * Hashear primero deja los dos lados en 32 bytes, así que `timingSafeEqual` no
 * revienta con largos distintos y la duración de la comparación no filtra el
 * largo del secreto.
 */
export const verificarSecretoProvisionamiento = (
  recibido: string | null | undefined,
  esperado: string | null | undefined,
): ResultadoSecreto => {
  // Fail-closed: sin secreto configurado no pasa NADIE, ni siquiera mandando
  // vacío. Comparar contra "" convertiría un deploy al que le falta la env en
  // un endpoint abierto que crea cuentas y manda contraseñas por correo.
  if (!esperado || esperado.trim() === "") return "no_configurado";
  if (!recibido) return "invalido";

  const a = createHash("sha256").update(recibido).digest();
  const b = createHash("sha256").update(esperado).digest();

  return timingSafeEqual(a, b) ? "ok" : "invalido";
};

export const PROVISIONING_SECRET_HEADER = "x-provisioning-secret";
