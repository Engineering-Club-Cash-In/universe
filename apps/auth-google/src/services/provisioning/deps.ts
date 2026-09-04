import { eq } from "drizzle-orm";
import {
  getEmailDeliveryMode,
  sendPortalCompanyAddedEmail,
  sendPortalWelcomeEmail,
} from "@cci/email";
import { db } from "../../db/connection";
import { users } from "../../db/schema";
import { auth } from "../../lib/auth";
import { env } from "../../config/env";
import {
  condicionDpiNormalizado,
  condicionEmail,
  ordenDesempateDpi,
} from "./dpiLookup";
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
 * La condición y el desempate viven en `dpiLookup.ts` para poder probarlos: ahí
 * está explicado por qué el ORDER BY no es decorativo. Este archivo solo los
 * ejecuta.
 */
const buscarPorDpi = async (dpiNormalizado: string): Promise<UsuarioPortal | null> => {
  const filas = await db
    .select()
    .from(users)
    .where(condicionDpiNormalizado(dpiNormalizado))
    .orderBy(ordenDesempateDpi(dpiNormalizado))
    .limit(1);

  return filas[0] ? aUsuarioPortal(filas[0]) : null;
};

const buscarPorEmail = async (email: string): Promise<UsuarioPortal | null> => {
  const filas = await db
    .select()
    .from(users)
    .where(condicionEmail(email))
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
