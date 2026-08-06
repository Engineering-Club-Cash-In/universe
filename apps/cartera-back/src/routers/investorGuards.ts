import { db } from "../database/index";
import { inversionistas } from "../database/db/schema";
import { eq } from "drizzle-orm";

// ── Guard a nivel de CAMPO para `descuenta_impuestos` ───────────────────────
// `descuenta_impuestos` cambia cuánto se le paga al inversionista (interés
// neteado 12% IVA + 7% ISR), así que solo ADMIN puede CAMBIARLO. El resto del
// endpoint sigue abierto a cualquier usuario autenticado.
//
// OJO: el modal de carteraFront siempre incluye `descuenta_impuestos` en el
// payload (default false del form), aunque el usuario no toque el checkbox.
// Por eso NO alcanza con detectar la presencia del campo: hay que comparar
// contra el valor guardado y bloquear solo cuando el valor REALMENTE cambia
// (o cuando se crea un inversionista con el flag en true).

type InvBody = { inversionista_id?: number | string; descuenta_impuestos?: unknown };

const elementos = (body: unknown): InvBody[] => {
  if (Array.isArray(body)) return body as InvBody[];
  if (body && typeof body === "object") return [body as InvBody];
  return [];
};

/**
 * ¿El body intenta CAMBIAR `descuenta_impuestos` respecto de lo guardado?
 * - update (con inversionista_id): true si el nuevo valor != el actual en BD.
 * - create (sin id): true solo si se pide activarlo (true); false = default.
 * Un valor no booleano se ignora (lo filtra el controller aguas abajo).
 */
export const intentaCambiarDescuentaImpuestos = async (body: unknown): Promise<boolean> => {
  for (const el of elementos(body)) {
    if (typeof el?.descuenta_impuestos !== "boolean") continue;
    const nuevo = el.descuenta_impuestos as boolean;

    const id = el.inversionista_id != null ? Number(el.inversionista_id) : null;
    if (id == null || Number.isNaN(id)) {
      // create: solo activar requiere ADMIN; false es el default y no cambia nada.
      if (nuevo === true) return true;
      continue;
    }

    const [actual] = await db
      .select({ descuenta_impuestos: inversionistas.descuenta_impuestos })
      .from(inversionistas)
      .where(eq(inversionistas.inversionista_id, id))
      .limit(1);

    // Si no existe todavía, se tratará como create aguas abajo: activar = cambio.
    if (!actual) {
      if (nuevo === true) return true;
      continue;
    }
    if (actual.descuenta_impuestos !== nuevo) return true;
  }
  return false;
};

export const guardDescuentaImpuestos = async ({
  body,
  user,
  set,
}: {
  body: unknown;
  user?: { role?: string };
  set: { status?: number };
}): Promise<{ message: string } | null> => {
  if (user?.role === "ADMIN") return null; // ADMIN puede todo, sin tocar la BD
  if (!(await intentaCambiarDescuentaImpuestos(body))) return null;
  set.status = 403;
  return { message: "Solo ADMIN puede modificar descuenta_impuestos" };
};
