import { db } from "../database";
import {
  creditos,
  creditos_inversionistas,
  creditos_inversionistas_espejo,
  cuotas_credito,
  pagos_credito,
  inversionistas,
  usuarios,
} from "../database/db";
import { eq, and, sql, inArray, notInArray } from "drizzle-orm";
import Big from "big.js";

// ============================================================
// TIPOS
// ============================================================

// ID fijo de Cube Investments S.A. en la base de datos
export const CUBE_ID = 86;

interface InversionistaResult {
  inversionista_id: number;
  nombre: string;
  monto_aportado: number;
  es_cube: boolean;
}

interface ScoreBreakdown {
  crm_bonus: number;
  formato: number;
  cuotas: number;
  proximidad: number;
  total: number;
}

interface FullCreditData {
  credito: any;
  usuario: any;
  espejo: any[];
  inversionistas_detalle: any[];
}

export interface CreditCandidate {
  credito_id: number;
  numero_credito_sifco: string;
  capital: number;
  capital_activo: number;
  formato_credito: "Pool" | "Individual";
  cuotas_pagadas: number;
  total_cuotas: number;
  inversionistas: InversionistaResult[];
  score: number;
  score_breakdown: ScoreBreakdown;
  credito_completo?: FullCreditData;
}

// ============================================================
// CONSTANTES DE SCORING
// ============================================================
const SCORE_BASE = 1000;
const SCORE_CRM_BONUS = 500;
const SCORE_FORMAT_INDIVIDUAL = 400;
const SCORE_FORMAT_POOL_CUBE_ONLY = 200;
const SCORE_FORMAT_POOL_CUBE_PLUS_1 = 100;
const SCORE_CUOTA_0 = 300;
const SCORE_PENALTY_PER_CUOTA = 30; // Reducido de 50 a 30
const SCORE_PROXIMITY_BASE_FITS = 300; // Bono porque el capital del crédito cubre todo el monto
const SCORE_PROXIMITY_HIGH = 200;      // Diferencia < 10%
const SCORE_PROXIMITY_MED = 100;       // Diferencia < 25%

// ============================================================
// FUNCIONES DE SCORING
// ============================================================

function calcFormatoBonus(
  formato: string,
  invs: InversionistaResult[]
): number {
  if (formato === "Individual") return SCORE_FORMAT_INDIVIDUAL;

  // Es Pool — verificar cuántos inversionistas hay además de Cube
  const hasCube = invs.some((i) => i.es_cube);
  if (!hasCube) return 0; // no debería llegar aquí (filtro hard), pero por seguridad

  const nonCubeCount = invs.filter((i) => !i.es_cube).length;
  if (nonCubeCount === 0) return SCORE_FORMAT_POOL_CUBE_ONLY;
  if (nonCubeCount === 1) return SCORE_FORMAT_POOL_CUBE_PLUS_1;
  return 0;                            
}

function calcCuotasBonus(cuotasPagadas: number): number {
  // Según las nuevas reglas:
  // 1. Si ya pasaron más de 5 cuotas, el bono es 0 (neutral, no resta ni suma).
  if (cuotasPagadas > 5) return 0;

  // 2. Si está entre 0 y 5, se da el bono de Cuota 0 menos la penalización ligera.
  // Usamos Math.max(0, ...) para asegurar que no reste puntos del total base.
  return Math.max(0, SCORE_CUOTA_0 - SCORE_PENALTY_PER_CUOTA * cuotasPagadas);
}

function calcCapitalProximityBonus(
  capitalActivo: number,
  monto: number | undefined
): number {
  if (monto === undefined || monto <= 0 || capitalActivo <= 0) return 0;

  // Si el capital del crédito es MENOR al monto, se requiere partir facturación.
  // Según las nuevas reglas, esto no suma puntos de proximidad (Score 0).
  if (capitalActivo < monto) return 0;

  const denominator = Math.max(capitalActivo, monto);
  const diffPercent = Math.abs(capitalActivo - monto) / denominator;

  // Escenario: El capital del crédito cubre TODO el monto (Preferido)
  // Se otorga un bono base por caber completo, más extras por cercanía.
  let score = SCORE_PROXIMITY_BASE_FITS;
  if (diffPercent < 0.1) score += SCORE_PROXIMITY_HIGH;
  else if (diffPercent < 0.25) score += SCORE_PROXIMITY_MED;
  return score;
}

// ============================================================
// QUERY PRINCIPAL
// ============================================================

export async function getCreditCandidates(
  monto?: number,
  limit?: number
): Promise<CreditCandidate[]> {
  console.log("\n🔍 ========== getCreditCandidates ==========");
  console.log(`   monto: ${monto ?? "no especificado"}`);

  // ──────────────────────────────────────────────────────────
  // 1. Diagnóstico de embudo de filtros inicial
  // ──────────────────────────────────────────────────────────
  const [{ totalActivos }] = await db.select({ totalActivos: sql<number>`COUNT(*)::int` })
    .from(creditos).where(eq(creditos.statusCredit, "ACTIVO"));
    
  const [{ totalCandidatosBase }] = await db.select({ totalCandidatosBase: sql<number>`COUNT(*)::int` })
    .from(creditos)
    .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
    .where(and(
      eq(creditos.statusCredit, "ACTIVO"),
      sql`LOWER(${usuarios.categoria}) LIKE '%cv veh_culo%'`
    ));

  console.log(`   - Créditos ACTIVOS en total: ${totalActivos}`);
  console.log(`   - Créditos ACTIVOS de Vehículo: ${totalCandidatosBase}`);

  // ──────────────────────────────────────────────────────────
  // 1. Créditos Activos de Vehículo
  //    - usuarios.categoria = 'CV Vehículo'
  //    - statusCredit = 'ACTIVO'
  //    - Optimización: Sin pagos 'pending' (Subquery NOT IN)
  // ──────────────────────────────────────────────────────────
  const baseCredits = await db
    .select({
      credito_id: creditos.credito_id,
      numero_credito_sifco: creditos.numero_credito_sifco,
      capital: creditos.capital,
      formato_credito: creditos.formato_credito,
      tipoCredito: creditos.tipoCredito,
      statusCredit: creditos.statusCredit,
    })
    .from(creditos)
    .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
    .where(
      and(
        // La categoría debe contener 'cv vehiculo' o 'cv vehículo'
        sql`LOWER(${usuarios.categoria}) LIKE '%cv veh_culo%'`,
        // Solo activos
        eq(creditos.statusCredit, "ACTIVO")
      )
    );

  console.log(`   Candidatos base (Activos + Vehículo + Sin pending): ${baseCredits.length}`);

  if (baseCredits.length === 0) return [];

  const creditoIds = baseCredits.map((c) => c.credito_id);

  // ──────────────────────────────────────────────────────────
  // 2. Extraer pagos inválidos a un Set en Memoria (Súper Rápido, O(1))
  //    Cualquier estado diferente a 'validated' o 'no_required' descarta el crédito
  // ──────────────────────────────────────────────────────────
  const creditosConInvalidosRaw = await db
    .selectDistinct({ credito_id: pagos_credito.credito_id })
    .from(pagos_credito)
    .where(
      and(
        inArray(pagos_credito.credito_id, creditoIds),
        notInArray(pagos_credito.validationStatus, ["validated", "no_required"])
      )
    );

  const invalidosSet = new Set(
    creditosConInvalidosRaw
      .map((r) => r.credito_id)
      .filter((id): id is number => id !== null)
  );
  console.log(`   Créditos descartados por validaciones de pagos pendientes/inválidos: ${invalidosSet.size}`);

  // ──────────────────────────────────────────────────────────
  // 3. Filtrar: espejo debe estar en 'completado'
  //    Significa que el ciclo anterior terminó y el capital está disponible
  //    para reinversión. Si tiene pendiente_* ya hay un proceso en curso.
  // ──────────────────────────────────────────────────────────
  const espejoRows = await db
    .select({
      credito_id: creditos_inversionistas_espejo.credito_id,
      status: creditos_inversionistas_espejo.status,
    })
    .from(creditos_inversionistas_espejo)
    .where(inArray(creditos_inversionistas_espejo.credito_id, creditoIds));

  // Agrupar por credito_id
  const espejoByCredito = new Map<number, string[]>();
  for (const row of espejoRows) {
    if (!espejoByCredito.has(row.credito_id)) {
      espejoByCredito.set(row.credito_id, []);
    }
    espejoByCredito.get(row.credito_id)!.push(row.status);
  }

  // Un crédito pasa si TODOS sus registros en espejo están en 'completado'
  // Si alguno está en pendiente_* ya hay un proceso en curso → descartado
  const creditosConEspejoCompleto = new Set<number>();
  for (const [creditoId, statuses] of espejoByCredito.entries()) {
    const todosCompletos = statuses.every((s) => s === "completado");
    if (todosCompletos) {
      creditosConEspejoCompleto.add(creditoId);
    }
  }
  // También pasan créditos que NO tienen ningún registro en espejo (aún sin ciclo)
  for (const id of creditoIds) {
    if (!espejoByCredito.has(id)) {
      creditosConEspejoCompleto.add(id);
    }
  }

  console.log(
    `   Créditos con espejo completado (elegibles): ${creditosConEspejoCompleto.size}`
  );

  // ──────────────────────────────────────────────────────────
  // 4. Inversionistas por crédito (para filtro Pool + score)
  // ──────────────────────────────────────────────────────────
  const invRows = await db
    .select({
      credito_id: creditos_inversionistas.credito_id,
      inversionista_id: creditos_inversionistas.inversionista_id,
      monto_aportado: creditos_inversionistas.monto_aportado,
      nombre: inversionistas.nombre,
    })
    .from(creditos_inversionistas)
    .innerJoin(
      inversionistas,
      eq(
        creditos_inversionistas.inversionista_id,
        inversionistas.inversionista_id
      )
    )
    .where(inArray(creditos_inversionistas.credito_id, creditoIds));

  const invsByCredito = new Map<number, InversionistaResult[]>();
  for (const row of invRows) {
    if (!invsByCredito.has(row.credito_id)) {
      invsByCredito.set(row.credito_id, []);
    }
    const esCube = row.inversionista_id === CUBE_ID;
    invsByCredito.get(row.credito_id)!.push({
      inversionista_id: row.inversionista_id,
      nombre: row.nombre,
      monto_aportado: Number(row.monto_aportado),
      es_cube: esCube,
    });
  }

  // ──────────────────────────────────────────────────────────
  // 5. Cuotas pagadas por crédito (todas incluyendo cuota 0)
  // ──────────────────────────────────────────────────────────
  const cuotasPagadasRaw = await db
    .select({
      credito_id: cuotas_credito.credito_id,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(cuotas_credito)
    .where(
      and(
        inArray(cuotas_credito.credito_id, creditoIds),
        eq(cuotas_credito.pagado, true)
        // Se incluyen todas las cuotas: 0, 1, 2, 3...
      )
    )
    .groupBy(cuotas_credito.credito_id);

  const cuotasPagadasByCredito = new Map<number, number>();
  for (const row of cuotasPagadasRaw) {
    cuotasPagadasByCredito.set(row.credito_id, Number(row.count));
  }

  // ──────────────────────────────────────────────────────────
  // 5.1 Cuotas totales por crédito (pagadas o no)
  // ──────────────────────────────────────────────────────────
  const totalCuotasRaw = await db
    .select({
      credito_id: cuotas_credito.credito_id,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(cuotas_credito)
    .where(inArray(cuotas_credito.credito_id, creditoIds))
    .groupBy(cuotas_credito.credito_id);

  const totalCuotasByCredito = new Map<number, number>();
  for (const row of totalCuotasRaw) {
    totalCuotasByCredito.set(row.credito_id, Number(row.count));
  }

  // ──────────────────────────────────────────────────────────
  // 6. Capital activo por crédito
  //    capital_activo = capital - SUM(abono_capital donde pagado=true)
  // ──────────────────────────────────────────────────────────
  const abonosCapitalRaw = await db
    .select({
      credito_id: pagos_credito.credito_id,
      total_abono: sql<string>`COALESCE(SUM(${pagos_credito.abono_capital}), 0)`,
    })
    .from(pagos_credito)
    .where(
      and(
        inArray(pagos_credito.credito_id, creditoIds),
        eq(pagos_credito.pagado, true)
      )
    )
    .groupBy(pagos_credito.credito_id);

  const abonosByCredito = new Map<number, Big>();
  for (const row of abonosCapitalRaw) {
    if (row.credito_id !== null) {
      abonosByCredito.set(row.credito_id, new Big(row.total_abono ?? "0"));
    }
  }

  // ──────────────────────────────────────────────────────────
  // 7. Aplicar filtros hard y calcular score
  // ──────────────────────────────────────────────────────────
  const candidates: CreditCandidate[] = [];

  for (const credito of baseCredits) {
    const { credito_id, numero_credito_sifco, capital, formato_credito } =
      credito;

    // Filtro en memoria: pagos inválidos (pendientes, rejects, resets, etc.)
    if (invalidosSet.has(credito_id)) {
      console.log(
        `   ❌ [${numero_credito_sifco}] Descartado: tiene pagos sin validar (estado riesgoso)`
      );
      continue;
    }

    // Filtro: espejo debe estar completo (ciclo anterior terminado)
    if (!creditosConEspejoCompleto.has(credito_id)) {
      console.log(
        `   ❌ [${numero_credito_sifco}] Descartado: espejo tiene registros pendientes (proceso en curso)`
      );
      continue;
    }

    // Filtro Pool: Cube debe existir Y ser el mayor inversionista (mayor monto_aportado)
    const invs = invsByCredito.get(credito_id) ?? [];
    const cubeInv = invs.find((i) => i.es_cube);

    // Identificar formato dinámicamente si viene null (para evitar saltarse validación de Pool)
    const actualFormadoCredito = formato_credito ?? (invs.length > 1 ? "Pool" : "Individual");

    if (actualFormadoCredito === "Pool") {
      // No tiene a Cube → descartado
      if (!cubeInv) {
        console.log(
          `   ❌ [${numero_credito_sifco}] Descartado: Pool sin Cube (ID ${CUBE_ID})`
        );
        continue;
      }

      // VALIDACIÓN: Cube debe ser el líder del Pool.
      // Si existe algún otro inversionista con un monto estrictamente mayor, se descarta.
      // Si Cube está empatado en el primer lugar, se permite.
      const maxMontoOtros = Math.max(0, ...invs.filter(i => !i.es_cube).map((i) => i.monto_aportado));
      if (cubeInv.monto_aportado < maxMontoOtros) {
        console.log(
          `   ❌ [${numero_credito_sifco}] Descartado: Pool donde Cube (Q${cubeInv.monto_aportado}) no es el líder (hay montos de Q${maxMontoOtros})`
        );
        continue;
      }
    }

    // Capital activo
    const capitalBig = new Big(capital ?? "0");
    const abonoCapital = abonosByCredito.get(credito_id) ?? new Big(0);
    const capitalActivo = capitalBig.minus(abonoCapital);
    const capitalActivoNum = Math.max(0, capitalActivo.toNumber());

    // Cuotas pagadas y totales
    const cuotasPagadas = cuotasPagadasByCredito.get(credito_id) ?? 0;
    const totalCuotas = totalCuotasByCredito.get(credito_id) ?? 0;

    // Score
    const crmBonus = numero_credito_sifco?.toLowerCase().startsWith("crm") ? SCORE_CRM_BONUS : 0;
    const formatoBonus = calcFormatoBonus(actualFormadoCredito, invs);
    const cuotasBonus = calcCuotasBonus(cuotasPagadas);
    const proximityBonus = monto !== undefined ? calcCapitalProximityBonus(capitalActivoNum, monto) : 0;

    const score = SCORE_BASE + crmBonus + formatoBonus + cuotasBonus + proximityBonus;

    console.log(
      `   ✅ [${numero_credito_sifco}] score=${score} (crm=${crmBonus}, fmt=${formatoBonus}, cuotas=${cuotasBonus}, prox=${proximityBonus})`
    );

    candidates.push({
      credito_id,
      numero_credito_sifco: numero_credito_sifco ?? "",
      capital: Number(capital),
      capital_activo: capitalActivoNum,
      formato_credito: actualFormadoCredito as "Pool" | "Individual",
      cuotas_pagadas: cuotasPagadas,
      total_cuotas: totalCuotas,
      inversionistas: invs,
      score,
      score_breakdown: {
        crm_bonus: crmBonus,
        formato: formatoBonus,
        cuotas: cuotasBonus,
        proximidad: proximityBonus,
        total: score,
      },
    });
  }

  // Ordenar DESC por score
  candidates.sort((a, b) => b.score - a.score);

  // Si se especificó un límite, cortar antes de las queries de relaciones
  if (limit !== undefined) {
    candidates.splice(limit);
  }

  // ──────────────────────────────────────────────────────────
  // 8. Opcional: Agregar todos los datos relaciones (a petición)
  // ──────────────────────────────────────────────────────────
  const finalIds = candidates.map((c) => c.credito_id);

  if (finalIds.length > 0) {
    const rawCreditos = await db.select().from(creditos).where(inArray(creditos.credito_id, finalIds));
    
    // Obtener los IDs de usuario de los créditos encontrados (filtrando nulos)
    const usuarioIdsSet = new Set(rawCreditos.map((c) => c.usuario_id).filter((id): id is number => id !== null));
    const usuarioIds = Array.from(usuarioIdsSet);
    
    const rawUsuarios = usuarioIds.length > 0 ? await db.select().from(usuarios).where(inArray(usuarios.usuario_id, usuarioIds)) : [];
    
    const rawEspejo = await db.select().from(creditos_inversionistas_espejo).where(inArray(creditos_inversionistas_espejo.credito_id, finalIds));
    const rawInversionistas = await db
      .select({
        detalle_credito_inversionista: creditos_inversionistas,
        nombre_inversionista: inversionistas.nombre,
      })
      .from(creditos_inversionistas)
      .innerJoin(inversionistas, eq(creditos_inversionistas.inversionista_id, inversionistas.inversionista_id))
      .where(inArray(creditos_inversionistas.credito_id, finalIds));

    for (const candidate of candidates) {
      const c = rawCreditos.find((x) => x.credito_id === candidate.credito_id);
      const u = rawUsuarios.find((x) => x.usuario_id === c?.usuario_id);
      const esp = rawEspejo.filter((x) => x.credito_id === candidate.credito_id);
      const invs = rawInversionistas.filter((x) => x.detalle_credito_inversionista.credito_id === candidate.credito_id);

      candidate.credito_completo = {
        credito: c,
        usuario: u,
        espejo: esp,
        inversionistas_detalle: invs.map((i) => ({
          ...i.detalle_credito_inversionista,
          nombre: i.nombre_inversionista,
        })),
      };
    }
  }

  console.log(`\n✅ Candidatos finales: ${candidates.length}`);
  console.log("===========================================\n");

  return candidates;
}
