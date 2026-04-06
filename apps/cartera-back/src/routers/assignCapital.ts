import { Elysia } from "elysia";
import { getCreditCandidates, type CreditCandidate } from "../controllers/assignCapital";

export const assignCapitalRouter = new Elysia()

  /**
   * GET /assign-capital/candidates
   *
   * Query params:
   *
   *  - monto           (opcional, number)
   *      Activa el bonus de proximidad en el score.
   *      Si viene con solo_insertable=true, también se usa para acumular créditos.
   *
   *  - solo_insertable (opcional, boolean "true")
   *      Devuelve SOLO los créditos que se insertarían para cubrir el monto.
   *      Toma créditos en orden de score acumulando sus capital_activo hasta
   *      llegar al monto. Requiere monto.
   *      Ejemplo: monto=10000, crédito1=Q3000, crédito2=Q4000, crédito3=Q4000
   *        → retorna los 3 (3000+4000+4000 = 11000 >= 10000)
   *
   *  - minimo          (opcional, number)
   *      Devuelve los top N créditos por score.
   *      Para dar opciones sin filtrar tanto como solo_insertable.
   *
   * Prioridad de modos: solo_insertable > minimo > default (todos)
   */
  .get("/assign-capital/candidates", async ({ query, set }) => {
    const {
      monto: montoStr,
      solo_insertable: soloInsertableStr,
      minimo: minimoStr,
    } = query as Record<string, string | undefined>;

    // ── Validar monto ──────────────────────────────────────────
    let monto: number | undefined;
    if (montoStr !== undefined) {
      const parsed = Number(montoStr);
      if (isNaN(parsed) || parsed <= 0) {
        set.status = 400;
        return { ok: false, message: "El parámetro 'monto' debe ser un número positivo." };
      }
      monto = parsed;
    }

    // ── Validar solo_insertable ────────────────────────────────
    const soloInsertable = soloInsertableStr === "true";

    if (soloInsertable && monto === undefined) {
      set.status = 400;
      return {
        ok: false,
        message: "El parámetro 'solo_insertable=true' requiere que también se envíe 'monto'.",
      };
    }

    // ── Validar minimo ─────────────────────────────────────────
    let minimo: number | undefined;
    if (minimoStr !== undefined) {
      const parsed = Number(minimoStr);
      if (isNaN(parsed) || parsed < 1 || !Number.isInteger(parsed)) {
        set.status = 400;
        return { ok: false, message: "El parámetro 'minimo' debe ser un entero positivo (ej: 5)." };
      }
      minimo = parsed;
    }

    try {
      const allCandidates = await getCreditCandidates(monto);

      let result: CreditCandidate[];

      if (soloInsertable && monto !== undefined) {
        // ── Solo los créditos necesarios para cubrir el monto ──
        let acumulado = 0;
        const insertables: CreditCandidate[] = [];
        for (const c of allCandidates) {
          insertables.push(c);
          acumulado += c.capital_activo;
          if (acumulado >= monto) break;
        }
        result = insertables;

      } else if (minimo !== undefined) {
        // ── Top N por score ────────────────────────────────────
        result = allCandidates.slice(0, minimo);

      } else {
        // ── Default: todos ─────────────────────────────────────
        result = allCandidates;
      }

      set.status = 200;
      return {
        ok: true,
        total: result.length,
        total_sin_filtro: allCandidates.length,
        monto_buscado: monto ?? null,
        solo_insertable: soloInsertable,
        minimo: minimo ?? null,
        capital_acumulado: soloInsertable
          ? result.reduce((acc, c) => acc + c.capital_activo, 0)
          : null,
        candidates: result,
      };

    } catch (error) {
      console.error("❌ Error en /assign-capital/candidates:", error);
      set.status = 500;
      return {
        ok: false,
        message: "Error obteniendo candidatos de asignación.",
        error: String(error),
      };
    }
  });
