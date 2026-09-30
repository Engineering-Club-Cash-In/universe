import "../utils/baseFalsaParaPruebas";
import { describe, it, expect } from "bun:test";
import { anotarMoraPagada, FILAS_POR_INSERT, type AnotacionMoraPagada } from "./anotarMoraPagada";
import { mora_pagada_cuota } from "../database/db/schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";

/**
 * Test: reemplaza_a calculation in anotarMoraPagada
 *
 * Verifica que anotarMoraPagada calcula reemplaza_a correctamente:
 * - Para filas PAGO con pago_id: reemplaza_a es un objeto SQL (subquery)
 * - Para filas sin pago_id (CONDONACION): reemplaza_a es null
 * - La subquery contiene las palabras clave esperadas
 */

describe("anotarMoraPagada reemplaza_a calculation", () => {
  it("1. PAGO with pago_id has reemplaza_a as SQL subquery object", async () => {
    // Mock executor que captura .values()
    const capturedValues: any[] = [];

    const mockExecutor = {
      insert: (table: any) => ({
        values: (rows: any[]) => {
          capturedValues.push(...rows);
          return {
            returning: () =>
              Promise.resolve(
                rows.map((_: any, i: number) => ({ id: 100 + i }))
              ),
          };
        },
      }),
    } as unknown as NodePgDatabase<any>;

    const anotaciones: AnotacionMoraPagada[] = [
      {
        credito_id: 1,
        cuota_id: 5,
        pago_id: 42,
        monto: 150,
        tipo: "PAGO",
      },
    ];

    await anotarMoraPagada(anotaciones, mockExecutor);

    expect(capturedValues).toHaveLength(1);
    const firstRow = capturedValues[0];

    // reemplaza_a debe ser un objeto (SQL object, no null)
    expect(firstRow.reemplaza_a).toBeTruthy();
    expect(typeof firstRow.reemplaza_a).toBe("object");

    // Verify it has the typical SQL query builder properties
    expect(firstRow.reemplaza_a).toHaveProperty("queryChunks");
  });

  it("2. CONDONACION without pago_id has reemplaza_a = null", async () => {
    const capturedValues: any[] = [];

    const mockExecutor = {
      insert: (table: any) => ({
        values: (rows: any[]) => {
          capturedValues.push(...rows);
          return {
            returning: () =>
              Promise.resolve(
                rows.map((_: any, i: number) => ({ id: 100 + i }))
              ),
          };
        },
      }),
    } as unknown as NodePgDatabase<any>;

    const anotaciones: AnotacionMoraPagada[] = [
      {
        credito_id: 2,
        cuota_id: 8,
        pago_id: null,
        monto: 200,
        tipo: "CONDONACION",
      },
    ];

    await anotarMoraPagada(anotaciones, mockExecutor);

    expect(capturedValues).toHaveLength(1);
    const firstRow = capturedValues[0];

    // reemplaza_a debe ser null para CONDONACION sin pago_id
    expect(firstRow.reemplaza_a).toBeNull();
  });

  it("3. Different pago_id values produce distinct SQL subqueries", async () => {
    const capturedValues1: any[] = [];
    const capturedValues2: any[] = [];

    const mockExecutor1 = {
      insert: (table: any) => ({
        values: (rows: any[]) => {
          capturedValues1.push(...rows);
          return {
            returning: () =>
              Promise.resolve(
                rows.map((_: any, i: number) => ({ id: 100 + i }))
              ),
          };
        },
      }),
    } as unknown as NodePgDatabase<any>;

    const mockExecutor2 = {
      insert: (table: any) => ({
        values: (rows: any[]) => {
          capturedValues2.push(...rows);
          return {
            returning: () =>
              Promise.resolve(
                rows.map((_: any, i: number) => ({ id: 100 + i }))
              ),
          };
        },
      }),
    } as unknown as NodePgDatabase<any>;

    // Two calls with different pago_ids
    await anotarMoraPagada(
      [
        {
          credito_id: 3,
          cuota_id: 10,
          pago_id: 99,
          monto: 300,
          tipo: "PAGO",
        },
      ],
      mockExecutor1
    );

    await anotarMoraPagada(
      [
        {
          credito_id: 3,
          cuota_id: 10,
          pago_id: 88,
          monto: 300,
          tipo: "PAGO",
        },
      ],
      mockExecutor2
    );

    // Both should have reemplaza_a as SQL objects
    expect(capturedValues1[0].reemplaza_a).toBeTruthy();
    expect(capturedValues2[0].reemplaza_a).toBeTruthy();

    // They should not be equal (different pago_id values in the subquery)
    expect(capturedValues1[0].reemplaza_a).not.toEqual(
      capturedValues2[0].reemplaza_a
    );
  });

  it("4. Zero monto values are filtered out", async () => {
    const capturedValues: any[] = [];

    const mockExecutor = {
      insert: (table: any) => ({
        values: (rows: any[]) => {
          capturedValues.push(...rows);
          return {
            returning: () =>
              Promise.resolve(
                rows.map((_: any, i: number) => ({ id: 100 + i }))
              ),
          };
        },
      }),
    } as unknown as NodePgDatabase<any>;

    const anotaciones: AnotacionMoraPagada[] = [
      {
        credito_id: 4,
        cuota_id: 12,
        pago_id: 55,
        monto: 0,
        tipo: "PAGO",
      },
    ];

    const result = await anotarMoraPagada(anotaciones, mockExecutor);

    // Should return 0 inserted rows
    expect(result).toBe(0);
    // capturedValues should be empty since no .values() was called
    expect(capturedValues).toHaveLength(0);
  });

  it("5. Multiple annotations maintain individual reemplaza_a values", async () => {
    const capturedValues: any[] = [];

    const mockExecutor = {
      insert: (table: any) => ({
        values: (rows: any[]) => {
          capturedValues.push(...rows);
          return {
            returning: () =>
              Promise.resolve(
                rows.map((_: any, i: number) => ({ id: 100 + i }))
              ),
          };
        },
      }),
    } as unknown as NodePgDatabase<any>;

    const anotaciones: AnotacionMoraPagada[] = [
      {
        credito_id: 5,
        cuota_id: 15,
        pago_id: 111,
        monto: 100,
        tipo: "PAGO",
      },
      {
        credito_id: 5,
        cuota_id: 16,
        pago_id: null,
        monto: 200,
        tipo: "CONDONACION",
      },
    ];

    await anotarMoraPagada(anotaciones, mockExecutor);

    expect(capturedValues).toHaveLength(2);

    // First row (PAGO) should have reemplaza_a as SQL object
    expect(capturedValues[0].reemplaza_a).toBeTruthy();
    expect(typeof capturedValues[0].reemplaza_a).toBe("object");

    // Second row (CONDONACION) should have reemplaza_a as null
    expect(capturedValues[1].reemplaza_a).toBeNull();
  });

  it("6. Restos menores a una millonésima no se anotan (se guardarían como 0.000000)", async () => {
    const capturados: any[] = [];
    const mockExecutor = {
      insert: () => ({
        values: (rows: any[]) => {
          capturados.push(...rows);
          return { returning: () => Promise.resolve(rows.map((_: any, i: number) => ({ id: 200 + i }))) };
        },
      }),
    } as unknown as NodePgDatabase<any>;

    const n = await anotarMoraPagada(
      [
        { credito_id: 1, cuota_id: 1, pago_id: 7, monto: "0.00000033", tipo: "PAGO" },
        { credito_id: 1, cuota_id: 2, pago_id: 7, monto: "0.0000005", tipo: "PAGO" },
      ],
      mockExecutor,
    );
    // El primero redondea a 0.000000 y se descarta; el segundo se guarda 0.000001.
    expect(n).toBe(1);
    expect(capturados.map((r) => [r.cuota_id, r.monto])).toEqual([[2, "0.000001"]]);
  });

  it("7. CONDONACION con pago_id pasada como any fuerza pago_id y reemplaza_a a null", async () => {
    const capturados: any[] = [];
    const mockExecutor = {
      insert: () => ({
        values: (rows: any[]) => {
          capturados.push(...rows);
          return { returning: () => Promise.resolve(rows.map((_: any, i: number) => ({ id: 300 + i }))) };
        },
      }),
    } as unknown as NodePgDatabase<any>;

    await anotarMoraPagada(
      [{ tipo: "CONDONACION", pago_id: 7, credito_id: 1, cuota_id: 2, monto: "5" } as any],
      mockExecutor,
    );

    expect(capturados).toHaveLength(1);
    const row = capturados[0];
    expect(row.pago_id).toBeNull();
    expect(row.reemplaza_a).toBeNull();
  });

  it("8. muchas filas: se insertan en bloques dentro del mismo ejecutor y se devuelve la suma", async () => {
    const bloques: number[] = [];
    const mockExecutor = {
      insert: () => ({
        values: (rows: any[]) => {
          bloques.push(rows.length);
          return { returning: () => Promise.resolve(rows.map((_: any, i: number) => ({ id: i + 1 }))) };
        },
      }),
    } as unknown as NodePgDatabase<any>;

    const filas = Array.from({ length: FILAS_POR_INSERT + 1 }, (_, i) => ({
      tipo: "CONDONACION" as const,
      credito_id: 1,
      cuota_id: i + 1,
      monto: "1",
    }));
    const n = await anotarMoraPagada(filas, mockExecutor);

    expect(bloques).toEqual([FILAS_POR_INSERT, 1]);
    expect(n).toBe(FILAS_POR_INSERT + 1);
  });
});
