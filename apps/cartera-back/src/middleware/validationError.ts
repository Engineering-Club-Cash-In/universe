import { Elysia } from "elysia";

// Cuando un request no pasa la validación de esquema (los t.Object de cada
// ruta), Elysia lo rechaza ANTES de ejecutar el handler, por lo que ningún
// try/catch de las rutas alcanza a traducir el error técnico de TypeBox
// (en inglés). Este hook es el único punto central donde se puede
// interceptar para responder { success, error } en español.

const extraerCampo = (error: any): string => {
  const errores = error?.all;
  let campo = "";
  if (Array.isArray(errores)) {
    const conPath = errores.find(
      (e: any) => typeof e?.path === "string" && e.path.length > 0
    );
    campo = conPath?.path?.replace(/^\//, "") ?? "";
  }
  if (!campo) {
    // El mensaje de TypeBox es un JSON con la propiedad inválida
    try {
      campo = (JSON.parse(error?.message)?.property ?? "").replace(/^\//, "");
    } catch {
      /* mensaje no es JSON, se usa el texto genérico */
    }
  }
  // "root" significa que TypeBox no identificó un campo puntual
  return campo === "root" ? "" : campo;
};

export const validationErrorMiddleware = (app: Elysia) =>
  app.onError(({ code, error, set }) => {
    if (code !== "VALIDATION") return;

    set.status = 422;
    const campo = extraerCampo(error);
    return {
      success: false,
      error: campo
        ? `El valor del campo "${campo}" no es válido. Corrígelo e intenta de nuevo.`
        : "Los datos enviados no son válidos. Revisa los filtros e intenta de nuevo.",
    };
  });
