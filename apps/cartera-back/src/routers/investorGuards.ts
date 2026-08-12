// ── Guard a nivel de CAMPO para `descuenta_impuestos` ───────────────────────
// `descuenta_impuestos` cambia cuánto se le paga al inversionista (interés
// neteado 12% IVA + 7% ISR), así que solo ADMIN puede escribirlo.
//
// Enfoque: para NO-ADMIN se ELIMINA el campo del body antes de llegar al
// controller. Así el valor guardado se preserva SIN importar por qué camino
// resuelva `insertInvestor` (por inversionista_id, o el upsert legacy que
// resuelve un inversionista existente por DPI/email/nombre aunque no venga id).
// Es más seguro que detectar "cambio", porque el modal siempre manda el campo
// con su default y no podemos replicar la resolución del upsert en el guard.

type InvBody = { descuenta_impuestos?: unknown };

const elementos = (body: unknown): InvBody[] => {
  if (Array.isArray(body)) return body as InvBody[];
  if (body && typeof body === "object") return [body as InvBody];
  return [];
};

/**
 * Elimina `descuenta_impuestos` de cada elemento del body (en sitio).
 * Devuelve true si quitó el campo de al menos un elemento.
 */
export const stripDescuentaImpuestos = (body: unknown): boolean => {
  let stripped = false;
  for (const el of elementos(body)) {
    if (el && typeof el === "object" && "descuenta_impuestos" in el) {
      delete (el as any).descuenta_impuestos;
      stripped = true;
    }
  }
  return stripped;
};

/**
 * ADMIN: pasa intacto. No-ADMIN: el campo se ignora (se elimina del body); el
 * resto de la request sigue normal. Nunca devuelve 403 — no rompe el guardado
 * de otros campos, solo impide escribir el flag protegido.
 */
export const guardDescuentaImpuestos = ({
  body,
  user,
}: {
  body: unknown;
  user?: { role?: string };
  set?: { status?: number };
}): void => {
  if (user?.role === "ADMIN") return;
  stripDescuentaImpuestos(body);
};
