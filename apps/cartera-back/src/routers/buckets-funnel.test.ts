import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Se lee el código fuente en vez de importar `routers/buckets`: importarlo
// arrastra la base de datos y deja módulos reales en caché, lo que rompe a los
// tests de otros archivos que los reemplazan con mock.module.
const buckets = readFileSync(new URL("./buckets.ts", import.meta.url), "utf8");
const schema = readFileSync(new URL("../database/db/schema.ts", import.meta.url), "utf8");

function estadosDelFunnel(): string[] {
  const bloque = buckets.match(/export const STATUS_FUNNEL: StatusCredit\[\] = \[([\s\S]*?)\];/);
  expect(bloque).not.toBeNull();
  const sinComentarios = (bloque?.[1] ?? "").replace(/\/\/.*$/gm, "");
  return [...sinComentarios.matchAll(/StatusCredit\.(\w+)/g)].map((m) => m[1] as string);
}

// Un crédito escalado a Jurídico (EN_JURIDICO) tiene que seguir en el funnel; si
// no, desaparece de la tabla por bucket, igual que lo hacía EN_RECUPERACION
// antes de la Fase 4.
describe("funnel operativo de cartera", () => {
  test("EN_JURIDICO existe en el enum TS con su valor de columna", () => {
    expect(schema).toContain('EN_JURIDICO = "EN_JURIDICO"');
  });

  test("EN_JURIDICO entra al funnel, junto a EN_RECUPERACION", () => {
    const funnel = estadosDelFunnel();
    expect(funnel).toContain("EN_JURIDICO");
    expect(funnel).toContain("EN_RECUPERACION");
  });

  test("los estados fuera del funnel siguen fuera", () => {
    const funnel = estadosDelFunnel();
    for (const estado of ["CANCELADO", "PENDIENTE_CANCELACION", "CAIDO"]) {
      expect(funnel).not.toContain(estado);
    }
  });
});
