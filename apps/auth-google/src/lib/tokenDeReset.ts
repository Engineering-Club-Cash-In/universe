/**
 * ¿Este enlace de recuperación está vigente?
 *
 * Que exista la fila NO alcanza. Better Auth no borra los tokens vencidos: se
 * quedan en `verification_tokens` hasta que alguien los limpia, y él mismo los
 * rechaza comparando `expiresAt` en cada canje.
 *
 * Importa porque el hook que corre ANTES del canje usa esta fila para decidir a
 * quién le invalida los demás enlaces. Dando por buena la sola existencia,
 * mandar un enlace viejo y vencido mataba el enlace nuevo que esa persona
 * acababa de pedir —y Better Auth después rechazaba el viejo igual—, así que se
 * quedaba sin ninguno de los dos y tenía que pedir un tercero.
 */

export interface FilaDeToken {
  value?: string | null;
  expiresAt?: Date | string | null;
}

export function tokenDeResetVigente(
  fila: FilaDeToken | null | undefined,
  ahora: Date = new Date(),
): boolean {
  if (!fila?.value) return false;

  const vence = fila.expiresAt;
  if (vence == null) return false;

  const fecha = vence instanceof Date ? vence : new Date(vence);
  if (Number.isNaN(fecha.getTime())) return false;

  return fecha > ahora;
}
