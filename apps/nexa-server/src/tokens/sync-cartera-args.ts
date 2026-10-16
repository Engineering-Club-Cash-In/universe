export type SyncCarteraArgs =
  | { ok: true; scope: { creditoIds: number[] } | { todos: true }; dryRun: boolean }
  | { ok: false; error: string };

export const SYNC_CARTERA_USAGE = [
  "Uso: bun run tokens:sync-cartera (--creditos 249,299,973 | --todos) [--dry-run]",
  "  --creditos <lista>  sincroniza SOLO los token users activos de esos créditos (separados por coma)",
  "  --todos             sincroniza TODOS los token users activos (incluye los de prueba)",
  "  --dry-run           muestra qué registraría; no llama a cartera ni escribe nada",
].join("\n");

/**
 * Sin --creditos ni --todos el script se niega a correr, y cualquier argumento
 * desconocido es un error: un `--dry-ru` mal escrito no puede degradar en una corrida real.
 */
export function parseSyncCarteraArgs(argv: string[]): SyncCarteraArgs {
  let creditosRaw: string | undefined;
  let todos = false;
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--todos") todos = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--creditos" || arg.startsWith("--creditos=")) {
      if (creditosRaw !== undefined) return { ok: false, error: "--creditos aparece más de una vez." };
      const value = arg === "--creditos" ? argv[++i] : arg.slice("--creditos=".length);
      if (value === undefined || value.startsWith("--")) return { ok: false, error: "--creditos necesita una lista, por ejemplo --creditos 249,299." };
      creditosRaw = value;
    } else return { ok: false, error: `Argumento desconocido: ${arg}` };
  }
  if (todos && creditosRaw !== undefined) return { ok: false, error: "--creditos y --todos son excluyentes." };
  if (creditosRaw !== undefined) {
    const parts = creditosRaw.split(",").map((part) => part.trim());
    const bad = parts.filter((part) => !/^[1-9]\d*$/.test(part) || !Number.isSafeInteger(Number(part)));
    if (parts.length === 0 || bad.length > 0) {
      return { ok: false, error: `--creditos debe ser una lista de enteros positivos separados por coma (inválido: ${bad.map((b) => JSON.stringify(b)).join(", ")}).` };
    }
    return { ok: true, scope: { creditoIds: [...new Set(parts.map(Number))] }, dryRun };
  }
  if (todos) return { ok: true, scope: { todos: true }, dryRun };
  return { ok: false, error: "Hay que indicar --creditos <lista> o --todos de forma explícita." };
}
