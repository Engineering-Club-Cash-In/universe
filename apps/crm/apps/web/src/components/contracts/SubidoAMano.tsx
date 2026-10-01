import { Eye, Hand } from "lucide-react";
import { fueSubidoAMano } from "server/src/lib/contrato-subido-a-mano";
import { Badge } from "@/components/ui/badge";

/**
 * Etiqueta de un contrato que jurídico subió a mano. No muestra nada para uno
 * generado desde la plantilla.
 */
export function EtiquetaSubidoAMano({
	apiResponse,
}: {
	apiResponse?: unknown;
}) {
	if (!fueSubidoAMano(apiResponse)) return null;
	return (
		<Badge
			variant="outline"
			className="gap-1 border-sky-500/40 bg-sky-500/10 text-sky-700 text-xs dark:text-sky-400"
		>
			<Hand className="h-3 w-3" />
			Subido a mano
		</Badge>
	);
}

/**
 * Pide mirar dónde quedaron las firmas de un contrato subido a mano.
 *
 * Sólo pide mirar, sin explicar por qué: la etiqueta "Subido a mano" ya dice
 * que el documento no salió de la plantilla, y repetirlo sonaba a que el
 * sistema no las ubica bien.
 *
 * Quien lo usa lo muestra sólo mientras falta firmar: después ya no hay nada
 * que corregir. Manda a "Seguimiento" (el enlace de observador) porque es el
 * único que muestra el documento sin quedar firmando en nombre de nadie.
 */
export function RevisarSubidoAMano({
	apiResponse,
	observerUrl,
}: {
	apiResponse?: unknown;
	observerUrl?: string | null;
}) {
	if (!fueSubidoAMano(apiResponse)) return null;
	return (
		<div className="flex items-start justify-between gap-2 rounded-md border border-sky-500/30 bg-sky-500/5 p-2 text-sky-800 text-xs dark:text-sky-300">
			<p>
				Dale un vistazo para confirmar que cada firma quedó en la línea de quien
				le toca.
			</p>
			{observerUrl && (
				<a
					href={observerUrl}
					target="_blank"
					rel="noopener noreferrer"
					className="flex shrink-0 items-center gap-1 font-medium underline-offset-2 hover:underline"
					title="Ver el documento y cómo va la firma (no permite firmar)"
				>
					<Eye className="h-3 w-3" />
					Revisar
				</a>
			)}
		</div>
	);
}
