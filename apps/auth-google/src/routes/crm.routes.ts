/**
 * Rutas para operaciones del CRM (leads, documentos, contratos, créditos)
 * Todas estas rutas requieren autenticación de Better Auth
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  // Profile / Lead
  getProfile,
  updateLead,
  getNumbersSifco,
  // Documents
  getPersonalDocuments,
  getContracts,
  // Credits
  getCredits,
  getCreditByNumeroSifco,
  type UpdateLeadPayload,
} from "../services/crm";
import { requireAuth, type AuthedVariables } from "../middleware/requireAuth";
import { consumirCupo } from "../middleware/rateLimiter";

const crmRoutes = new Hono<{ Variables: AuthedVariables }>();

// ============================================
// MIDDLEWARE DE AUTENTICACIÓN
// ============================================

// Aplicar middleware a todas las rutas. `requireAuth` deja en el contexto el
// usuario ya validado, que es de donde salen las identidades que usan los
// handlers.
//
// El token de sesión NO se reenvía al CRM: esas rutas son servicio-a-servicio
// y se autorizan con el secreto compartido (ver services/crm/portalAuth.ts).
// Esta sesión autoriza el acceso del usuario a este servicio, no la llamada al
// CRM: por eso tener sesión no puede ser lo único que decida QUÉ lead se
// devuelve.
crmRoutes.use("*", requireAuth);

// ============================================
// IDENTIDAD DE LA SESIÓN
// ============================================
// Estas rutas devuelven la ficha completa de un cliente (ingresos, dirección,
// DPI), URLs firmadas de sus documentos escaneados, los PDF de sus contratos y
// el detalle de sus créditos. Antes elegían a QUIÉN devolvérselos con el
// `email`/`dpi` del query string —y con el `email` del cuerpo, en la de
// escritura—, así que cualquier cuenta del portal, donde el registro es
// abierto, podía leer y reescribir los datos de otra persona con solo cambiar
// un parámetro.
//
// Es el mismo arreglo que ya se hizo en `cartera.routes.ts`: la identidad sale
// de la sesión, lo que manda el navegador se ignora.

/** Correo de la sesión, la única llave con la que se resuelve el lead. */
const correoDeSesion = (c: any): string => {
  const user = c.get("user") as AuthedVariables["user"] | undefined;
  // Normalizado igual que en el registro (`decidirLeadDelPortal` del CRM) y que
  // en `cartera.routes.ts`. Antes se mandaba tal cual para no cambiar a qué
  // fila apuntaba el `=` exacto del CRM, pero eso dejaba la asimetría del otro
  // lado: el registro aceptaba a quien se dio de alta como "Ana@Ejemplo.com"
  // contra el lead "ana@ejemplo.com", y después perfil, documentos, contratos,
  // créditos y actualización le fallaban todos. El CRM ya compara normalizado
  // (`eqEmail`), así que la llave viaja en su forma canónica.
  const email = user?.email?.trim().toLowerCase();

  if (!email) {
    throw new HTTPException(401, { message: "No autorizado. Inicia sesión." });
  }

  return email;
};

/**
 * El DPI NO viaja como llave de búsqueda, y por eso va vacío.
 *
 * El CRM resuelve el lead con `OR(email, dpi)`, y el DPI de la sesión lo
 * autodeclara el propio usuario (POST /api/profile/me/dpi lo escribe sin
 * contrastarlo contra RENAP ni contra el lead). Reenviarlo reabriría el mismo
 * agujero por otra puerta: bastaría reclamar el DPI de alguien que todavía no
 * tiene cuenta en el portal para que la rama del DPI resolviera a SU lead.
 *
 * Con el correo solo, el alcance de una cuenta es el lead de su propio correo.
 */
const SIN_DPI = "";

/** Números SIFCO de las oportunidades del lead de la sesión. */
const sifcoDeSesion = async (c: any): Promise<string[]> => {
  const oportunidades = await getNumbersSifco(correoDeSesion(c), SIN_DPI);

  return (oportunidades ?? [])
    .map((o) => o?.numeroSifco?.trim())
    .filter((n): n is string => !!n);
};

// ============================================
// RUTAS DE PERFIL / LEAD
// ============================================

/**
 * GET /api/crm/profile
 * Perfil del lead de la sesión.
 *
 * Los parámetros `email` y `dpi` se siguen aceptando pero se IGNORAN, para que
 * auth-google se pueda desplegar sin esperar al front. Conviene retirarlos del
 * front en una release posterior.
 */
crmRoutes.get("/profile", async (c) => {
  try {
    const profile = await getProfile(correoDeSesion(c), SIN_DPI);

    return c.json({
      success: true,
      data: profile,
    });
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : "Error al obtener perfil",
    });
  }
});

// ============================================
// SIMULACRO DEL CAMBIO DE DPI
// ============================================
//
// `soloValidar: true` le pide al CRM que corra candado, gate de mora y
// duplicados y conteste SIN escribir nada. El portal lo usa como paso previo
// del cambio de DPI, que está obligado a escribir la CUENTA antes que el lead:
// sin esa pasada, un rechazo del CRM llegaba con la cuenta ya cambiada y la
// persona quedaba con una identidad por servicio.
//
// Es el ÚNICO modo en el que el DPI del cuerpo se reenvía, y se sostiene sobre
// dos patas:
//   1. No escribe. El peligro de aceptar un DPI del cuerpo es que quede
//      guardado en un lead ajeno; en simulacro no queda guardado en ninguno.
//   2. El DPI que hay que validar es el NUEVO, y ese sólo existe en el cuerpo:
//      el de la sesión es el viejo, y validar el viejo no valida nada.
//
// Lo que sí abre es ENUMERACIÓN: la respuesta dice por qué se rechaza, así que
// una cuenta del portal podría preguntar, DPI por DPI, quién está en mora. Se
// contiene con el tope de abajo y con el rastro, no recortando el motivo (ver
// el comentario del handler).

/**
 * Simulacros por cuenta y por hora.
 *
 * El uso legítimo es UNA persona cambiando su DPI una vez; con correcciones y
 * reintentos, tres o cuatro. Quince deja diez veces ese margen y aun así le
 * pone techo al barrido (un raspado necesitaría cientos de cuentas, y crear
 * cuentas ya tiene su propio límite: `signUpLimiter`).
 *
 * 🔴 El número es generoso a propósito. Un límite mal calibrado ya tumbó el
 * login una vez. Este ni siquiera puede: sólo cuenta simulacros, así que
 * agotarlo no toca el login, ni la lectura del perfil, ni la escritura real —
 * lo único que se posterga es volver a preguntarle al CRM.
 */
const LIMITE_SIMULACRO_DPI = 15;
const VENTANA_SIMULACRO_DPI_MS = 60 * 60 * 1000;

/**
 * Los últimos 4 dígitos, para el rastro.
 *
 * El rastro tiene que dejar ver un barrido (muchos DPI distintos desde una
 * cuenta) sin convertir el log en una lista de DPI de terceros: el log es un
 * lugar de menos confianza que la base, y el DPI ajeno es justamente el dato
 * que la persona no debería estar tocando.
 *
 * 🔴 Se filtran los DÍGITOS antes de cortar, no se corta a secas. Este valor
 * sale del cuerpo y en este punto todavía no pasó por ninguna validación de
 * formato —la corre el CRM, que es quien tiene el expediente—, así que
 * `slice(-4)` podía dejar un salto de línea, un retorno de carro o un ESC
 * dentro de la línea del log: el cuerpo partía el rastro en dos, inventando
 * una entrada que nadie escribió, o lo ensuciaba con secuencias ANSI. Y el
 * rastro es justamente lo que queda para reconstruir un barrido de
 * enumeración, así que envenenarlo vacía de sentido al log.
 *
 * `trim()` no alcanzaba: saca espacio en blanco de las PUNTAS, no lo que queda
 * adentro ni los controles que no son espacio en blanco (ESC, NEL).
 *
 * Lista blanca y no escape: un DPI es 13 dígitos, así que quedarse sólo con
 * `[0-9]` cierra de una vez todo lo que no sea un dígito —controles, marcas de
 * dirección, separadores de línea Unicode— sin tener que enumerarlos y sin que
 * el próximo carácter raro abra el agujero de nuevo. Lo que no llega a 5
 * dígitos sale `****`: no es el DPI de nadie, y de todas formas el CRM lo va a
 * rechazar por formato.
 */
const dpiEnmascarado = (dpi: string): string => {
  const soloDigitos = dpi.replace(/[^0-9]/g, "");

  return soloDigitos.length <= 4 ? "****" : `****${soloDigitos.slice(-4)}`;
};

/**
 * POST /api/crm/profile/update
 * Actualiza el lead de la sesión.
 *
 * El destino NO se acepta del cuerpo: el `email` que decide sobre qué lead se
 * escribe es el de la sesión. Del cuerpo solo sobreviven los campos editables,
 * y en la ESCRITURA el DPI se toma de la cuenta —nunca el del cuerpo—:
 * escribir un DPI arbitrario en un lead envenena la resolución de identidad
 * del portal (el CRM casa leads por DPI) y deja al dueño legítimo fuera con un
 * 409. Ese invariante no cambia; el simulacro es la única excepción y no
 * escribe (ver arriba).
 */
crmRoutes.post("/profile/update", async (c) => {
  let body: Partial<UpdateLeadPayload> | null;
  try {
    body = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "Cuerpo de la petición inválido" });
  }

  try {
    const user = c.get("user") as AuthedVariables["user"] | undefined;

    const payload: UpdateLeadPayload = { email: correoDeSesion(c) };

    if (typeof body?.phone === "string") {
      payload.phone = body.phone;
    }

    if (typeof body?.address === "string") {
      payload.address = body.address;
    }

    // Contra `true` ESTRICTO. Con un `if (body?.soloValidar)` bastaría mandar
    // `"false"`, `1` o `{}` para abrir la puerta del DPI del cuerpo: el modo
    // que relaja una regla de identidad se pide con un valor exacto.
    const esSimulacro = body?.soloValidar === true;

    if (esSimulacro) {
      const dpiDelCuerpo = typeof body?.dpi === "string" ? body.dpi.trim() : "";

      // La cubeta es la CUENTA, no la IP: el abuso que interesa acá es una
      // sesión preguntando por muchos DPI, y varias personas pueden compartir
      // la IP pública de una oficina.
      const cupo = consumirCupo({
        namespace: "crm-dpi-simulacro",
        llave: user?.id?.trim() || payload.email,
        windowMs: VENTANA_SIMULACRO_DPI_MS,
        max: LIMITE_SIMULACRO_DPI,
      });

      if (!cupo.permitido) {
        return c.json(
          {
            success: false,
            error: {
              message:
                "Demasiadas validaciones de DPI. Intentá de nuevo más tarde.",
              code: "DPI_VALIDATION_RATE_LIMIT",
            },
          },
          429,
          {
            "Retry-After": cupo.faltanSegundos.toString(),
            "X-RateLimit-Limit": LIMITE_SIMULACRO_DPI.toString(),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": cupo.reiniciaEn.toISOString(),
          },
        );
      }

      // Cuentan TODOS los simulacros, no sólo los de un DPI ajeno. Si sólo
      // contaran esos, bastaría con autodeclararse el DPI del objetivo en la
      // cuenta (POST /api/profile/me/dpi no lo contrasta contra nada) para
      // preguntar gratis. Y un éxito informa tanto como un rechazo —"no tiene
      // mora" también es la respuesta que se busca—, así que acá no aplica el
      // `soloFallos` del limitador del login.

      // Rastro del caso sospechoso: preguntar por un DPI que no es el de la
      // cuenta. En el camino legítimo pasa una vez —el DPI nuevo todavía no
      // está en la sesión—; el barrido se ve como muchos, y distintos, desde
      // la misma cuenta.
      if (dpiDelCuerpo && dpiDelCuerpo !== user?.dpi?.trim()) {
        console.warn(
          `[Auditoría] Simulacro de DPI ajeno al de la sesión: usuario=${user?.id} correo=${payload.email} dpi=${dpiEnmascarado(dpiDelCuerpo)} restantes=${cupo.restantes}`,
        );
      }

      payload.soloValidar = true;

      // El DPI viaja tal como vino (ya recortado). La validación de formato, el
      // candado, el gate de mora y los duplicados los corre el CRM, que es
      // quien tiene el expediente: duplicar acá esas reglas sólo garantiza que
      // se desincronicen.
      if (body?.dpi !== undefined) {
        payload.dpi = dpiDelCuerpo;
      }
    } else if (body?.dpi !== undefined) {
      // ESCRITURA REAL. El cuerpo solo expresa la INTENCIÓN de fijar el DPI; el
      // valor sale de la cuenta, que es donde el portal ya lo fijó
      // (POST /api/profile/me/dpi).
      const dpiDeSesion = user?.dpi?.trim();

      if (!dpiDeSesion) {
        throw new HTTPException(409, {
          message:
            "Tu cuenta todavía no tiene DPI registrado. Registralo antes de actualizar tus datos.",
        });
      }

      payload.dpi = dpiDeSesion;
    }

    const result = await updateLead(payload);

    // El simulacro no escribió nada: decirle "actualizado" al front sería
    // mentirle justo en el paso cuyo propósito es NO haber tocado nada.
    if (esSimulacro) {
      return c.json({
        success: true,
        validado: true,
        message: "El cambio de DPI puede aplicarse",
      });
    }

    return c.json({
      success: true,
      message: "Información actualizada correctamente",
      data: result.data,
    });
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : "Error al actualizar información",
    });
  }
});

/**
 * GET /api/crm/sifco
 * Números SIFCO del lead de la sesión. `email` y `dpi` del query se ignoran.
 */
crmRoutes.get("/sifco", async (c) => {
  try {
    const opportunities = await getNumbersSifco(correoDeSesion(c), SIN_DPI);

    return c.json({
      success: true,
      data: opportunities,
    });
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : "Error al obtener números SIFCO",
    });
  }
});

// ============================================
// RUTAS DE DOCUMENTOS Y CONTRATOS
// ============================================

/**
 * GET /api/crm/documents
 * Documentos del lead de la sesión. `email` y `dpi` del query se ignoran.
 *
 * La respuesta trae URLs FIRMADAS de DPI escaneado, estados de cuenta y títulos
 * de propiedad: elegir el lead con un parámetro del cliente las repartía a
 * cualquiera.
 */
crmRoutes.get("/documents", async (c) => {
  try {
    const documents = await getPersonalDocuments(correoDeSesion(c), SIN_DPI);

    return c.json({
      success: true,
      data: documents,
    });
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : "Error al obtener documentos",
    });
  }
});

/**
 * GET /api/crm/contracts
 * Contratos del lead de la sesión. `email` y `dpi` del query se ignoran.
 */
crmRoutes.get("/contracts", async (c) => {
  try {
    const contracts = await getContracts(correoDeSesion(c), SIN_DPI);

    return c.json({
      success: true,
      data: contracts,
    });
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : "Error al obtener contratos",
    });
  }
});

// ============================================
// RUTAS DE CRÉDITOS
// ============================================

/**
 * GET /api/crm/credits
 * Créditos del lead de la sesión.
 *
 * El `numerosSifco` del query es decorativo y se IGNORA: no tenía ningún
 * vínculo con la identidad, así que cualquier sesión podía enumerar la cartera
 * entera pidiendo números ajenos —auth-google los consultaba en cartera con su
 * token de servicio—. El conjunto se deriva ahora de las oportunidades del
 * lead, que es exactamente lo que el front ya pedía.
 */
crmRoutes.get("/credits", async (c) => {
  try {
    const numerosSifco = await sifcoDeSesion(c);

    const credits = numerosSifco.length > 0 ? await getCredits(numerosSifco) : [];

    return c.json({
      success: true,
      data: credits,
    });
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : "Error al obtener créditos",
    });
  }
});

/**
 * GET /api/crm/credit
 * Un crédito del lead de la sesión.
 *
 * Aquí el número SÍ hace falta —identifica cuál de los créditos del titular se
 * pide—, así que se comprueba que esté entre los suyos y se responde 403 si no.
 * El 403 es el mismo tanto si el crédito existe como si no: contestar 404 solo
 * para los inexistentes convertiría la ruta en un oráculo de números SIFCO.
 */
crmRoutes.get("/credit", async (c) => {
  try {
    const numeroSifco = c.req.query("numeroSifco")?.trim();

    if (!numeroSifco) {
      throw new HTTPException(400, { message: "El parámetro numeroSifco es requerido" });
    }

    const permitidos = await sifcoDeSesion(c);

    if (!permitidos.includes(numeroSifco)) {
      throw new HTTPException(403, {
        message: "Ese crédito no pertenece a tu usuario",
      });
    }

    const credit = await getCreditByNumeroSifco(numeroSifco);

    if (!credit) {
      throw new HTTPException(404, { message: "Crédito no encontrado" });
    }

    return c.json({
      success: true,
      data: credit,
    });
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : "Error al obtener crédito",
    });
  }
});

export default crmRoutes;
