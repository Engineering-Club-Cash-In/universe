import "dotenv/config";
import { syncTodosLosClientes } from "../controllers/sifcoSync";

console.log("🚀 Iniciando script de sincronización SIFCO...\n");

syncTodosLosClientes()
  .then((resumen) => {
    console.log("\n✅ Script finalizado:", resumen);
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n❌ Error fatal:", err.message);
    process.exit(1);
  });
