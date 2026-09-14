// src/routers/rubros.ts
import { Elysia, t } from "elysia";
import { authMiddleware } from "./midleware";
import {
  RubroError,
  actualizarTipo,
  anularRubro,
  crearRubro,
  crearTipo,
  editarRubro,
  eliminarTipo,
  listarHistorial,
  listarRubrosDeCredito,
  listarTipos,
  resolverUsuarioId,
} from "../controllers/rubros";
import { MONTO_MAXIMO_RUBRO } from "../controllers/rubrosPolicy";

/**
 * Gate de rol server-side. `authMiddleware` SÓLO valida la firma del JWT: no
 * mira el rol, así que sin esto cualquier token vivo (el de un INVESTOR del
 * portal incluido) podría crearle cobros a un crédito ajeno. Mismo helper que
 * usa `latefee.ts`.
 */
const requireRole =
  (roles: string[]) =>
  (user: any, set: any): boolean => {
    if (!user || !roles.includes(user.role)) {
      set.status = 403;
      return false;
    }
    return true;
  };

/**
 * Quién puede QUÉ. El catálogo y la edición de un rubro ya creado son de ADMIN:
 * definir la naturaleza de un cobro y corregir un monto ya cobrado son
 * decisiones de negocio, no operación diaria. Consultar y dar de alta rubros sí
 * los hace el ASESOR — pero sólo de tipos NO obligatorios, y eso NO se decide
 * acá sino en `puedeCrearRubro`, que es la única que sabe qué tipo se pidió.
 */
const ADMIN = ["ADMIN"];
const ADMIN_Y_ASESOR = ["ADMIN", "ASESOR"];

const noAutorizado = (roles: string[]) => ({
  success: false,
  message: `[ERROR] No autorizado (requiere ${roles.join(" o ")})`,
});

/** Traduce el error del controlador a HTTP: 4xx redactado, 500 para lo inesperado. */
const responderError = (err: unknown, set: any, mensajeGenerico: string) => {
  if (err instanceof RubroError) {
    set.status = err.status;
    return { success: false, message: err.message };
  }
  // El detalle del 500 va al log del servidor y NO al cliente: los mensajes de
  // los 4xx los redacta la policy y el front los muestra, pero el de un error
  // inesperado lo escribe el driver y filtra la forma de la base a quien manda
  // el request.
  //
  // Ojo con lo que esconde: este callback tapaba el texto de errores como
  // "numeric field overflow" o "invalid input syntax for type integer", que NO
  // eran fallas del servidor sino entradas sin acotar llegando a Postgres. La
  // respuesta correcta a eso es cortarlas en el esquema (`t.Integer`, los
  // `maximum`) y en la policy, no ocultar el síntoma; si acá cae un 500 de esa
  // familia, falta un guard más arriba.
  console.error("❌ [rubros]", mensajeGenerico, err);
  set.status = 500;
  return { success: false, message: mensajeGenerico };
};

/**
 * Mayor entero que cabe en un `integer` de Postgres. Todas las PK de este
 * módulo son `SERIAL`, o sea `integer`: un id más grande no es "un id que no
 * existe" sino un `numeric out of range` del driver, que salía como 500.
 */
const MAX_INT_PG = 2147483647;

/**
 * `:id` de la URL a número; null si no es uno (el router responde 400).
 *
 * Se acota por ARRIBA además de por abajo: `GET /rubros/credito/99999999999999999999`
 * pasaba el `> 0`, llegaba a la consulta y reventaba en Postgres. Un id fuera
 * del rango de la columna es una URL inválida —400—, no una falla del servidor.
 *
 * La forma se valida con la EXPRESIÓN REGULAR antes de convertir, porque
 * `Number` acepta literales de JavaScript que no son ids: `Number("1e3")` es
 * 1000 y `Number("0x10")` es 16, los dos enteros y en rango. O sea que
 * `GET /rubros/credito/1e3` respondía 200 con los rubros del crédito 1000 —un
 * registro que nadie pidió, servido en silencio— en vez del 400 que merece una
 * URL que no es un id. `+1`, ` 5 ` y `5.0` caen por lo mismo: un id es una
 * cadena de dígitos y nada más.
 */
const idNumerico = (v: string): number | null => {
  if (!/^\d+$/.test(v)) return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= MAX_INT_PG ? n : null;
};

export const rubrosRouter = new Elysia({ prefix: "/rubros" })
  .use(authMiddleware)

  // Elysia responde 422 cuando el body no cumple el esquema TypeBox; el
  // contrato acordado con el front dice 400 para "body malformado". Sólo se
  // traduce ese caso: el resto de errores (401 del middleware de sesión, 500)
  // caen al manejador por defecto tal como en los demás routers.
  .onError(({ code, error, set }: any) => {
    if (code === "VALIDATION") {
      set.status = 400;
      return {
        success: false,
        message: "[ERROR] Body inválido",
        error: error?.message ?? String(error),
      };
    }
  })

  // ---------------------------------------------------------------- catálogo
  .get(
    "/tipos",
    async ({ query, user, set }: any) => {
      if (!requireRole(ADMIN_Y_ASESOR)(user, set))
        return noAutorizado(ADMIN_Y_ASESOR);
      try {
        const tipos = await listarTipos({
          incluir_inactivos: query?.incluir_inactivos === "true",
        });
        return { success: true, tipos };
      } catch (err) {
        return responderError(err, set, "Error al listar los tipos de rubro");
      }
    },
    {
      query: t.Object({ incluir_inactivos: t.Optional(t.String()) }),
      detail: { summary: "Listar tipos de rubro", tags: ["Rubros"] },
    }
  )

  .post(
    "/tipos",
    async ({ body, user, set }: any) => {
      if (!requireRole(ADMIN)(user, set)) return noAutorizado(ADMIN);
      try {
        const usuario_id = await resolverUsuarioId({
          usuario_id: user?.id ?? user?.user_id,
          usuario_email: user?.email ?? user?.correo,
        });
        const tipo = await crearTipo({ ...body, usuario_id });
        set.status = 201;
        return { success: true, tipo };
      } catch (err) {
        return responderError(err, set, "Error al crear el tipo de rubro");
      }
    },
    {
      body: t.Object({
        nombre: t.String({ minLength: 1 }),
        descripcion: t.Optional(t.String()),
        obligatorio: t.Optional(t.Boolean()),
      }),
      detail: { summary: "Crear tipo de rubro", tags: ["Rubros"] },
    }
  )

  .put(
    "/tipos/:tipo_id",
    async ({ params, body, user, set }: any) => {
      if (!requireRole(ADMIN)(user, set)) return noAutorizado(ADMIN);
      const tipo_id = idNumerico(params.tipo_id);
      if (!tipo_id) {
        set.status = 400;
        return { success: false, message: "tipo_id inválido" };
      }
      try {
        const usuario_id = await resolverUsuarioId({
          usuario_id: user?.id ?? user?.user_id,
          usuario_email: user?.email ?? user?.correo,
        });
        const tipo = await actualizarTipo(tipo_id, { ...body, usuario_id });
        return { success: true, tipo };
      } catch (err) {
        return responderError(err, set, "Error al actualizar el tipo de rubro");
      }
    },
    {
      body: t.Object({
        nombre: t.Optional(t.String({ minLength: 1 })),
        descripcion: t.Optional(t.String()),
        obligatorio: t.Optional(t.Boolean()),
        activo: t.Optional(t.Boolean()),
      }),
      detail: { summary: "Actualizar tipo de rubro", tags: ["Rubros"] },
    }
  )

  /**
   * Borra un tipo del catálogo. ADMIN only, y sólo si NADIE lo usa.
   *
   * Sirve para limpiar la entrada mal escrita o de prueba que nunca se le cobró
   * a nadie. En cuanto existe un rubro de ese tipo, el borrado se llevaría el
   * historial de cobros de clientes reales y el controlador responde 409
   * explicando que la salida es desactivarlo (`PUT` con `activo: false`).
   */
  .delete(
    "/tipos/:tipo_id",
    async ({ params, user, set }: any) => {
      if (!requireRole(ADMIN)(user, set)) return noAutorizado(ADMIN);
      const tipo_id = idNumerico(params.tipo_id);
      if (!tipo_id) {
        set.status = 400;
        return { success: false, message: "tipo_id inválido" };
      }
      try {
        const usuario_id = await resolverUsuarioId({
          usuario_id: user?.id ?? user?.user_id,
          usuario_email: user?.email ?? user?.correo,
        });
        const tipo = await eliminarTipo(tipo_id, { usuario_id });
        return { success: true, tipo };
      } catch (err) {
        return responderError(err, set, "Error al borrar el tipo de rubro");
      }
    },
    { detail: { summary: "Borrar tipo de rubro", tags: ["Rubros"] } }
  )

  // ------------------------------------------------------------------ rubros
  .get(
    "/credito/:credito_id",
    async ({ params, user, set }: any) => {
      if (!requireRole(ADMIN_Y_ASESOR)(user, set))
        return noAutorizado(ADMIN_Y_ASESOR);
      const credito_id = idNumerico(params.credito_id);
      if (!credito_id) {
        set.status = 400;
        return { success: false, message: "credito_id inválido" };
      }
      try {
        const rubros = await listarRubrosDeCredito(credito_id);
        return { success: true, rubros };
      } catch (err) {
        return responderError(err, set, "Error al listar los rubros del crédito");
      }
    },
    { detail: { summary: "Rubros de un crédito", tags: ["Rubros"] } }
  )

  .post(
    "/",
    async ({ body, user, set }: any) => {
      // ASESOR entra, pero `crearRubro` le niega (403) los tipos obligatorios:
      // el gate de rol fino necesita saber QUÉ tipo se pidió, y eso es una
      // consulta a la base que no le toca al router.
      if (!requireRole(ADMIN_Y_ASESOR)(user, set))
        return noAutorizado(ADMIN_Y_ASESOR);
      try {
        const usuario_id = await resolverUsuarioId({
          usuario_id: user?.id ?? user?.user_id,
          usuario_email: user?.email ?? user?.correo,
        });
        // El rol sale del TOKEN y va DESPUÉS del body: un `role: "ADMIN"`
        // inyectado en el JSON no puede pisar al real.
        const rubro = await crearRubro({
          ...body,
          usuario_id,
          role: user?.role,
        });
        set.status = 201;
        return { success: true, rubro };
      } catch (err) {
        return responderError(err, set, "Error al crear el rubro");
      }
    },
    {
      body: t.Object({
        // `t.Integer` y no `t.Number`: las columnas son `integer`, y un
        // `credito_id: 1.5` pasaba el `minimum: 1`, llegaba a Postgres como
        // texto "1.5" y moría con `invalid input syntax for type integer` —un
        // 500 por una entrada que el esquema tenía que haber cortado—. El tope
        // es el del `integer` de la columna, por la misma razón.
        credito_id: t.Integer({ minimum: 1, maximum: MAX_INT_PG }),
        tipo_id: t.Integer({ minimum: 1, maximum: MAX_INT_PG }),
        // El piso (mayor a cero) lo juzga la policy, que redondea primero y
        // explica el rechazo. El techo va acá además de en la policy porque un
        // `1e16` no es una decisión de negocio: es un valor que no cabe en
        // `numeric(18,2)` y terminaba en `numeric field overflow`.
        monto: t.Number({ maximum: MONTO_MAXIMO_RUBRO }),
        // REQUERIDA: la columna es NOT NULL y el tipo sólo dice QUÉ se cobra —
        // la descripción es lo que le explica el cargo a este cliente. El
        // `minLength` corta el string vacío acá; el de puros espacios lo corta
        // `crearRubro`, que es quien lo recorta antes de guardarlo.
        descripcion: t.String({ minLength: 1 }),
        motivo: t.Optional(t.String()),
      }),
      detail: { summary: "Crear rubro", tags: ["Rubros"] },
    }
  )

  .put(
    "/:rubro_id",
    async ({ params, body, user, set }: any) => {
      if (!requireRole(ADMIN)(user, set)) return noAutorizado(ADMIN);
      const rubro_id = idNumerico(params.rubro_id);
      if (!rubro_id) {
        set.status = 400;
        return { success: false, message: "rubro_id inválido" };
      }
      try {
        const usuario_id = await resolverUsuarioId({
          usuario_id: user?.id ?? user?.user_id,
          usuario_email: user?.email ?? user?.correo,
        });
        const rubro = await editarRubro(rubro_id, {
          ...body,
          usuario_id,
          role: user?.role,
        });
        return { success: true, rubro };
      } catch (err) {
        return responderError(err, set, "Error al editar el rubro");
      }
    },
    {
      body: t.Object({
        monto: t.Optional(t.Number({ maximum: MONTO_MAXIMO_RUBRO })),
        // Opcional pero NUNCA vacía: omitirla es "no la toques", mandarla es
        // reemplazarla por algo que se pueda leer. Ya no acepta `null` porque
        // la columna es NOT NULL — borrar la descripción dejaría el cargo sin
        // explicación y reventaría en la base.
        descripcion: t.Optional(t.String({ minLength: 1 })),
        // REQUERIDO en TODA edición, no sólo al cambiar el monto: corregir la
        // descripción cambia el único texto que le explica el cargo al cliente,
        // así que el historial necesita el porqué igual que en un ajuste de
        // monto.
        //
        // Presente pero SIN `minLength` a propósito: quien juzga si el motivo
        // sirve es `editarRubro`, que lo recorta y responde 400 con el texto
        // que explica por qué hace falta. Con `minLength` acá, un motivo vacío
        // —el caso común, el campo que el usuario no llenó— moría en el 422
        // genérico del middleware de validación, mientras que uno de puros
        // espacios llegaba al guard y recibía el mensaje bueno: la misma
        // intención del usuario con dos respuestas distintas, y la peor
        // tocándole al caso más frecuente.
        motivo: t.String(),
      }),
      detail: { summary: "Editar rubro", tags: ["Rubros"] },
    }
  )

  /**
   * Anula un rubro. ADMIN only y con motivo obligatorio.
   *
   * Es POST y no DELETE porque NO borra: la fila sobrevive con su
   * `monto_original` intacto, deja de cobrarse y libera el índice único para
   * que se pueda crear el rubro correcto de ese tipo. Sin esta ruta, un cobro
   * cargado por error era permanente —no hay DELETE, editarlo a 0 lo rechaza la
   * policy y `completado` sólo lo enciende un abono, que es fase 2— y la única
   * salida era un UPDATE a mano en producción.
   */
  .post(
    "/:rubro_id/anular",
    async ({ params, body, user, set }: any) => {
      if (!requireRole(ADMIN)(user, set)) return noAutorizado(ADMIN);
      const rubro_id = idNumerico(params.rubro_id);
      if (!rubro_id) {
        set.status = 400;
        return { success: false, message: "rubro_id inválido" };
      }
      try {
        const usuario_id = await resolverUsuarioId({
          usuario_id: user?.id ?? user?.user_id,
          usuario_email: user?.email ?? user?.correo,
        });
        // Igual que en el alta: el rol sale del TOKEN y va DESPUÉS del body,
        // para que un `role: "ADMIN"` inyectado en el JSON no pueda pisar al
        // real.
        const rubro = await anularRubro(rubro_id, {
          ...body,
          usuario_id,
          role: user?.role,
        });
        return { success: true, rubro };
      } catch (err) {
        return responderError(err, set, "Error al anular el rubro");
      }
    },
    {
      body: t.Object({
        // Presente pero SIN `minLength`, por la misma razón que en el PUT: el
        // motivo vacío —el caso común— tiene que llegar al controlador y
        // recibir el 400 con el texto que explica por qué hace falta, no el 422
        // genérico del validador.
        motivo: t.String(),
      }),
      detail: { summary: "Anular rubro", tags: ["Rubros"] },
    }
  )

  .get(
    "/:rubro_id/historial",
    async ({ params, user, set }: any) => {
      if (!requireRole(ADMIN_Y_ASESOR)(user, set))
        return noAutorizado(ADMIN_Y_ASESOR);
      const rubro_id = idNumerico(params.rubro_id);
      if (!rubro_id) {
        set.status = 400;
        return { success: false, message: "rubro_id inválido" };
      }
      try {
        const historial = await listarHistorial(rubro_id);
        return { success: true, historial };
      } catch (err) {
        return responderError(err, set, "Error al obtener el historial del rubro");
      }
    },
    { detail: { summary: "Historial de un rubro", tags: ["Rubros"] } }
  );
