import "../utils/baseFalsaParaPruebas";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import Big from "big.js";
import { anotarMoraPagoNormal } from "./registerPayment";
import { moraPendientePorCuota } from "../utils/moraPendiente";

/**
 * El pago normal es LA promesa del ledger: si cobra mora y no la anota, el cron
 * se la vuelve a cobrar entera mañana. Estas pruebas ejecutan la función real
 * que usan las tres ramas de `insertPayment`, con el cargador de cuotas y la
 * escritura inyectados, y fijan con una guarda que las tres ramas la llaman.
 */

const TX = { soyLaTransaccion: true };
const HOY = new Date("2026-09-29T12:00:00Z");
const CAPITAL = "10000";
// La más vieja primero, como la devuelve el cargador del cron.
const CUOTAS = [
  { cuota_id: 11, diasAtraso: 40, pagado: "0" },
  { cuota_id: 12, diasAtraso: 10, pagado: "0" },
];
const PENDIENTE = moraPendientePorCuota({ capital: CAPITAL, cuotas: CUOTAS });

function montaje() {
  const cargas: unknown[][] = [];
  const opciones: unknown[] = [];
  const anotaciones: { filas: any[]; ejecutor: unknown }[] = [];
  return {
    cargas,
    opciones,
    anotaciones,
    cargarCuotas: (async (ids: number[], ejecutor: unknown, hoy: Date, opts?: unknown) => {
      cargas.push([ids, ejecutor, hoy]);
      opciones.push(opts);
      return new Map([[7, { capital: CAPITAL, cuotas: CUOTAS }]]);
    }) as any,
    deps: {
      anotarMoraPagada: async (filas: any[], ejecutor: unknown) => {
        anotaciones.push({ filas, ejecutor });
        return filas.length;
      },
    } as any,
  };
}

describe("anotarMoraPagoNormal", () => {
  test("anota lo cobrado de mora, cuota más vieja primero, con el pago y la tx", async () => {
    const m = montaje();
    const primera = new Big(PENDIENTE.porCuota.find((c) => c.cuota_id === 11)!.pendiente);
    const mora = primera.plus(5);
    await anotarMoraPagoNormal({ credito_id: 7, mora, pago_id: 900, tx: TX, deps: m.deps, hoy: HOY, cargarCuotas: m.cargarCuotas });

    expect(m.anotaciones).toHaveLength(1);
    expect(m.anotaciones[0].ejecutor).toBe(TX);
    const filas = m.anotaciones[0].filas;
    expect(filas.map((f) => f.cuota_id)).toEqual([11, 12]);
    expect(new Big(filas[0].monto).eq(primera)).toBe(true);
    expect(new Big(filas[1].monto).eq(5)).toBe(true);
    for (const f of filas) {
      expect(f.pago_id).toBe(900);
      expect(f.tipo).toBe("PAGO");
      expect(f.credito_id).toBe(7);
    }
  });

  test("lee las cuotas por la MISMA transacción y con la fecha que recibe", async () => {
    const m = montaje();
    await anotarMoraPagoNormal({ credito_id: 7, mora: new Big(1), pago_id: 1, tx: TX, deps: m.deps, hoy: HOY, cargarCuotas: m.cargarCuotas });
    expect(m.cargas).toEqual([[[7], TX, HOY]]);
  });

  // Su propia fila ya existe cuando se anota: si contara como cobertura, la
  // cuota saldría del reparto y la mora cobrada no quedaría anotada en ella.
  test("el cargador NO cuenta este mismo pago como cobertura de su cuota", async () => {
    const m = montaje();
    await anotarMoraPagoNormal({ credito_id: 7, mora: new Big(1), pago_id: 900, tx: TX, deps: m.deps, hoy: HOY, cargarCuotas: m.cargarCuotas });
    expect(m.opciones).toEqual([{ excluirPagoId: 900 }]);
  });

  test("lo cobrado por encima del pendiente no se anota", async () => {
    const m = montaje();
    await anotarMoraPagoNormal({ credito_id: 7, mora: new Big(PENDIENTE.total).plus(1000), pago_id: 1, tx: TX, deps: m.deps, hoy: HOY, cargarCuotas: m.cargarCuotas });
    const suma = m.anotaciones[0].filas.reduce((a, f) => a.plus(f.monto), new Big(0));
    expect(suma.eq(PENDIENTE.total)).toBe(true);
  });

  test("sin mora cobrada no lee ni escribe", async () => {
    const m = montaje();
    await anotarMoraPagoNormal({ credito_id: 7, mora: new Big(0), pago_id: 1, tx: TX, deps: m.deps, hoy: HOY, cargarCuotas: m.cargarCuotas });
    expect(m.cargas).toHaveLength(0);
    expect(m.anotaciones).toHaveLength(0);
  });

  test("si la anotación falla, el error sube (la tx del pago se revierte)", async () => {
    const m = montaje();
    m.deps.anotarMoraPagada = async () => {
      throw new Error("uq violada");
    };
    await expect(
      anotarMoraPagoNormal({ credito_id: 7, mora: new Big(1), pago_id: 1, tx: TX, deps: m.deps, hoy: HOY, cargarCuotas: m.cargarCuotas }),
    ).rejects.toThrow("uq violada");
  });

  test("si anotarMoraPagada lanza un error con code: 23505, ese mismo objeto sube sin envolver", async () => {
    const m = montaje();
    const err = new Error("unique constraint violation") as any;
    err.code = "23505";
    m.deps.anotarMoraPagada = async () => {
      throw err;
    };
    try {
      await anotarMoraPagoNormal({ credito_id: 7, mora: new Big(1), pago_id: 1, tx: TX, deps: m.deps, hoy: HOY, cargarCuotas: m.cargarCuotas });
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBe(err);
    }
  });
});

describe("guarda: las tres ramas de insertPayment anotan dentro de su transacción", () => {
  const fuente = readFileSync(new URL("./registerPayment.ts", import.meta.url), "utf8");
  const inicio = fuente.indexOf("export const insertPayment");
  const cuerpo = fuente.slice(inicio, fuente.indexOf("\nexport ", inicio + 1));

  test("las cuatro ramas anotan lo COBRADO, una sola vez por boleta", () => {
    // Lo cobrado sale de procesarPagoMora, no de `moraBig` (que puede valer la
    // mora entera del crédito aunque la boleta no la haya alcanzado).
    expect(cuerpo).toContain("const moraCobradaEnBoleta = new Big(resultadoMora.montoAplicadoMora ?? 0);");
    const bloques = cuerpo.match(/if \([^\n]*!moraYaAnotada[^\n]*\) \{\s*await anotarMoraPagoNormal\(\{[\s\S]*?\}\);\s*moraYaAnotada = true;/g) ?? [];
    expect(bloques).toHaveLength(4);
    for (const b of bloques) {
      expect(b).toContain("mora: moraCobradaEnBoleta");
      expect(b).toMatch(/\btx,/);
      expect(b).toContain("moraCobradaEnBoleta.gt(0)");
    }
    // Ninguna llamada queda fuera de esos bloques.
    expect((cuerpo.match(/anotarMoraPagoNormal\(\{/g) ?? []).length).toBe(4);
    // El pago especial de mora ya anota vía insertarPago: marca la boleta.
    const i = cuerpo.indexOf("if (resultadoMora.pagoCompleto && resultadoMora.moraPagada) {");
    expect(cuerpo.slice(i, cuerpo.indexOf("if (!resultadoMora.moraPagada && resultadoMora.pagoParcial)", i))).toContain("moraYaAnotada = true;");
  });

  test("la fecha es la de Guatemala, no la UTC", () => {
    expect(cuerpo).toMatch(/const hoyParaAnotacion = hoyGuatemala\(\);/);
  });
});

describe("guarda: insertarPago dentro de insertPayment respeta deps y la marca de la boleta", () => {
  const fuente = readFileSync(new URL("./registerPayment.ts", import.meta.url), "utf8");
  const cuerpo = fuente.slice(fuente.indexOf("export const insertPayment"), fuente.indexOf("export async function insertarPago"));
  test("toda llamada a insertarPago pasa las dependencias inyectadas", () => {
    const llamadas = cuerpo.match(/await insertarPago\(\{[\s\S]*?\}\);/g) ?? [];
    expect(llamadas.length).toBe(5);
    for (const l of llamadas) expect(l).toContain("deps: safeDeps,");
  });
  test("la fila rastro solo anota si ninguna otra fila de la boleta lo hizo, y marca", () => {
    expect(cuerpo).toContain("const anotaEstaFila = !moraYaAnotada;");
    expect(cuerpo).toContain("anotarMoraEnLedger: anotaEstaFila,");
    expect(cuerpo).toContain("if (anotaEstaFila && moraCobradaEnBoleta.gt(0)) moraYaAnotada = true;");
    const insertar = fuente.slice(fuente.indexOf("export async function insertarPago"));
    expect(insertar).toContain("if (pago?.pago_id && anotarMoraEnLedger) {");
  });
});
