import { describe, expect, it } from "bun:test";

// Test de integración: ejercita el filtro excluir_pagados_mes de
// getCreditosWithUserByMesAnio contra la base configurada en SUPABASE_DB_URL
// (clon DEV/local). Solo lecturas. Si no hay DB configurada, se salta.
const hasDb = !!process.env.SUPABASE_DB_URL;

if (!hasDb) {
  describe("excluir_pagados_mes (integración)", () => {
    it.skip("requiere SUPABASE_DB_URL apuntando al clon DEV/local", () => {});
  });
} else {
  const { sql } = await import("drizzle-orm");
  const { db } = await import("../database/index");
  const { getCreditosWithUserByMesAnio } = await import("./credits");

  const hoyGuatemala = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Guatemala" })
  );
  const hoyStr = hoyGuatemala.toISOString().slice(0, 10);

  const toRows = (r: any) => (Array.isArray(r) ? r : (r.rows ?? []));

  // Mismo criterio que la implementación, expresado en SQL independiente.
  const cuotaActualPagadaSql = (alias: string) => sql.raw(`
    COALESCE((
      SELECT bool_and(COALESCE(cc.pagado, false))
      FROM cartera.cuotas_credito cc
      WHERE cc.credito_id = ${alias}.credito_id AND cc.numero_cuota > 0
        AND cc.fecha_vencimiento = (
          SELECT MIN(cc2.fecha_vencimiento) FROM cartera.cuotas_credito cc2
          WHERE cc2.credito_id = ${alias}.credito_id AND cc2.numero_cuota > 0
            AND cc2.fecha_vencimiento >= '${hoyStr}'::date)
    ), false)`);

  const moraActivaSql = (alias: string) =>
    sql.raw(`EXISTS (SELECT 1 FROM cartera.moras_credito m
      WHERE m.credito_id = ${alias}.credito_id AND m.activa = true)`);

  async function buscarEscenario(pagada: boolean, conMora: boolean) {
    const rows = toRows(
      await db.execute(sql`
        SELECT c.numero_credito_sifco
        FROM cartera.creditos c
        JOIN cartera.usuarios u ON u.usuario_id = c.usuario_id
        JOIN cartera.asesores a ON a.asesor_id = c.asesor_id
        WHERE c."statusCredit" IN ('ACTIVO','MOROSO','EN_CONVENIO')
          AND ${cuotaActualPagadaSql("c")} = ${pagada}
          AND ${moraActivaSql("c")} = ${conMora}
        LIMIT 1
      `)
    );
    return rows[0]?.numero_credito_sifco as string | undefined;
  }

  async function totalPorSifco(sifco: string, excluir?: boolean) {
    const res = await getCreditosWithUserByMesAnio(
      0, hoyGuatemala.getFullYear(), 1, 5, sifco, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, excluir
    );
    return res.totalCount;
  }

  describe(`excluir_pagados_mes (integración, hoy=${hoyStr})`, () => {
    it("el totalCount con flag cuadra con un cross-check SQL independiente", async () => {
      const off = await getCreditosWithUserByMesAnio(
        0, hoyGuatemala.getFullYear(), 1, 1, undefined, "ACTIVO",
        undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined
      );
      const on = await getCreditosWithUserByMesAnio(
        0, hoyGuatemala.getFullYear(), 1, 1, undefined, "ACTIVO",
        undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, true
      );
      const [check] = toRows(
        await db.execute(sql`
          SELECT count(*) AS excluibles
          FROM cartera.creditos c
          JOIN cartera.usuarios u ON u.usuario_id = c.usuario_id
          JOIN cartera.asesores a ON a.asesor_id = c.asesor_id
          WHERE c."statusCredit" IN ('ACTIVO','MOROSO','EN_CONVENIO')
            AND ${cuotaActualPagadaSql("c")} = true
            AND NOT ${moraActivaSql("c")}
        `)
      );
      expect(off.totalCount - on.totalCount).toBe(Number(check.excluibles));
      expect(on.totalCount).toBeLessThanOrEqual(off.totalCount);
    });

    it("crédito que YA pagó su cuota actual y sin mora → se excluye con el flag", async () => {
      const sifco = await buscarEscenario(true, false);
      if (!sifco) return console.warn("(sin escenario en la DB, se omite)");
      expect(await totalPorSifco(sifco, undefined)).toBe(1); // sin flag sigue saliendo
      expect(await totalPorSifco(sifco, true)).toBe(0); // con flag desaparece
    });

    it("moroso que pagó su cuota actual pero con mora activa → NO se excluye", async () => {
      const sifco = await buscarEscenario(true, true);
      if (!sifco) return console.warn("(sin escenario en la DB, se omite)");
      expect(await totalPorSifco(sifco, true)).toBe(1);
    });

    it("crédito que NO ha pagado su cuota actual → NO se excluye", async () => {
      const sifco = await buscarEscenario(false, false);
      if (!sifco) return console.warn("(sin escenario en la DB, se omite)");
      expect(await totalPorSifco(sifco, true)).toBe(1);
    });
  });
}
