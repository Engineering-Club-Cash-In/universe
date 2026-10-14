import { afterAll, expect } from "bun:test";
import { cerrarEsquemaBoletaTardia, integrationTest, levantarEsquemaBoletaTardia, uuidIntento } from "./boletaTardiaTestDb";
process.env.URL_PUBLIC_R2 = "https://pub-test.r2.dev/payments-receipts/";

afterAll(cerrarEsquemaBoletaTardia);
const BASE = process.env.URL_PUBLIC_R2;
const llave = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}.jpg`;

/** Pago con boleta: `intento` null = pago normal; `falso` = reversado. Devuelve el pago_id. */
const pago = async (sql: any, credito: number, intento: string | null, urls: string[], falso = false) => {
  const [{ pago_id }] = await sql`INSERT INTO cartera.pagos_credito (credito_id, boleta_tardia_intento_id, "paymentFalse") VALUES (${credito}, ${intento}, ${falso}) RETURNING pago_id`;
  for (const url_boleta of urls) await sql`INSERT INTO cartera.boletas (pago_id, url_boleta) VALUES (${pago_id}, ${url_boleta})`;
  return pago_id as number;
};

integrationTest("llavesYaUsadas contra la base real: otro pago vivo cuenta; el mismo intento del mismo crédito no", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  const { depsFotoReales } = await import("./boletaTardiaFoto");
  const usadas = depsFotoReales().llavesYaUsadas;
  const I = uuidIntento(501);

  await pago(sql, 1, I, [`${BASE}${llave(1)}`]);                 // mismo crédito, mismo intento (doble clic)
  expect(await usadas(1, I, [llave(1)])).toEqual([]);

  await pago(sql, 2, null, [`${BASE}${llave(2)}`]);              // pago normal de otro crédito
  expect(await usadas(1, I, [llave(2)])).toEqual([llave(2)]);

  await pago(sql, 1, null, [`${BASE}${llave(3)}`]);              // mismo crédito pero SIN intento (NULL): es otro pago
  expect(await usadas(1, I, [llave(3)])).toEqual([llave(3)]);

  await pago(sql, 3, I, [`${BASE}${llave(4)}`]);                 // mismo intento pero OTRO crédito: reuso
  expect(await usadas(1, I, [llave(4)])).toEqual([llave(4)]);

  await pago(sql, 4, null, [`${BASE}${llave(5)}`], true);        // pago reversado (paymentFalse): ya no cuenta
  expect(await usadas(1, I, [llave(5)])).toEqual([]);

  await pago(sql, 5, null, [llave(6)]);                          // fila vieja con la llave sola
  expect(await usadas(1, I, [llave(6)])).toEqual([llave(6)]);

  expect(await usadas(1, I, [llave(1), llave(2), llave(7)])).toEqual([llave(2)]); // mezcla: solo las reusadas
});
