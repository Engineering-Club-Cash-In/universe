import "dotenv/config";
import { loadConfig } from "../config";
import { createDependencies } from "../dependencies";
import { syncTokensToCartera } from "../tokens/sync-cartera";
import { parseSyncCarteraArgs, SYNC_CARTERA_USAGE } from "../tokens/sync-cartera-args";
import { DbCarteraEventTokenUserRepository } from "../db/cartera-events-repository";

// Registra en cartera los tokens de Nexa que ya existen en nexa-server.
// Idempotente: se puede correr de nuevo sin duplicar nada. Nunca imprime tokens
// completos ni el national_id.
//   --creditos 249,299   solo esos créditos (lista blanca)
//   --todos              todos los token users activos (explícito)
//   --dry-run            informa qué registraría, sin llamar a cartera ni escribir
// Sin --creditos ni --todos se niega a correr.
const args = parseSyncCarteraArgs(process.argv.slice(2));
if (!args.ok) {
  console.error(`${args.error}\n${SYNC_CARTERA_USAGE}`);
  process.exit(2);
}
const config = loadConfig();
if (config.mockCartera) {
  console.error("MOCK_CARTERA=true: el cartera es simulado, no hay nada que sincronizar.");
  process.exit(1);
}
const deps = createDependencies(config);
const refuse = (what: string) => () => {
  throw new Error(`dry-run: no debe ${what}`);
};
const summary = await syncTokensToCartera({
  tokenUsers: deps.tokenUsers,
  // En dry-run se pasan stubs que revientan: si alguien rompe la guarda, no escribe.
  cartera: args.dryRun ? { registerNexaToken: refuse("llamar a cartera") } : deps.cartera,
  cancelledTokenUsers: args.dryRun
    ? { deactivateByCreditoId: refuse("desactivar token users") }
    : new DbCarteraEventTokenUserRepository(deps.db),
  creditoIds: "creditoIds" in args.scope ? args.scope.creditoIds : undefined,
  dryRun: args.dryRun,
});
console.log(JSON.stringify(args.dryRun ? { dryRun: true, ...summary } : summary, null, 2));
const incomplete = (summary.notFound?.length ?? 0) > 0;
if (incomplete) console.error(`Sin token user activo para los créditos: ${summary.notFound!.join(", ")}`);
process.exit(summary.rejected.length > 0 || summary.failed.length > 0 || incomplete ? 1 : 0);
