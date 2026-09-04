import { eq, sql } from "drizzle-orm";
import {
  getEmailDeliveryMode,
  sendPortalCompanyAddedEmail,
  sendPortalWelcomeEmail,
} from "@cci/email";
import { db } from "../../db/connection";
import { users } from "../../db/schema";
import { auth } from "../../lib/auth";
import { env } from "../../config/env";
import type {
  DependenciasProvisionamiento,
  UsuarioPortal,
} from "./ensureInvestorAccount";

/**
 * Las dependencias reales: base, Better Auth y Resend.
 *
 * La lógica vive en `ensureInvestorAccount.ts` y recibe todo esto por
 * parámetro. Este archivo es el único que sabe de tablas y de red.
 */

const aUsuarioPortal = (fila: typeof users.$inferSelect): UsuarioPortal => ({
  id: fila.id,
  email: fila.email,
  nombre: fila.name,
  role: fila.role,
  dpi: fila.dpi,
});

/**
 * Busca por DPI normalizando EN SQL, no en JS.
 *
 * Normaliza los dos lados porque la columna trae basura de captura
 * ('1573 66197 01', '1852752810101.'): comparar el texto crudo no encontraría a
 * esas personas y el alta intentaría crearles una cuenta que ya existe.
 *
 * El ORDER BY no es decorativo. Normalizar puede empatar a dos usuarios
 * distintos: hoy `1852752810101` lo tienen Oscar Massis (su DPI real) y la
 * cuenta de Inversiones Monaco (que quedó capturada con el DPI de su
 * representante, más un punto). Con `LIMIT 1` a secas, cuál de los dos sale es
 * cosa del planificador — y el aviso de "ahora representas a Monaco" podía
 * terminar en la bandeja de la propia empresa en vez de en la de Oscar.
 *
 * Gana la coincidencia EXACTA sobre la columna cruda: el dato limpio le gana al
 * sucio. `created_at` desempata para que el resultado sea siempre el mismo.
 */
const buscarPorDpi = async (dpiNormalizado: string): Promise<UsuarioPortal | null> => {
  const filas = await db
    .select()
    .from(users)
    .where(
      sql`ltrim(regexp_replace(coalesce(${users.dpi}, ''), '[[:space:].-]', '', 'g'), '0') = ${dpiNormalizado}`,
    )
    .orderBy(sql`(${users.dpi} = ${dpiNormalizado}) DESC, ${users.createdAt} ASC`)
    .limit(1);

  return filas[0] ? aUsuarioPortal(filas[0]) : null;
};

const buscarPorEmail = async (email: string): Promise<UsuarioPortal | null> => {
  const filas = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);

  return filas[0] ? aUsuarioPortal(filas[0]) : null;
};

export const dependenciasReales = (): DependenciasProvisionamiento => ({
  // El portal ya tiene su URL en el servicio: no se inventa una env nueva para
  // lo mismo, y así el enlace del correo no depende de quién llame.
  portalUrl: env.FRONTEND_URL,
  modoEnvio: () => {
    const modo = getEmailDeliveryMode();
    return {
      server: modo.server,
      redirige: modo.redirige,
      destinatarioUnico: modo.destinatarioUnico,
    };
  },
  buscarPorDpi,
  buscarPorEmail,
  crearUsuario: async ({ nombre, email, password }) => {
    const creado = await auth.api.signUpEmail({
      body: { name: nombre, email, password },
    });
    return { id: creado.user.id };
  },
  actualizarUsuario: async (id, cambios) => {
    const set: Record<string, unknown> = {};
    if (cambios.role) set.role = cambios.role;
    // `dpi: null` es un cambio válido (limpiar), pero solo se manda cuando la
    // llave viene: `undefined` es "no tocar".
    if (cambios.dpi !== undefined) set.dpi = cambios.dpi;
    if (Object.keys(set).length === 0) return;

    await db.update(users).set(set).where(eq(users.id, id));
  },
  enviarBienvenida: (params) => sendPortalWelcomeEmail(params),
  enviarEmpresaAgregada: (params) => sendPortalCompanyAddedEmail(params),
});
