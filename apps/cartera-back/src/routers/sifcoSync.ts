import { Elysia } from "elysia";
import { syncTodosLosClientes } from "../controllers/sifcoSync";

export const sifcoSyncRouter = new Elysia({ prefix: "/api/sifco-sync" }).post(
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
