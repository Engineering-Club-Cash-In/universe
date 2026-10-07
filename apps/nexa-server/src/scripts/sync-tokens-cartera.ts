import "dotenv/config";
import { loadConfig } from "../config";
import { createDependencies } from "../dependencies";
import { syncTokensToCartera } from "../tokens/sync-cartera";
import { DbCarteraEventTokenUserRepository } from "../db/cartera-events-repository";

// Registra en cartera los tokens de Nexa que ya existen en nexa-server.
// Idempotente: se puede correr de nuevo sin duplicar nada. Nunca imprime tokens.
const config = loadConfig();
if (config.mockCartera) {
  console.error("MOCK_CARTERA=true: el cartera es simulado, no hay nada que sincronizar.");
  process.exit(1);
}
const deps = createDependencies(config);
const summary = await syncTokensToCartera({
  tokenUsers: deps.tokenUsers,
  cartera: deps.cartera,
  cancelledTokenUsers: new DbCarteraEventTokenUserRepository(deps.db),
});
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.rejected.length > 0 || summary.failed.length > 0 ? 1 : 0);
