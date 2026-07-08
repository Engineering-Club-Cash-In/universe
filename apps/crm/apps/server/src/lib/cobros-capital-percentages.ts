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

function capitalTotal(stats: readonly CobrosCapitalStats[], estados: ReadonlySet<string>) {
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
