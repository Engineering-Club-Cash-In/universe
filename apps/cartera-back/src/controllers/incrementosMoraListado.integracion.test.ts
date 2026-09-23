import { describe, expect, it } from "bun:test";

/**
 * El cálculo EN CONJUNTO tiene que dar exactamente lo mismo que el crédito por
 * crédito: es una reescritura del que el detalle hacía para uno solo, y si
 * divergieran la tarjeta anunciaría en la lista un ritmo distinto del que
 * muestra al abrir el crédito.
 *
 * Contra datos REALES porque el riesgo de la versión en conjunto no está en la
 * fórmula (eso se prueba sin base) sino en el plegado: que una cuota caiga en
 * el crédito equivocado, o que un crédito sin cuotas quede fuera del mapa.
 *
 * Solo LECTURAS. Sin SUPABASE_DB_URL se salta.
 *
 * NOTA: no se ejercita `getCreditosWithUserByMesAnio` de punta a punta porque
 * el dump local va atrasado de esquema (`creditos.excluir_compras` no existe) y
 * la consulta principal del listado no corre ahí. Ese cableado se prueba con el
 * test de contrato sobre el fuente.
 */
const hasDb = !!process.env.SUPABASE_DB_URL;

if (!hasDb) {
  describe("incrementos de mora en conjunto (integración)", () => {
    it.skip("requiere SUPABASE_DB_URL apuntando al clon DEV/local", () => {});
  });
} else {
  process.env.RESEND_API_KEY ||= "test";
  process.env.EMAIL_DOMAIN ||= "test.local";

  const { sql } = await import("drizzle-orm");
  const { db } = await import("../database/index");
  const { incrementosMoraPorCredito } = await import("./credits");

  // Créditos con una cuota impaga que TODAVÍA no topó su cargo (vencida hace
  // menos de 30 días, o por vencer dentro de 30): son los únicos donde el
  // cálculo puede dar algo distinto de cero. Una muestra de puras cuotas
  // vencidas hace años daría cero en todo —están todas topadas— y comparar
  // ceros no probaría el plegado. Se agregan después créditos cualesquiera,
  // para que la muestra también tenga los casos de cero.
  const muestra = await db.execute<any>(sql`
    (SELECT c.credito_id, c.capital, c."statusCredit" AS status
     FROM cartera.creditos c
     WHERE EXISTS (
       SELECT 1 FROM cartera.cuotas_credito cc
       WHERE cc.credito_id = c.credito_id AND cc.pagado = false
         AND cc.fecha_vencimiento::date > (CURRENT_DATE - 30)
         AND cc.fecha_vencimiento::date <= (CURRENT_DATE + 30)
     )
     ORDER BY c.credito_id
     LIMIT 200)
    UNION
    (SELECT c.credito_id, c.capital, c."statusCredit" AS status
     FROM cartera.creditos c
     ORDER BY c.credito_id
     LIMIT 100)
  `);
  const creditos = muestra.rows.map((r: any) => ({
    credito_id: Number(r.credito_id),
    capital: r.capital,
    statusCredit: r.status,
  }));

  describe(`incrementos de mora en conjunto (integración, ${creditos.length} créditos)`, () => {
    it("hay muestra suficiente para que la comparación signifique algo", () => {
      expect(creditos.length).toBeGreaterThan(50);
    });

    it("el conjunto da lo MISMO que crédito por crédito", async () => {
      const enConjunto = await incrementosMoraPorCredito(creditos);
      expect(enConjunto.size).toBe(creditos.length);

      for (const credito of creditos) {
        const uno = await incrementosMoraPorCredito([credito]);
        expect(uno.get(credito.credito_id)).toEqual(
          enConjunto.get(credito.credito_id)!,
        );
      }
    });

    it("MUTACIÓN: el EXISTS del pago aplicado correlaciona de verdad", async () => {
      // Si la correlación se rompiera (`pc.cuota_id = pc.cuota_id`), el EXISTS
      // daría true para TODA cuota, ninguna sería elegible y todo el reporte
      // caería a "0.00" — verde en los tests con doble de `db`, inerte en
      // producción. Solo contra datos reales se nota.
      const enConjunto = await incrementosMoraPorCredito(creditos);
      const distintosDeCero = [...enConjunto.values()].filter(
        (v) => Number(v.incrementoDiarioMora) > 0,
      );
      expect(distintosDeCero.length).toBeGreaterThan(10);
    });

    it("al menos un crédito real tiene mora que SUBE: si todos dieran cero, comparar ceros no probaría nada", async () => {
      const enConjunto = await incrementosMoraPorCredito(creditos);
      const suben = [...enConjunto.values()].filter(
        (v) => Number(v.incrementoMaximoMensualMora) > 0,
      );
      expect(suben.length).toBeGreaterThan(0);
    });

    it("todo crédito de la página sale con los dos campos formateados", async () => {
      const enConjunto = await incrementosMoraPorCredito(creditos);
      for (const credito of creditos) {
        const v = enConjunto.get(credito.credito_id);
        expect(v?.incrementoDiarioMora).toMatch(/^\d+\.\d{2}$/);
        expect(v?.incrementoMaximoMensualMora).toMatch(/^\d+\.\d{2}$/);
      }
    });
  });
}
