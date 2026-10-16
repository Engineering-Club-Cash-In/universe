import { describe, expect, test } from "bun:test";
import { formatLoteSummary, parseCrearLoteArgs, runCrearLote, validateLote, type LoteRow } from "./crear-lote";

const CUI_A = "1234567890101";
const CUI_B = "2000000120101";
const CUI_C = "2000000122217";
const row = (creditoId: number, nationalId = CUI_A, description = `Credito ${creditoId}`): LoteRow => ({ creditoId, description, nationalId });

type Call = { url: string; init: RequestInit; body: { creditoId: number; description: string; nationalId: string } };
function fakeApi(respond: (call: Call) => { status: number; body?: unknown } | "boom") {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    const call: Call = { url, init, body: JSON.parse(String(init.body)) };
    calls.push(call);
    const out = respond(call);
    if (out === "boom") throw new Error("network down");
    return new Response(JSON.stringify(out.body ?? {}), { status: out.status, headers: { "Content-Type": "application/json" } });
  };
  return { calls, fetch };
}
const created = (c: Call, carteraRegistration = "CREATED") => ({
  status: 201,
  body: { creditoId: c.body.creditoId, nationalId: c.body.nationalId, token: `32200${String(c.body.creditoId).padStart(9, "0")}`, carteraRegistration },
});
const base = { aplicar: true, baseUrl: "https://nexa.example", adminKey: "admin-key-123" };

describe("validateLote", () => {
  test("acepta un lote válido y avisa (sin rechazar) del mismo CUI en varios créditos", () => {
    const result = validateLote([row(1, CUI_A), row(2, CUI_A), row(3, CUI_B)]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(3);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("1, 2");
    expect(result.warnings.join()).not.toContain(CUI_A);
  });

  test("rechaza creditoId repetido, inválido, description vacía y CUI malo, todo junto y sin filtrar el CUI", () => {
    const bad = "1234567800101";
    const result = validateLote([
      row(1), row(1), row(-4), { creditoId: 2.5, description: "x", nationalId: CUI_A },
      row(5, CUI_A, "   "), row(6, bad), row(7, 1234567890101 as unknown as string),
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const text = result.errors.join("\n");
    expect(text).toContain("repetido");
    expect(result.errors.length).toBe(6);
    expect(text).toContain("description");
    expect(text).toContain("verificador");
    expect(text).toContain("no número");
    expect(text).not.toContain(bad);
    expect(text).not.toContain(CUI_A);
  });

  test("rechaza lo que no es un array, vacío, filas que no son objeto y description de más de 200", () => {
    expect(validateLote({}).ok).toBe(false);
    expect(validateLote([]).ok).toBe(false);
    expect(validateLote([null, "x"]).ok).toBe(false);
    expect(validateLote([row(1, CUI_A, "x".repeat(201))]).ok).toBe(false);
  });

  test("avisa de un CUI que empieza en 0", () => {
    // 0 + 7 dígitos 0000000 => suma 0 => verificador 0
    const result = validateLote([row(9, "0000000000101")]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings.join()).toContain("empieza en 0");
  });
});

describe("parseCrearLoteArgs", () => {
  test("por defecto es ensayo y valida --limite", () => {
    expect(parseCrearLoteArgs(["--archivo", "a.json"])).toEqual({ ok: true, archivo: "a.json", aplicar: false, limite: undefined });
    expect(parseCrearLoteArgs(["--archivo=a.json", "--limite", "1", "--aplicar"])).toEqual({ ok: true, archivo: "a.json", aplicar: true, limite: 1 });
    expect(parseCrearLoteArgs([])).toMatchObject({ ok: false });
    expect(parseCrearLoteArgs(["--archivo", "a.json", "--limite", "0"])).toMatchObject({ ok: false });
    expect(parseCrearLoteArgs(["--archivo", "a.json", "--aplicr"])).toMatchObject({ ok: false });
  });
});

describe("runCrearLote", () => {
  test("por defecto (sin aplicar) no llama a la API y no imprime el CUI", async () => {
    const api = fakeApi(() => ({ status: 500 }));
    const logs: string[] = [];
    const result = await runCrearLote({ rows: [row(1), row(2, CUI_B)], aplicar: false, fetch: api.fetch, log: (l) => logs.push(l) });
    expect(api.calls).toHaveLength(0);
    expect(result.aplicado).toBe(false);
    expect(result.total).toBe(2);
    expect(logs.join("\n")).toContain("crédito 1");
    expect(logs.join("\n")).not.toContain(CUI_A);
    expect(logs.join("\n")).not.toContain(CUI_B);
  });

  test("--limite procesa solo los primeros N, en orden, con auth y sin seguir redirecciones", async () => {
    const api = fakeApi(created);
    const result = await runCrearLote({ ...base, rows: [row(10), row(11), row(12)], limite: 2, fetch: api.fetch, log: () => {} });
    expect(api.calls.map((c) => c.body.creditoId)).toEqual([10, 11]);
    expect(api.calls[0]!.url).toBe("https://nexa.example/admin/token-users");
    expect((api.calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer admin-key-123");
    expect(api.calls[0]!.init.redirect).toBe("manual");
    expect(api.calls[0]!.init.signal).toBeDefined();
    expect(result.creados).toBe(2);
    expect(result.stoppedAt).toBeUndefined();
  });

  test("también el ensayo respeta --limite", async () => {
    const result = await runCrearLote({ rows: [row(1), row(2), row(3)], aplicar: false, limite: 1, log: () => {} });
    expect(result.total).toBe(1);
  });

  test.each([
    ["PENDING"],
    ["REJECTED:token_conflict"],
    ["REJECTED:credit_cancelled"],
  ])("se detiene en carteraRegistration %s y no sigue con los demás", async (registration) => {
    const api = fakeApi((c) => created(c, c.body.creditoId === 2 ? registration : "CREATED"));
    const result = await runCrearLote({ ...base, rows: [row(1), row(2), row(3), row(4)], fetch: api.fetch, log: () => {} });
    expect(api.calls.map((c) => c.body.creditoId)).toEqual([1, 2]);
    expect(result.creados).toBe(1);
    expect(result.stoppedAt).toMatchObject({ position: 2, creditoId: 2 });
    expect(result.stoppedAt!.reason).toContain(registration);
    expect(result.stoppedAt!.reason).toContain("tokens:sync-cartera --creditos 2");
  });

  test("UPDATED y UNCHANGED son éxito limpio", async () => {
    const api = fakeApi((c) => created(c, c.body.creditoId === 1 ? "UPDATED" : "UNCHANGED"));
    const result = await runCrearLote({ ...base, rows: [row(1), row(2)], fetch: api.fetch, log: () => {} });
    expect(result.creados).toBe(2);
    expect(result.stoppedAt).toBeUndefined();
  });

  test.each([[401], [409], [422], [500], [302]])("se detiene con HTTP %i", async (status) => {
    const api = fakeApi(() => ({ status, body: { error: "nope" } }));
    const result = await runCrearLote({ ...base, rows: [row(1), row(2)], fetch: api.fetch, log: () => {} });
    expect(api.calls).toHaveLength(1);
    expect(result.stoppedAt?.reason).toContain(`HTTP ${status}`);
  });

  test("201 sin carteraRegistration o con valor desconocido también detiene", async () => {
    for (const body of [(c: Call) => ({ creditoId: c.body.creditoId }), (c: Call) => ({ creditoId: c.body.creditoId, carteraRegistration: "OTRA" })]) {
      const api = fakeApi((c) => ({ status: 201, body: body(c) }));
      const result = await runCrearLote({ ...base, rows: [row(1), row(2)], fetch: api.fetch, log: () => {} });
      expect(api.calls).toHaveLength(1);
      expect(result.stoppedAt).toBeDefined();
    }
  });

  test("error de red o timeout detiene sin reintentar", async () => {
    const boom = fakeApi(() => "boom");
    const r1 = await runCrearLote({ ...base, rows: [row(1), row(2)], fetch: boom.fetch, log: () => {} });
    expect(boom.calls).toHaveLength(1);
    expect(r1.stoppedAt?.reason).toContain("idempotente");

    let intentos = 0;
    const colgado = async (_url: string, init: RequestInit) => {
      intentos += 1;
      await new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(new Error("aborted"))));
      return new Response();
    };
    const r2 = await runCrearLote({ ...base, rows: [row(1), row(2)], fetch: colgado, timeoutMs: 20, log: () => {} });
    expect(intentos).toBe(1);
    expect(r2.stoppedAt?.creditoId).toBe(1);
  });

  test("reanudar: HTTP 200 de un crédito que ya existía se salta sin detener, y se lista", async () => {
    const api = fakeApi((c) => c.body.creditoId === 1
      ? { status: 200, body: { creditoId: 1, nationalId: c.body.nationalId, token: "32200000000001" } }
      : created(c));
    const result = await runCrearLote({ ...base, rows: [row(1), row(2)], fetch: api.fetch, log: () => {} });
    expect(result.yaExistian).toEqual([1]);
    expect(result.creados).toBe(1);
    expect(result.stoppedAt).toBeUndefined();
    expect(formatLoteSummary(result, "lote.json").join("\n")).toContain("tokens:sync-cartera --creditos 1");
  });

  test("HTTP 200 con otro nationalId guardado detiene (no es el mismo cliente)", async () => {
    const api = fakeApi(() => ({ status: 200, body: { creditoId: 1, nationalId: CUI_C, token: "32200000000001" } }));
    const result = await runCrearLote({ ...base, rows: [row(1, CUI_A), row(2)], fetch: api.fetch, log: () => {} });
    expect(api.calls).toHaveLength(1);
    expect(result.stoppedAt?.reason).toContain("nationalId distinto");
    expect(JSON.stringify(result)).not.toContain(CUI_C);
  });

  test("respuesta de otro crédito detiene", async () => {
    const api = fakeApi(() => ({ status: 201, body: { creditoId: 999, carteraRegistration: "CREATED" } }));
    const result = await runCrearLote({ ...base, rows: [row(1)], fetch: api.fetch, log: () => {} });
    expect(result.stoppedAt?.reason).toContain("otro crédito");
  });

  test("nunca loguea el nationalId, la llave ni el token completo, ni en éxito ni en error", async () => {
    const logs: string[] = [];
    const api = fakeApi((c) => c.body.creditoId === 2
      ? { status: 422, body: { error: `Nexa rejected ${CUI_B} con admin-key-123 y 32200000000002` } }
      : created(c));
    const result = await runCrearLote({ ...base, rows: [row(1, CUI_A), row(2, CUI_B)], fetch: api.fetch, log: (l) => logs.push(l) });
    const all = [...logs, ...formatLoteSummary(result, "lote.json"), JSON.stringify(result)].join("\n");
    expect(all).not.toContain(CUI_A);
    expect(all).not.toContain(CUI_B);
    expect(all).not.toContain("admin-key-123");
    expect(all).not.toContain("32200000000002");
    expect(all).not.toContain("32200000000001");
    expect(all).toContain("0001"); // últimos 4 del token sí
  });

  test("con aplicar exige URL y llave", async () => {
    await expect(runCrearLote({ rows: [row(1)], aplicar: true, log: () => {} })).rejects.toThrow("NEXA_SERVER_URL");
  });
});
