import { Elysia } from "elysia";
import { getCreditCandidates, type CreditCandidate } from "../controllers/assignCapital";
import { authMiddleware } from "./midleware";

export const assignCapitalRouter = new Elysia()
  .use(authMiddleware)

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
   *  - plazo_objetivo  (opcional, entero positivo)
   *      Filtro estricto: solo créditos con EXACTAMENTE esa cantidad de plazos
   *      (cuotas) restantes. No escala a plazos vecinos.
   *      Si los créditos de ese plazo no cubren el monto, se devuelven igual
   *      los que haya (o ninguno); el faltante queda sin asignar.
   *
   * Prioridad de modos: solo_insertable > minimo > default (todos)
   * plazo_objetivo es ortogonal: filtra antes, y luego se aplica el modo.
   *
   * OJO con `total_sin_filtro` en la respuesta: cuenta los candidatos que
   * devolvió el controller, o sea DESPUÉS del filtro de plazo_objetivo y antes
   * del modo. Con plazo_objetivo=12 y 3 candidatos de 400, dice 3 — no 400.
   * Si el front necesita el "3 de 400", ese total pre-filtro hoy no sale de
   * getCreditCandidates y hay que exponerlo aparte.
   */
  .get("/assign-capital/candidates", async ({ query, set }) => {
    const {
      monto: montoStr,
      solo_insertable: soloInsertableStr,
      minimo: minimoStr,
      inversionista_id: inversionistaIdStr,
      porcentaje: porcentajeStr,
      plazo_objetivo: plazoObjetivoStr,
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

    // ── Validar inversionista_id ───────────────────────────────
    let inversionista_id: number | undefined;
    if (inversionistaIdStr !== undefined) {
      const parsed = Number(inversionistaIdStr);
      if (!isNaN(parsed)) {
        inversionista_id = parsed;
      }
    }

    // ── Validar porcentaje ─────────────────────────────────────
    let porcentaje: number | undefined;
    if (porcentajeStr !== undefined) {
      const parsed = Number(porcentajeStr);
      if (isNaN(parsed) || parsed <= 0 || parsed > 100) {
        set.status = 400;
        return { ok: false, message: "El parámetro 'porcentaje' debe ser un número mayor a 0 y máximo 100." };
      }
      porcentaje = parsed;
    }

    // ── Validar plazo_objetivo ─────────────────────────────────
    let plazoObjetivo: number | undefined;
    if (plazoObjetivoStr !== undefined && plazoObjetivoStr !== "") {
      const parsed = Number(plazoObjetivoStr);
      if (isNaN(parsed) || parsed < 1 || !Number.isInteger(parsed)) {
        set.status = 400;
        return { ok: false, message: "El parámetro 'plazo_objetivo' debe ser un entero positivo (ej: 12)." };
      }
      plazoObjetivo = parsed;
    }

    try {
      const allCandidates = await getCreditCandidates(monto, minimo, inversionista_id, porcentaje, plazoObjetivo);

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

      }  else {
        // ── Default: todos ─────────────────────────────────────
        result = allCandidates;
      }

      set.status = 200;
      return {
        ok: true,
        total: result.length,
        // "sin filtro" = sin el modo (solo_insertable / minimo). El filtro de
        // plazo_objetivo, si vino, YA se aplicó: no es el universo completo.
        total_sin_filtro: allCandidates.length,
        monto_buscado: monto ?? null,
        solo_insertable: soloInsertable,
        minimo: minimo ?? null,
        plazo_objetivo: plazoObjetivo ?? null,
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
