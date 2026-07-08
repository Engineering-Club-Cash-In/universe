import { describe, expect, it } from "bun:test";

// Integración: getMoraCobradaPorAsesor (mora cobrada por asesor en el período de
// cierre de un mes) contra SUPABASE_DB_URL. Solo lecturas. Se salta si no hay DB.
const hasDb = !!process.env.SUPABASE_DB_URL;

if (!hasDb) {
  describe("getMoraCobradaPorAsesor (integración)", () => {
    it.skip("requiere SUPABASE_DB_URL", () => {});
  });
} else {
  const { getMoraCobradaPorAsesor } = await import("./reportes");
  const { db } = await import("../database/index");
  const { sql } = await import("drizzle-orm");

  describe("getMoraCobradaPorAsesor", () => {
    it("período = [día 6 del mes, día 6 del mes siguiente)", async () => {
      const r = await getMoraCobradaPorAsesor({ mes: 6, anio: 2026 });
      expect(r.periodo.inicio).toBe("2026-06-06");
      expect(r.periodo.fin).toBe("2026-07-06");
    }, 20000);

    it("diciembre rueda el año en el fin de período", async () => {
      const r = await getMoraCobradaPorAsesor({ mes: 12, anio: 2026 });
      expect(r.periodo.inicio).toBe("2026-12-06");
      expect(r.periodo.fin).toBe("2027-01-06");
    }, 20000);

    it("totalCobrado == suma de porAsesor y cuadra vs SUM independiente", async () => {
      const r = await getMoraCobradaPorAsesor({ mes: 6, anio: 2026 });
      const sumaPorAsesor = r.porAsesor.reduce((s, a) => s + Number(a.cobrado), 0);
      expect(Number(r.totalCobrado)).toBeCloseTo(sumaPorAsesor, 2);

      // Reconstrucción independiente del mismo total (misma ventana + paymentFalse=false).
      const indep = await db.execute<{ total: string }>(sql`
        SELECT COALESCE(SUM(pc.mora::numeric), 0) AS total
        FROM cartera.pagos_credito pc
        WHERE pc.fecha_pago >= '2026-06-06'::timestamp
          AND pc.fecha_pago <  '2026-07-06'::timestamp
          AND COALESCE(pc."paymentFalse", false) = false
      `);
      expect(Number(r.totalCobrado)).toBeCloseTo(Number(indep.rows[0].total), 2);
    }, 20000);

    it("filtro asesores limita a los IDs pedidos", async () => {
      const full = await getMoraCobradaPorAsesor({ mes: 6, anio: 2026 });
      const ids = full.porAsesor.slice(0, 1).map((a) => a.asesorId);
      if (!ids.length) return;
      const filt = await getMoraCobradaPorAsesor({ mes: 6, anio: 2026, asesores: ids });
      expect(filt.porAsesor.every((a) => ids.includes(a.asesorId))).toBe(true);
    }, 20000);
  });
}
