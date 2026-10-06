import { Elysia, t } from "elysia";
import { sendSimpleEmail, sendNewCreditNotification } from "@cci/email";
import { authMiddleware, rechazoSiNoEsAdminActivo } from "./midleware";

const defaultRouter = new Elysia();

defaultRouter.get("/", (_) => {
    return "Hello World from cartera service!";
});

/**
 * Diagnósticos de correo: colgaban SIN token, y `/test-email-r2` le manda la
 * liquidación (PDF) de CUALQUIER inversionista a CUALQUIER dirección. Quedan
 * para ADMIN activo. Instancia propia para que `authMiddleware` no alcance a "/".
 */
const testEmailRouter = new Elysia().use(authMiddleware);

testEmailRouter.get("/test-email", async ({ query, user, set }: any) => {
    const rechazo = await rechazoSiNoEsAdminActivo(user, set);
    if (rechazo) return rechazo;
    const { email } = query;
    if (!email) return { error: "Email is required" };
    
    const result = await sendSimpleEmail(email, "Hola desde Cartera", "¡Hola! Esta es una prueba del servicio de correos con Resend.");
    return result;
}, {
    query: t.Object({
        email: t.String()
    })
});

testEmailRouter.get("/test-email-r2", async ({ query, user, set }: any) => {
    const rechazo = await rechazoSiNoEsAdminActivo(user, set);
    if (rechazo) return rechazo;
    const { investor_id, email } = query;
    if (!investor_id || !email) return { error: "investor_id and email are required" };
    
    // Import diferido: el diagnóstico es lo único de este router que necesita
    // el controlador de inversionistas (10k líneas); "/" no tiene por qué cargarlo.
    const { testUploadAndEmail } = await import("../controllers/investor");
    return await testUploadAndEmail(Number(investor_id), email);
}, {
    query: t.Object({
        investor_id: t.String(),
        email: t.String()
    })
});

testEmailRouter.get("/test-email-credit", async ({ query, user, set }: any) => {
    const rechazo = await rechazoSiNoEsAdminActivo(user, set);
    if (rechazo) return rechazo;
    const { email, opportunityId } = query;
    if (!email) return { error: "El email es requerido en los parámetros (?email=tu@correo.com)" };
    
    // Al ser un test visual, mandamos datos de crédito 'de juguete'
    const result = await sendNewCreditNotification({
        to: [email],
        clientName: "Cliente de Prueba S.A. (Visual Test)",
        creditNumber: "CRM-TEST-0001",
        capital: "150000.00",
        plazo: 36,
        cuota: "5250.00",
        interestRate: "1.5",
        investors: ["Inversionista 1 (Q.100,000.00)", "Inversionista 2 (Q.50,000.00)"],
        vehiculoMarca: "Toyota",
        vehiculoLinea: "Hilux",
        vehiculoModelo: "2024",
        vehiculoPlaca: "P123ABC",
        montoAsegurado: 140000.00,
        opportunityId: opportunityId // Aquí se inyecta el verdadero ID que pongas en la URL
    });
    
    return result;
}, {
    query: t.Object({
        email: t.String(),
        opportunityId: t.Optional(t.String())
    })
});

// Al FINAL: Elysia copia las rutas de la instancia al momento del `use`.
defaultRouter.use(testEmailRouter);

export default defaultRouter;