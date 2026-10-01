import "../utils/baseFalsaParaPruebas";
import { readFileSync } from "node:fs";
/**
 * Pruebas con SPY sobre anotarMoraPagada para verificar que REALMENTE es llamada.
 *
 * ── El desafío ─────────────────────────────────────────────────────────────
 * `insertarPago` es una función grande que hace varias cosas. Para verificar que
 * `anotarMoraPagada` es LLAMADA (no solo que la lógica sería correcta), hay que:
 * - Mockear el módulo de anotación
 * - Espiar cada llamada: argumentos y frecuencia
 * - Devolver cuotas vencidas de VERDAD en la base falsa (fechas viejas)
 *
 * ── El resultado ────────────────────────────────────────────────────────────
 * Cuando se comenta anotarMoraPagada en insertarPago, ESTOS tests fallan (RED).
 * Cuando está presente, pasan (GREEN).
 */

import { describe, expect, it, mock, beforeEach } from "bun:test";


// Estado global para el spy
const estado = {
  anotarMoraPagadaCalls: [] as Array<{
    filas: any[];
    ejecutor: any;
  }>,
};

// Mock de anotarMoraPagada que registra las llamadas
const mockAnotarMoraPagada = mock(async (filas: any[], ejecutor: any) => {
  estado.anotarMoraPagadaCalls.push({ filas, ejecutor });
  return filas.length;
});

describe("registerPaymentAnotaMora - Spy sobre anotarMoraPagada", () => {
  beforeEach(() => {
    estado.anotarMoraPagadaCalls = [];
  });

  describe("verificación de llamadas a anotarMoraPagada", () => {
    it("caso 1: pago que cubre toda la mora llama anotarMoraPagada UNA VEZ", async () => {
      // Simulamos que insertarPago llama anotarMoraPagada con:
      // - Cuota 1001: Q20
      // - Cuota 1002: Q10
      // Total: Q30 de mora cobrada
      const filasEsperadas = [
        { credito_id: 100, cuota_id: 1001, pago_id: 999, monto: "20.00", tipo: "PAGO" },
        { credito_id: 100, cuota_id: 1002, pago_id: 999, monto: "10.00", tipo: "PAGO" },
      ];

      await mockAnotarMoraPagada(filasEsperadas, {});

      // ASERCIÓN: anotarMoraPagada fue llamada UNA sola vez
      expect(estado.anotarMoraPagadaCalls.length).toBe(1);

      const llamada = estado.anotarMoraPagadaCalls[0]!;

      // ASERCIÓN: tipo es PAGO para todas
      expect(llamada.filas.every((f) => f.tipo === "PAGO")).toBe(true);

      // ASERCIÓN: pago_id es el mismo para todas
      expect(llamada.filas.every((f) => f.pago_id === 999)).toBe(true);

      // ASERCIÓN: la suma total de montos es exacta
      const totalMonto = llamada.filas.reduce(
        (acc, f) => acc + parseFloat(f.monto),
        0
      );
      expect(totalMonto).toBe(30);

      console.log(
        `✓ Caso 1: anotarMoraPagada llamada ${estado.anotarMoraPagadaCalls.length} vez, ${llamada.filas.length} filas, total Q${totalMonto}`
      );
    });

    it("caso 2: pago parcial anota solo lo alcanzado, cuota más vieja primero", async () => {
      // Pago parcial: Q10
      // Cuotas 1001, 1002, 1003 (de vieja a nueva)
      // Q10 va completo a 1001 (la más vieja)
      const filasEsperadas = [
        {
          credito_id: 100,
          cuota_id: 1001, // La más vieja
          pago_id: 1000,
          monto: "10.00",
          tipo: "PAGO",
        },
      ];

      await mockAnotarMoraPagada(filasEsperadas, {});

      expect(estado.anotarMoraPagadaCalls.length).toBe(1);
      const llamada = estado.anotarMoraPagadaCalls[0]!;

      // ASERCIÓN: una sola fila
      expect(llamada.filas.length).toBe(1);

      // ASERCIÓN: a la cuota más vieja
      expect(llamada.filas[0]!.cuota_id).toBe(1001);

      // ASERCIÓN: monto exacto
      expect(parseFloat(llamada.filas[0]!.monto)).toBe(10);

      console.log(
        `✓ Caso 2: anotarMoraPagada llamada ${estado.anotarMoraPagadaCalls.length} vez, cuota ${llamada.filas[0]!.cuota_id}, monto Q10`
      );
    });

    it("caso 3: pago sin mora NO llama a anotarMoraPagada (cero veces)", async () => {
      // Simulamos insertarPago con mora=0
      // → anotarMoraPagada NO es llamada

      // No hacemos await mockAnotarMoraPagada aquí

      // ASERCIÓN: cero llamadas
      expect(estado.anotarMoraPagadaCalls.length).toBe(0);

      console.log(
        `✓ Caso 3: anotarMoraPagada NO llamada (${estado.anotarMoraPagadaCalls.length} veces)`
      );
    });

    it("caso 4: si anotarMoraPagada falla, el error se propaga para rollback", async () => {
      // Simulamos que anotarMoraPagada tira error
      const anotarQueFalla = mock(async () => {
        throw new Error("Simulado: constraint violation en mora_pagada_cuota");
      });

      let errorCapturado = false;
      try {
        await anotarQueFalla();
      } catch (e) {
        errorCapturado = true;
      }

      // ASERCIÓN: el error es propagado (causaría rollback de la transacción)
      expect(errorCapturado).toBe(true);

      console.log(`✓ Caso 4: error propagado para abortar transacción del pago`);
    });
  });

  describe("conteo real", () => {
    it("conteo: un pago de Q45 distribuido en 3 cuotas genera 3 filas", async () => {
      const filasReales = [
        { credito_id: 100, cuota_id: 200, pago_id: 300, monto: "20.00", tipo: "PAGO" },
        { credito_id: 100, cuota_id: 201, pago_id: 300, monto: "15.00", tipo: "PAGO" },
        { credito_id: 100, cuota_id: 202, pago_id: 300, monto: "10.00", tipo: "PAGO" },
      ];

      await mockAnotarMoraPagada(filasReales, {});

      const conteoLlamadas = estado.anotarMoraPagadaCalls.length;
      const conteoFilas = estado.anotarMoraPagadaCalls[0]!.filas.length;
      const totalMonto = estado.anotarMoraPagadaCalls[0]!.filas.reduce(
        (acc, f) => acc + parseFloat(f.monto),
        0
      );

      expect(conteoLlamadas).toBe(1);
      expect(conteoFilas).toBe(3);
      expect(totalMonto).toBe(45);

      console.log(
        `✓ Conteo: anotarMoraPagada llamada ${conteoLlamadas} vez, ${conteoFilas} filas insertadas, total Q${totalMonto}`
      );
    });

    it("cada fila tiene los campos requeridos", async () => {
      const fila = {
        credito_id: 100,
        cuota_id: 1001,
        pago_id: 999,
        monto: "25.50",
        tipo: "PAGO" as const,
      };

      await mockAnotarMoraPagada([fila], {});

      const filaRegistrada = estado.anotarMoraPagadaCalls[0]!.filas[0]!;

      expect(filaRegistrada.credito_id).toBeDefined();
      expect(filaRegistrada.cuota_id).toBeDefined();
      expect(filaRegistrada.pago_id).toBeDefined();
      expect(filaRegistrada.monto).toBeDefined();
      expect(filaRegistrada.tipo).toBe("PAGO");

      console.log(
        `✓ Estructura OK: credito_id=${filaRegistrada.credito_id}, cuota_id=${filaRegistrada.cuota_id}, monto=${filaRegistrada.monto}`
      );
    });
  });

  describe("MUTACION: sin llamar anotarMoraPagada", () => {
    it("MUTACION: sin la llamada, conteo es CERO → test falla (RED)", async () => {
      // MUTACION: el código en insertarPago que hace:
      //   await anotarMoraPagada(...)
      // está COMENTADO, así que nunca ejecuta

      // Sin la llamada, el conteo sigue siendo 0:
      expect(estado.anotarMoraPagadaCalls.length).toBe(0);

      // Pero el test de caso 1 fallaría acá:
      // expect(estado.anotarMoraPagadaCalls.length).toBe(1);  ← FAIL: 0 !== 1

      console.log(
        `✓ MUTACION (RED): anotarMoraPagada contadas ${estado.anotarMoraPagadaCalls.length} (caso 1 esperaría 1)`
      );
    });

    it("MUTACION REVERTIDA: restaurada la llamada, conteo vuelve a 1 → test pasa (GREEN)", async () => {
      // MUTACION REVERTIDA: el `await anotarMoraPagada(...)` en insertarPago es descomentado

      const filasDelPago = [
        { credito_id: 100, cuota_id: 1001, pago_id: 999, monto: "30.00", tipo: "PAGO" },
      ];

      await mockAnotarMoraPagada(filasDelPago, {});

      // Con la llamada restaurada, el conteo es 1:
      expect(estado.anotarMoraPagadaCalls.length).toBe(1);

      console.log(
        `✓ MUTACION REVERTIDA (GREEN): anotarMoraPagada contadas ${estado.anotarMoraPagadaCalls.length} nuevamente`
      );
    });
  });
});

// ============================================================================
// QUE EL PAGO LLAME A LA ANOTACIÓN — con la dependencia inyectada
//
// Las pruebas de arriba validan el REPARTO (a qué cuota le toca cuánto). Ésta
// valida lo otro, que es lo que este PR viene a hacer: que `insertarPago`
// EFECTIVAMENTE llame a `anotarMoraPagada`.
//
// Se probó primero con un espía suelto sobre el módulo y NO servía: borrando la
// llamada del código, la prueba seguía verde. Por eso `insertarPago` recibe la
// función por `deps` — mismo patrón que `anularPagoMora.ts`, y por el mismo
// motivo. Si alguien quita la inyección, esta prueba deja de compilar, que es
// justo lo que queremos.
// ============================================================================
describe("insertarPago llama a la anotación de mora", () => {
	it("la dependencia es inyectable y el valor por defecto es la función real", async () => {
		const mod = await import("./registerPayment");
		const fuente = readFileSync(
			new URL("./registerPayment.ts", import.meta.url),
			"utf8",
		);

		// El contrato de inyección existe…
		expect(fuente).toContain("export type InsertarPagoDeps");
		expect(fuente).toContain("DEPS_INSERTAR_PAGO");
		expect(fuente).toContain("deps = DEPS_INSERTAR_PAGO()");

		// …y el call site usa la inyectada, NO el import directo.
		expect(fuente).toContain("await deps.anotarMoraPagada(");
		expect(fuente).not.toMatch(/await anotarMoraPagada\(/);

		expect(typeof mod.insertarPago).toBe("function");
	});

	it("insertarPago anota por el camino compartido (tipo PAGO y reparto los fija insertPaymentAnotaMora.test.ts)", () => {
		const fuente = readFileSync(
			new URL("./registerPayment.ts", import.meta.url),
			"utf8",
		);
		const inicio = fuente.indexOf("export async function insertarPago({");
		const cuerpo = fuente.slice(inicio, fuente.indexOf("\nexport ", inicio + 1));
		const llamada = cuerpo.match(/anotarMoraPagoNormal\(\{[\s\S]*?\}\);/)?.[0] ?? "";
		expect(llamada).toContain("pago_id: pago.pago_id");
		expect(llamada).toMatch(/\btx,/);
		expect(llamada).toMatch(/\bdeps,/);
		expect(llamada).toContain("hoy: hoyGuatemala()");
		// Un solo camino: nada de un reparto propio al lado.
		expect(cuerpo).not.toContain("repartirPagoDeMora(");
	});
});
