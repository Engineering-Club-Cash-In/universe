import { Elysia } from "elysia";
import { syncTodosLosClientes } from "../controllers/sifcoSync";
import { authMiddleware } from "./midleware";

export const sifcoSyncRouter = new Elysia({ prefix: "/api/sifco-sync" })
  .use(authMiddleware)
  .post(
  "/all",
  async () => {
    // Lanzar en background y responder inmediatamente
    syncTodosLosClientes().catch((err) => {
      console.error("❌ Error en sincronización masiva:", err.message);
    });

    return {
      success: true,
      message: "Sincronización iniciada en background. Revisá los archivos en src/scripts/ cuando termine.",
    };
  }
);
