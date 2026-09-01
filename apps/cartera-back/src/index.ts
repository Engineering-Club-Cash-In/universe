import { Elysia } from "elysia";
import config from "./config";
import * as routers from "./routers";
import { cors } from "@elysiajs/cors";
import { iniciarTareasProgramadas, type TareaProgramada } from "../schedule";
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
// Fase de pruebas de COBROS-02: se prende el SUBCONJUNTO que alimenta el
// módulo de cobros y nada más.
//
//   moras            → sin esto no hay subidas de bucket, y las alertas de
//                      cobros del CRM (cliente_subido / sin_contacto_3d) leen
//                      justo esas subidas: apagado, salen vacías siempre.
//   buckets_convenio → corre después de moras y es el dueño de las
//                      transiciones de los créditos EN_CONVENIO, que el motor
//                      de mora excluye a propósito.
//
// Quedan fuera a propósito: efectividad de asesores, expiración de compras,
// cierre mensual y snapshot de facturación (escriben histórico que no se está
// probando), y sobre todo verificación de facturas en SAT y su reporte por
// correo, que le pegan a SAT de verdad y mandan correos reales.
const TAREAS_PROGRAMADAS: TareaProgramada[] = ['moras', 'buckets_convenio'];

// 🚀 Iniciar tareas programadas ANTES de levantar el servidor
if (TAREAS_PROGRAMADAS.length > 0) {
  iniciarTareasProgramadas(TAREAS_PROGRAMADAS);
  console.warn(
    `[Jobs] ⚠️  Tareas programadas PARCIALES (rama COBROS-02): solo ${TAREAS_PROGRAMADAS.join(', ')}. Si ves esto en cartera de producción, el FIXME de index.ts llegó a producción y el resto de tareas NO está corriendo.`,
  );
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
if (TAREAS_PROGRAMADAS.length > 0) {
  console.log(`⏰ Tareas programadas activas: ${TAREAS_PROGRAMADAS.join(', ')}`);
}
