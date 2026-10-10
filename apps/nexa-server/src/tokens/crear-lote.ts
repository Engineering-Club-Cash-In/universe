import { validateCui } from "./cui";

export type LoteRow = { creditoId: number; description: string; nationalId: string };

export const CREAR_LOTE_USAGE = [
  "Uso: bun run tokens:crear-lote --archivo <ruta.json> [--limite N] [--aplicar]",
  "  --archivo <ruta>  JSON con [{ creditoId, description, nationalId }]",
  "  --limite N        procesa solo las primeras N filas (para probar con 1)",
  "  --aplicar         crea los tokens de verdad; sin esto es un ensayo que no llama a la API",
  "Entorno (solo con --aplicar): NEXA_SERVER_URL, NEXA_ADMIN_API_KEY",
].join("\n");

export type CrearLoteArgs =
  | { ok: true; archivo: string; aplicar: boolean; limite?: number }
  | { ok: false; error: string };

export function parseCrearLoteArgs(argv: string[]): CrearLoteArgs {
  let archivo: string | undefined;
  let limiteRaw: string | undefined;
  let aplicar = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--aplicar") aplicar = true;
    else if (arg === "--archivo" || arg.startsWith("--archivo=")) {
      const value = arg === "--archivo" ? argv[++i] : arg.slice("--archivo=".length);
      if (!value || value.startsWith("--")) return { ok: false, error: "--archivo necesita una ruta." };
      archivo = value;
    } else if (arg === "--limite" || arg.startsWith("--limite=")) {
      const value = arg === "--limite" ? argv[++i] : arg.slice("--limite=".length);
      if (value === undefined) return { ok: false, error: "--limite necesita un número." };
      limiteRaw = value;
    } else return { ok: false, error: `Argumento desconocido: ${arg}` };
  }
  if (!archivo) return { ok: false, error: "Falta --archivo <ruta.json>." };
  let limite: number | undefined;
  if (limiteRaw !== undefined) {
    if (!/^[1-9]\d*$/.test(limiteRaw)) return { ok: false, error: "--limite debe ser un entero positivo." };
    limite = Number(limiteRaw);
  }
  return { ok: true, archivo, aplicar, limite };
}

export type LoteValidation =
  | { ok: true; rows: LoteRow[]; warnings: string[] }
  | { ok: false; errors: string[] };

const MAX_DESCRIPTION = 200; // nexa_token_users.description es varchar(200)

/** Valida TODO el lote antes de tocar la red. Los mensajes nunca incluyen el nationalId. */
export function validateLote(input: unknown): LoteValidation {
  if (!Array.isArray(input)) return { ok: false, errors: ["El archivo debe contener un array JSON."] };
  if (input.length === 0) return { ok: false, errors: ["El array está vacío."] };
  const errors: string[] = [];
  const rows: LoteRow[] = [];
  const seenCredito = new Map<number, number>();
  input.forEach((raw, index) => {
    const at = `Fila ${index + 1}`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      errors.push(`${at}: debe ser un objeto { creditoId, description, nationalId }.`);
      return;
    }
    const row = raw as Record<string, unknown>;
    const { creditoId, description, nationalId } = row;
    let ok = true;
    if (typeof creditoId !== "number" || !Number.isSafeInteger(creditoId) || creditoId <= 0) {
      errors.push(`${at}: creditoId debe ser un entero positivo.`);
      ok = false;
    } else if (seenCredito.has(creditoId)) {
      errors.push(`${at}: creditoId ${creditoId} repetido (ya aparece en la fila ${seenCredito.get(creditoId)}).`);
      ok = false;
    } else seenCredito.set(creditoId, index + 1);
    if (typeof description !== "string" || description.trim() === "") {
      errors.push(`${at}${typeof creditoId === "number" ? ` (crédito ${creditoId})` : ""}: description no puede estar vacía.`);
      ok = false;
    } else if (description.length > MAX_DESCRIPTION) {
      errors.push(`${at}: description pasa de ${MAX_DESCRIPTION} caracteres.`);
      ok = false;
    }
    const cui = validateCui(nationalId);
    if (!cui.valid) {
      errors.push(`${at}${typeof creditoId === "number" ? ` (crédito ${creditoId})` : ""}: nationalId inválido, ${cui.reason}.`);
      ok = false;
    }
    if (ok) rows.push({ creditoId: creditoId as number, description: description as string, nationalId: nationalId as string });
  });
  if (errors.length > 0) return { ok: false, errors };

  const warnings: string[] = [];
  const byCui = new Map<string, number[]>();
  for (const row of rows) byCui.set(row.nationalId, [...(byCui.get(row.nationalId) ?? []), row.creditoId]);
  for (const ids of byCui.values()) {
    if (ids.length > 1) warnings.push(`Un mismo CUI aparece en varios créditos (${ids.join(", ")}): es válido, solo se avisa.`);
  }
  const leadingZero = rows.filter((row) => row.nationalId.startsWith("0")).map((row) => row.creditoId);
  if (leadingZero.length > 0) {
    warnings.push(`CUI que empieza en 0 (créditos ${leadingZero.join(", ")}): el servidor lo manda a Nexa como número y pierde ese cero; revisar.`);
  }
  return { ok: true, rows, warnings };
}

const CLEAN_CARTERA = new Set(["CREATED", "UPDATED", "UNCHANGED"]);

export type LoteOutcome = {
  creditoId: number;
  http?: number;
  carteraRegistration?: string;
  tokenLast4?: string;
  kind: "creado" | "ya_existia" | "detenido";
  detail?: string;
};

export type LoteResult = {
  aplicado: boolean;
  total: number;
  procesadas: number;
  creados: number;
  yaExistian: number[];
  outcomes: LoteOutcome[];
  stoppedAt?: { position: number; creditoId: number; reason: string };
};

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

// Nunca debe salir un CUI ni un token completo: se tapa toda corrida larga de dígitos.
function sanitize(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) if (secret) out = out.split(secret).join("***");
  return out.replace(/\d{13,}/g, "***").slice(0, 200);
}

export async function runCrearLote(options: {
  rows: LoteRow[];
  aplicar: boolean;
  limite?: number;
  baseUrl?: string;
  adminKey?: string;
  fetch?: Fetcher;
  timeoutMs?: number;
  log?: (line: string) => void;
}): Promise<LoteResult> {
  const log = options.log ?? console.log;
  const selected = options.limite ? options.rows.slice(0, options.limite) : options.rows;
  const result: LoteResult = {
    aplicado: options.aplicar, total: selected.length, procesadas: 0, creados: 0, yaExistian: [], outcomes: [],
  };

  if (!options.aplicar) {
    log(`ENSAYO (no se llama a la API). Se crearían ${selected.length} de ${options.rows.length} tokens:`);
    selected.forEach((row, i) => log(`  ${i + 1}. crédito ${row.creditoId} - ${row.description}`));
    log("Para crear de verdad: agregar --aplicar.");
    return result;
  }

  if (!options.baseUrl || !options.adminKey) throw new Error("Con --aplicar hacen falta NEXA_SERVER_URL y NEXA_ADMIN_API_KEY.");
  const doFetch: Fetcher = options.fetch ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? 30_000;
  const endpoint = `${options.baseUrl.replace(/\/+$/, "")}/admin/token-users`;

  for (const [index, row] of selected.entries()) {
    const position = index + 1;
    const secrets = [row.nationalId, options.adminKey];
    const stop = (reason: string, extra: Partial<LoteOutcome> = {}) => {
      const reasonSafe = sanitize(reason, secrets);
      result.outcomes.push({ creditoId: row.creditoId, kind: "detenido", detail: reasonSafe, ...extra });
      result.stoppedAt = { position, creditoId: row.creditoId, reason: reasonSafe };
      log(`  ${position}/${selected.length} crédito ${row.creditoId}: DETENIDO - ${reasonSafe}`);
      return result;
    };
    let response: Response;
    try {
      // Sin reintentos y sin seguir redirecciones (no se reenvía la llave a otro host).
      response = await doFetch(endpoint, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { Authorization: `Bearer ${options.adminKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ creditoId: row.creditoId, description: row.description, nationalId: row.nationalId }),
      });
    } catch (error) {
      return stop(`sin respuesta (${error instanceof Error ? error.name : "error"}): el token pudo haberse creado; es seguro reintentar, el endpoint es idempotente`);
    }

    let body: Record<string, unknown> | undefined;
    try {
      const parsed = await response.json();
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
    } catch { /* cuerpo no JSON */ }
    const http = response.status;
    const carteraRegistration = typeof body?.carteraRegistration === "string" ? body.carteraRegistration : undefined;
    const token = typeof body?.token === "string" ? body.token : undefined;
    const tokenLast4 = token ? token.slice(-4) : undefined;
    const meta = { http, carteraRegistration, tokenLast4 };

    if (http !== 200 && http !== 201) {
      const err = typeof body?.error === "string" ? `: ${body.error}` : "";
      return stop(`HTTP ${http}${err}`, meta);
    }
    if (!body) return stop(`HTTP ${http} con cuerpo que no es JSON`, meta);
    if (body.creditoId !== row.creditoId) return stop(`la respuesta es de otro crédito (${String(body.creditoId)})`, meta);
    if (carteraRegistration !== undefined && !CLEAN_CARTERA.has(carteraRegistration)) {
      return stop(`cartera respondió ${carteraRegistration}; el token puede existir en nexa-server, repararlo con tokens:sync-cartera --creditos ${row.creditoId}`, meta);
    }
    if (http === 201 && carteraRegistration === undefined) {
      return stop("HTTP 201 sin carteraRegistration", meta);
    }

    result.procesadas += 1;
    if (http === 200 && carteraRegistration === undefined) {
      // Idempotencia: el crédito ya tenía token. Si el CUI guardado difiere, no es el mismo cliente.
      if (body.nationalId !== row.nationalId) {
        result.procesadas -= 1;
        return stop("el crédito ya tenía token con un nationalId distinto al del archivo", meta);
      }
      result.yaExistian.push(row.creditoId);
      result.outcomes.push({ creditoId: row.creditoId, kind: "ya_existia", ...meta });
      log(`  ${position}/${selected.length} crédito ${row.creditoId}: ya existía (HTTP 200, token ...${tokenLast4 ?? "????"}); cartera no se confirma aquí`);
    } else {
      result.creados += 1;
      result.outcomes.push({ creditoId: row.creditoId, kind: "creado", ...meta });
      log(`  ${position}/${selected.length} crédito ${row.creditoId}: HTTP ${http} cartera=${carteraRegistration} token ...${tokenLast4 ?? "????"}`);
    }
  }
  return result;
}

export function formatLoteSummary(result: LoteResult, archivo: string): string[] {
  const lines = [`Resumen: ${result.creados} creados, ${result.yaExistian.length} ya existían, ${result.procesadas} de ${result.total} procesados.`];
  if (result.yaExistian.length > 0) {
    lines.push(`Ya existían (cartera sin confirmar): ${result.yaExistian.join(", ")}. Verificar con: bun run tokens:sync-cartera --creditos ${result.yaExistian.join(",")} --dry-run`);
  }
  if (result.stoppedAt) {
    const { position, creditoId, reason } = result.stoppedAt;
    lines.push(`SE DETUVO en la fila ${position} (crédito ${creditoId}): ${reason}`);
    lines.push(`Quedaron hechas ${result.procesadas}. Corregir la causa y retomar volviendo a correr el mismo comando con --archivo ${archivo} --aplicar: los ya creados responden 200 y se saltan.`);
  }
  return lines;
}
