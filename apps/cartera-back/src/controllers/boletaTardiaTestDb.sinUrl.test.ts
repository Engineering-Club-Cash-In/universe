import { expect, test } from "bun:test";
import { cerrarEsquemaBoletaTardia, levantarEsquemaBoletaTardia } from "./boletaTardiaTestDb";

// Codex r1 #4: sin TEST_DATABASE_URL, postgres.js se conectaría por defecto (PG*/localhost)
// y el fixture correría DROP SCHEMA cartera CASCADE ahí. Debe negarse antes de conectar.
// No usa integrationTest: corre justamente cuando la variable NO está.
test.skipIf(!!process.env.TEST_DATABASE_URL)("sin TEST_DATABASE_URL el fixture se niega a conectar", async () => {
  await expect(levantarEsquemaBoletaTardia()).rejects.toThrow(/TEST_DATABASE_URL/);
  // El rechazo no queda memorizado: el afterAll de los otros archivos de la misma corrida no lanza.
  await expect(cerrarEsquemaBoletaTardia()).resolves.toBeUndefined();
});
