import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { authLimiter, createRateLimiter } from "./rateLimiter";

const config = (namespace: string, max: number, soloFallos = false) => ({
  namespace,
  windowMs: 15 * 60 * 1000,
  max,
  message: "limitado",
  code: "RATE_LIMIT_EXCEEDED",
  soloFallos,
});

const request = (email = "victima@example.test", extraHeaders = {}) =>
  new Request("http://localhost/api/auth/sign-in/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "198.51.100.10",
      ...extraHeaders,
    },
    body: JSON.stringify({ email, password: "incorrecta" }),
  });

const formRequest = (email: string) =>
  new Request("http://localhost/api/auth/sign-in/email", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-forwarded-for": "198.51.100.40",
    },
    body: new URLSearchParams({ email, password: "incorrecta" }),
  });

describe("rate limiter del login", () => {
  it("aísla el contador general del contador de fallos de autenticación", async () => {
    const app = new Hono();
    app.use("*", createRateLimiter(config("api", 100)));
    app.use("*", createRateLimiter(config("auth", 2, true)));
    app.post("*", (c) => c.json({ error: "credenciales inválidas" }, 401));

    expect((await app.request(request())).status).toBe(401);
    expect((await app.request(request())).status).toBe(401);
    expect((await app.request(request())).status).toBe(429);
  });

  it("ignora CF-Connecting-IP porque el origen no está detrás de Cloudflare", async () => {
    const app = new Hono();
    app.use("*", createRateLimiter(config("proxy-confiable", 1)));
    app.post("*", (c) => c.json({ ok: true }));

    expect(
      (
        await app.request(
          request("victima@example.test", {
            "cf-connecting-ip": "192.0.2.201",
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(
          request("victima@example.test", {
            "cf-connecting-ip": "192.0.2.202",
          }),
        )
      ).status,
    ).toBe(429);
  });

  it("no borra los fallos de otra cuenta cuando un login sí funciona", async () => {
    const app = new Hono();
    app.use("*", authLimiter);
    app.post("*", async (c) => {
      const body = await c.req.json<{ email: string }>();
      return body.email === "atacante@example.test"
        ? c.json({ ok: true })
        : c.json({ error: "credenciales inválidas" }, 401);
    });

    for (let intento = 0; intento < 9; intento++) {
      expect(
        (
          await app.request(
            request("victima@example.test", {
              "x-forwarded-for": "198.51.100.20",
            }),
          )
        ).status,
      ).toBe(401);
      expect(
        (
          await app.request(
            request("atacante@example.test", {
              "x-forwarded-for": "198.51.100.20",
            }),
          )
        ).status,
      ).toBe(200);
    }

    expect(
      (
        await app.request(
          request("victima@example.test", {
            "x-forwarded-for": "198.51.100.20",
          }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await app.request(
          request("victima@example.test", {
            "x-forwarded-for": "198.51.100.20",
          }),
        )
      ).status,
    ).toBe(429);
  });

  it("no borra fallos al alternar logins urlencoded de cuentas distintas", async () => {
    const app = new Hono();
    app.use("*", authLimiter);
    app.post("*", async (c) => {
      const body = await c.req.parseBody();
      return body.email === "atacante@example.test"
        ? c.json({ ok: true })
        : c.json({ error: "credenciales inválidas" }, 401);
    });

    for (let intento = 0; intento < 9; intento++) {
      expect((await app.request(formRequest("victima@example.test"))).status).toBe(401);
      expect((await app.request(formRequest("atacante@example.test"))).status).toBe(200);
    }

    expect((await app.request(formRequest("victima@example.test"))).status).toBe(401);
    expect((await app.request(formRequest("victima@example.test"))).status).toBe(429);
  });

  it("usa una sola cubeta por IP aunque cambie el correo enviado", async () => {
    const app = new Hono();
    app.use("*", authLimiter);
    app.post("*", (c) => c.json({ error: "credenciales inválidas" }, 401));

    for (let intento = 0; intento < 10; intento++) {
      expect(
        (
          await app.request(
            request(`inventado-${intento}@example.test`, {
              "x-forwarded-for": "198.51.100.50",
            }),
          )
        ).status,
      ).toBe(401);
    }

    expect(
      (
        await app.request(
          request("otro-correo-arbitrario@example.test", {
            "x-forwarded-for": "198.51.100.50",
          }),
        )
      ).status,
    ).toBe(429);
  });

  it("usa una sola cubeta por IP aunque cambie la ruta", async () => {
    const app = new Hono();
    app.use("*", createRateLimiter(config("rutas", 2)));
    app.get("*", (c) => c.json({ ok: true }));
    const headers = { "x-forwarded-for": "198.51.100.60" };

    expect((await app.request("http://localhost/uno", { headers })).status).toBe(200);
    expect((await app.request("http://localhost/dos", { headers })).status).toBe(200);
    expect((await app.request("http://localhost/tres", { headers })).status).toBe(429);
  });

  it("reserva el cupo antes de ejecutar fallos concurrentes", async () => {
    const app = new Hono();
    app.use("*", createRateLimiter(config("concurrente", 2, true)));

    let recibidas = 0;
    let liberar = () => {};
    const espera = new Promise<void>((resolve) => {
      liberar = resolve;
    });

    app.post("*", async (c) => {
      recibidas++;
      await espera;
      return c.json({ error: "credenciales inválidas" }, 401);
    });

    const peticiones = Array.from({ length: 3 }, () =>
      app.request(
        request("victima@example.test", {
          "x-forwarded-for": "198.51.100.70",
        }),
      ),
    );
    const recibidasAntesDeLiberar = recibidas;
    liberar();
    const estados = (await Promise.all(peticiones)).map((response) => response.status).sort();

    expect(recibidasAntesDeLiberar).toBe(2);
    expect(estados).toEqual([401, 401, 429]);
  });

  it("mantiene desactivado el límite en desarrollo sin NODE_ENV explícito", async () => {
    const nodeEnvAnterior = process.env.NODE_ENV;
    delete process.env.NODE_ENV;

    try {
      const app = new Hono();
      app.use("*", createRateLimiter(config("desarrollo", 1)));
      app.post("*", (c) => c.json({ ok: true }));

      expect((await app.request(request())).status).toBe(200);
      expect((await app.request(request())).status).toBe(200);
    } finally {
      if (nodeEnvAnterior === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = nodeEnvAnterior;
    }
  });
});
