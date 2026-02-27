import { Elysia, t } from "elysia";
import { sendSimpleEmail } from "@cci/email";
import { testUploadAndEmail } from "../controllers/investor";

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

defaultRouter.get("/test-email-r2", async ({ query }) => {
    const { investor_id, email } = query;
    if (!investor_id || !email) return { error: "investor_id and email are required" };
    
    return await testUploadAndEmail(Number(investor_id), email);
}, {
    query: t.Object({
        investor_id: t.String(),
        email: t.String()
    })
});

export default defaultRouter;