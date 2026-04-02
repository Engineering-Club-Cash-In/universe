import { Elysia } from "elysia";
import config from "./config";
import * as routers from "./routers";
import { cors } from "@elysiajs/cors";
import { iniciarTareasProgramadas } from "../schedule";
import { auditLogMiddleware } from "./middleware/auditLog";

const app = new Elysia()
  .use(cors({
    origin: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }))
  .use(auditLogMiddleware)
  .use(routers.defaultRouter)
  .use(routers.inversionistasRouter)
  .use(routers.advisorRouter)
  .use(routers.usersRouter)
  .use(routers.paymentRouter)
  .use(routers.creditRouter)
  .use(routers.uploadRouter)
  .use(routers.sifcoRouter)
  .use(routers.authRouter)
  .use(routers.morasRouter)
  .use(routers.bancosRouter)
  .use(routers.cuentasRoutes)
  .use(routers.dteController)
  .use(routers.paymentAgreementsRouter)
  .use(routers.recalculateFromJsonRouter)
  .use(routers.mirrorInvestorRouter)
  .use(routers.notificationsRouter)
  .use(routers.reconcileEspejoRouter)
  .use(routers.investorDocumentsRouter)
  .use(routers.abonosCapitalRouter)
  .use(routers.recibosGenericosRouter)
  .use(routers.fallenCreditsRouter)
  .use(routers.sifcoSyncRouter);

// 🚀 Iniciar tareas programadas ANTES de levantar el servidor
iniciarTareasProgramadas();

// 🦊 Levantar el servidor
app.listen(config.port);

console.log(
  `🦊 Elysia Server is running at ${app.server?.hostname}:${app.server?.port}`
);
console.log('⏰ Tareas programadas activas');