import { MapPin } from "lucide-react";
import type { ReactNode } from "react";
import { GpsMapaPreview } from "@/components/cobros/gps-mapa-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	ESTADO_SENAL_CONFIG,
	formatCoordenadas,
	formatFechaSenal,
	formatIgnicion,
	formatVelocidad,
	googleMapsUrl,
	resolveEstadoSenal,
} from "@/routes/cobros/-gps-ficha";
import type { client } from "@/utils/orpc";

type GpsVehiculoOutput = Awaited<ReturnType<typeof client.getGpsVehiculo>>;
type GpsTelemetria = Extract<
	GpsVehiculoOutput,
	{ estado: "vinculado" }
>["telemetria"];

export function Dato({
	label,
	value,
	hint,
}: {
	label: string;
	value: string;
	hint?: string;
}) {
	return (
		<div>
			<p className="text-muted-foreground text-sm">{label}</p>
			<p className="font-medium">{value}</p>
			{hint && hint !== "—" && (
				<p className="text-muted-foreground text-xs">{hint}</p>
			)}
		</div>
	);
}

/**
 * Datos que devolvió Wialon para una unidad: estado de señal, ignición,
 * telemetría, mapa y enlace a Google Maps. Solo lectura: la usan la consulta
 * en vivo y el historial de consultas anteriores.
 *
 * `consultadaAt` es el momento de la consulta. En vivo es "ahora"; en el
 * historial es la fecha de esa consulta, para que el badge de señal ("Señal
 * con retraso") y el aviso de "sin posición nueva" se midan contra cuando se
 * consultó y no contra hoy. Las fechas de última conexión y posición se
 * muestran absolutas, así que no dependen de este valor.
 */
export function DatosTelemetria({
	telemetria,
	unitName,
	acciones,
	consultadaAt,
}: {
	telemetria: GpsTelemetria;
	unitName: string;
	// Botones extra de la consulta en vivo (enlace de rastreo).
	acciones?: ReactNode;
	consultadaAt?: Date;
}) {
	const ahora = consultadaAt ?? new Date();
	const ignicion = formatIgnicion(telemetria.isIgnitionOn);
	const IgnicionIcon = ignicion.icon;
	// La frescura que se muestra es la de la UBICACIÓN (pos.t), no la del
	// último mensaje: un equipo puede seguir reportando sin fix de GPS y las
	// coordenadas quedarse viejas. Marcarlas "reciente" mandaría a un gestor
	// a un lugar desactualizado.
	const estadoSenal = resolveEstadoSenal(telemetria.ultimaPosicionAt, ahora);
	const sinFixReciente =
		resolveEstadoSenal(telemetria.ultimaSenalAt, ahora) === "fresca" &&
		estadoSenal !== "fresca";
	const configSenal = ESTADO_SENAL_CONFIG[estadoSenal];
	const mapsUrl = googleMapsUrl(telemetria.latitude, telemetria.longitude);

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-2">
				<Badge className={configSenal.badgeClass} variant="secondary">
					{configSenal.label}
				</Badge>
				<span className="flex items-center gap-1.5 font-medium text-sm">
					<IgnicionIcon className={`h-4 w-4 ${ignicion.className}`} />
					<span className={ignicion.className}>{ignicion.label}</span>
				</span>
			</div>
			{sinFixReciente && (
				<p className="text-amber-700 text-xs dark:text-amber-400">
					El GPS sigue reportando, pero sin posición nueva: la ubicación es de{" "}
					{formatFechaSenal(telemetria.ultimaPosicionAt)}.
				</p>
			)}

			<div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
				<Dato
					label="Última conexión"
					value={formatFechaSenal(telemetria.ultimaSenalAt)}
				/>
				<Dato label="Velocidad" value={formatVelocidad(telemetria.speedKmh)} />
				<Dato
					label="Ubicación"
					value={formatCoordenadas(telemetria.latitude, telemetria.longitude)}
					hint={
						telemetria.ultimaPosicionAt
							? `Posición del ${formatFechaSenal(telemetria.ultimaPosicionAt)}`
							: "Sin fecha de posición"
					}
				/>
				<Dato
					label="Odómetro"
					value={
						telemetria.mileageFormatted ||
						(telemetria.mileageKm != null
							? `${Math.round(telemetria.mileageKm).toLocaleString("es-GT")} km`
							: "—")
					}
				/>
				<Dato
					label="Horas de motor"
					value={
						telemetria.engineHoursFormatted ||
						(telemetria.engineHours != null
							? `${Math.round(telemetria.engineHours).toLocaleString("es-GT")} h`
							: "—")
					}
				/>
				<Dato label="Unidad GPS" value={unitName} />
			</div>

			<GpsMapaPreview
				latitude={telemetria.latitude}
				longitude={telemetria.longitude}
			/>

			<div className="flex flex-wrap gap-2">
				{mapsUrl && (
					<Button asChild size="sm" variant="outline">
						<a href={mapsUrl} rel="noopener noreferrer" target="_blank">
							<MapPin className="mr-2 h-4 w-4" />
							Abrir en Google Maps
						</a>
					</Button>
				)}
				{acciones}
			</div>
		</div>
	);
}
