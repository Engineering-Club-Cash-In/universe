import { createHash, createHmac, randomUUID } from "node:crypto";

/**
 * Entrega de la cola cartera.nexa_outbox hacia nexa-server.
 *
 * Contrato (fijo): POST {NEXA_SERVER_URL}/internal/cartera/events, firmado con
 * HMAC-SHA256 (NEXA_CARTERA_EVENTS_SECRET) sobre
 *   ["POST", "/internal/cartera/events", timestamp, nonce, sha256hex(body)].join("\n")
 * — el mismo esquema canónico que nexa-server usa hacia cartera.
 *
 * Cómo reclama: un solo statement (su propia transacción, corta) toma hasta 20
 * filas pendientes con FOR UPDATE SKIP LOCKED y les corre proximo_intento_at
 * 2 minutos. Ese "lease" es lo que impide que otra instancia o la siguiente
 * corrida las vuelva a tomar mientras esta envía; la transacción NO queda
 * abierta durante el fetch. Si el proceso muere a mitad, la fila vuelve sola
 * cuando vence el lease. nexa-server es idempotente por eventId, así que un
 * reenvío no hace daño.
 *
 * Qué hace con la respuesta:
 *   2xx                      → enviado_at = now()
 *   400, 413, 422            → terminal: proximo_intento_at = 'infinity' y log de error
 *                              (nexa-server rechazó el contenido; reenviarlo no cambia nada).
 *   cualquier otro, o red    → intentos+1, backoff exponencial (60 s · 2^n, tope 1 h).
 *                              Incluye 404: una versión vieja de nexa-server o un proxy
 *                              mal configurado no debe hacer perder eventos.
 *                              Para reintentarla a mano: proximo_intento_at = now().
 */

export const NEXA_EVENTS_PATH = "/internal/cartera/events";
const LOTE = 20;
const LEASE_SEGUNDOS = 120;
const BACKOFF_BASE_SEGUNDOS = 60;
const BACKOFF_TOPE_SEGUNDOS = 3600;
const TIMEOUT_MS = 10_000;
const MAX_ERROR = 500;
const MIN_SECRET_BYTES = 32;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIPOS_SOPORTADOS = new Set(["credit_cancelled"]);
const ESTADOS_TERMINALES = new Set([400, 413, 422]);

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

/** Lo mínimo de pg.Pool que se usa (client.query). */
export interface NexaOutboxSql {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface NexaEventsConfig {
  nexaServerUrl?: string;
  secret?: string;
  timeoutMs?: number;
}

type FilaOutbox = {
  id: string | number;
  event_id: string;
  tipo: string;
  credito_id: number;
  created_at: Date | string;
};

export type ResultadoEnvio =
  | { omitido: "sin_configuracion" }
  | { reclamados: number; enviados: number; reintentos: number; terminales: number };

type Desenlace =
  | { tipo: "enviado" }
  | { tipo: "reintento"; error: string }
  | { tipo: "terminal"; error: string };

export function backoffSegundos(intentosPrevios: number) {
  const exponente = Math.min(Math.max(0, intentosPrevios), 16);
  return Math.min(BACKOFF_TOPE_SEGUNDOS, BACKOFF_BASE_SEGUNDOS * 2 ** exponente);
}

let configFaltanteAvisada = false;
/** Solo para pruebas: vuelve a permitir el aviso de configuración faltante. */
export const reiniciarAvisoConfigFaltante = () => { configFaltanteAvisada = false; };

// Una vez por proceso y sin el valor del secreto: el job reporta "completed"
// cada minuto, así que sin esto un canal sin configurar pasa por sano.
function avisarConfigFaltante(config: NexaEventsConfig) {
  if (configFaltanteAvisada) return;
  configFaltanteAvisada = true;
  const faltas: string[] = [];
  if (!(config.nexaServerUrl?.trim())) faltas.push("NEXA_SERVER_URL ausente o vacía");
  else if (!URL.canParse(`${config.nexaServerUrl.trim().replace(/\/+$/, "")}${NEXA_EVENTS_PATH}`)) faltas.push("NEXA_SERVER_URL no es una URL válida");
  const bytes = Buffer.byteLength(config.secret?.trim() ?? "");
  if (bytes < MIN_SECRET_BYTES) faltas.push(`NEXA_CARTERA_EVENTS_SECRET ausente o menor a ${MIN_SECRET_BYTES} bytes`);
  console.error(`canal cartera→nexa-server sin configuración: ${faltas.join("; ") || "URL con protocolo o credenciales no permitidos"}; los eventos de la outbox quedan pendientes`);
}

/** null si la configuración no alcanza para enviar: las filas esperan. */
function resolverConfig(config: NexaEventsConfig) {
  const secret = config.secret?.trim() ?? "";
  const base = config.nexaServerUrl?.trim() ?? "";
  if (!base || Buffer.byteLength(secret) < MIN_SECRET_BYTES) return null;
  let url: URL;
  try {
    url = new URL(`${base.replace(/\/+$/, "")}${NEXA_EVENTS_PATH}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  return { url: url.toString(), secret, timeoutMs: config.timeoutMs ?? TIMEOUT_MS };
}

function truncar(texto: string) {
  return texto.length > MAX_ERROR ? texto.slice(0, MAX_ERROR) : texto;
}

function aIso(valor: Date | string) {
  const fecha = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString();
}

export async function enviarEventosNexaPendientes({
  sql,
  fetch: fetcher = fetch,
  now = Date.now,
  config,
}: {
  sql: NexaOutboxSql;
  fetch?: Fetcher;
  now?: () => number;
  config: NexaEventsConfig;
}): Promise<ResultadoEnvio> {
  const resuelta = resolverConfig(config);
  if (!resuelta) {
    avisarConfigFaltante(config);
    return { omitido: "sin_configuracion" };
  }

  const reclamo = await sql.query(
    `WITH reclamadas AS (
       SELECT id
         FROM cartera.nexa_outbox
        WHERE enviado_at IS NULL
          AND proximo_intento_at <= now()
        ORDER BY id
        LIMIT $1
        FOR UPDATE SKIP LOCKED
     )
     UPDATE cartera.nexa_outbox o
        SET proximo_intento_at = now() + $2::int * interval '1 second'
       FROM reclamadas r
      WHERE o.id = r.id
     RETURNING o.id, o.event_id, o.tipo, o.credito_id, o.intentos, o.created_at`,
    [LOTE, LEASE_SEGUNDOS],
  );
  const filas = (reclamo.rows as Array<FilaOutbox & { intentos: number }>)
    .slice()
    .sort((a, b) => Number(a.id) - Number(b.id));

  const resultado = { reclamados: filas.length, enviados: 0, reintentos: 0, terminales: 0 };
  // En paralelo: 20 envíos con timeout de 10 s caben holgados en el lease de 2 min.
  await Promise.all(filas.map(async (fila) => {
    const desenlace = await entregar(fila, resuelta, fetcher, now);
    try {
      await registrar(sql, fila, desenlace);
    } catch (error) {
      // La fila queda con su lease y vuelve en 2 min; reenviar es idempotente.
      console.error(
        `[nexaCarteraEvents] no se pudo registrar el resultado del evento ${fila.event_id}:`,
        error instanceof Error ? error.message : error,
      );
      return;
    }
    if (desenlace.tipo === "enviado") resultado.enviados += 1;
    else if (desenlace.tipo === "reintento") {
      resultado.reintentos += 1;
      console.warn(`[nexaCarteraEvents] evento ${fila.event_id} (crédito ${fila.credito_id}) se reintenta: ${desenlace.error}`);
    } else {
      resultado.terminales += 1;
      console.error(
        `[nexaCarteraEvents] evento ${fila.event_id} (crédito ${fila.credito_id}, ${fila.tipo}) rechazado de forma definitiva, no se reintenta: ${desenlace.error}`,
      );
    }
  }));

  return resultado;
}

async function entregar(
  fila: FilaOutbox,
  config: { url: string; secret: string; timeoutMs: number },
  fetcher: Fetcher,
  now: () => number,
): Promise<Desenlace> {
  if (!TIPOS_SOPORTADOS.has(fila.tipo)) return { tipo: "terminal", error: `tipo_no_soportado: ${truncar(String(fila.tipo))}` };
  const creditoId = Number(fila.credito_id);
  const occurredAt = aIso(fila.created_at);
  if (!UUID.test(String(fila.event_id)) || !Number.isInteger(creditoId) || creditoId <= 0 || !occurredAt) {
    return { tipo: "terminal", error: "fila_invalida" };
  }

  const body = JSON.stringify({ eventId: String(fila.event_id), type: fila.tipo, creditoId, occurredAt });
  const timestamp = String(Math.floor(now() / 1000));
  const nonce = randomUUID();
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const signature = createHmac("sha256", config.secret)
    .update(["POST", NEXA_EVENTS_PATH, timestamp, nonce, bodyHash].join("\n"))
    .digest("hex");

  let response: Response;
  try {
    response = await fetcher(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cartera-timestamp": timestamp,
        "x-cartera-nonce": nonce,
        "x-cartera-signature": signature,
      },
      body,
      // No seguir redirecciones: el cuerpo firmado no sale hacia otro destino.
      redirect: "error",
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    const nombre = error instanceof Error ? error.name : "Error";
    const mensaje = error instanceof Error ? error.message : String(error);
    return { tipo: "reintento", error: truncar(`red: ${nombre}: ${mensaje}`) };
  }

  const detalle = await response.text().then((t) => t.slice(0, 200), () => "");
  if (response.ok) return { tipo: "enviado" };
  const error = truncar(`HTTP ${response.status}${detalle ? `: ${detalle}` : ""}`);
  return ESTADOS_TERMINALES.has(response.status) ? { tipo: "terminal", error } : { tipo: "reintento", error };
}

async function registrar(sql: NexaOutboxSql, fila: FilaOutbox & { intentos: number }, desenlace: Desenlace) {
  if (desenlace.tipo === "enviado") {
    await sql.query(
      `UPDATE cartera.nexa_outbox
          SET enviado_at = now(), ultimo_error = NULL
        WHERE id = $1 AND enviado_at IS NULL`,
      [fila.id],
    );
    return;
  }
  if (desenlace.tipo === "reintento") {
    await sql.query(
      `UPDATE cartera.nexa_outbox
          SET intentos = intentos + 1,
              ultimo_error = $2,
              proximo_intento_at = now() + $3::int * interval '1 second'
        WHERE id = $1 AND enviado_at IS NULL`,
      [fila.id, desenlace.error, backoffSegundos(Number(fila.intentos) || 0)],
    );
    return;
  }
  await sql.query(
    `UPDATE cartera.nexa_outbox
        SET intentos = intentos + 1,
            ultimo_error = $2,
            proximo_intento_at = 'infinity'
      WHERE id = $1 AND enviado_at IS NULL`,
    [fila.id, desenlace.error],
  );
}
