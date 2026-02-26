import { Elysia, t } from "elysia";
import { sendSimpleEmail } from "@cci/email";

const defaultRouter = new Elysia();

defaultRouter.get("/", (_) => {
    return "Hello World from cartera service!";
});

defaultRouter.get("/test-email", async ({ query }) => {
    const { email } = query;
    if (!email) return { error: "Email is required" };
    
    const result = await sendSimpleEmail(email, "Hola desde Cartera", "¡Hola! Esta es una prueba del servicio de correos con Resend.");
    return result;
}, {
    query: t.Object({
        email: t.String()
    })
});

export default defaultRouter;