import { Elysia, t } from "elysia";
import { createAdminService, loginService, verifyTokenService } from "../controllers/auth";
 

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
  );
