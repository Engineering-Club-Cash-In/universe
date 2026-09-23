/**
 * ANULAR UNA BOLETA ES REINTENTABLE: el reintento no duplica los espejos de
 * inversionistas.
 *
 * `pagos_credito_inversionistas_espejo` NO tiene restricción de unicidad por
 * pago e inversionista —verificado contra el esquema de producción: solo la PK
 * por `id`, el índice de liquidación y los dos parciales de "no liquidado"; la
 * unicidad `uk_pago_inversionista` es de la tabla VIEJA,
 * `pagos_credito_inversionistas`—, y de hecho ya hay pares (pago,
 * inversionista) repetidos legítimos en la base: el espejo se regenera por
 * período. Así que NO se puede protegerse con un "si ya existe, saltear": lo
 * único que sirve es que el reintento no vuelva a pasar por ahí.
 *
 * Con los espejos PRIMERO, una anulación fallida —la restitución de mora tira a
 * propósito para abortar su transacción— dejaba las filas escritas y el
 * reintento las escribía otra vez.
 *
 * Y juntar todo en una sola transacción no es una opción: el guard de
 * devolución pendiente abre su PROPIA conexión y toma `FOR NO KEY UPDATE` sobre
 * la fila del crédito, contra la que la anulación pide `FOR UPDATE`. Ver el
 * bloque de `falsePayment`.
 */
import { describe, expect, it } from "bun:test";

const FUENTE = await Bun.file(
  new URL("./payments.ts", import.meta.url).pathname,
).text();

const cuerpoDeFalsePayment = (() => {
  const inicio = FUENTE.indexOf("export async function falsePayment(");
  expect(inicio).toBeGreaterThan(-1);
  const fin = FUENTE.indexOf("\nexport async function", inicio + 1);
  return FUENTE.slice(inicio, fin === -1 ? undefined : fin);
})();

describe("falsePayment: el reintento no duplica espejos", () => {
  it("la anulación va ANTES de escribir los espejos", () => {
    const anulacion = cuerpoDeFalsePayment.indexOf(
      "anularPagoYRestituirMora(",
    );
    const espejos = cuerpoDeFalsePayment.indexOf(
      "insertPagosCreditoInversionistas(",
    );

    expect(anulacion).toBeGreaterThan(-1);
    expect(espejos).toBeGreaterThan(-1);
    // Si esto se invierte otra vez, una anulación fallida vuelve a dejar los
    // espejos escritos y el reintento los duplica.
    expect(anulacion).toBeLessThan(espejos);
  });

  it("los espejos siguen corriendo bajo el guard de devolución pendiente", () => {
    // Invertir el orden no puede haberse llevado por delante el guard: un
    // crédito en PENDIENTE_AUTORIZACION no debe generar espejos ni falsos.
    const guard = cuerpoDeFalsePayment.indexOf(
      "withPendingReturnCreditLocks(",
    );
    const espejos = cuerpoDeFalsePayment.indexOf(
      "insertPagosCreditoInversionistas(",
    );

    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(espejos);
  });

  it("la anulación NO quedó adentro del guard (sería un bloqueo contra sí misma)", () => {
    // El guard toma `FOR NO KEY UPDATE` sobre la fila del crédito desde OTRA
    // conexión; la anulación pide `FOR UPDATE` sobre la misma fila desde la
    // suya. Adentro del callback, la segunda espera un candado que solo se
    // suelta cuando el callback termina.
    const guard = cuerpoDeFalsePayment.indexOf("withPendingReturnCreditLocks(");
    const anulacion = cuerpoDeFalsePayment.indexOf("anularPagoYRestituirMora(");

    expect(anulacion).toBeLessThan(guard);
  });
});

describe("la anulación repetida es inofensiva (lo que hace seguro al reintento)", () => {
  it("sobre un pago YA falso no restituye mora ni re-marca su decremento", async () => {
    const texto = await Bun.file(
      new URL("./anularPagoMora.ts", import.meta.url).pathname,
    ).text();

    // `paymentFalse` se lee ANTES del UPDATE y es lo que corta las dos
    // escrituras: la regla de restitución devuelve `null` y la marca del
    // decremento queda condicionada al mismo dato.
    expect(texto).toContain("paymentFalse: pagos_credito.paymentFalse");
    expect(texto).toContain("!pagoPrevio?.paymentFalse");
  });
});
