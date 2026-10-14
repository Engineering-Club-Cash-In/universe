import { Hand } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { googleMapsEmbedUrl } from "@/routes/cobros/-gps-ficha";

/**
 * Previsualización de la posición de la unidad. No pinta nada sin coordenadas
 * válidas. Se monta solo después de confirmar el motivo de consulta (o desde
 * una consulta ya registrada), así que no expone la ubicación antes de auditar.
 *
 * El mapa arranca «quieto»: una capa transparente encima recibe la rueda del
 * mouse, así que desplazar la ficha pasa de largo sin que Google tape el mapa
 * con «Utiliza la tecla Ctrl junto con la rueda…» (el embed sin API key no
 * acepta `gestureHandling`). Un clic sobre el mapa lo activa para moverlo y
 * hacer zoom; al salir con el mouse vuelve a quedar quieto.
 */
export function GpsMapaPreview({
	latitude,
	longitude,
	className = "h-56",
}: {
	latitude: number | undefined;
	longitude: number | undefined;
	/** Alto del mapa (y su lugar en un flex); el borde y el radio son siempre los mismos. */
	className?: string;
}) {
	const [activo, setActivo] = useState(false);
	const src = googleMapsEmbedUrl(latitude, longitude);
	if (!src) return null;

	return (
		<div
			className={cn(
				"group/mapa relative w-full overflow-hidden rounded-xl border border-line-subtle bg-muted",
				className,
			)}
		>
			<iframe
				className="absolute inset-0 size-full"
				loading="lazy"
				// Al salir con el mouse, el mapa vuelve a quedar quieto.
				onMouseLeave={() => setActivo(false)}
				referrerPolicy="no-referrer"
				src={src}
				title="Ubicación de la unidad en el mapa"
			/>
			{activo ? null : (
				<button
					aria-label="Activar el mapa para moverlo y hacer zoom"
					className="absolute inset-0 flex cursor-pointer items-end justify-start p-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
					onClick={() => setActivo(true)}
					type="button"
				>
					<span className="inline-flex items-center gap-1.5 rounded-full bg-surface/95 px-2.5 py-1 font-medium text-[11px] text-fg-secondary opacity-0 shadow-tooltip transition-opacity duration-150 group-focus-within/mapa:opacity-100 group-hover/mapa:opacity-100">
						<Hand aria-hidden className="size-3" />
						Haga clic para mover el mapa
					</span>
				</button>
			)}
		</div>
	);
}
