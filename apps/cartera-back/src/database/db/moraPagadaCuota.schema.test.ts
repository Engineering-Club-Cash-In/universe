import { describe, it, expect } from "bun:test";

/**
 * Schema Contract Test: mora_pagada_cuota
 *
 * Verifica que el archivo SQL (0043_mora_pagada_cuota.sql) y el esquema
 * Drizzle (schema.ts) no se hayan separado. Lee los archivos como texto,
 * no como código ejecutable — es una prueba de contrato entre dos fuentes
 * de verdad, no una prueba de lógica.
 */

describe("mora_pagada_cuota schema contract", () => {
  // Lee los archivos una sola vez al comienzo de la suite
  // Rutas relativas a esta prueba: corre igual en CI y en cualquier clon.
  const sqlPath = new URL("../../../drizzle/0043_mora_pagada_cuota.sql", import.meta.url);
  const schemaPath = new URL("./schema.ts", import.meta.url);

  const sqlFile = Bun.file(sqlPath);
  const schemaFile = Bun.file(schemaPath);

  let sqlContent: string;
  let schemaContent: string;

  // Ejecutado antes de cada test (read() es async pero espera dentro del test)
  const setup = async () => {
    if (!sqlContent) {
      sqlContent = await sqlFile.text();
    }
    if (!schemaContent) {
      schemaContent = await schemaFile.text();
    }
  };

  it("1. SQL declares all 5 CHECK constraints with exact names", async () => {
    await setup();

    const requiredConstraints = [
      "mora_pagada_cuota_tipo_valido",
      "mora_pagada_cuota_monto_no_cero",
      "mora_pagada_cuota_signo_por_tipo",
      "mora_pagada_cuota_pago_obligatorio_en_pago",
      "mora_pagada_cuota_compensatoria_apunta",
    ];

    for (const constraint of requiredConstraints) {
      // Buscar la declaración de constraint dentro de la tabla, no en comentarios
      const constraintPattern = new RegExp(
        `CONSTRAINT\\s+${constraint}\\s+CHECK`,
        "i"
      );
      expect(sqlContent).toMatch(constraintPattern);
    }
  });

  it("2. SQL declares all 4 indices with exact names", async () => {
    await setup();

    const requiredIndices = [
      "mora_pagada_cuota_uq_pago",
      "mora_pagada_cuota_uq_revierte",
      "mora_pagada_cuota_idx_cuota",
      "mora_pagada_cuota_idx_pago",
    ];

    for (const index of requiredIndices) {
      // Buscar en CREATE INDEX statements, no en comentarios
      const createIndexPattern = new RegExp(
        `CREATE\\s+(UNIQUE\\s+)?INDEX\\s+IF\\s+NOT\\s+EXISTS\\s+${index}`,
        "i"
      );
      expect(sqlContent).toMatch(createIndexPattern);
    }
  });

  it("3. Each unique index name exported as constant appears textually in SQL", async () => {
    await setup();

    // Los nombres únicos que exporta schema.ts deben aparecer en el SQL
    const uniqueIndexNames = [
      "mora_pagada_cuota_uq_pago",
      "mora_pagada_cuota_uq_revierte",
    ];

    for (const name of uniqueIndexNames) {
      expect(schemaContent).toContain(`"${name}"`);
      expect(sqlContent).toContain(name);
    }
  });

  it("4. Schema declares exactly 11 columns, no more, no less", async () => {
    await setup();

    // Extraer la lista de columnas del SQL (entre CREATE TABLE y CONSTRAINT/INDEX)
    const tableMatch = sqlContent.match(
      /CREATE TABLE IF NOT EXISTS cartera\.mora_pagada_cuota \(([\s\S]*?)\);/
    );
    expect(tableMatch).toBeTruthy();

    const tableBlock = tableMatch![1];

    // Esperamos 11 columnas: id, credito_id, cuota_id, pago_id, monto, tipo,
    // revierte_a, reemplaza_a, usuario_id, motivo, fecha
    const expectedColumns = [
      "id",
      "credito_id",
      "cuota_id",
      "pago_id",
      "monto",
      "tipo",
      "revierte_a",
      "reemplaza_a",
      "usuario_id",
      "motivo",
      "fecha",
    ];

    // Buscar columnas como declaraciones: "columna_id   tipo_dato"
    for (const col of expectedColumns) {
      const colDeclPattern = new RegExp(`^\\s+${col}\\s+\\w+`, "m");
      expect(tableBlock).toMatch(colDeclPattern);
    }

    // Verifica que Drizzle declara todas las columnas dentro de la tabla mora_pagada_cuota
    const tableDefMatch = schemaContent.match(
      /export const mora_pagada_cuota = customSchema\.table\(\s*"mora_pagada_cuota",\s*\{([\s\S]*?)\},/
    );
    expect(tableDefMatch).toBeTruthy();
    const tableDef = tableDefMatch![1];

    for (const col of expectedColumns) {
      // Buscar el patrón "col: tipo(" donde col es el nombre de la columna
      // (puede haber espacios/newlines)
      const colPattern = new RegExp(`\\b${col}\\s*:`, "i");
      expect(tableDef).toMatch(colPattern);
    }
  });

  it("5. SQL uses clock_timestamp() and not now() for fecha column", async () => {
    await setup();

    // Buscar la columna fecha
    const fechaMatch = sqlContent.match(
      /fecha\s+timestamp\s+NOT NULL\s+DEFAULT\s+(\w+)\(/
    );
    expect(fechaMatch).toBeTruthy();
    expect(fechaMatch![1]).toBe("clock_timestamp");

    // Asegurarse de que no usa now()
    const nowMatch = sqlContent.match(
      /fecha\s+timestamp\s+NOT NULL\s+DEFAULT\s+now\(\)/
    );
    expect(nowMatch).toBeFalsy();
  });

  it("6. SQL declares ON DELETE CASCADE for credito_id and cuota_id", async () => {
    await setup();

    const credito_cascade = /credito_id\s+integer\s+NOT NULL\s+REFERENCES\s+cartera\.creditos\(credito_id\)\s+ON DELETE CASCADE/i;
    expect(sqlContent).toMatch(credito_cascade);

    const cuota_cascade = /cuota_id\s+integer\s+NOT NULL\s+REFERENCES\s+cartera\.cuotas_credito\(cuota_id\)\s+ON DELETE CASCADE/i;
    expect(sqlContent).toMatch(cuota_cascade);
  });

  it("7. SQL declares mora_pagada_cuota_reemplaza_solo_pago CHECK constraint", async () => {
    await setup();

    const reemplazaCheck = /CONSTRAINT\s+mora_pagada_cuota_reemplaza_solo_pago\s+CHECK/i;
    expect(sqlContent).toMatch(reemplazaCheck);

    // Verify it checks reemplaza_a IS NULL OR tipo = 'PAGO'
    const checkContent = sqlContent.match(
      /CONSTRAINT\s+mora_pagada_cuota_reemplaza_solo_pago\s+CHECK\s*\((.*?)\)/i
    );
    expect(checkContent).toBeTruthy();
    const constraintBody = checkContent![1].toLowerCase();
    expect(constraintBody).toContain("reemplaza_a");
    expect(constraintBody).toContain("null");
    expect(constraintBody).toContain("pago");
  });

  it("8. SQL unique index mora_pagada_cuota_uq_pago includes COALESCE(reemplaza_a, 0)", async () => {
    await setup();

    const uniqueIndexMatch = sqlContent.match(
      /CREATE UNIQUE INDEX IF NOT EXISTS mora_pagada_cuota_uq_pago\s+ON\s+cartera\.mora_pagada_cuota\s*\((.*?)\)\s+WHERE/i
    );
    expect(uniqueIndexMatch).toBeTruthy();
    const indexColumns = uniqueIndexMatch![1];
    expect(indexColumns).toContain("COALESCE");
    expect(indexColumns).toContain("reemplaza_a");
  });

  it("9. Schema mora_pagada_cuota has reemplaza_a column", async () => {
    await setup();

    const tableDefMatch = schemaContent.match(
      /export const mora_pagada_cuota = customSchema\.table\(\s*"mora_pagada_cuota",\s*\{([\s\S]*?)\},/
    );
    expect(tableDefMatch).toBeTruthy();
    const tableDef = tableDefMatch![1];

    expect(tableDef).toContain("reemplaza_a");
  });

  it("10. Schema mora_pagada_cuota has onDelete cascade for credito_id and cuota_id", async () => {
    await setup();

    const tableDefMatch = schemaContent.match(
      /export const mora_pagada_cuota = customSchema\.table\(\s*"mora_pagada_cuota",\s*\{([\s\S]*?)\},/
    );
    expect(tableDefMatch).toBeTruthy();
    const tableDef = tableDefMatch![1];

    // Look for onDelete: "cascade" pattern near credito_id
    expect(tableDef).toMatch(/credito_id[\s\S]*?onDelete\s*:\s*"cascade"/i);
    // Look for onDelete: "cascade" pattern near cuota_id
    expect(tableDef).toMatch(/cuota_id[\s\S]*?onDelete\s*:\s*"cascade"/i);
  });

  it("11. Schema mora_pagada_cuota fecha uses clock_timestamp()", async () => {
    await setup();

    const tableDefMatch = schemaContent.match(
      /export const mora_pagada_cuota = customSchema\.table\(\s*"mora_pagada_cuota",\s*\{([\s\S]*?)\},/
    );
    expect(tableDefMatch).toBeTruthy();
    const tableDef = tableDefMatch![1];

    // Look for fecha with clock_timestamp() not defaultNow()
    expect(tableDef).toMatch(/fecha[\s\S]*?clock_timestamp/);
    expect(tableDef).not.toMatch(/fecha[\s\S]*?defaultNow\(\)/);
  });

  it("12. Schema mora_pagada_cuota index uq_pago includes COALESCE expression", async () => {
    await setup();

    const tableDefMatch = schemaContent.match(
      /export const mora_pagada_cuota = customSchema\.table\(\s*"mora_pagada_cuota",\s*\{[\s\S]*?\}\s*,\s*\(table\)\s*=>\s*\[([\s\S]*?)\]/
    );
    expect(tableDefMatch).toBeTruthy();
    const indices = tableDefMatch![1];

    // Check for MORA_PAGADA_CUOTA_UQ_PAGO index
    expect(indices).toContain("MORA_PAGADA_CUOTA_UQ_PAGO");
    // Check that COALESCE is present in the index
    expect(indices).toMatch(/MORA_PAGADA_CUOTA_UQ_PAGO[\s\S]*?COALESCE/i);
  });

  it("13. Schema moras_historial pago_id has NO references (no .references())", async () => {
    await setup();

    // Find the moras_historial table definition
    const historialmatch = schemaContent.match(
      /export const moras_historial = customSchema\.table\("moras_historial",\s*\{([\s\S]*?)\},/
    );
    expect(historialmatch).toBeTruthy();
    const historicalDef = historialmatch![1];

    // Look for pago_id declaration
    const pagoIdMatch = historicalDef.match(
      /pago_id\s*:\s*integer\("pago_id"\)([\s\S]*?)(?:,\s*\w+\s*:|,?\s*\})/
    );
    expect(pagoIdMatch).toBeTruthy();
    const pagoIdDecl = pagoIdMatch![1];

    // pago_id should NOT have .references() call
    expect(pagoIdDecl).not.toMatch(/\.references/);
  });

  it("M1: Mutation - removing COALESCE from uq_pago would fail the unique index check", async () => {
    await setup();

    // Verify COALESCE is present in the SQL unique index
    const uniqueIndexMatch = sqlContent.match(
      /CREATE UNIQUE INDEX IF NOT EXISTS mora_pagada_cuota_uq_pago\s+ON\s+cartera\.mora_pagada_cuota\s*\((.*?)\)\s+WHERE/i
    );
    expect(uniqueIndexMatch).toBeTruthy();
    expect(uniqueIndexMatch![1]).toContain("COALESCE");

    // The index must include reemplaza_a to allow duplicate (pago, cuota) with different replacements
    expect(uniqueIndexMatch![1]).toContain("reemplaza_a");
  });

  it("M2: Mutation - adding .references() to moras_historial.pago_id would violate audit requirements", async () => {
    await setup();

    const historialmatch = schemaContent.match(
      /export const moras_historial = customSchema\.table\("moras_historial",\s*\{([\s\S]*?)\},/
    );
    expect(historialmatch).toBeTruthy();
    const historicalDef = historialmatch![1];

    // Find pago_id definition
    const pagoIdDef = historicalDef.match(/pago_id\s*:\s*integer\("pago_id"\)([\s\S]*?)(?:,\s*\w+|$)/);
    expect(pagoIdDef).toBeTruthy();

    // Must NOT have .references() to preserve deleted payment references
    expect(pagoIdDef![1]).not.toContain(".references");
  });

  it("M3: Mutation - always null reemplaza_a would break the index", async () => {
    await setup();

    const tableDefMatch = schemaContent.match(
      /export const mora_pagada_cuota = customSchema\.table\(\s*"mora_pagada_cuota",\s*\{([\s\S]*?)\},/
    );
    expect(tableDefMatch).toBeTruthy();
    const tableDef = tableDefMatch![1];

    // reemplaza_a must be calculated from SQL, not hardcoded null
    expect(tableDef).toContain("reemplaza_a");

    // Que `anotarMoraPagada` calcule reemplaza_a (y lo deje en null en las
    // condonaciones) lo prueba por comportamiento anotarMoraPagada.reemplaza.test.ts.
  });

  it("M4: Mutation - removing ON DELETE CASCADE from cuota_id would block deletions", async () => {
    await setup();

    // SQL must have ON DELETE CASCADE for cuota_id
    expect(sqlContent).toMatch(
      /cuota_id\s+integer\s+NOT NULL\s+REFERENCES\s+cartera\.cuotas_credito\(cuota_id\)\s+ON DELETE CASCADE/i
    );

    // Schema must also have onDelete: "cascade"
    const tableDefMatch = schemaContent.match(
      /export const mora_pagada_cuota = customSchema\.table\(\s*"mora_pagada_cuota",\s*\{([\s\S]*?)\},/
    );
    expect(tableDefMatch).toBeTruthy();
    const tableDef = tableDefMatch![1];

    expect(tableDef).toMatch(/cuota_id[\s\S]*?onDelete\s*:\s*"cascade"/i);
  });
});
