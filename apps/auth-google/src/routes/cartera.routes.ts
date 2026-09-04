/**
 * Rutas para operaciones de Cartera (inversiones, inversionistas, etc.)
 * Todas estas rutas requieren autenticación de Better Auth
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  // Investor
  AmbiguousInvestorEmailError,
  CarteraInvestorError,
  createInvestor,
  findInvestorByEmail,
  getInvestorProfile,
  getInvestorDocuments,
  getBancos,
  // Investments
  getLiquidaciones,
  getInvestmentsStats,
  getAsesorById,
} from "../services/cartera";
import {
  PortalInvestorPayloadError,
  buildPortalInvestorUpdate,
} from "../lib/portalInvestorPayload";
import { puedeEditarInversionista } from "../lib/portalInvestorWriteAccess";
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
// RUTAS DE INVERSIONISTAS
// ============================================

/**
 * POST /api/cartera/investor
 * Actualiza los datos de cobro del inversionista de la cuenta autenticada.
 *
 * El destino NO sale de la petición. El correo de la sesión resuelve el
 * inversionista y la escritura viaja dirigida por `inversionista_id`; del
 * cuerpo solo se conservan los campos editables (ver
 * `buildPortalInvestorUpdate`). Así el titular solo puede modificar su propia
 * fila, aunque mande otro DPI u otro correo.
 */
carteraRoutes.post("/investor", async (c) => {
  const user = c.get("user");
  // Tal cual viene de la sesión, igual que la consulta del perfil: así el
  // inversionista que se puede editar es exactamente el que el titular ve.
  const email = user?.email?.trim();

  if (!email) {
    throw new HTTPException(401, { message: "No autorizado. Inicia sesión." });
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "Cuerpo de la petición inválido" });
  }

  let investor: Awaited<ReturnType<typeof findInvestorByEmail>>;
  try {
    investor = await findInvestorByEmail(email);
  } catch (error) {
    // El correo lo comparten varios inversionistas: no hay forma de saber a
    // cuál quiso escribir el titular, así que no se escribe a ninguno. Es
    // preferible bloquear la edición hasta que se limpien los datos antes que
    // cambiarle la cuenta bancaria a la empresa equivocada.
    if (error instanceof AmbiguousInvestorEmailError) {
      throw new HTTPException(409, {
        message:
          "Tu correo está asociado a más de un inversionista. " +
          "Contacta a soporte para que lo corrijan antes de editar tus datos.",
      });
    }

    throw new HTTPException(502, {
      message: "Error al obtener perfil del inversionista",
    });
  }

  if (!investor) {
    throw new HTTPException(404, {
      message: "No encontramos un inversionista asociado a tu cuenta",
    });
  }

  // El correo de la sesión NO basta para autorizar la escritura:
  // `requireEmailVerification` está en false, así que una sesión no prueba que
  // el correo sea de quien lo usa. Sin esto, bastaba con crear una cuenta con
  // el correo de un inversionista —si aún no estaba en Better Auth— para
  // reescribirle la cuenta bancaria, sin acertar su DPI ni su nombre. Ver
  // `puedeEditarInversionista`: la verificación de correo sigue pendiente de
  // una decisión de producto, esto solo cierra este camino.
  if (
    !puedeEditarInversionista({
      sesion: { id: user.id, role: user.role },
      creadoPorUsuarioPortal: investor.creado_por_usuario_portal,
    })
  ) {
    throw new HTTPException(403, {
      message:
        "Tu cuenta todavía no está habilitada para editar los datos del inversionista. " +
        "Completa tu registro como inversionista o contacta a soporte.",
    });
  }

  let payload;
  try {
    payload = buildPortalInvestorUpdate(investor.inversionista_id, body);
  } catch (error) {
    if (error instanceof PortalInvestorPayloadError) {
      throw new HTTPException(400, { message: error.message });
    }
    throw error;
  }

  try {
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

    // Un rechazo de cartera viaja con su motivo. La escritura ya está acotada
    // a la fila del titular, así que el mensaje no puede hablar de terceros.
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
 * Obtener perfil de inversionista por DPI
 */
carteraRoutes.get("/investor", async (c) => {
  try {
    const dpi = c.req.query("dpi");
    const email = c.req.query("email");

    if (!dpi && !email) {
      throw new HTTPException(400, { message: "Se requiere dpi o email" });
    }

    const profile = await getInvestorProfile(dpi || "", email || "");

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
 * GET /api/cartera/investor-documents/client/:email
 * Obtener documentos de un inversionista por email
 */
carteraRoutes.get("/investor-documents/client/:email", async (c) => {
  try {
    const email = c.req.param("email");

    if (!email) {
      throw new HTTPException(400, { message: "El parámetro email es requerido" });
    }

    const documents = await getInvestorDocuments(email);

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
 * Obtener liquidaciones del inversionista por DPI
 */
carteraRoutes.get("/liquidaciones", async (c) => {
  try {
    const dpi = c.req.query("dpi");
    const email = c.req.query("email");
    const page = parseInt(c.req.query("page") || "1", 10);
    const perPage = parseInt(c.req.query("perPage") || "10", 10);

    if (!dpi && !email) {
      throw new HTTPException(400, { message: "Se requiere dpi o email" });
    }

    const liquidaciones = await getLiquidaciones(dpi || "", email || "", page, perPage);

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
 * Obtener estadísticas de inversiones
 */
carteraRoutes.get("/investments/stats", async (c) => {
  try {
    const dpi = c.req.query("dpi");
    const email = c.req.query("email");

    if (!dpi && !email) {
      throw new HTTPException(400, { message: "Se requiere dpi o email" });
    }

    const stats = await getInvestmentsStats(dpi || "", email || "");

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
 * GET /api/cartera/liquidaciones/reporte?email=correo@ejemplo.com
 * Genera URL temporal del reporte xlsx almacenado en R2
 */
carteraRoutes.get("/liquidaciones/reporte", async (c) => {
  try {
    const email = c.req.query("email");
    if (!email) {
      throw new HTTPException(400, { message: "El parámetro 'email' es requerido" });
    }

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
