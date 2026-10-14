import { CircleHelp, MapPin, Power, PowerOff } from "lucide-react";
import type { ReactNode } from "react";
import { GpsMapaPreview } from "@/components/cobros/gps-mapa-preview";
import { fechaCortaGps } from "@/components/cobros/ubicaciones/panel";
import { CrmPill, type CrmTone } from "@/components/ds/cards-credito";
import { GpsEstadoVehiculo, MapView } from "@/components/ds/ubicaciones";
import { Button } from "@/components/ui/button";
import {
	ESTADO_SENAL_CONFIG,
	type EstadoSenal,
	formatCoordenadas,
	formatFechaSenal,
	formatUltimaSenal,
	formatVelocidad,
	googleMapsEmbedUrl,
	googleMapsUrl,
	resolveEstadoSenal,
} from "@/routes/cobros/-gps-ficha";
import type { client } from "@/utils/orpc";

type GpsVehiculoOutput = Awaited<ReturnType<typeof client.getGpsVehiculo>>;
export type GpsTelemetria = Extract<
	GpsVehiculoOutput,
	{ estado: "vinculado" }
>["telemetria"];

const TONO_SENAL: Record<EstadoSenal, CrmTone> = {
	fresca: "success",
	tibia: "warning",
	vieja: "danger",
	sin_datos: "neutral",
};

function Ignicion({ encendido }: { encendido: boolean | undefined }) {
	// `undefined` = la unidad no reporta un sensor de ignición reconocible:
	// pintarlo como «apagado» sería afirmar algo que nadie midió.
	const [Icono, texto, clase] =
		encendido === true
			? [Power, "Motor encendido", "text-success-text"]
			: encendido === false
				? [PowerOff, "Motor apagado", "text-fg-secondary"]
				: [CircleHelp, "Ignición sin dato", "text-fg-tertiary"];
	return (
		<span
			className={`inline-flex items-center gap-1.5 font-medium text-xs ${clase}`}
		>
			<Icono aria-hidden className="size-3.5" />
			{texto}
		</span>
	);
}

function Fila({
	label,
	children,
	hint,
}: {
	label: string;
	children: ReactNode;
	hint?: string;
}) {
	return (
		<div className="flex items-baseline justify-between gap-3 py-1.5">
			<dt className="shrink-0 text-fg-tertiary text-xs">{label}</dt>
			<dd className="min-w-0 text-right">
				<span className="wrap-break-word font-medium text-[13px] text-fg">
					{children}
				</span>
				{hint ? (
					<span className="block text-[11px] text-fg-tertiary">{hint}</span>
				) : null}
			</dd>
		</div>
	);
}

/**
 * Lo que devolvió Wialon para una unidad, de un vistazo: el mapa a la
 * izquierda y, a la derecha, de cuándo es la posición, si está detenido o en
 * movimiento, la señal y el resto de la telemetría. Solo lectura: lo usan la
 * consulta en vivo y las consultas anteriores.
 *
 * `consultadaAt` es el momento de la consulta. En vivo es «ahora»; en una
 * consulta anterior es su fecha, para que «Señal con retraso» y el aviso de
 * «sin posición nueva» se midan contra cuando se consultó. La antigüedad
 * grande («hace 2 días») sí se mide contra hoy: es lo que el asesor necesita
 * saber antes de ir a buscar el vehículo.
 */
export function DatosTelemetria({
	telemetria,
	unitName,
	acciones,
	consultadaAt,
	mapa,
}: {
	telemetria: GpsTelemetria;
	unitName: string;
	// Botones extra de la consulta en vivo (enlace de rastreo).
	acciones?: ReactNode;
	consultadaAt?: Date;
	/** Reemplaza el mapa real (catálogo del design system, sin Google). */
	mapa?: ReactNode;
}) {
	const momento = consultadaAt ?? new Date();
	// La frescura que se muestra es la de la UBICACIÓN (pos.t), no la del
	// último mensaje: un equipo puede seguir reportando sin fix de GPS y las
	// coordenadas quedarse viejas. Marcarlas «reciente» mandaría a un gestor
	// a un lugar desactualizado.
	const estadoSenal = resolveEstadoSenal(telemetria.ultimaPosicionAt, momento);
	const sinFixReciente =
		resolveEstadoSenal(telemetria.ultimaSenalAt, momento) === "fresca" &&
		estadoSenal !== "fresca";
	const mapsUrl = googleMapsUrl(telemetria.latitude, telemetria.longitude);
	const conPosicion =
		googleMapsEmbedUrl(telemetria.latitude, telemetria.longitude) != null;
	const velocidad = telemetria.speedKmh;
	const movimiento =
		velocidad == null || !Number.isFinite(velocidad)
			? null
			: velocidad > 0
				? "en-movimiento"
				: "detenido";

	return (
		<div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
			{/* En pantalla ancha el mapa ocupa todo el alto de la columna de datos. */}
			<div className="flex min-w-0 flex-col">
				{mapa ??
					(conPosicion ? (
						<GpsMapaPreview
							className="h-52 sm:h-64 lg:h-auto lg:min-h-64 lg:flex-1"
							latitude={telemetria.latitude}
							longitude={telemetria.longitude}
						/>
					) : (
						<MapView
							className="h-52 w-full sm:h-64 lg:h-auto lg:min-h-64 lg:flex-1"
							etiqueta="El GPS no reportó una posición válida"
							pins={[]}
						/>
					))}
			</div>

			<div className="flex min-w-0 flex-col gap-3">
				<div className="flex flex-col gap-0.5">
					<span className="text-[11px] text-fg-tertiary">
						Posición del vehículo
					</span>
					<span className="font-bold text-fg text-xl leading-[1.26]">
						{telemetria.ultimaPosicionAt
							? fechaCortaGps(telemetria.ultimaPosicionAt)
							: "Sin fecha de posición"}
					</span>
					{telemetria.ultimaPosicionAt ? (
						<span className="text-fg-secondary text-xs">
							{formatUltimaSenal(telemetria.ultimaPosicionAt)}
						</span>
					) : null}
				</div>

				<div className="flex flex-wrap items-center gap-2">
					{movimiento ? (
						<GpsEstadoVehiculo className="py-1 text-xs" estado={movimiento} />
					) : null}
					<CrmPill
						kind="chip"
						tone={TONO_SENAL[estadoSenal]}
						title={
							consultadaAt
								? "Antigüedad de la posición al momento de la consulta"
								: undefined
						}
					>
						{ESTADO_SENAL_CONFIG[estadoSenal].label}
					</CrmPill>
					<Ignicion encendido={telemetria.isIgnitionOn} />
				</div>

				{sinFixReciente ? (
					<p className="text-warning-text text-xs">
						El GPS sigue reportando, pero sin posición nueva: la ubicación es de{" "}
						{formatFechaSenal(telemetria.ultimaPosicionAt)}.
					</p>
				) : null}

				<dl className="divide-y divide-line-subtle border-line-subtle border-y">
					<Fila label="Coordenadas">
						{formatCoordenadas(telemetria.latitude, telemetria.longitude)}
					</Fila>
					<Fila label="Velocidad">{formatVelocidad(velocidad)}</Fila>
					<Fila label="Última conexión">
						{formatFechaSenal(telemetria.ultimaSenalAt)}
					</Fila>
					<Fila label="Odómetro">
						{telemetria.mileageFormatted ||
							(telemetria.mileageKm != null
								? `${Math.round(telemetria.mileageKm).toLocaleString("es-GT")} km`
								: "—")}
					</Fila>
					<Fila label="Horas de motor">
						{telemetria.engineHoursFormatted ||
							(telemetria.engineHours != null
								? `${Math.round(telemetria.engineHours).toLocaleString("es-GT")} h`
								: "—")}
					</Fila>
					<Fila label="Unidad GPS">{unitName}</Fila>
				</dl>

				{mapsUrl || acciones ? (
					<div className="flex flex-wrap gap-2">
						{mapsUrl ? (
							<Button asChild size="sm" variant="outline">
								<a href={mapsUrl} rel="noopener noreferrer" target="_blank">
									<MapPin aria-hidden />
									Abrir en Google Maps
								</a>
							</Button>
						) : null}
						{acciones}
					</div>
				) : null}
			</div>
		</div>
	);
}
