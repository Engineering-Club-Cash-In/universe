/**
 * Rutas para operaciones de Cartera (inversiones, inversionistas, etc.)
 * Todas estas rutas requieren autenticación de Better Auth
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  // Investor
  CarteraInvestorError,
  createInvestor,
  getEntidades,
  getInvestorProfileById,
  getInvestorDocumentsById,
  getBancos,
  // Investments
  getLiquidaciones,
  getInvestmentsStats,
  getAsesorById,
  type EntidadPortal,
} from "../services/cartera";
import {
  PortalInvestorPayloadError,
  buildPortalInvestorUpdate,
} from "../lib/portalInvestorPayload";
import { requireAuth, type AuthedVariables } from "../middleware/requireAuth";
import { getSignedUrlFromBucket } from "../lib/storage";

const carteraRoutes = new Hono<{ Variables: AuthedVariables }>();

// ============================================
// MIDDLEWARE DE AUTENTICACIÓN
// ============================================

// Aplicar middleware a todas las rutas. `requireAuth` deja en el contexto el
// usuario ya validado, que es de donde salen las identidades que usan los
// handlers.
carteraRoutes.use("*", requireAuth);

// ============================================
// ENTIDADES DE LA SESIÓN
// ============================================
// Un login del portal puede operar varios inversionistas: el propio y el de
// cada sociedad que representa. Cartera resuelve ese conjunto a partir del
// correo, y acá se decide cuál de ellos atiende cada request.
//
// El correo sale SIEMPRE de la sesión, nunca del query string: tomarlo del
// cliente dejaba que cualquier usuario logueado leyera los datos de otro
// pasando `?email=`.

const TTL_ENTIDADES_MS = 60 * 1000;

/**
 * Techo de correos cacheados a la vez.
 *
 * El TTL por sí solo no libera nada: solo hace que un valor vencido se ignore
 * o se pise CUANDO ESA MISMA persona vuelve. Quien entra una vez y no vuelve
 * deja su entrada ahí para siempre, y el proceso es de vida larga. Con el
 * registro abierto y sin verificación de correo, eso es memoria que crece sola.
 *
 * 500 correos activos a la vez es holgado para el portal —hoy hay 16 cuentas—
 * y acota el peor caso a algo que no importa.
 */
const MAX_ENTIDADES_CACHE = 500;

const cacheEntidades = new Map<
  string,
  { entidades: EntidadPortal[]; expiraEn: number }
>();

/**
 * Deja sitio antes de guardar: primero lo vencido, y si aún así se llegó al
 * techo, lo más viejo. `Map` conserva el orden de inserción, así que la primera
 * llave es la que lleva más tiempo dentro.
 */
const hacerSitioEnCache = (): void => {
  const ahora = Date.now();

  for (const [correo, valor] of cacheEntidades) {
    if (valor.expiraEn <= ahora) cacheEntidades.delete(correo);
  }

  while (cacheEntidades.size >= MAX_ENTIDADES_CACHE) {
    const masViejo = cacheEntidades.keys().next();
    if (masViejo.done) break;
    cacheEntidades.delete(masViejo.value);
  }
};

/** Correo de la sesión, normalizado. Lanza 401 si no hay. */
const correoDeSesion = (c: any): string => {
  const user = c.get("user") as { email?: string | null } | undefined;
  const email = user?.email?.trim().toLowerCase();

  if (!email) {
    throw new HTTPException(401, { message: "No autorizado. Inicia sesión." });
  }

  return email;
};

/**
 * Entidades que puede operar el usuario de la sesión.
 *
 * Cacheadas un minuto: el CRM da de alta sociedades en caliente y no queremos
 * que el inversionista tenga que volver a entrar para verlas.
 *
 * El caché es una optimización de LECTURA, no una autorización: lo que guarda
 * es la respuesta de cartera de hace hasta un minuto, no un permiso vigente.
 * Por eso quien va a ESCRIBIR pide `{ frescas: true }` y la resuelve de nuevo
 * (ver `entidadPedida`).
 *
 * @param frescas ignora lo cacheado y vuelve a preguntarle a cartera. El
 *                resultado sí se guarda: refrescar no es saltarse el caché,
 *                es actualizarlo.
 */
const resolverEntidades = async (
  c: any,
  { frescas = false }: { frescas?: boolean } = {},
): Promise<EntidadPortal[]> => {
  const email = correoDeSesion(c);

  if (!frescas) {
    const cacheado = cacheEntidades.get(email);
    if (cacheado && cacheado.expiraEn > Date.now()) {
      return cacheado.entidades;
    }
  }

  const entidades = await getEntidades(email);
  hacerSitioEnCache();
  cacheEntidades.set(email, {
    entidades,
    expiraEn: Date.now() + TTL_ENTIDADES_MS,
  });

  return entidades;
};

/**
 * Resuelve a qué entidad apunta el request y verifica que sea del usuario.
 *
 * @param idCrudo id pedido por el cliente (query o body). Sin él se usa la
 *                primera entidad, que es como se comportaba el portal antes de
 *                que existiera el selector.
 * @param frescas re-resuelve la pertenencia contra cartera en vez de confiar en
 *                el caché. Obligatorio para las MUTACIONES: si el staff le quita
 *                o le cambia el representante legal a una sociedad, la lista
 *                cacheada la sigue autorizando hasta un minuto, y en esa ventana
 *                el ex-representante puede reescribirle los datos bancarios a
 *                una entidad que ya no le corresponde. Va por aquí y no por una
 *                invalidación del caché a propósito: invalidar exigiría que
 *                cartera y el CRM avisaran cada vez que cambia una relación de
 *                representación, y basta con que uno de esos avisos falte para
 *                que el agujero vuelva sin que nada lo delate.
 */
const entidadPedida = async (
  c: any,
  idCrudo?: unknown,
  {
    frescas = false,
    exigeUnaSola = false,
  }: { frescas?: boolean; exigeUnaSola?: boolean } = {},
): Promise<EntidadPortal> => {
  const entidades = await resolverEntidades(c, { frescas });

  if (entidades.length === 0) {
    throw new HTTPException(404, {
      message:
        "Tu usuario todavía no está vinculado a un inversionista. Escribile a tu asesor.",
    });
  }

  if (idCrudo === undefined || idCrudo === null || idCrudo === "") {
    // Sin id, la de SIEMPRE: la que cuelga del correo de la sesión.
    //
    // Es el camino de compatibilidad —el portal anterior al selector no manda
    // `inversionista_id`— y por eso tiene que comportarse como antes, cuando
    // cartera resolvía por correo y nada más. Devolver `entidades[0]` cambiaba
    // esa respuesta: la lista viene ordenada con la persona primero, así que a
    // quien tiene su correo puesto en una SOCIEDAD y además una fila personal,
    // una edición bancaria pensada para la sociedad le caía encima a su fila
    // personal. Y el perfil, los documentos y las inversiones le mostraban la
    // entidad equivocada.
    //
    // `es_ancla` es justo eso: la fila cuyo correo casó con el de la sesión.
    // `entidades[0]` queda de respaldo para las que solo llegaron por
    // expansión de DPI, donde no hay ancla que preferir.
    const anclas = entidades.filter((e) => e.es_ancla);

    // Y si el correo casó con VARIAS, escribir sin id no se hace.
    //
    // `inversionistas.email` no es único: el representante de una sociedad
    // suele tener su correo puesto en su ficha personal Y en la de la empresa,
    // que es justo el caso que este PR viene a resolver con el selector. Con el
    // id, la elección la hace la persona; sin él, elegir por el orden de la
    // lista es escribirle la cuenta bancaria a la entidad equivocada, sin que
    // nadie se entere y con la anterior ya pisada.
    //
    // Es el 409 que hacía `findInvestorByEmail` con `coincidencias_email > 1`,
    // que se perdió al mudar la resolución al selector: mismo texto, para que
    // el portal viejo siga viendo la misma respuesta. Solo aplica a las
    // ESCRITURAS —las lecturas siguen enseñando el ancla— porque leer la
    // entidad equivocada se corrige mirando otra vez, y escribirla no.
    if (exigeUnaSola && anclas.length > 1) {
      throw new HTTPException(409, {
        message:
          "Tu correo está asociado a más de un inversionista. " +
          "Contacta a soporte para que lo corrijan antes de editar tus datos.",
      });
    }

    return anclas[0] ?? entidades[0];
  }

  const id = Number(idCrudo);
  const entidad = entidades.find((e) => e.inversionista_id === id);

  // El id lo manda el navegador: sin esta comprobación cualquiera podría leer
  // (o escribirle) a un inversionista ajeno solo cambiando el número.
  if (!entidad) {
    throw new HTTPException(403, {
      message: "Esa entidad no pertenece a tu usuario",
    });
  }

  return entidad;
};

/**
 * GET /api/cartera/entidades
 * Entidades que el usuario de la sesión puede operar. Sin parámetros: es lo que
 * el portal pide, no lo que le manden.
 */
carteraRoutes.get("/entidades", async (c) => {
  try {
    const entidades = await resolverEntidades(c);

    return c.json({
      success: true,
      data: entidades,
    });
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(500, {
      message:
        error instanceof Error ? error.message : "Error al obtener las entidades",
    });
  }
});

// ============================================
// RUTAS DE INVERSIONISTAS
// ============================================

/**
 * POST /api/cartera/investor
 * Actualiza los datos bancarios de una de las entidades del usuario.
 *
 * El destino NO se acepta a ciegas: `entidadPedida` comprueba que el
 * `inversionista_id` que manda el navegador esté entre las entidades de la
 * sesión y responde 403 si no lo está. Del cuerpo solo sobreviven los campos
 * editables (ver `buildPortalInvestorUpdate`): antes se reenviaba crudo a
 * cartera con el token de admin, y el upsert de allá acepta `nombre`, `dpi`,
 * `email`, `emite_factura`, `descuenta_impuestos`, `tipo_reinversion` y
 * `dpi_rep_legal`. Ese último concede acceso a entidades, así que un usuario
 * del portal podía auto-asignarse las sociedades de cualquiera.
 */
carteraRoutes.post("/investor", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "Cuerpo de la petición inválido" });
  }

  // RIESGO CONOCIDO Y ABIERTO, a la espera de una decisión de negocio:
  // `requireEmailVerification` está en false (lib/auth.ts), así que la sesión
  // NO prueba que el correo sea de quien lo usa. Como el conjunto de entidades
  // se resuelve por ese correo, si el de un inversionista todavía no estaba
  // registrado en Better Auth, alguien podía crear una cuenta con él y
  // reescribirle los datos de cobro sin acertar su DPI ni su nombre.
  //
  // Aquí NO se pone una barrera parcial a propósito: cualquier apaño local da
  // falsa tranquilidad y deja el problema real —que la identidad del portal se
  // apoya en un correo sin verificar— fuera de la vista. La salida es exigir
  // verificación de correo; el ataque necesita una cuenta NUEVA, así que
  // exigirla solo a los registros nuevos cierra el hueco sin tocar a las
  // cuentas que ya existen. Ver el hilo del review en el PR #1545.

  try {
    // `frescas: true`: la pertenencia de una escritura no se decide con una
    // lista de hace un minuto. Ver `entidadPedida`.
    const entidad = await entidadPedida(
      c,
      (body as { inversionista_id?: unknown } | null)?.inversionista_id,
      { frescas: true, exigeUnaSola: true },
    );

    // Whitelist: lo único que el inversionista edita de su propia ficha, ya
    // validado y dirigido por el id que resolvió el servidor.
    const payload = buildPortalInvestorUpdate(entidad.inversionista_id, body);

    const result = await createInvestor(payload);

    return c.json({
      success: true,
      message: "Inversionista actualizado correctamente",
      data: result,
    });
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }

    // Un campo mal formado es culpa de quien llama, no del servidor.
    if (error instanceof PortalInvestorPayloadError) {
      throw new HTTPException(400, { message: error.message });
    }

    // Un rechazo de cartera viaja con su motivo. La escritura ya está acotada
    // a una entidad del titular, así que el mensaje no puede hablar de terceros.
    if (error instanceof CarteraInvestorError) {
      const status =
        error.status === 400 || error.status === 409 ? error.status : 502;
      throw new HTTPException(status, { message: error.message });
    }

    throw new HTTPException(502, {
      message: "Error al actualizar inversionista",
    });
  }
});

/**
 * GET /api/cartera/investor
 * Perfil de la entidad activa
 */
carteraRoutes.get("/investor", async (c) => {
  try {
    const entidad = await entidadPedida(c, c.req.query("inversionista_id"));

    const profile = await getInvestorProfileById(entidad.inversionista_id);

    return c.json({
      success: true,
      data: profile,
    });
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : "Error al obtener perfil del inversionista",
    });
  }
});

/**
 * GET /api/cartera/bancos
 * Obtener catálogo de bancos
 */
carteraRoutes.get("/bancos", async (c) => {
  try {
    const bancos = await getBancos(true);

    return c.json({
      success: true,
      data: bancos,
    });
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : "Error al obtener bancos",
    });
  }
});

// ============================================
// RUTAS DE DOCUMENTOS DE INVERSIONISTAS
// ============================================

/**
 * GET /api/cartera/investor-documents
 * Documentos visibles de la entidad activa
 */
carteraRoutes.get("/investor-documents", async (c) => {
  try {
    const entidad = await entidadPedida(c, c.req.query("inversionista_id"));

    const documents = await getInvestorDocumentsById(entidad.inversionista_id);

    return c.json({
      success: true,
      data: documents,
    });
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : "Error al obtener documentos del inversionista",
    });
  }
});

/**
 * GET /api/cartera/investor-documents/client/:email
 * Alias de compatibilidad para el portal anterior al selector. El :email se
 * ignora — se atiende la entidad de la sesión — para que auth-google se pueda
 * desplegar sin esperar al front.
 */
carteraRoutes.get("/investor-documents/client/:email", async (c) => {
  try {
    const entidad = await entidadPedida(c);

    const documents = await getInvestorDocumentsById(entidad.inversionista_id);

    return c.json({
      success: true,
      data: documents,
    });
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : "Error al obtener documentos del inversionista",
    });
  }
});

// ============================================
// RUTAS DE INVERSIONES / LIQUIDACIONES
// ============================================

/**
 * GET /api/cartera/liquidaciones
 * Liquidaciones de la entidad activa
 */
carteraRoutes.get("/liquidaciones", async (c) => {
  try {
    const entidad = await entidadPedida(c, c.req.query("inversionista_id"));
    const page = parseInt(c.req.query("page") || "1", 10);
    const perPage = parseInt(c.req.query("perPage") || "10", 10);

    const liquidaciones = await getLiquidaciones(
      entidad.inversionista_id,
      page,
      perPage,
    );

    return c.json({
      success: true,
      ...liquidaciones,
    });
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : "Error al obtener liquidaciones",
    });
  }
});

/**
 * GET /api/cartera/investments/stats
 * Estadísticas de la entidad activa
 */
carteraRoutes.get("/investments/stats", async (c) => {
  try {
    const entidad = await entidadPedida(c, c.req.query("inversionista_id"));

    const stats = await getInvestmentsStats(entidad.inversionista_id);

    return c.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : "Error al obtener estadísticas",
    });
  }
});

// ============================================
// RUTAS DE ASESORES
// ============================================

/**
 * GET /api/cartera/advisor
 * Obtener información del asesor por ID
 */
carteraRoutes.get("/advisor", async (c) => {
  try {
    const id = c.req.query("id");

    if (!id) {
      throw new HTTPException(400, { message: "El parámetro id es requerido" });
    }

    const asesorId = parseInt(id, 10);
    if (isNaN(asesorId)) {
      throw new HTTPException(400, { message: "El parámetro id debe ser un número" });
    }

    const asesor = await getAsesorById(asesorId);

    return c.json({
      success: true,
      data: asesor,
    });
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : "Error al obtener asesor",
    });
  }
});

// ============================================
// REPORTE DE LIQUIDACIONES (R2)
// ============================================

/**
 * GET /api/cartera/liquidaciones/reporte
 * Genera URL temporal del reporte xlsx almacenado en R2.
 *
 * Sigue resolviendo por el correo de la sesión: es el histórico de los
 * inversionistas viejos y el archivo está nombrado así en R2. No aplica a los
 * que se den de alta de ahora en adelante.
 */
carteraRoutes.get("/liquidaciones/reporte", async (c) => {
  try {
    const email = correoDeSesion(c);

    const bucket = process.env.R2_BUCKET_NAME || "reports";
    const key = `settlement-history/${email}.xlsx`;

    const result = await getSignedUrlFromBucket(key, bucket);

    if (!result) {
      return c.json(
        { success: false, error: "Reporte no encontrado para este correo" },
        404,
      );
    }

    return c.json({
      success: true,
      data: {
        reporte_url: result.url,
        fecha_generacion: result.lastModified?.toISOString() || new Date().toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    console.error("[ReporteLiquidaciones] Error:", error);
    throw new HTTPException(500, {
      message: "Error al obtener el reporte",
    });
  }
});

export default carteraRoutes;
