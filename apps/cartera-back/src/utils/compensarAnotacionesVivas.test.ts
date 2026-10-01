import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * La regla de compensación vive UNA vez (`compensarAnotacionesVivas`) y solo
 * toca anotaciones que nadie compensó todavía. Sin ese filtro, revertir dos
 * veces el mismo pago chocaría contra `mora_pagada_cuota_uq_revierte` en vez
 * de no hacer nada.
 */
const fuente = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
const anotar = fuente("./anotarMoraPagada.ts");
const cuerpo = (src: string, firma: string) => {
  const i = src.indexOf(firma);
  return src.slice(i, src.indexOf("\nexport ", i + 1));
};

describe("compensarAnotacionesVivas", () => {
  test("solo compensa filas sin compensación previa", () => {
    const c = cuerpo(anotar, "export async function compensarAnotacionesVivas");
    expect(c).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM \$\{mora_pagada_cuota\} AS c\s*WHERE c\.revierte_a = \$\{mora_pagada_cuota\.id\}/);
    expect(c).toContain("revierte_a: v.id");
    expect(c).toContain("montoParaLedger(new Big(v.monto).times(-1))");
  });
  test("la reversa de un pago y la ruptura de convenio usan la misma regla", () => {
    expect(cuerpo(anotar, "export async function revertirMoraPagadaDePago")).toContain("compensarAnotacionesVivas(");
    const cerrar = fuente("./cerrarMoraPagadaDeCredito.ts");
    expect(cuerpo(cerrar, "export async function cerrarMoraPagadaDeCredito")).toContain("compensarAnotacionesVivas(");
    // Nadie más inserta compensatorias por su cuenta.
    expect(cerrar).not.toContain(".insert(mora_pagada_cuota)");
  });
});

describe("compensarAnotacionesVivas — dos compensaciones solapadas", () => {
  test("omite SOLO el choque de revierte_a y devuelve lo realmente insertado", async () => {
    const { compensarAnotacionesVivas } = await import("./anotarMoraPagada");
    const { mora_pagada_cuota } = await import("../database/db/schema");
    const { sql } = await import("drizzle-orm");
    let conflicto: any = null;
    const vivas = [
      { id: 10, credito_id: 1, cuota_id: 5, monto: "20.000000" },
      { id: 11, credito_id: 1, cuota_id: 6, monto: "7.500000" },
    ];
    const ejecutor: any = {
      select: () => ({ from: () => ({ where: async () => vivas }) }),
      insert: () => ({
        values: (filas: any[]) => ({
          onConflictDoNothing: (c: any) => {
            conflicto = c;
            // La otra llamada ya compensó la fila 10: la base devuelve solo una.
            return { returning: async () => [{ id: 99 }] };
          },
        }),
      }),
    };
    const n = await compensarAnotacionesVivas(sql`true`, { tipo: "REVERSA" }, ejecutor);
    expect(n).toBe(1);
    expect(conflicto?.target).toBe(mora_pagada_cuota.revierte_a);
    expect(conflicto?.where).toBeTruthy();
  });
});
