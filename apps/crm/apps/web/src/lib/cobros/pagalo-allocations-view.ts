/**
 * CB-127 · Deriva "links por cuota" a partir de `allocationsSnapshot`
 * (jsonb, formato documentado en
 * server/src/db/schema/pagalo-payments.ts:95-108).
 *
 * Semántica clave: el snapshot es POR GRUPO, no por link. Un link `CAPITAL`
 * cubre todas las cuotas del snapshot con ese `link_type` — el mapeo es
 * cuota → tipo de link → link, N:1, nunca un link por cuota.
 */

export type PagaloLinkType = "CAPITAL" | "MORA_INTERES";

export type AllocationRow = {
	link_type: PagaloLinkType;
	cartera_cuota_id: number | null;
	numero_cuota: number | null;
	rubro: string;
	amount: string;
	facturable: boolean;
};

export type LinkParaAgrupar = {
	id: string;
	linkType: PagaloLinkType;
	status: string;
	generation: number;
};

export type RubroCuota = { rubro: string; amount: string };

export type CuotaConLinks = {
	numeroCuota: number | null;
	etiqueta: string;
	montoTotal: string;
	rubros: RubroCuota[];
	linkTypes: PagaloLinkType[];
	linksActivos: LinkParaAgrupar[];
	linksHistoricos: LinkParaAgrupar[];
};

const ESTADOS_VIVOS = new Set(["CREATING", "ACTIVE"]);
// linksHistoricos es específicamente para contar DUPLICADOS (generaciones
// previas superadas) — un catch-all "todo lo que no es vivo" clasificaba
// también PAID ahí, así que un grupo normal pagado sin ninguna regeneración
// mostraba "(1 link(s) previo(s))" en cada cuota, insinuando un duplicado
// que nunca existió (hallazgo de code review, PR2 #1497). PAID no cuenta
// para ningún lado: no es un duplicado cerrado sin pago, tampoco pendiente.
const ESTADOS_HISTORICOS = new Set([
	"REPLACED",
	"EXPIRED",
	"CANCELLED",
	"ERROR",
]);

function esFilaValida(valor: unknown): valor is AllocationRow {
	if (!valor || typeof valor !== "object") return false;
	const fila = valor as Record<string, unknown>;
	if (fila.link_type !== "CAPITAL" && fila.link_type !== "MORA_INTERES")
		return false;
	if (typeof fila.rubro !== "string") return false;
	if (typeof fila.amount !== "string") return false;
	// AllocationRow declara numero_cuota como number | null (sin undefined) —
	// el chequeo anterior (!== null && !== undefined && typeof !== "number")
	// dejaba pasar undefined sin llegar al typeof, así que un snapshot
	// histórico/malformado con el campo directamente ausente entraba como
	// válido y agruparPorCuota usaba esa clave undefined en el Map, armando
	// un grupo "Cuota #undefined" en vez de descartar la fila (hallazgo de
	// code review). Solo null o number pasan ahora.
	if (fila.numero_cuota !== null && typeof fila.numero_cuota !== "number")
		return false;
	return true;
}

function sumarMontos(valores: string[]): string {
	const centavos = valores.reduce((acc, v) => {
		const n = Math.round(Number(v) * 100);
		return acc + (Number.isFinite(n) ? n : 0);
	}, 0);
	return (centavos / 100).toFixed(2);
}

/**
 * Agrupa el snapshot por `numero_cuota` (las filas sin cuota — mora pura de
 * un grupo solo-mora — caen en un grupo sintético) y mapea cada tipo de link
 * involucrado a los links vivos e históricos de ese tipo en el grupo.
 */
export function agruparPorCuota(
	snapshot: unknown,
	links: LinkParaAgrupar[],
): CuotaConLinks[] {
	if (!Array.isArray(snapshot)) return [];
	const filas = snapshot.filter(esFilaValida);
	if (filas.length === 0) return [];

	const porCuota = new Map<number | null, AllocationRow[]>();
	for (const fila of filas) {
		const clave = fila.numero_cuota;
		const grupo = porCuota.get(clave) ?? [];
		grupo.push(fila);
		porCuota.set(clave, grupo);
	}

	const linksPorTipo = new Map<PagaloLinkType, LinkParaAgrupar[]>();
	for (const link of links) {
		const grupo = linksPorTipo.get(link.linkType) ?? [];
		grupo.push(link);
		linksPorTipo.set(link.linkType, grupo);
	}

	const resultado: CuotaConLinks[] = [];
	const ordenCuotas = [...porCuota.keys()].sort((a, b) => {
		if (a === null) return 1;
		if (b === null) return -1;
		return a - b;
	});

	for (const numeroCuota of ordenCuotas) {
		const filasCuota = porCuota.get(numeroCuota) ?? [];
		const linkTypes = [...new Set(filasCuota.map((f) => f.link_type))];
		const linksDeLaCuota = linkTypes.flatMap(
			(tipo) => linksPorTipo.get(tipo) ?? [],
		);
		resultado.push({
			numeroCuota,
			etiqueta: numeroCuota === null ? "Mora" : `Cuota #${numeroCuota}`,
			montoTotal: sumarMontos(filasCuota.map((f) => f.amount)),
			rubros: filasCuota.map((f) => ({ rubro: f.rubro, amount: f.amount })),
			linkTypes,
			linksActivos: linksDeLaCuota.filter((l) => ESTADOS_VIVOS.has(l.status)),
			linksHistoricos: linksDeLaCuota.filter((l) =>
				ESTADOS_HISTORICOS.has(l.status),
			),
		});
	}

	return resultado;
}
