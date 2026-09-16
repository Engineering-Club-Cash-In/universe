import { APIError } from "better-auth/api";

/**
 * Se niega a poner como contraseña nueva la que ya está puesta.
 *
 * Better Auth no lo comprueba en ninguno de los dos caminos, y con la marca de
 * primer ingreso eso deja de ser un no-op inocente: `/change-password` con la
 * MISMA contraseña temporal en los dos campos respondía 200, y ese 200 limpiaba
 * la marca. La credencial que viajó por correo seguía siendo la buena y encima
 * ya no había candado. La comprobación del formulario no cuenta: se salta con
 * una petición directa.
 *
 * Se compara contra el hash guardado y no contra `currentPassword`, y eso cubre
 * los dos caminos con una sola regla: el del enlace ni siquiera manda la
 * contraseña actual.
 *
 * Comparar contra el hash es justamente lo que obliga a pedir la prueba de
 * identidad: contestar "esa ya la tenés puesta" es contestar "acertaste", y
 * esta regla corre ANTES de que Better Auth mire la contraseña actual. Ver
 * `PruebaDeIdentidad`.
 */

/** Lo que la regla necesita de una cuenta: quién la provee y su hash. */
export interface CuentaConPassword {
  providerId: string;
  password?: string | null;
}

/** El `ctx` de Better Auth reducido a lo que esta regla usa. */
export interface ContextoDePassword {
  context: {
    internalAdapter: {
      findAccounts: (userId: string) => Promise<CuentaConPassword[]>;
    };
    password: {
      verify: (params: { hash: string; password: string }) => Promise<boolean>;
    };
  };
}

/**
 * Con qué se ganó el derecho a que esta regla conteste.
 *
 * Es explícito y sin default a propósito: el error "tiene que ser distinta"
 * solo aparece cuando la contraseña nueva ACIERTA con la que está puesta, así
 * que quien lo recibe se entera de que acertó. Eso está bien si ya probó ser
 * quien dice; es un oráculo de contraseñas si no.
 *
 * - `enlace`: el token de recuperación vigente ya es la prueba, y ese camino
 *   ni siquiera manda la contraseña actual.
 * - `sesion`: la cookie NO es prueba de nada aquí. Es lo que trae quien pide
 *   `/change-password`, y precisamente lo que `/change-password` verifica es
 *   `currentPassword`; hasta entonces, quien pide puede ser cualquiera con la
 *   sesión en la mano.
 */
export type PruebaDeIdentidad =
  | { via: "enlace" }
  | { via: "sesion"; actual: unknown };

/**
 * ¿Podemos contestarle a quien pide sin decirle nada que no supiera ya?
 *
 * Callarse cuando la contraseña actual no cuadra deja que conteste Better
 * Auth, y contesta lo mismo —`INVALID_PASSWORD`— haya acertado o no la nueva:
 * los dos desenlaces se vuelven uno solo. Que acertar cueste una verificación
 * más de argon2 no agrega nada: lo que esa diferencia de tiempo delata —si la
 * contraseña actual era la buena— ya lo dice la respuesta en voz alta.
 */
/**
 * ¿La contraseña que vino como "actual" es de verdad la de esta cuenta?
 *
 * Es la MISMA verificación que hace Better Auth unos milisegundos después, y se
 * expone porque el hook `before` la necesita para otra cosa: sin ella, el
 * camino de la sesión no puede borrar los enlaces pendientes sin destruirlos
 * también en los intentos fallidos. Con ella, se sabe que el cambio va a
 * ocurrir y el borrado puede fallar cerrado. Ver `hooksDePassword.ts`.
 *
 * Devuelve `false` —y no tira— cuando la cuenta no tiene credenciales: quien
 * entra por Google no tiene ninguna contraseña actual que probar, y ahí
 * `/change-password` va a rechazar por su cuenta.
 */
export const credencialCoincide = async (
  ctx: ContextoDePassword,
  userId: string,
  actual: unknown,
): Promise<boolean> => {
  if (typeof actual !== "string" || actual === "") return false;

  const cuentas = await ctx.context.internalAdapter.findAccounts(userId);
  const credencial = cuentas.find(
    (cuenta) => cuenta.providerId === "credential" && cuenta.password,
  );
  if (!credencial?.password) return false;

  return ctx.context.password.verify({
    hash: credencial.password,
    password: actual,
  });
};

const puedeContestar = async (
  ctx: ContextoDePassword,
  hash: string,
  prueba: PruebaDeIdentidad,
): Promise<boolean> => {
  if (prueba.via === "enlace") return true;

  const { actual } = prueba;
  if (typeof actual !== "string" || actual === "") return false;

  return ctx.context.password.verify({ hash, password: actual });
};

export const exigirPasswordDistintaALaActual = async (
  ctx: ContextoDePassword,
  userId: string,
  nueva: string,
  prueba: PruebaDeIdentidad,
): Promise<void> => {
  const cuentas = await ctx.context.internalAdapter.findAccounts(userId);
  const credencial = cuentas.find(
    (cuenta) => cuenta.providerId === "credential" && cuenta.password,
  );

  // Sin cuenta de credenciales no hay contraseña que repetir: es alguien que
  // entra por Google y el reset se la va a crear.
  if (!credencial?.password) return;

  if (!(await puedeContestar(ctx, credencial.password, prueba))) return;

  const esLaMisma = await ctx.context.password.verify({
    hash: credencial.password,
    password: nueva,
  });

  if (!esLaMisma) return;

  throw new APIError("BAD_REQUEST", {
    message:
      "La contraseña nueva tiene que ser distinta de la que estás usando.",
  });
};
