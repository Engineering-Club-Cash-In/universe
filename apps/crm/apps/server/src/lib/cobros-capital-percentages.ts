const ACTIVE_ESTADOS = new Set([
	"al_dia",
	"mora_30",
	"mora_60",
	"mora_90",
	"mora_120",
]);

const CLOSED_ESTADOS = new Set(["incobrable", "completado"]);

export type CobrosCapitalStats = {
	estadoMora: string;
	sumaCapital: string;
	porcentaje: string;
};

function capitalTotal(stats: readonly CobrosCapitalStats[], estados: Set<string>) {
	return stats
		.filter((stat) => estados.has(stat.estadoMora))
		.reduce((sum, stat) => sum + Number(stat.sumaCapital || 0), 0);
}

function percentage(capital: string, total: number) {
	if (total <= 0) return "0";
	return ((Number(capital || 0) / total) * 100).toFixed(2);
}

export function recalculateCobrosCapitalPercentages<T extends CobrosCapitalStats>(
	stats: readonly T[],
) {
	const activeTotal = capitalTotal(stats, ACTIVE_ESTADOS);
	const closedTotal = capitalTotal(stats, CLOSED_ESTADOS);

	return stats.map((stat) => {
		if (ACTIVE_ESTADOS.has(stat.estadoMora)) {
			return { ...stat, porcentaje: percentage(stat.sumaCapital, activeTotal) };
		}

		if (CLOSED_ESTADOS.has(stat.estadoMora)) {
			return { ...stat, porcentaje: percentage(stat.sumaCapital, closedTotal) };
		}

		return { ...stat, porcentaje: "0" };
	});
}
