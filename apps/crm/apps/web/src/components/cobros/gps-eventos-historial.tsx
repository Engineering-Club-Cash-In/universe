import { useQuery } from "@tanstack/react-query";
import {
	BatteryWarning,
	History,
	Map as MapIcon,
	Power,
	SatelliteDish,
} from "lucide-react";
import { useState } from "react";
import { GpsMapaPreview } from "@/components/cobros/gps-mapa-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { formatFechaSenal, googleMapsUrl } from "@/routes/cobros/-gps-ficha";
import { orpc } from "@/utils/orpc";

const DESCRIPCION_EVENTOS =
	"Eventos detectados automáticamente. Desconexión de energía en todos los buckets; ignición y GPS sin reportar solo para créditos en B4.";

type GpsEventoTipo = "desconexion_energia" | "ignicion" | "sin_reportar";

const EVENTO_CONFIG: Record<
	GpsEventoTipo,
	{
		label: string;
		descripcion?: string;
		icon: typeof BatteryWarning;
		badgeClass: string;
	}
> = {
	desconexion_energia: {
		label: "Desconexión de energía",
		descripcion:
			"El GPS dejó de recibir corriente del vehículo (voltaje externo bajo 3 V). Es posible que se haya desconectado el equipo.",
		icon: BatteryWarning,
		badgeClass: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
	},
	ignicion: {
		label: "Ignición",
		descripcion: "El vehículo se encendió (estaba apagado).",
		icon: Power,
		badgeClass:
			"bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
	},
	sin_reportar: {
		label: "Sin reportar",
		descripcion:
			"El GPS lleva más de 2 horas sin enviar señal. Puede estar sin cobertura, apagado o manipulado.",
		icon: SatelliteDish,
		badgeClass:
			"bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
	},
};

// Fallback defensivo: si el enum de BD gana un tipo nuevo antes de que este
// componente se actualice, `EVENTO_CONFIG[tipo]` sería `undefined` y
// `config.icon` tumbaría el render de la Ficha 360 entera, no solo esta
// tarjeta. Con esto, un tipo desconocido se muestra genérico en vez de crashear.
const EVENTO_CONFIG_FALLBACK = {
	label: "Evento GPS",
	icon: History,
	badgeClass: "bg-muted text-muted-foreground",
};

/**
 * Historial de eventos GPS (CB-119) en el tab Vehículo de la Ficha 360:
 * desconexión de energía (todos los buckets), ignición y sin reportar (solo
 * B4), detectados por el job de polling.
 *
 * A diferencia de GpsVehiculoCard (CB-118), esto NO consulta Wialon en vivo
 * ni exige motivo auditado — lee eventos ya guardados en gps_eventos, y el
 * acceso lo controla el mismo assertAccesoCasoCobro del resto de la ficha.
 * Por eso puede tener refetch normal (staleTime por defecto), sin el gate de
 * auditoría de la tarjeta de telemetría.
 */
export function GpsEventosHistorial({
	casoCobroId,
	embedded = false,
}: {
	casoCobroId: string;
	// Dentro de una pestaña de VehiculoGpsTabs: sin marco de tarjeta ni título,
	// y con aviso de vacío en vez de desaparecer (la pestaña ya existe).
	embedded?: boolean;
}) {
	// Un solo mapa abierto a la vez; el iframe se monta recién al abrirlo.
	const [mapaAbiertoId, setMapaAbiertoId] = useState<string | null>(null);
	const eventos = useQuery({
		...orpc.getGpsEventosCaso.queryOptions({
			input: { casoCobroId, limit: 20 },
		}),
	});

	// Silencioso si no hay eventos: la mayoría de casos nunca tendrá uno, y
	// una tarjeta vacía todo el tiempo sería ruido en la ficha. Solo aparece
	// cuando hay algo que mostrar (o mientras carga o falla la consulta —
	// !isError es a propósito: sin él, un fallo real de red/servidor deja
	// isLoading en false y data en undefined, y la tarjeta desaparecía en
	// silencio en vez de mostrar el aviso de error de abajo).
	if (
		!eventos.isLoading &&
		!eventos.isError &&
		(eventos.data?.length ?? 0) === 0
	) {
		if (!embedded) return null;
		// Embebido conserva la misma estructura que con datos o cargando, para
		// que la descripción no desaparezca de golpe al terminar de cargar.
		return (
			<div>
				<p className="mb-3 text-muted-foreground text-sm">
					{DESCRIPCION_EVENTOS}
				</p>
				<p className="text-muted-foreground text-sm">
					Este crédito no tiene notificaciones GPS.
				</p>
			</div>
		);
	}

	const Raiz = embedded ? "div" : Card;
	const Cabecera = embedded ? "div" : CardHeader;
	const Cuerpo = embedded ? "div" : CardContent;
	const Descripcion = embedded ? "p" : CardDescription;

	return (
		<Raiz>
			<Cabecera className={embedded ? "mb-3 space-y-1" : undefined}>
				{!embedded && (
					<CardTitle className="flex items-center gap-2">
						<History className="h-5 w-5" />
						Historial de eventos GPS
					</CardTitle>
				)}
				<Descripcion
					className={embedded ? "text-muted-foreground text-sm" : undefined}
				>
					{DESCRIPCION_EVENTOS}
				</Descripcion>
			</Cabecera>
			<Cuerpo>
				{eventos.isLoading && (
					<p className="text-muted-foreground text-sm">Cargando...</p>
				)}
				{eventos.isError && (
					<p className="text-destructive text-sm">
						No se pudo cargar el historial de eventos GPS.
					</p>
				)}
				{eventos.data && eventos.data.length > 0 && (
					<ul className="space-y-2">
						{eventos.data.map((evento) => {
							const config =
								EVENTO_CONFIG[evento.tipo as GpsEventoTipo] ??
								EVENTO_CONFIG_FALLBACK;
							const Icon = config.icon;
							const mapsUrl = googleMapsUrl(
								evento.lat ?? undefined,
								evento.lon ?? undefined,
							);
							const mapaAbierto = mapaAbiertoId === evento.id;
							return (
								<li className="rounded-md border p-3" key={evento.id}>
									<div className="flex items-start justify-between gap-3">
										<div className="flex items-start gap-3">
											<Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
											<div>
												<div className="flex items-center gap-2">
													<Badge
														className={config.badgeClass}
														variant="secondary"
													>
														{config.label}
													</Badge>
													{evento.notificado && (
														<span className="text-muted-foreground text-xs">
															Notificado
														</span>
													)}
												</div>
												<p className="mt-1 text-muted-foreground text-xs">
													{formatFechaSenal(evento.ocurridoAt)}
												</p>
												{config.descripcion && (
													<p className="text-muted-foreground text-xs">
														{config.descripcion}
													</p>
												)}
											</div>
										</div>
										{mapsUrl && (
											<Button
												aria-expanded={mapaAbierto}
												className="shrink-0"
												onClick={() =>
													setMapaAbiertoId(mapaAbierto ? null : evento.id)
												}
												size="sm"
												type="button"
												variant="outline"
											>
												<MapIcon className="mr-1.5 h-3.5 w-3.5" />
												{mapaAbierto ? "Ocultar mapa" : "Ver mapa"}
											</Button>
										)}
									</div>
									{mapaAbierto && mapsUrl && (
										<div className="mt-3 space-y-1.5">
											<GpsMapaPreview
												latitude={evento.lat ?? undefined}
												longitude={evento.lon ?? undefined}
											/>
											<a
												className="text-primary text-xs hover:underline"
												href={mapsUrl}
												rel="noreferrer"
												target="_blank"
											>
												Abrir en Google Maps
											</a>
										</div>
									)}
								</li>
							);
						})}
					</ul>
				)}
			</Cuerpo>
		</Raiz>
	);
}
