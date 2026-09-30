import { googleMapsEmbedUrl } from "@/routes/cobros/-gps-ficha";

/**
 * Previsualización de la posición de la unidad. No pinta nada sin coordenadas
 * válidas. Se monta solo después de confirmar el motivo de consulta, así que
 * no expone la ubicación antes de auditar.
 */
export function GpsMapaPreview({
	latitude,
	longitude,
	className = "h-56",
}: {
	latitude: number | undefined;
	longitude: number | undefined;
	/** Alto del mapa; el ancho y el borde son siempre los mismos. */
	className?: string;
}) {
	const src = googleMapsEmbedUrl(latitude, longitude);
	if (!src) return null;

	return (
		<iframe
			className={`${className} w-full rounded-md border`}
			loading="lazy"
			referrerPolicy="no-referrer-when-downgrade"
			src={src}
			title="Ubicación de la unidad en el mapa"
		/>
	);
}
