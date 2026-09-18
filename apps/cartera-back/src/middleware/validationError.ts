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

// Rubros pactó con el front un 400 —no el 422 de acá— para el body malformado,
// y lo traduce en el `onError` de su propio router. Pero este middleware se
// registra en `index.ts` ANTES que los routers, y Elysia corta la cadena de
// `onError` en cuanto uno devuelve respuesta: el del router nunca corría y el
// front recibía 422. Así que se DELEGA: no se responde el error de validación
// de rubros, para que la cadena siga hasta el manejador que sí conoce ese
// contrato. Ninguna otra ruta cambia.
//
// La decisión vive acá y no en `rubros.ts` porque el problema es el ORDEN de
// registro, y ese orden sólo se puede ceder desde el que va primero: no hay
// forma de que el router se adelante (ni con `onError({ as: "global" })`, ni
// con el hook `error` de la ruta o del `guard` — se probaron las tres y las
// tres siguen perdiendo contra este).
const esRubros = (request: Request): boolean => {
  const ruta = new URL(request.url).pathname;
  return ruta === "/rubros" || ruta.startsWith("/rubros/");
};

export const validationErrorMiddleware = (app: Elysia) =>
  app.onError(({ code, error, set, request }) => {
    if (code !== "VALIDATION") return;
    if (esRubros(request)) return;

    set.status = 422;
    const campo = extraerCampo(error);
    return {
      success: false,
      error: campo
        ? `El valor del campo "${campo}" no es válido. Corrígelo e intenta de nuevo.`
        : "Los datos enviados no son válidos. Revisa los filtros e intenta de nuevo.",
    };
  });
