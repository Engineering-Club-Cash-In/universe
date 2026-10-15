import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/utils/orpc";
import {
	AlertaSinVerificar,
	ReferenciasPorParticipante,
} from "./AlertaReferenciasRepetidas";

/** Cinco minutos: la pantalla de análisis no repite la búsqueda en cada foco de ventana. */
const CINCO_MINUTOS = 5 * 60 * 1000;

/**
 * Para la pantalla de análisis, junto al buró interno: las referencias de las
 * solicitudes que ya figuran en otro cliente, con el detalle o el aviso que el
 * servidor mande según quién consulta. Informativo, no bloquea. Sin
 * coincidencias, sin permiso o mientras carga no muestra nada; si no se pudo
 * verificar, lo dice, y la pantalla sigue.
 */
export function ReferenciasRepetidasAnalisis({
	opportunityId,
}: {
	opportunityId: string;
}) {
	const { data, isError } = useQuery({
		...orpc.getReferenciasRepetidas.queryOptions({ input: { opportunityId } }),
		staleTime: CINCO_MINUTOS,
	});
	if (isError || data?.error) return <AlertaSinVerificar />;
	if (!data || data.participantes.length === 0) return null;

	return (
		<div className="space-y-3">
			<ReferenciasPorParticipante participantes={data.participantes} />
		</div>
	);
}
