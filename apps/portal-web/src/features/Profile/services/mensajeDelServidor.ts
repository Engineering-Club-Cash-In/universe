/**
 * Motivo legible de un rechazo de auth-google.
 *
 * auth-google no contesta sus errores con un `message` plano: el manejador
 * global (`middleware/error.ts`) serializa cada `HTTPException` como
 * `{ success: false, error: { message } }`. Quien leía `data.error` esperando
 * texto recibía un OBJETO, y el `Error` construido con él acababa mostrándole
 * al usuario "[object Object]" —o el mensaje genérico— en vez del motivo real,
 * justo en los casos que la persona puede corregir sola (DPI mal formado, DPI
 * de otra cuenta).
 *
 * Se aceptan las dos formas porque conviven: las rutas que contestan con
 * `c.json(...)` sí mandan el mensaje plano.
 */
const texto = (valor: unknown): string | null =>
  typeof valor === "string" && valor.trim() ? valor.trim() : null;

export const mensajeDelServidor = (error: unknown, respaldo: string): string => {
  const datos = (error as { response?: { data?: unknown } })?.response?.data as
    | { message?: unknown; error?: unknown }
    | undefined;

  if (!datos) {
    return respaldo;
  }

  const anidado = (datos.error as { message?: unknown } | undefined)?.message;

  return (
    texto(datos.message) ?? texto(anidado) ?? texto(datos.error) ?? respaldo
  );
};
