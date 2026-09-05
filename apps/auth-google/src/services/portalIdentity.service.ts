/**
 * Escrituras de identidad (rol y DPI) sobre la cuenta del portal.
 *
 * Estos campos dejaron de aceptarse desde el cliente (`input: false` en
 * lib/auth.ts). Todo cambio pasa por aquí, siempre contra el userId que sale
 * de la sesión, nunca contra uno enviado en el body.
 */

import { and, eq, ne } from "drizzle-orm";

import { db } from "../db/connection";
import { users } from "../db/schema";
import {
  normalizeDpi,
  resolveRoleAfterRegistration,
  type PortalUserType,
} from "../lib/portalIdentity";

/**
 * Quien ejecuta las consultas: la conexión suelta o la transacción abierta por
 * `applyRegistrationOutcome`. Se pasa como parámetro —con `db` por defecto—
 * para no partir la firma que usa `profile.routes.ts`, que llama a `setUserDpi`
 * fuera de toda transacción.
 */
type Transaccion = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Ejecutor = typeof db | Transaccion;

export class DpiFormatError extends Error {
  constructor() {
    super("El DPI debe tener exactamente 13 dígitos");
    this.name = "DpiFormatError";
  }
}

export class DpiAlreadyTakenError extends Error {
  constructor() {
    super("El DPI ya está registrado en otra cuenta");
    this.name = "DpiAlreadyTakenError";
  }
}

/**
 * `true` si el error es un choque contra un índice único de Postgres.
 *
 * En las escrituras de abajo solo se toca `users.dpi`, así que un 23505 aquí
 * solo puede venir de la unicidad del DPI.
 */
const esViolacionDeUnicidad = (error: unknown): boolean => {
  const code = (error as { code?: unknown })?.code;

  if (code === "23505") {
    return true;
  }

  return (
    error instanceof Error &&
    /duplicate key value violates unique constraint/i.test(error.message)
  );
};

/**
 * Comprueba que el DPI esté libre para la cuenta indicada y devuelve su forma
 * normalizada. Lanza `DpiFormatError` o `DpiAlreadyTakenError`.
 *
 * Es un `SELECT`, y por tanto NO excluye nada: dos peticiones simultáneas con
 * el mismo DPI libre lo pasan las dos. No es su trabajo. La exclusión real la
 * dan los índices únicos —`cartera.inversionistas.dpi` para la fila del
 * inversionista y `users.dpi` para la identidad del portal—, y `setUserDpi`
 * traduce ese choque a `DpiAlreadyTakenError` para que el perdedor reciba un
 * 409 con sentido en vez de un 500 genérico.
 *
 * Esto existe solo para el caso común y secuencial: dar un mensaje claro antes
 * de gastar una llamada a un sistema externo. Aquí vivió una reserva escrita
 * (`claimDpi`/`releaseDpiClaim` con compare-and-set) que intentaba hacer
 * recuperable la orquestación entre los tres sistemas; se retiró al volver
 * idempotente el alta en cartera, que es la única escritura externa que
 * importa. Esa idempotencia NO es universal: solo la hay cuando el alta viaja
 * con `creado_por_usuario_portal`, es decir, en el flujo autenticado, que es
 * el único desde el que se llega aquí.
 *
 * No es un endpoint: se llama siempre dentro de un flujo con sesión y contra el
 * `userId` de esa sesión, así que no reintroduce el oráculo público de DPIs que
 * se eliminó.
 */
export async function assertDpiAvailable(
  userId: string,
  dpi: string,
  ejecutor: Ejecutor = db,
): Promise<string> {
  const normalized = normalizeDpi(dpi);

  if (!normalized) {
    throw new DpiFormatError();
  }

  // La columna es única; se comprueba antes para poder devolver un 409 claro
  // en vez de un error de constraint.
  const [taken] = await ejecutor
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.dpi, normalized), ne(users.id, userId)));

  if (taken) {
    throw new DpiAlreadyTakenError();
  }

  return normalized;
}

/**
 * Fija el DPI de la cuenta indicada. `userId` debe venir de la sesión.
 *
 * El `SELECT` de `assertDpiAvailable` no excluye a una petición simultánea, así
 * que la escritura puede chocar igual contra el índice único. Ese 23505 se
 * traduce al mismo `DpiAlreadyTakenError` que devuelve la comprobación previa:
 * quien pierde la carrera recibe un 409 que puede corregir, no un 500 mudo.
 *
 * `ejecutor` permite correr contra una transacción abierta. Por defecto es la
 * conexión suelta, que es como la usa `profile.routes.ts`.
 */
export async function setUserDpi(
  userId: string,
  dpi: string,
  ejecutor: Ejecutor = db,
): Promise<string> {
  const normalized = await assertDpiAvailable(userId, dpi, ejecutor);

  try {
    await ejecutor
      .update(users)
      .set({ dpi: normalized, updatedAt: new Date() })
      .where(eq(users.id, userId));
  } catch (error) {
    if (esViolacionDeUnicidad(error)) {
      throw new DpiAlreadyTakenError();
    }

    throw error;
  }

  return normalized;
}

/**
 * Aplica en la cuenta de la sesión el resultado de un registro que el servidor
 * ya validó: fija el DPI y, si corresponde, asciende el rol.
 *
 * El rol se decide con `resolveRoleAfterRegistration`, que nunca asigna un rol
 * fuera de los de autoservicio ni pisa uno administrativo.
 *
 * Las dos escrituras son ATÓMICAS: o quedan las dos o no queda ninguna. Ver el
 * porqué en el cuerpo.
 */
export async function applyRegistrationOutcome(
  userId: string,
  userType: PortalUserType,
  dpi: string | null | undefined,
): Promise<{ dpi: string | null; role: PortalUserType | null }> {
  // Las dos escrituras van en UNA transacción. Sueltas, un fallo entre ellas
  // —no hace falta un crash: `connectionTimeoutMillis` es de 2 s y la segunda
  // escritura pide una conexión NUEVA del pool— deja la cuenta con el DPI ya
  // commiteado y el rol en CLIENT. Ese estado es un callejón sin salida para el
  // titular: los dos caminos de recuperación del portal (el formulario de
  // `Profile.tsx` y el reintento del callback de Google en `useProfile.ts`)
  // están gateados por `!user.dpi`, que ya no se cumple, así que deja de ver la
  // sección de inversionista sin poder arreglarlo. Deshaciéndolo entero no
  // queda nada escrito y el reintento —que es idempotente, porque el alta en
  // cartera reconoce su propia fila— vuelve a estar disponible.
  //
  // `DpiAlreadyTakenError` tiene que salir FUERA del callback, nunca capturarse
  // dentro para seguir: un 23505 aborta la transacción en Postgres y cualquier
  // statement posterior fallaría con 25P02.
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: users.id, role: users.role, dpi: users.dpi })
      .from(users)
      .where(eq(users.id, userId));

    if (!current) {
      throw new Error("Usuario no encontrado");
    }

    // El DPI que queda EN VIGOR, no solo el que escribió esta llamada: si la
    // cuenta ya lo traía de un intento anterior, aquí no hay nada que escribir y
    // devolver `null` haría parecer que se quedó sin DPI.
    let appliedDpi: string | null = current.dpi;
    const normalized = normalizeDpi(dpi);

    if (normalized && normalized !== current.dpi) {
      await setUserDpi(userId, normalized, tx);
      appliedDpi = normalized;
    }

    const nextRole = resolveRoleAfterRegistration(current.role, userType);

    if (!nextRole) {
      return { dpi: appliedDpi, role: null };
    }

    // El ascenso se condiciona al rol que se leyó arriba, no solo al id. Entre
    // ese SELECT y este UPDATE media la escritura del DPI: si en esa ventana un
    // administrador cambia la cuenta a un rol administrativo, un predicado por
    // id lo pisaría con INVESTOR y rompería el invariante de que el registro del
    // portal nunca toca esos roles. `resolveRoleAfterRegistration` solo devuelve
    // un rol cuando el actual es CLIENT, así que `current.role` aquí es siempre
    // ese valor concreto.
    const ascendidos = await tx
      .update(users)
      .set({ role: nextRole, updatedAt: new Date() })
      .where(and(eq(users.id, userId), eq(users.role, current.role)))
      .returning({ id: users.id });

    // Cero filas = el rol cambió bajo nuestros pies. Se respeta el rol nuevo y
    // se reporta que no hubo ascenso. NO se deshace la transacción: el DPI sí
    // es correcto y el rol nuevo es el que manda.
    if (ascendidos.length === 0) {
      return { dpi: appliedDpi, role: null };
    }

    return { dpi: appliedDpi, role: nextRole };
  });
}
