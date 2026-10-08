import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Fija sobre el fuente (el doble de `db` de los demás tests nunca ejecuta SQL)
// que el orden `bucket_motor` y el monto vencido usan los mismos criterios que
// los campos que la respuesta muestra. Review Codex PR #1901.
const fuente = readFileSync(join(import.meta.dir, "credits.ts"), "utf8");

describe("orden bucket_motor y monto_vencido — criterios alineados con la respuesta", () => {
  const orden = fuente.slice(
    fuente.indexOf("const ordenBucketSql"),
    fuente.indexOf("const ordenDefault"),
  );

  it("ordena por el bucket canónico y no por la expresión del filtro", () => {
    expect(orden).toContain('bucketActualSql("creditos", "moras_credito")');
    expect(orden).not.toContain("bucketMotorSql");
  });

  it("el atraso del orden usa la elegibilidad de la mora (pago aplicado y estados excluidos)", () => {
    expect(orden).toContain("NOT ${hasPaidPaymentSql()}");
    expect(orden).toContain("STATUS_EXCLUIDOS_MORA");
  });

  it("si el orden por bucket falla, el listado reintenta con el orden por defecto", () => {
    expect(fuente).toContain(".orderBy(...ordenDefault)");
  });

  it("monto_vencido excluye las cuotas reestructuradas por el convenio activo", () => {
    const monto = fuente.slice(
      fuente.indexOf("export async function montoVencidoPorCredito"),
      fuente.indexOf("export const ORDEN_LISTADO_CREDITOS"),
    );
    expect(monto).toContain("cuotasReestructuradas.has(f.cuota_id)");
    expect(monto).toContain("anulado_at");
    expect(monto).toContain("vencidoDeConvenio");
  });

  it("el bucket del historial que devuelve la respuesta también respeta el piso por estado", () => {
    const mapper = fuente.slice(
      fuente.indexOf("const bucketHistorial = ultimoBucketMap.get(creditoId)"),
      fuente.indexOf("const bucket =\n          numeroBucket"),
    );
    expect(mapper).toContain("Math.max(");
    expect(mapper).toContain("pisoPorEstado(row.creditos.statusCredit, catalogoBuckets)");
  });
});
