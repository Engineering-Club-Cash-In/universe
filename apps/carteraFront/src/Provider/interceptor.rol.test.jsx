import { afterAll, beforeEach, expect, test } from "bun:test";
import axios from "axios";

const originales = { localStorage: globalThis.localStorage, window: globalThis.window, post: axios.post };
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.window = { location: { pathname: "/creditos", href: "/creditos" } };

const jwt = (payload) =>
  `${btoa(JSON.stringify({ alg: "HS256" }))}.${btoa(JSON.stringify(payload)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")}.firma`;
const vencido = (role) => jwt({ id: 3, role, exp: Math.floor(Date.now() / 1000) - 10 });

const { default: api } = await import("./interceptor");
const interceptorDeRequest = api.interceptors.request.handlers.find(Boolean).fulfilled;

afterAll(() => {
  globalThis.localStorage = originales.localStorage;
  globalThis.window = originales.window;
  axios.post = originales.post;
});

beforeEach(() => {
  store.clear();
  window.location.href = "/creditos";
  store.set("accessToken", vencido("ADMIN"));
  store.set("refreshToken", "refresh-viejo");
  store.set("user", JSON.stringify({ id: 3, role: "ADMIN" }));
});

const refrescaCon = (role) => {
  axios.post = async () => ({
    data: { success: true, accessToken: jwt({ id: 3, role, exp: Math.floor(Date.now() / 1000) + 3600 }), refreshToken: "refresh-nuevo" },
  });
};

test("refresh automático con el mismo rol guarda los tokens rotados", async () => {
  refrescaCon("ADMIN");
  const config = await interceptorDeRequest({ url: "/creditos", headers: {} });
  expect(store.get("refreshToken")).toBe("refresh-nuevo");
  expect(config.headers.Authorization).toBe(`Bearer ${store.get("accessToken")}`);
  await new Promise((r) => setTimeout(r, 1));
});

test("refresh automático con otro rol no guarda los tokens y cierra la sesión", async () => {
  refrescaCon("ASESOR");
  await expect(interceptorDeRequest({ url: "/creditos", headers: {} })).rejects.toThrow("Sesión expirada");
  expect(store.has("accessToken")).toBe(false);
  expect(store.has("refreshToken")).toBe(false);
  expect(store.has("user")).toBe(false);
  expect(window.location.href).toBe("/login");
  await new Promise((r) => setTimeout(r, 1));
});
