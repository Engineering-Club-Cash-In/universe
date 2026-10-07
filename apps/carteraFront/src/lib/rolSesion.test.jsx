import { expect, test } from "bun:test";
import { debeCerrarSesionPorRol, rolCambio, rolDelToken } from "./rolSesion";

const jwt = (payload) =>
  `${btoa(JSON.stringify({ alg: "HS256" }))}.${btoa(JSON.stringify(payload)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")}.firma`;

test("rolCambio: mismo rol no cierra sesión", () => {
  expect(rolCambio("ADMIN", "ADMIN")).toBe(false);
});

test("rolCambio: ascendido o degradado cierra sesión", () => {
  expect(rolCambio("ASESOR", "ADMIN")).toBe(true);
  expect(rolCambio("ADMIN", "CONTA")).toBe(true);
});

test("rolCambio: sin rol del servidor no decide", () => {
  expect(rolCambio("ADMIN", undefined)).toBe(false);
  expect(rolCambio("ADMIN", null)).toBe(false);
  expect(rolCambio("ADMIN", "")).toBe(false);
});

test("rolDelToken: lee el rol del payload (base64url, sin padding)", () => {
  // "?>?" produce "/" y "+" en base64: el token los trae como "_" y "-".
  const conUrlSafe = jwt({ id: 7, email: "a?>?b@x.com", role: "CONTA" });
  expect(conUrlSafe).toMatch(/[-_]/);
  expect(rolDelToken(conUrlSafe)).toBe("CONTA");
  expect(rolDelToken(jwt({ id: 7, role: "ADMIN", pad: "a" }))).toBe("ADMIN");
});

test("rolDelToken: token roto o sin rol da null", () => {
  expect(rolDelToken("no-es-un-jwt")).toBeNull();
  expect(rolDelToken("a.%%%.b")).toBeNull();
  expect(rolDelToken(jwt({ id: 7 }))).toBeNull();
  expect(rolDelToken(undefined)).toBeNull();
});

test("debeCerrarSesionPorRol: compara el rol del token rotado con el user guardado", () => {
  const user = JSON.stringify({ id: 3, role: "ADMIN" });
  expect(debeCerrarSesionPorRol(user, jwt({ id: 3, role: "ADMIN" }))).toBe(false);
  expect(debeCerrarSesionPorRol(user, jwt({ id: 3, role: "ASESOR" }))).toBe(true);
  // El token no informa rol: no decide.
  expect(debeCerrarSesionPorRol(user, jwt({ id: 3 }))).toBe(false);
  expect(debeCerrarSesionPorRol(user, "no-es-un-jwt")).toBe(false);
  // Sin user legible y con rol en el token: cierra (no hay contra qué validar).
  expect(debeCerrarSesionPorRol(null, jwt({ id: 3, role: "ADMIN" }))).toBe(true);
  expect(debeCerrarSesionPorRol("{roto", jwt({ id: 3, role: "ADMIN" }))).toBe(true);
});
