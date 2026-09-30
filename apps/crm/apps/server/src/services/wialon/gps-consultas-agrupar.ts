/**
 * Agrupa, SOLO PARA MOSTRAR, las consultas de telemetría que devolvieron la
 * misma ubicación. `gps_consulta_logs` es la auditoría de CB-118 (una fila por
 * consulta, con su usuario y motivo) y no se toca: el historial de la ficha
 * junta las repetidas en una entrada, que lleva los datos de la consulta más
 * reciente y la lista de todas las que contiene.
 *
 * Recibe las filas de la más nueva a la más vieja. Solo se agrupan consultas
 * de telemetría que tengan coordenadas en su snapshot; las demás (ubicaciones
 * clave, sin unidad, Wialon caído) van como entradas propias y no rompen el
 * grupo en curso: en B4 cada clic deja una fila de telemetría y otra de
 * ubicaciones clave intercaladas, y no por eso la ubicación dejó de repetirse.
 * Una ubicación distinta abre un grupo nuevo.
 */
export type FilaConsultaGps = {
	id: string;
	motivo: string;
	origen: string | null;
	unitName: string | null;
	userNombre: string | null;
	createdAt: Date;
	snapshot: unknown;
};

export type ConsultaDelGrupo = Pick<
	FilaConsultaGps,
	"id" | "motivo" | "userNombre" | "createdAt"
>;

export type EntradaConsultaGps = FilaConsultaGps & {
	/** Todas las consultas de la entrada, la más reciente primero (incluye la propia). */
	consultas: ConsultaDelGrupo[];
};

function coordenadas(
	fila: FilaConsultaGps,
): { lat: number; lon: number } | null {
	if (fila.origen !== "telemetria") return null;
	const tel = (fila.snapshot as { telemetria?: Record<string, unknown> } | null)
		?.telemetria;
	const lat = tel?.latitude;
	const lon = tel?.longitude;
	return typeof lat === "number" &&
		typeof lon === "number" &&
		Number.isFinite(lat) &&
		Number.isFinite(lon)
		? { lat, lon }
		: null;
}

export function agruparConsultasGps(
	filas: FilaConsultaGps[],
): EntradaConsultaGps[] {
	const entradas: EntradaConsultaGps[] = [];
	let grupoActual: {
		entrada: EntradaConsultaGps;
		lat: number;
		lon: number;
	} | null = null;

	for (const fila of filas) {
		const miembro: ConsultaDelGrupo = {
			id: fila.id,
			motivo: fila.motivo,
			userNombre: fila.userNombre,
			createdAt: fila.createdAt,
		};
		const coord = coordenadas(fila);

		if (
			coord &&
			grupoActual &&
			grupoActual.lat === coord.lat &&
			grupoActual.lon === coord.lon
		) {
			grupoActual.entrada.consultas.push(miembro);
			continue;
		}

		const entrada: EntradaConsultaGps = { ...fila, consultas: [miembro] };
		entradas.push(entrada);
		if (coord) grupoActual = { entrada, lat: coord.lat, lon: coord.lon };
	}

	return entradas;
}
