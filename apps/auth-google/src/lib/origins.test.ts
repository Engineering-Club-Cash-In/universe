import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { cors } from "hono/cors";

import {
  declaraVariosOrigenes,
  normalizeOrigin,
  parseOriginList,
  resolveCorsOrigin,
} from "./origins";

const PORTAL_A = "https://portal.clubcashin.com";
const PORTAL_B = "https://inversionistas.clubcashin.com";
const AJENO = "https://sitio-malicioso.example";

describe("normalizeOrigin", () => {
  it("canoniza a esquema://host[:puerto]", () => {
    expect(normalizeOrigin(`${PORTAL_A}/`)).toBe(PORTAL_A);
    expect(normalizeOrigin(`${PORTAL_A}/ruta?x=1`)).toBe(PORTAL_A);
    expect(normalizeOrigin("http://localhost:5173")).toBe(
      "http://localhost:5173",
    );
  });

  it("descarta lo que no es un origen", () => {
    expect(normalizeOrigin("")).toBeNull();
    expect(normalizeOrigin("   ")).toBeNull();
    expect(normalizeOrigin("null")).toBeNull();
    expect(normalizeOrigin("portal.clubcashin.com")).toBeNull();
    expect(normalizeOrigin(undefined)).toBeNull();
    expect(normalizeOrigin(null)).toBeNull();
  });
});

describe("parseOriginList", () => {
  // El caso que motivó el cambio: la variable admite varios dominios.
  it("parte por comas y canoniza cada entrada", () => {
    expect(parseOriginList(`${PORTAL_A},${PORTAL_B}`).origenes).toEqual([
      PORTAL_A,
      PORTAL_B,
    ]);
  });

  it("tolera espacios y entradas vacías alrededor de las comas", () => {
    expect(parseOriginList(`  ${PORTAL_A} , , ${PORTAL_B}/  `).origenes).toEqual(
      [PORTAL_A, PORTAL_B],
    );
  });

  it("deduplica lo que canoniza al mismo origen", () => {
    expect(parseOriginList(`${PORTAL_A},${PORTAL_A}/`).origenes).toEqual([
      PORTAL_A,
    ]);
  });

  it("separa lo que no es un origen en vez de tragárselo", () => {
    const { origenes, invalidos } = parseOriginList(
      `${PORTAL_A},portal.clubcashin.com`,
    );

    expect(origenes).toEqual([PORTAL_A]);
    expect(invalidos).toEqual(["portal.clubcashin.com"]);
  });

  it("devuelve listas vacías cuando no hay valor", () => {
    expect(parseOriginList(undefined)).toEqual({
      origenes: [],
      invalidos: [],
    });
  });
});

describe("resolveCorsOrigin", () => {
  const CONFIABLES = [PORTAL_A, PORTAL_B];

  // La regresión concreta: devolver `env.CORS_ORIGIN` entero ponía la cadena
  // con coma en `Access-Control-Allow-Origin`, que ningún navegador acepta.
  it("devuelve el origen solicitado, nunca la lista entera", () => {
    expect(
      resolveCorsOrigin({ origin: PORTAL_B, trustedOrigins: CONFIABLES }),
    ).toBe(PORTAL_B);
    expect(
      resolveCorsOrigin({ origin: PORTAL_A, trustedOrigins: CONFIABLES }),
    ).toBe(PORTAL_A);
  });

  it("no devuelve nada para un origen ajeno, ausente u opaco", () => {
    expect(
      resolveCorsOrigin({ origin: AJENO, trustedOrigins: CONFIABLES }),
    ).toBeNull();
    expect(
      resolveCorsOrigin({ origin: "", trustedOrigins: CONFIABLES }),
    ).toBeNull();
    expect(
      resolveCorsOrigin({ origin: "null", trustedOrigins: CONFIABLES }),
    ).toBeNull();
  });

  it("en desarrollo replica la política laxa de siempre", () => {
    expect(
      resolveCorsOrigin({
        origin: "http://localhost:5199",
        trustedOrigins: CONFIABLES,
        allowAnyOrigin: true,
      }),
    ).toBe("http://localhost:5199");
    expect(
      resolveCorsOrigin({
        origin: "",
        trustedOrigins: CONFIABLES,
        allowAnyOrigin: true,
      }),
    ).toBe("*");
  });
});

// Hono escribe verbatim lo que devuelve el callback de `origin`. Estas pruebas
// fijan ese contrato: es la capa donde el bug se veía desde el navegador.
describe("cabecera Access-Control-Allow-Origin con Hono", () => {
  const CONFIABLES = [PORTAL_A, PORTAL_B];

  const construirApp = () => {
    const app = new Hono();
    app.use(
      "*",
      cors({
        origin: (origin) =>
          resolveCorsOrigin({ origin, trustedOrigins: CONFIABLES }),
        credentials: true,
      }),
    );
    app.get("/ping", (c) => c.json({ ok: true }));
    return app;
  };

  it("responde con el dominio que pidió, sin comas", async () => {
    for (const origen of CONFIABLES) {
      const res = await construirApp().request("/ping", {
        headers: { Origin: origen },
      });
      const acao = res.headers.get("access-control-allow-origin");

      expect(acao).toBe(origen);
      expect(acao).not.toContain(",");
    }
  });

  it("omite la cabecera para un origen ajeno", async () => {
    const res = await construirApp().request("/ping", {
      headers: { Origin: AJENO },
    });

    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  // Con la cabecera dependiendo del Origin, una caché compartida podría
  // servirle a un dominio del portal la respuesta del otro. Lo emite el propio
  // `cors` de Hono siempre que `origin` no sea `*`; se fija aquí para que un
  // cambio futuro de esa librería no lo quite sin que nadie se entere.
  it("declara Vary: Origin en respuestas que no son preflight", async () => {
    const res = await construirApp().request("/ping", {
      headers: { Origin: PORTAL_A },
    });

    expect(res.headers.get("vary")).toContain("Origin");
  });
});

describe("declaraVariosOrigenes", () => {
  // El caso que motiva la comprobación: `FRONTEND_URL` cae por default a
  // `CORS_ORIGIN`, así que un despliegue en dos dominios que solo declara
  // `CORS_ORIGIN` copia la lista ENTERA en la base del enlace de recuperación
  // de contraseña. El correo sale con
  // `https://a,https://b/reset-password?token=…`, que el navegador resuelve a
  // un host inexistente.
  it("reconoce una lista de dos dominios", () => {
    expect(declaraVariosOrigenes(`${PORTAL_A},${PORTAL_B}`)).toBe(true);
    expect(declaraVariosOrigenes(` ${PORTAL_A} , ${PORTAL_B} `)).toBe(true);
  });

  it("no se queja de un solo origen", () => {
    expect(declaraVariosOrigenes(PORTAL_A)).toBe(false);
    expect(declaraVariosOrigenes(`${PORTAL_A}/`)).toBe(false);
  });

  // Una coma suelta o un valor repetido no declaran dos dominios distintos:
  // `parseOriginList` ya canoniza y deduplica, así que no hay nada ambiguo que
  // bloquear.
  it("no cuenta comas vacías ni repetidos", () => {
    expect(declaraVariosOrigenes(`${PORTAL_A},`)).toBe(false);
    expect(declaraVariosOrigenes(`${PORTAL_A},${PORTAL_A}`)).toBe(false);
  });

  // Un valor inválido no es "varios orígenes": ese error ya lo reporta la
  // comprobación de esquema, que corre antes y con su propio mensaje.
  it("ignora las entradas que no son un origen", () => {
    expect(declaraVariosOrigenes("portal.cci.com")).toBe(false);
    expect(declaraVariosOrigenes("")).toBe(false);
    expect(declaraVariosOrigenes(undefined)).toBe(false);
  });
});
