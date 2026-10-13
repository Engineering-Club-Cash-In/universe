import { Elysia, t } from "elysia";
import {
  createAdminService,
  createContaService,
  getPlatformUsersService,
  loginService,
  refreshTokenService,
  updateContaUserService,
  verifyTokenService,
} from "../controllers/auth";
import { authMiddleware, rechazoSiNoEsAdminActivo } from "./midleware";

/**
 * Rutas PÚBLICAS de sesión: login, verify y refresh. Las usan el front de
 * cartera, el CRM y auth-google sin un Authorization previo (el token viaja en
 * el query/body), así que NO llevan `authMiddleware`.
 */
const authPublicRouter = new Elysia()
  .post(
    "/auth/login",
    async ({ body, set }) => {
      try {
        const { email, password } = body;

        const result = await loginService(email, password);

        set.status = 200;
        return {
          success: true,
          message: "Login exitoso",
          data: result,
        };
      } catch (error: any) {
        console.error("❌ Error en /auth/login:", error);
        set.status = 401;
        return {
          success: false,
          error: error.message || "Credenciales inválidas",
        };
      }
    },
    {
      detail: {
        summary: "Login de usuario y obtención de token JWT",
        tags: ["Auth"],
      },
      body: t.Object({
        email: t.String({ format: "email" }),
        password: t.String(),
      }),
    }
  )
  /**
   * ✅ Verificar token JWT
   */
 .get(
  "/auth/verify",
  async ({ query, set }) => {
    try {
      const { token } = query as Record<string, string | undefined>;

      if (!token) {
        set.status = 400;
        return { success: false, error: "El token es obligatorio." };
      }

      // Revalida en la base: un usuario desactivado o borrado ya no renueva.
      const result = await verifyTokenService(token);

      if (!result.success) {
        set.status = 401;
        return { success: false, error: result.error };
      }

      // Aquí usamos result.data y result.accessToken
      set.status = 200;
      return {
        success: true,
        message: "Token válido",
        data: result.data,             // ← Usuario decodificado
        accessToken: result.accessToken, // ← Token renovado
      };
    } catch (error: any) {
      console.error("❌ Error en /auth/verify:", error);
      set.status = 500;
      return {
        success: false,
        error: error.message || "Error verificando token",
      };
    }
  },
  {
    detail: {
      summary: "Verifica si un token JWT es válido",
      tags: ["Auth"],
    },
    query: t.Object({
      token: t.String(),
    }),
  }
)

.post(
    "/auth/refresh",
    async ({ body, set }) => {
      try {
        const { refreshToken } = body as { refreshToken?: string };

        if (!refreshToken) {
          set.status = 400;
          return { success: false, error: "El refresh token es obligatorio." };
        }

        // Revalida en la base: un usuario desactivado o borrado ya no renueva,
        // y el token nuevo lleva el rol VIGENTE, no el del refresh viejo.
        const result = await refreshTokenService(refreshToken);
        if (!result.success) {
          set.status = 401;
          return { success: false, error: result.error };
        }

        set.status = 200;
        return {
          success: true,
          message: "Token renovado correctamente",
          accessToken: result.accessToken,
          refreshToken: result.refreshToken, // el front y el CRM persisten el rotado
        };
      } catch (error: any) {
        console.error("❌ Error en /auth/refresh:", error);
        set.status = 500;
        return {
          success: false,
          error: error.message || "No se pudo refrescar el token",
        };
      }
    },
    {
      detail: {
        summary: "Refresca el access token usando un refresh token",
        tags: ["Auth"],
      },
      body: t.Object({
        refreshToken: t.String(),
      }),
    }
  );

/**
 * Rutas que ADMINISTRAN usuarios: crear ADMIN/CONTA, editar un CONTA (clave
 * incluida) y listar usuarios. Colgaban sin `authMiddleware`: cualquiera, sin
 * token, podía crearse un ADMIN, cambiarle la clave a otro usuario o bajarse la
 * tabla con password_hash. Ahora: token válido (`authMiddleware`) + ADMIN
 * activo revalidado en la base, en CADA ruta.
 *
 * Instancia propia a propósito: el `derive` de `authMiddleware` es local a ella
 * y no alcanza a las rutas públicas de arriba.
 */
const authAdminRouter = new Elysia()
  .use(authMiddleware)
  /**
    * 🆕 Crear administrador
   */
   .post(
    "/auth/admin",
    async ({ body, set, user }: any) => {
      const rechazo = await rechazoSiNoEsAdminActivo(user, set);
      if (rechazo) return rechazo;
      try {
        const result = await createAdminService(body);

        set.status = 201;
        return {
          success: true,
          message: "Administrador creado exitosamente",
          data: result,
        };
      } catch (error: any) {
        console.error("❌ Error en /auth/admin:", error);
        set.status = 500;
        return {
          success: false,
          error: error.message || "Error creando administrador",
        };
      }
    },
    {
      detail: {
        summary: "Crea un nuevo administrador y su usuario de plataforma",
        tags: ["Auth", "Admin"],
      },
      body: t.Object({
        nombre: t.String(),
        apellido: t.String(),
        email: t.String({ format: "email" }),
        telefono: t.Optional(t.String()),
        password: t.String(),
      }),
    }
  )

   .post(
    "/auth/conta",
    async ({ body, set, user }: any) => {
      const rechazo = await rechazoSiNoEsAdminActivo(user, set);
      if (rechazo) return rechazo;
      try {
        const result = await createContaService(body);

        set.status = 201;
        return {
          success: true,
          message: "Usuario de contabilidad creado exitosamente",
          data: result,
        };
      } catch (error: any) {
        console.error("❌ Error en /auth/conta:", error);
        set.status = 500;
        return {
          success: false,
          error: error.message || "Error creando usuario de contabilidad",
        };
      }
    },
    {
      detail: {
        summary: "Crea un nuevo usuario de contabilidad y su usuario en plataforma",
        tags: ["Auth", "Conta"],
      },
      body: t.Object({
        nombre: t.String(),
        email: t.String({ format: "email" }),
        telefono: t.Optional(t.String()),
        password: t.String(),
      }),
    }
  )

  /**
   * ✏️ Actualizar usuario de contabilidad
   */
  .post(
    "/auth/conta/update",
    async ({ body, query, set, user }: any) => {
      const rechazo = await rechazoSiNoEsAdminActivo(user, set);
      if (rechazo) return rechazo;
      try {
        // Ojo: pese al nombre, `contaId` es el platform_users.id (así lo manda el front).
        const contaId = Number(query.contaId);
        if (!contaId) {
          set.status = 400;
          return { success: false, error: "contaId es obligatorio en query params" };
        }

        const result = await updateContaUserService(contaId, body);

        set.status = 200;
        return {
          success: true,
          message: "Usuario de contabilidad actualizado",
          data: result,
        };
      } catch (error: any) {
        console.error("❌ Error en /auth/conta/update:", error);
        set.status = 500;
        return {
          success: false,
          error: error.message || "Error actualizando usuario de contabilidad",
        };
      }
    },
    {
      detail: {
        summary: "Actualiza datos de un usuario de contabilidad (profile + platform_users)",
        tags: ["Auth", "Conta"],
      },
      query: t.Object({
        contaId: t.String(), // query param obligatorio
      }),
      body: t.Object({
        email: t.Optional(t.String({ format: "email" })),
        password: t.Optional(t.String()),
        is_active: t.Optional(t.Boolean()),
        telefono: t.Optional(t.String()),
        nombre: t.Optional(t.String()),
        apellido: t.Optional(t.String()),
      }),
    }
  )

  /**
   * 👥 Obtener todos los usuarios de plataforma (excepto admins)
   */
  .get(
    "/auth/platform-users",
    async ({ set, user }: any) => {
      const rechazo = await rechazoSiNoEsAdminActivo(user, set);
      if (rechazo) return rechazo;
      try {
        const result = await getPlatformUsersService();

        set.status = 200;
        return {
          success: true,
          message: "Usuarios de plataforma obtenidos",
          data: result,
        };
      } catch (error: any) {
        console.error("❌ Error en /auth/platform-users:", error);
        set.status = 500;
        return {
          success: false,
          error: error.message || "Error obteniendo usuarios de plataforma",
        };
      }
    },
    {
      detail: {
        summary: "Obtiene todos los usuarios de plataforma (asesores y contabilidad, sin admins)",
        tags: ["Auth", "Platform Users"],
      },
    }
  );

export const authRouter = new Elysia().use(authPublicRouter).use(authAdminRouter);
