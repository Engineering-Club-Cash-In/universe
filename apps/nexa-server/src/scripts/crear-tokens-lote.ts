// Crea tokens de pago de Nexa por crédito, en lote, llamando a la API admin de
// nexa-server por HTTP (sirve desde una máquina local contra prod).
//
// Formato del archivo (--archivo): un array JSON, una fila por crédito:
//   [
//     { "creditoId": 249, "description": "Crédito 249 - Nombre Cliente", "nationalId": "2345678901101" }
//   ]
//   - creditoId: entero positivo, sin repetidos
//   - description: texto no vacío (máx. 200)
//   - nationalId: CUI de Guatemala como TEXTO de 13 dígitos, con verificador, departamento y municipio válidos.
//     El mismo CUI en varios créditos es válido (solo se avisa).
//
// Entorno (solo con --aplicar; NO usa loadConfig): NEXA_SERVER_URL, NEXA_ADMIN_API_KEY.
//
// Por defecto es un ENSAYO: valida y muestra qué crearía, sin llamar a la API.
//   bun run tokens:crear-lote --archivo lote.json                      # ensayo
//   bun run tokens:crear-lote --archivo lote.json --limite 1 --aplicar # probar con 1
//   bun run tokens:crear-lote --archivo lote.json --aplicar            # todos
// Con --aplicar crea de a uno y se detiene en el primer resultado que no sea limpio
// (HTTP fuera de 200/201 o carteraRegistration distinto de CREATED/UPDATED/UNCHANGED).
// Nunca imprime el nationalId ni el token completo (solo los últimos 4).
import { readFileSync } from "node:fs";
import { CREAR_LOTE_USAGE, formatLoteSummary, parseCrearLoteArgs, runCrearLote, validateLote } from "../tokens/crear-lote";

const args = parseCrearLoteArgs(process.argv.slice(2));
if (!args.ok) {
  console.error(`${args.error}\n${CREAR_LOTE_USAGE}`);
  process.exit(2);
}

let parsed: unknown;
try {
  parsed = JSON.parse(readFileSync(args.archivo, "utf8"));
} catch (error) {
  console.error(`No se pudo leer ${args.archivo} como JSON: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
const validation = validateLote(parsed);
if (!validation.ok) {
  console.error(`Lote rechazado, no se crea ninguno (${validation.errors.length} errores):`);
  for (const line of validation.errors) console.error(`  - ${line}`);
  process.exit(1);
}
for (const warning of validation.warnings) console.warn(`AVISO: ${warning}`);

const baseUrl = process.env.NEXA_SERVER_URL;
const adminKey = process.env.NEXA_ADMIN_API_KEY;
if (args.aplicar) {
  if (!baseUrl || !adminKey) {
    console.error("Con --aplicar hacen falta NEXA_SERVER_URL y NEXA_ADMIN_API_KEY.");
    process.exit(2);
  }
  const url = new URL(baseUrl);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !local) {
    console.error("NEXA_SERVER_URL debe ser https (la llave admin no viaja en claro).");
    process.exit(2);
  }
  console.log(`Destino: ${url.origin}`);
}

const result = await runCrearLote({
  rows: validation.rows, aplicar: args.aplicar, limite: args.limite, baseUrl, adminKey,
});
if (args.aplicar) for (const line of formatLoteSummary(result, args.archivo)) console.log(line);
process.exit(result.stoppedAt ? 1 : 0);
