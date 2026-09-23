import { Layers } from "lucide-react";
import {
	cartasDelPaquete,
	PAQUETE_CARTAS,
} from "server/src/lib/paquete-cartas";

/**
 * Qué cartas trae un paquete, debajo de su nombre.
 *
 * El paquete se ve como un solo contrato ("Cartas"), y sin esto no habría forma
 * de saber desde la ficha cuáles quedaron adentro: si se generó con cinco o con
 * siete, o si le falta la de GPS. No muestra nada para un contrato común.
 */
export function CartasDelPaquete({
	contractType,
	apiResponse,
}: {
	contractType: string;
	apiResponse?: unknown;
}) {
	if (contractType !== PAQUETE_CARTAS) return null;
	const cartas = cartasDelPaquete(apiResponse);
	if (cartas.length === 0) return null;

	return (
		<div className="mt-1 flex items-start gap-1 text-muted-foreground text-xs">
			<Layers className="mt-0.5 h-3 w-3 shrink-0" />
			<span>
				{cartas.length} carta(s) en un solo documento:{" "}
				{cartas.map((c: { label: string }) => c.label).join(" · ")}
			</span>
		</div>
	);
}
