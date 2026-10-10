import {
  createEnlacePublicoEstadoCuentaRouter,
  createEstadoCuentaCancelacionRouter,
} from "./estadoCuentaCancelacionRouter";
import { estadoCuentaCancelacionDeps } from "../controllers/estadoCuentaCancelacionDeps";

// Instancias reales (BD, R2, Puppeteer, CRM). Ver `estadoCuentaCancelacionRouter.ts`.
export const estadoCuentaCancelacionRouter = createEstadoCuentaCancelacionRouter(
  estadoCuentaCancelacionDeps
);

// Enlace público que abre el cliente desde WhatsApp (sin sesión).
export const enlacePublicoEstadoCuentaRouter = createEnlacePublicoEstadoCuentaRouter(
  estadoCuentaCancelacionDeps
);
