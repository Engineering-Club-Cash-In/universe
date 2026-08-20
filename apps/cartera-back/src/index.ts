import { Elysia } from "elysia";
import config from "./config";
import * as routers from "./routers";
import { cors } from "@elysiajs/cors";
import { iniciarTareasProgramadas } from "../schedule";
import { auditLogMiddleware } from "./middleware/auditLog";
import { validationErrorMiddleware } from "./middleware/validationError";

const app = new Elysia()
  .use(validationErrorMiddleware)
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
  .use(routers.sifcoSyncRouter)
  .use(routers.assignCapitalRouter)
  .use(routers.addInvestorToCreditRouter)
  .use(routers.completeEspejoRouter)
  .use(routers.replaceInvestorCreditRouter)
  .use(routers.compraCarteraAceptadaRouter)
  .use(routers.devolucionRouter)
  .use(routers.creditosNuevosConAbonosRouter)
  .use(routers.cuentasExtraInversionistaRouter)
  .use(routers.cierreMensualRouter)
  .use(routers.actualizarPagosExcelRouter)
  .use(routers.reportesRouter)
  .use(routers.gastosAdministrativosRouter)
  .use(routers.metasFacturacionRouter)
  .use(routers.facturacionSnapshotRouter)
  .use(routers.ingresosCarrosRouter)
  .use(routers.aseguradorasRouter)
  .use(routers.bucketsRouter)
  .use(routers.cuotasRouter)
  .use(routers.modalidadFacturacionRouter);

// ═══════════════════════════════════════════════════════════════════════════
//   🚨 FIXME(COBROS-02): REVERTIR ESTA LÍNEA ANTES DE MERGEAR A DEVELOP 🚨
//
//   Está en `false` FIJO, no por variable de entorno: la instancia de
//   COBROS-02 solo sirve la API contra el sandbox `cartera_cobros2`, y
//   depender de que la env quedara bien puesta en el ambiente era demasiado
//   frágil para lo que estos jobs escriben (procesarMoras y
//   procesarBucketsConvenio mueven buckets y reasignan asesores).
//
//   Si esta rama se mergea así, cartera de producción se queda SIN NINGUNA
//   tarea programada: procesarMoras, buckets de convenio, efectividad de
//   asesores, expiración de compras de cartera, cierre mensual, verificación
//   de facturas en SAT y snapshot diario de facturación. No se nota al
//   desplegar: se nota cuando la mora deja de calcularse y el cierre del mes
//   sale vacío.
//
//   Para revertir: poner esta constante en `true` (o quitar la condición y
//   volver a llamar `iniciarTareasProgramadas()` directamente).
// ═══════════════════════════════════════════════════════════════════════════
const TAREAS_PROGRAMADAS_ACTIVAS = false;

// 🚀 Iniciar tareas programadas ANTES de levantar el servidor
if (TAREAS_PROGRAMADAS_ACTIVAS) {
  iniciarTareasProgramadas();
} else {
  console.warn(
    "[Jobs] ⚠️  Tareas programadas DESACTIVADAS en el código (rama COBROS-02): esta instancia levanta solo la API contra cartera_cobros2. Si ves esto en cartera de producción, el FIXME de index.ts llegó a producción.",
  );
}

// 🦊 Levantar el servidor
app.listen(config.port);

console.log(
  `🦊 Elysia Server is running at ${app.server?.hostname}:${app.server?.port}`
);
if (TAREAS_PROGRAMADAS_ACTIVAS) {
  console.log('⏰ Tareas programadas activas');
}
