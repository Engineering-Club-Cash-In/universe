import { describe, expect, it } from "bun:test";

// Integración: ejercita getMoraByEtapaYAsesor (live + histórico) contra la base
// de SUPABASE_DB_URL (clon DEV/local). Solo lecturas. Se salta si no hay DB.
const hasDb = !!process.env.SUPABASE_DB_URL;

if (!hasDb) {
  describe("getMoraByEtapaYAsesor (integración)", () => {
    it.skip("requiere SUPABASE_DB_URL apuntando al clon DEV/local", () => {});
  });
} else {
  const { getMoraByEtapaYAsesor } = await import("./reportes");

  const sumaTotal = (r: any) => Number(r.totales.totalEnMora.sumaMora);
  const buckets = ["mora_30", "mora_60", "mora_90", "mora_120_plus"] as const;

  describe("getMoraByEtapaYAsesor", () => {
    it("live: totales = suma de buckets y de porAsesor", async () => {
      const r = await getMoraByEtapaYAsesor();
      expect(r.alcance).toBe("live");
      const porBuckets = buckets.reduce((s, b) => s + Number(r.totales[b].sumaMora), 0);
      expect(porBuckets).toBeCloseTo(sumaTotal(r), 2);
      const porAsesor = r.porAsesor.reduce(
        (s: number, a: any) => s + Number(a.totalEnMora.sumaMora), 0);
      expect(porAsesor).toBeCloseTo(sumaTotal(r), 2);
    });

    it("histórico(hoy-1) devuelve alcance historico y forma válida", async () => {
      const ayer = new Date(Date.now() - 86400000).toLocaleDateString("sv-SE", {
        timeZone: "America/Guatemala",
      });
      const r = await getMoraByEtapaYAsesor({ fecha: ayer });
      expect(r.alcance).toBe("historico");
      expect(r.fecha).toBe(ayer);
      const porBuckets = buckets.reduce((s, b) => s + Number(r.totales[b].sumaMora), 0);
      expect(porBuckets).toBeCloseTo(sumaTotal(r), 2);
    });

    it("fecha anterior a la cobertura → vacío + dataDisponibleDesde", async () => {
      const r = await getMoraByEtapaYAsesor({ fecha: "2000-01-01" });
      expect(r.porAsesor.length).toBe(0);
      expect(sumaTotal(r)).toBe(0);
      expect(typeof r.dataDisponibleDesde).toBe("string");
    });

    it("filtro asesores limita porAsesor a los IDs pedidos", async () => {
      const full = await getMoraByEtapaYAsesor();
      const ids = full.porAsesor.slice(0, 1).map((a: any) => a.asesorId);
      if (!ids.length) return;
      const filt = await getMoraByEtapaYAsesor({ asesores: ids });
      expect(filt.porAsesor.every((a: any) => ids.includes(a.asesorId))).toBe(true);
    });

    it("mapea cuotas → bucket con los umbrales exactos", async () => {
      const { bucketCaseSql } = await import("./reportes");
      const { db } = await import("../database");
      const { sql } = await import("drizzle-orm");
      const r = await db.execute<{ n: number; bucket: string }>(sql`
        SELECT v.n, ${bucketCaseSql(sql`v.n`)} AS bucket
        FROM (VALUES (1),(2),(3),(4),(5)) AS v(n)
        ORDER BY v.n
      `);
      const map = Object.fromEntries(r.rows.map((x) => [x.n, x.bucket]));
      expect(map[1]).toBe("mora_30");
      expect(map[2]).toBe("mora_60");
      expect(map[3]).toBe("mora_90");
      expect(map[4]).toBe("mora_120_plus");
      expect(map[5]).toBe("mora_120_plus");
    });
  });
}
