import { createHash, createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { backoffSegundos, enviarEventosNexaPendientes, reiniciarAvisoConfigFaltante, type NexaOutboxSql } from "./nexaCarteraEvents";

const SECRET = "k".repeat(40);
const NOW = 1_790_000_000_000;
const CONFIG = { nexaServerUrl: "https://nexa.example.com/", secret: SECRET };

type Fila = { id: string; event_id: string; tipo: string; credito_id: number; intentos: number; created_at: Date };

const fila = (over: Partial<Fila> = {}): Fila => ({
  id: "7",
  event_id: "7f0c2f5e-3d1a-4c55-9a43-2f8f2f0f9b11",
  tipo: "credit_cancelled",
  credito_id: 9234,
  intentos: 0,
  created_at: new Date("2026-10-05T15:00:00.000Z"),
  ...over,
});

function fakeSql(filas: Fila[]) {
  const queries: Array<{ text: string; params: unknown[] }> = [];
  const sql: NexaOutboxSql = {
    query: async (text, params = []) => {
      queries.push({ text, params });
      if (/FOR UPDATE SKIP LOCKED/.test(text)) return { rows: filas };
      return { rows: [] };
    },
  };
  const updates = () => queries.filter((q) => !/FOR UPDATE SKIP LOCKED/.test(q.text));
  return { sql, queries, updates };
}

function fakeFetch(respond: () => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond();
  };
  return { fetch, calls };
}

const ok = () => new Response(JSON.stringify({ status: "ok", eventId: "x", deactivated: 1 }), { status: 200 });

describe("enviarEventosNexaPendientes", () => {
  test("firma la petición con el esquema canónico y envía el body del contrato", async () => {
    const { sql } = fakeSql([fila()]);
    const { fetch, calls } = fakeFetch(ok);
    await enviarEventosNexaPendientes({ sql, fetch, now: () => NOW, config: CONFIG });

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe("https://nexa.example.com/internal/cartera/events");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = String(init.body);
    expect(JSON.parse(body)).toEqual({
      eventId: "7f0c2f5e-3d1a-4c55-9a43-2f8f2f0f9b11",
      type: "credit_cancelled",
      creditoId: 9234,
      occurredAt: "2026-10-05T15:00:00.000Z",
    });
    const headers = init.headers as Record<string, string>;
    expect(headers["x-cartera-timestamp"]).toBe(String(NOW / 1000));
    expect(headers["x-cartera-nonce"]).toMatch(/^[0-9a-f-]{36}$/);
    const esperado = createHmac("sha256", SECRET).update([
      "POST",
      "/internal/cartera/events",
      headers["x-cartera-timestamp"],
      headers["x-cartera-nonce"],
      createHash("sha256").update(body).digest("hex"),
    ].join("\n")).digest("hex");
    expect(headers["x-cartera-signature"]).toBe(esperado);
    expect(JSON.stringify(init)).not.toContain(SECRET);
  });

  test("cada envío lleva un nonce distinto", async () => {
    const { sql } = fakeSql([fila({ id: "1" }), fila({ id: "2", event_id: "8f0c2f5e-3d1a-4c55-9a43-2f8f2f0f9b11" })]);
    const { fetch, calls } = fakeFetch(ok);
    await enviarEventosNexaPendientes({ sql, fetch, now: () => NOW, config: CONFIG });
    const nonces = calls.map((c) => (c.init.headers as Record<string, string>)["x-cartera-nonce"]);
    expect(new Set(nonces).size).toBe(2);
  });

  test("reclama con SKIP LOCKED, lote 20 y lease de 2 minutos en un solo statement", async () => {
    const { sql, queries } = fakeSql([]);
    const { fetch, calls } = fakeFetch(ok);
    const r = await enviarEventosNexaPendientes({ sql, fetch, now: () => NOW, config: CONFIG });
    expect(r).toEqual({ reclamados: 0, enviados: 0, reintentos: 0, terminales: 0 });
    expect(calls).toHaveLength(0);
    expect(queries).toHaveLength(1);
    const claim = queries[0]!;
    expect(claim.text).toContain("enviado_at IS NULL");
    expect(claim.text).toContain("proximo_intento_at <= now()");
    expect(claim.text).toContain("ORDER BY id");
    expect(claim.text).toContain("FOR UPDATE SKIP LOCKED");
    expect(claim.params).toEqual([20, 120]);
  });

  test("éxito marca enviado_at", async () => {
    const { sql, updates } = fakeSql([fila()]);
    const { fetch } = fakeFetch(ok);
    const r = await enviarEventosNexaPendientes({ sql, fetch, now: () => NOW, config: CONFIG });
    expect(r).toEqual({ reclamados: 1, enviados: 1, reintentos: 0, terminales: 0 });
    expect(updates()).toHaveLength(1);
    expect(updates()[0]!.text).toContain("enviado_at = now()");
    expect(updates()[0]!.params).toEqual(["7"]);
  });

  test.each([500, 502, 503, 401, 403, 404, 408, 409, 429])("HTTP %d reintenta con backoff exponencial", async (status) => {
    const { sql, updates } = fakeSql([fila({ intentos: 3 })]);
    const { fetch } = fakeFetch(() => new Response('{"error":"x"}', { status }));
    const r = await enviarEventosNexaPendientes({ sql, fetch, now: () => NOW, config: CONFIG });
    expect(r).toMatchObject({ reintentos: 1, enviados: 0, terminales: 0 });
    const u = updates()[0]!;
    expect(u.text).toContain("intentos = intentos + 1");
    expect(u.text).not.toContain("infinity");
    expect(u.params[0]).toBe("7");
    expect(String(u.params[1])).toStartWith(`HTTP ${status}`);
    expect(u.params[2]).toBe(480); // 60 · 2^3
  });

  test("error de red / timeout reintenta", async () => {
    const { sql, updates } = fakeSql([fila()]);
    const { fetch } = fakeFetch(() => { throw new DOMException("The operation timed out.", "TimeoutError"); });
    const r = await enviarEventosNexaPendientes({ sql, fetch, now: () => NOW, config: CONFIG });
    expect(r).toMatchObject({ reintentos: 1 });
    expect(String(updates()[0]!.params[1])).toContain("TimeoutError");
    expect(updates()[0]!.params[2]).toBe(60);
  });

  test("el backoff llega a tope de 1 hora", () => {
    expect([0, 1, 2, 5, 6, 10, 1000].map(backoffSegundos)).toEqual([60, 120, 240, 1920, 3600, 3600, 3600]);
  });

  test.each([400, 413, 422])("HTTP %d es terminal: no se reintenta más", async (status) => {
    const { sql, updates } = fakeSql([fila()]);
    const { fetch } = fakeFetch(() => new Response('{"error":"invalid_body"}', { status }));
    const r = await enviarEventosNexaPendientes({ sql, fetch, now: () => NOW, config: CONFIG });
    expect(r).toMatchObject({ terminales: 1, reintentos: 0, enviados: 0 });
    const u = updates()[0]!;
    expect(u.text).toContain("proximo_intento_at = 'infinity'");
    expect(String(u.params[1])).toBe(`HTTP ${status}: {"error":"invalid_body"}`);
  });

  test("ultimo_error se trunca a 500 caracteres", async () => {
    const { sql, updates } = fakeSql([fila()]);
    const { fetch } = fakeFetch(() => { throw new Error("x".repeat(2000)); });
    await enviarEventosNexaPendientes({ sql, fetch, now: () => NOW, config: CONFIG });
    expect(String(updates()[0]!.params[1]).length).toBe(500);
  });

  test("tipo no soportado o fila inválida: terminal sin enviar", async () => {
    const { sql, updates } = fakeSql([
      fila({ id: "1", tipo: "credit_reactivated" }),
      fila({ id: "2", credito_id: 0, event_id: "8f0c2f5e-3d1a-4c55-9a43-2f8f2f0f9b11" }),
    ]);
    const { fetch, calls } = fakeFetch(ok);
    const r = await enviarEventosNexaPendientes({ sql, fetch, now: () => NOW, config: CONFIG });
    expect(calls).toHaveLength(0);
    expect(r).toMatchObject({ terminales: 2 });
    expect(updates().every((u) => u.text.includes("'infinity'"))).toBe(true);
  });

  test.each([
    ["sin URL", { secret: SECRET }],
    ["sin secreto", { nexaServerUrl: "https://nexa.example.com" }],
    ["secreto corto", { nexaServerUrl: "https://nexa.example.com", secret: "corto" }],
    ["URL inválida", { nexaServerUrl: "no es url", secret: SECRET }],
    ["protocolo no http", { nexaServerUrl: "ftp://nexa.example.com", secret: SECRET }],
    ["credenciales en la URL", { nexaServerUrl: "https://u:p@nexa.example.com", secret: SECRET }],
  ])("%s: no reclama ni envía nada", async (_caso, config) => {
    const { sql, queries } = fakeSql([fila()]);
    const { fetch, calls } = fakeFetch(ok);
    const r = await enviarEventosNexaPendientes({ sql, fetch, now: () => NOW, config });
    expect(r).toEqual({ omitido: "sin_configuracion" });
    expect(queries).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  test("avisa UNA vez por proceso qué falta, sin el valor del secreto", async () => {
    reiniciarAvisoConfigFaltante();
    const original = console.error;
    const logs: string[] = [];
    console.error = (...args: unknown[]) => { logs.push(args.join(" ")); };
    try {
      const config = { nexaServerUrl: "", secret: "corto-secreto" };
      for (let i = 0; i < 3; i++) {
        await enviarEventosNexaPendientes({ sql: fakeSql([fila()]).sql, fetch: fakeFetch(ok).fetch, now: () => NOW, config });
      }
    } finally {
      console.error = original;
    }
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("canal cartera→nexa-server sin configuración");
    expect(logs[0]).toContain("NEXA_SERVER_URL");
    expect(logs[0]).toContain("NEXA_CARTERA_EVENTS_SECRET");
    expect(logs[0]).not.toContain("corto-secreto");
  });

  test("si falla el registro del resultado no revienta la corrida", async () => {
    const queries: string[] = [];
    const sql: NexaOutboxSql = {
      query: async (text) => {
        queries.push(text);
        if (/SKIP LOCKED/.test(text)) return { rows: [fila()] };
        throw new Error("db caída");
      },
    };
    const { fetch } = fakeFetch(ok);
    const r = await enviarEventosNexaPendientes({ sql, fetch, now: () => NOW, config: CONFIG });
    expect(r).toEqual({ reclamados: 1, enviados: 0, reintentos: 0, terminales: 0 });
  });

  test("si falla el reclamo, lanza (el job lo reporta como fallido)", async () => {
    const sql: NexaOutboxSql = { query: async () => { throw new Error("db caída"); } };
    const { fetch } = fakeFetch(ok);
    await expect(enviarEventosNexaPendientes({ sql, fetch, now: () => NOW, config: CONFIG })).rejects.toThrow("db caída");
  });
});
