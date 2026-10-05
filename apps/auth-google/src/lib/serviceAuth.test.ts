import { describe, expect, it } from "bun:test";

import { extractBearerToken, secretsMatch } from "./serviceAuth";

describe("secretsMatch", () => {
  it("acepta el secreto correcto", () => {
    expect(secretsMatch("s3cr3t-compartido", "s3cr3t-compartido")).toBe(true);
  });

  it("rechaza un secreto distinto de la misma longitud", () => {
    expect(secretsMatch("aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb")).toBe(false);
  });

  it("rechaza secretos de longitudes distintas sin lanzar", () => {
    expect(() => secretsMatch("corto", "un-secreto-mucho-mas-largo")).not.toThrow();
    expect(secretsMatch("corto", "un-secreto-mucho-mas-largo")).toBe(false);
  });

  it("rechaza cuando el prefijo coincide pero el resto no", () => {
    expect(secretsMatch("secreto", "secreto-extendido")).toBe(false);
  });

  // Fail closed: si el entorno no trae el secreto configurado, nadie pasa.
  it("rechaza cuando el secreto esperado no está configurado", () => {
    expect(secretsMatch("lo-que-sea", undefined)).toBe(false);
    expect(secretsMatch("lo-que-sea", "")).toBe(false);
    expect(secretsMatch("lo-que-sea", "   ")).toBe(false);
  });

  it("rechaza cuando no se envió ningún secreto", () => {
    expect(secretsMatch(undefined, "s3cr3t-compartido")).toBe(false);
    expect(secretsMatch("", "s3cr3t-compartido")).toBe(false);
  });

  it("rechaza cuando faltan ambos", () => {
    expect(secretsMatch(undefined, undefined)).toBe(false);
  });
});

describe("extractBearerToken", () => {
  it("extrae el token de un header Bearer", () => {
    expect(extractBearerToken("Bearer abc123")).toBe("abc123");
  });

  it("acepta el esquema sin distinguir mayúsculas", () => {
    expect(extractBearerToken("bearer abc123")).toBe("abc123");
  });

  it("devuelve null si el header falta o no es Bearer", () => {
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken("")).toBeNull();
    expect(extractBearerToken("Basic abc123")).toBeNull();
    expect(extractBearerToken("Bearer")).toBeNull();
    expect(extractBearerToken("Bearer    ")).toBeNull();
  });
});
