import { afterEach, expect, spyOn, test } from "bun:test";
import { borrarComprobantesNexaDeR2BestEffort, keyDeUrlBoletaNexa } from "./nexaBoletaR2";

const uuid = "0f8b7c1e-2a3d-4e5f-8a9b-0c1d2e3f4a5b";
const key = `boletas-nexa/${uuid}.png`;
const logs = () => [...spyOn(console, "error").mock.calls, ...spyOn(console, "info").mock.calls].map(([l]) => JSON.parse(l));
afterEach(() => { spyOn(console, "error").mockRestore(); spyOn(console, "info").mockRestore(); });
const silenciar = () => { spyOn(console, "error").mockImplementation(() => {}); spyOn(console, "info").mockImplementation(() => {}); };

test("la key sale de la URL desde boletas-nexa/, con cualquier URL_PUBLIC_R2, y solo si es un PNG generado", () => {
  expect(keyDeUrlBoletaNexa(`https://pub-viejo.r2.dev/${key}`)).toBe(key);
  expect(keyDeUrlBoletaNexa(`https://cdn.clubcashin.com/boletas/${key}`)).toBe(key);
  for (const url of [`https://r2/${uuid}.png`, "https://r2/boletas-nexa/x.png", `https://r2/${key}?v=1`,
    `https://r2/boletas-nexa/../${uuid}.png`, `https://r2/boletas-nexa/${uuid.toUpperCase()}.png`,
    `https://r2/boletas-nexa/${uuid}.jpg`, `https://r2/boletas-nexa/sub/${uuid}.png`, ""]) {
    expect(keyDeUrlBoletaNexa(url)).toBeNull();
  }
});

test("fuera de producción no borra nada, y una URL ajena nunca se borra", async () => {
  silenciar();
  const borrar = spyOn({ borrar: async (_: string) => {} }, "borrar");
  await borrarComprobantesNexaDeR2BestEffort([`https://r2/${key}`], { produccion: () => false, borrar, timeoutMs: 50 });
  await borrarComprobantesNexaDeR2BestEffort(["https://r2/subida-a-mano.png"], { produccion: () => true, borrar, timeoutMs: 50 });
  expect(borrar).not.toHaveBeenCalled();
  expect(logs().map((l) => l.event)).toEqual(["nexa.boleta_imagen.error", "nexa.boleta_imagen.r2_no_borrado"]);
});

test("si el borrado falla o se cuelga, no lanza, sigue con el resto y deja la key en el log", async () => {
  silenciar();
  const otra = key.replace("0f8b", "1f8b");
  const borrar = async (k: string) => {
    if (k === key) throw new Error("R2 caído");
    return new Promise<void>(() => {});
  };
  await borrarComprobantesNexaDeR2BestEffort([`https://r2/${key}`, `https://r2/${otra}`], { produccion: () => true, borrar, timeoutMs: 20 });
  expect(logs()).toEqual([key, otra].map((k, i) => ({
    level: "error", paso: "borrar_r2_tras_borrar_pago", event: "nexa.boleta_imagen.error", key: k,
    error: i === 0 ? "R2 caído" : "tiempo agotado (20 ms)",
  })));
});
