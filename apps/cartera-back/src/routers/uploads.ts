import { Elysia } from "elysia";
import { borrarArchivoBoletaHuerfano } from "../controllers/archivoBoletaHuerfano";
import { uploadFileController } from "../utils/functions/uploadsFiles";
import { authMiddleware } from "./midleware";

export const uploadRouter = new Elysia()
  .use(authMiddleware)
  .post("/upload", uploadFileController)
  // Retención de PII del bot de cobros: borra un archivo de boleta SOLO si no
  // respalda ningún pago (ver el controlador). Aditivo: /upload no cambia.
  .delete("/upload/boleta-huerfana", borrarArchivoBoletaHuerfano);
