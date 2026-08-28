/**
 * CB-127 · Agrupa el `allocationsSnapshot` (jsonb, por grupo — ver
 * buildPagaloAllocations en el server) por cuota, para la vista "Links por
 * cuota" del supervisor. `allocationsSnapshot` es por GRUPO, no por link: un
 * link CAPITAL cubre TODAS las cuotas del snapshot con ese link_type — el
 * mapeo cuota→tipo de link es N:1, nunca un link por cuota.
 *
 * Entrada `unknown` (viene de jsonb sin garantía de forma histórica —
 * grupos viejos pueden tener otras formas): se valida fila por fila,
 * descartando lo que no matchea en vez de tirar.
 */

export type PagaloLinkType = "CAPITAL" | "MORA_INTERES";

type AllocationRow = {
	link_type: PagaloLinkType;
	numero_cuota: number | null;
	rubro: string;
	amount: string;
};

export type LinkResumen = {
	id: string;
	status: string;
	generation: number;
};

export type CuotaConLinks = {
	/** null representa el grupo sintético "Mora" (filas sin numero_cuota). */
	numeroCuota: number | null;
	rubros: Array<{ rubro: string; amount: string }>;
	linkTypes: PagaloLinkType[];
	/** Links vivos (CREATING/ACTIVE) de los tipos que cubren esta cuota. */
	linksVivos: LinkResumen[];
	/** Links históricos (REPLACED/EXPIRED/CANCELLED/ERROR) — para el conteo de duplicados. */
	linksHistoricos: LinkResumen[];
};

const LINK_TYPES: readonly PagaloLinkType[] = ["CAPITAL", "MORA_INTERES"];
const ESTADOS_VIVOS = new Set(["CREATING", "ACTIVE"]);
// linksHistoricos es específicamente para contar DUPLICADOS (generaciones
// previas superadas) — un catch-all "todo lo que no es vivo" clasificaba
// también PAID ahí, así que un grupo normal pagado sin ninguna regeneración
// mostraba "(1 link(s) previo(s))" en cada cuota, insinuando un duplicado
// que nunca existió (hallazgo de code review). PAID no cuenta para ningún
// lado: no es un duplicado cerrado sin pago, tampoco está pendiente.
const ESTADOS_HISTORICOS = new Set([
	"REPLACED",
	"EXPIRED",
	"CANCELLED",
	"ERROR",
]);

function esAllocationRow(row: unknown): row is AllocationRow {
	if (!row || typeof row !== "object") return false;
	const r = row as Record<string, unknown>;
	if (!LINK_TYPES.includes(r.link_type as PagaloLinkType)) return false;
	if (typeof r.rubro !== "string") return false;
	if (typeof r.amount !== "string") return false;
	if (r.numero_cuota !== null && typeof r.numero_cuota !== "number")
		return false;
	return true;
}

/**
 * `numero_cuota: null` de una fila real (mora pura, sin cuota asociada) cae
 * en el grupo sintético "Mora" — clave interna -1, nunca choca con un
 * numeroCuota real (siempre >= 1).
 */
const CLAVE_MORA = -1;

export function agruparPorCuota(
	snapshot: unknown,
	links: Array<{
		id: string;
		linkType: PagaloLinkType;
		status: string;
		generation: number;
	}>,
): CuotaConLinks[] {
	const filas = Array.isArray(snapshot) ? snapshot.filter(esAllocationRow) : [];

	const porCuota = new Map<
		number,
		{
			numeroCuota: number | null;
			rubros: Map<string, number>;
			linkTypes: Set<PagaloLinkType>;
		}
	>();

	for (const fila of filas) {
		const clave = fila.numero_cuota ?? CLAVE_MORA;
		let entrada = porCuota.get(clave);
		if (!entrada) {
			entrada = {
				numeroCuota: fila.numero_cuota,
				rubros: new Map(),
				linkTypes: new Set(),
			};
			porCuota.set(clave, entrada);
		}
		const monto = Number(fila.amount);
		entrada.rubros.set(
			fila.rubro,
			(entrada.rubros.get(fila.rubro) ?? 0) +
				(Number.isFinite(monto) ? monto : 0),
		);
		entrada.linkTypes.add(fila.link_type);
	}

	const linksPorTipo = new Map<PagaloLinkType, typeof links>();
	for (const link of links) {
		const lista = linksPorTipo.get(link.linkType) ?? [];
		lista.push(link);
		linksPorTipo.set(link.linkType, lista);
	}

	return [...porCuota.values()]
		.sort(
			(a, b) =>
				(a.numeroCuota ?? Number.POSITIVE_INFINITY) -
				(b.numeroCuota ?? Number.POSITIVE_INFINITY),
		)
		.map((entrada) => {
			const linkTypes = [...entrada.linkTypes];
			const linksDeLosTipos = linkTypes.flatMap(
				(tipo) => linksPorTipo.get(tipo) ?? [],
			);
			return {
				numeroCuota: entrada.numeroCuota,
				rubros: [...entrada.rubros.entries()].map(([rubro, amount]) => ({
					rubro,
					amount: amount.toFixed(2),
				})),
				linkTypes,
				linksVivos: linksDeLosTipos
					.filter((l) => ESTADOS_VIVOS.has(l.status))
					.map((l) => ({
						id: l.id,
						status: l.status,
						generation: l.generation,
					})),
				linksHistoricos: linksDeLosTipos
					.filter((l) => ESTADOS_HISTORICOS.has(l.status))
					.map((l) => ({
						id: l.id,
						status: l.status,
						generation: l.generation,
					})),
			};
		});
}
