import { Elysia, t } from "elysia";
import { createUser, verifyToken } from "../controllers/auth";
import { supabase } from "../controllers/auth";
const authRouter = new Elysia({
  prefix: "/auth",
})
  .post(
    "/register",
    async ({ body }) => {
      try {
        const user = await createUser(body.email, body.password);
        return { success: true, user };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
    {
      body: t.Object({
        email: t.String({ format: "email" }),
        password: t.String({ minLength: 6 }),
      }),
    }
  )
  // Add this to your existing auth router
  .post(
    "/login",
    async ({ body }) => {
      try {
        // Implement login logic with Supabase
        const { data, error } = await supabase.auth.signInWithPassword({
          email: body.email,
          password: body.password,
        });

        if (error) throw error;

        return {
          success: true,
          user: data.user,
          token: data.session.access_token,
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
    {
      body: t.Object({
        email: t.String({ format: "email" }),
        password: t.String(),
      }),
    }
  )
  .post(
    "/verify-token",
    async ({ body }) => {
      try {
        const user = await verifyToken(body.token);
        return { success: true, user };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
    {
      body: t.Object({
        token: t.String(),
      }),
    }
  );

export default authRouter;
