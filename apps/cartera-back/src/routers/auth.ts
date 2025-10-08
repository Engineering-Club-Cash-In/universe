import { Elysia, t } from "elysia";
import { createAdminService, createContaService, getPlatformUsersService, loginService, updateContaUserService, verifyTokenService } from "../controllers/auth";
import jwt from "jsonwebtoken"; 
 
const JWT_SECRET = process.env.JWT_SECRET!;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET!;

export const authRouter = new Elysia()
  /**
    * 🆕 Crear administrador
   */
   .post(
    "/auth/admin",
    async ({ body, set }) => {
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

        const result = verifyTokenService(token);

        if (!result.valid) {
          set.status = 401;
          return { success: false, error: result.error };
        }

        set.status = 200;
        return {
          success: true,
          message: "Token válido",
          data: result.decoded,
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
  ).post(
    "/auth/refresh",
    async ({ body, set }) => {
      try {
        const { refreshToken } = body as { refreshToken?: string };

        if (!refreshToken) {
          set.status = 400;
          return { success: false, error: "El refresh token es obligatorio." };
        }

        let decoded: any;
        try {
          decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
        } catch (err) {
          set.status = 401;
          return { success: false, error: "Refresh token inválido o expirado" };
        }

        // ✅ Generar un nuevo access token
        const newAccessToken = jwt.sign(
          { id: decoded.id, role: decoded.role },
          JWT_SECRET,
          { expiresIn: "30m" } // Access token válido por 30 minutos
        );

        // Opcional: generar también un nuevo refresh token
        const newRefreshToken = jwt.sign(
          { id: decoded.id, role: decoded.role },
          JWT_REFRESH_SECRET,
          { expiresIn: "7d" } // Refresh válido por 7 días
        );

        set.status = 200;
        return {
          success: true,
          message: "Token renovado correctamente",
          accessToken: newAccessToken,
          refreshToken: newRefreshToken, // opcional devolverlo
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
  )

   .post(
    "/auth/conta",
    async ({ body, set }) => {
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
    async ({ body, query, set }) => {
      try {
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
    async ({ set }) => {
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
