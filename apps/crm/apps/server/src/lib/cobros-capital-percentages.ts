// Default histórico (buckets B0-B5 fijos). Los callers que consumen el
// catálogo dinámico de cartera-back deben pasar su propio `activeEstados`
// (derivado del catálogo real) — si no, un bucket nuevo/renumerado queda
// fuera del denominador y nunca recibe porcentaje, aunque sí aparezca en el
// array de stats (ver moraBuckets.ts / cobros.ts para el caso dinámico).
const ACTIVE_ESTADOS_DEFAULT = new Set([
	"al_dia",
	"mora_30",
	"mora_60",
	"mora_90",
	"mora_120",
	"mora_120_plus",
]);

export type CobrosCapitalStats = {
	estadoMora: string;
	sumaCapital: string;
	porcentaje: string;
};

export type CobrosCapitalStatsWithCases = CobrosCapitalStats & {
	totalCases: number;
};

function sumBy<T>(
	stats: readonly T[],
	estados: ReadonlySet<string>,
	estadoMora: (stat: T) => string,
	value: (stat: T) => number,
) {
	return stats
		.filter((stat) => estados.has(estadoMora(stat)))
		.reduce((sum, stat) => sum + value(stat), 0);
}

function capitalTotal(
	stats: readonly CobrosCapitalStats[],
	estados: ReadonlySet<string>,
) {
	return sumBy(
		stats,
		estados,
		(stat) => stat.estadoMora,
		(stat) => Number(stat.sumaCapital || 0),
	);
}

function caseCountTotal(
	stats: readonly CobrosCapitalStatsWithCases[],
	estados: ReadonlySet<string>,
) {
	return sumBy(
		stats,
		estados,
		(stat) => stat.estadoMora,
		(stat) => Number(stat.totalCases || 0),
	);
}

function percentage(capital: string, total: number) {
	if (total <= 0) return "0";
	return ((Number(capital || 0) / total) * 100).toFixed(2);
}

function percentageByCaseCount(totalCases: number, total: number) {
	if (total <= 0) return "0";
	return ((Number(totalCases || 0) / total) * 100).toFixed(2);
}

export function recalculateCobrosCapitalPercentages<
	T extends CobrosCapitalStats,
>(
	stats: readonly T[],
	activeEstados: ReadonlySet<string> = ACTIVE_ESTADOS_DEFAULT,
) {
	const activeTotal = capitalTotal(stats, activeEstados);

	return stats.map((stat) => {
		if (activeEstados.has(stat.estadoMora)) {
			return { ...stat, porcentaje: percentage(stat.sumaCapital, activeTotal) };
		}

		return stat;
	});
}

/**
 * Igual que recalculateCobrosCapitalPercentages, pero cuando la fuente no
 * trae datos de capital (`hasCapitalData: false` — ej. fallback local, que
 * nunca calcula `sumaCapital`) calcula el porcentaje por número de casos en
 * su lugar, para no mostrar 0% en todo el embudo cuando sí hay casos.
 *
 * `hasCapitalData` debe venir explícito del caller (no se infiere de
 * `sumaCapital === 0`): una cartera real con capital activo en 0 es un caso
 * válido y debe mostrar 0%, distinto de "esta fuente no calculó capital".
 */
export function recalculateCobrosPercentagesWithFallback<
	T extends CobrosCapitalStatsWithCases,
>(
	stats: readonly T[],
	hasCapitalData: boolean,
	activeEstados: ReadonlySet<string> = ACTIVE_ESTADOS_DEFAULT,
) {
	if (hasCapitalData) {
		return recalculateCobrosCapitalPercentages(stats, activeEstados);
	}

	const activeCaseTotal = caseCountTotal(stats, activeEstados);

	return stats.map((stat) => {
		if (activeEstados.has(stat.estadoMora)) {
			return {
				...stat,
				porcentaje: percentageByCaseCount(stat.totalCases, activeCaseTotal),
			};
		}

		return stat;
	});
}

/**
 * Deriva si una fuente trajo capital REAL para todos los buckets activos,
 * a partir del payload crudo (antes de que un default tipo `|| "0"` colapse
 * "faltante" y "cero real" en el mismo valor).
 *
 * Es all-or-nothing por diseño: si UN bucket activo no trajo sumaCapital,
 * toda la fuente se considera sin capital confiable -- mezclar buckets con
 * capital real y buckets con capital desconocido-tratado-como-cero
 * distorsiona el % sin avisar (ver cobros.ts, bug donde "al menos un
 * bucket trae capital" se usaba incorrectamente como señal de "true").
 */
export function deriveHasCapitalData(
	stats: readonly {
		estadoMora: string;
		sumaCapital: string | null | undefined;
	}[],
	activeEstados: ReadonlySet<string> = ACTIVE_ESTADOS_DEFAULT,
): boolean {
	const activeStats = stats.filter((stat) =>
		activeEstados.has(stat.estadoMora),
	);

	if (activeStats.length === 0) return false;

	return activeStats.every(
		(stat) => stat.sumaCapital != null && stat.sumaCapital !== "",
	);
}
