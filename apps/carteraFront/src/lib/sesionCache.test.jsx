import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { limpiarCacheDeSesion } from "./sesionCache";

test("limpiarCacheDeSesion: los datos del usuario anterior no sobreviven", () => {
  const qc = new QueryClient();
  qc.setQueryData(["nexa-dashboard"], { creditos: [1, 2, 3] });
  qc.setQueryData(["credito", 7], { nombre: "Cliente del ADMIN" });

  limpiarCacheDeSesion(qc);

  expect(qc.getQueryData(["nexa-dashboard"])).toBeUndefined();
  expect(qc.getQueryData(["credito", 7])).toBeUndefined();
  expect(qc.getQueryCache().getAll()).toHaveLength(0);
});

test("limpiarCacheDeSesion: una respuesta en vuelo no repuebla la caché", async () => {
  const qc = new QueryClient();
  let soltar;
  const lenta = new Promise((r) => (soltar = r));
  const pedido = qc
    .fetchQuery({ queryKey: ["nexa-dashboard"], queryFn: () => lenta })
    .catch(() => "cancelada");

  limpiarCacheDeSesion(qc);
  soltar({ creditos: ["del ADMIN"] });
  await pedido;
  await new Promise((r) => setTimeout(r, 0));

  expect(qc.getQueryData(["nexa-dashboard"])).toBeUndefined();
});

test("limpiarCacheDeSesion: sin nada en caché no falla", () => {
  expect(() => limpiarCacheDeSesion(new QueryClient())).not.toThrow();
});
