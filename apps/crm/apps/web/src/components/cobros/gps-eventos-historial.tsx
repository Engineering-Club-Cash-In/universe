import { useQuery } from "@tanstack/react-query";
import {
	BatteryWarning,
	History,
	MapPinOff,
	Power,
	SatelliteDish,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { formatFechaSenal, googleMapsUrl } from "@/routes/cobros/-gps-ficha";
import { orpc } from "@/utils/orpc";

type GpsEventoTipo =
	| "desconexion_energia"
	| "ignicion"
	| "sin_reportar"
	| "salida_geocerca";

const EVENTO_CONFIG: Record<
	GpsEventoTipo,
	{ label: string; icon: typeof BatteryWarning; badgeClass: string }
> = {
	desconexion_energia: {
		label: "Desconexión de energía",
		icon: BatteryWarning,
		badgeClass: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
	},
	ignicion: {
		label: "Ignición",
		icon: Power,
		badgeClass:
			"bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
	},
	sin_reportar: {
		label: "Sin reportar",
		icon: SatelliteDish,
		badgeClass:
			"bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
	},
	salida_geocerca: {
		label: "Salida de Guatemala",
		icon: MapPinOff,
		badgeClass: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
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
 * desconexión de energía, ignición, sin reportar y salida de Guatemala,
 * detectados por el job de polling para créditos en B4.
 *
 * A diferencia de GpsVehiculoCard (CB-118), esto NO consulta Wialon en vivo
 * ni exige motivo auditado — lee eventos ya guardados en gps_eventos, y el
 * acceso lo controla el mismo assertAccesoCasoCobro del resto de la ficha.
 * Por eso puede tener refetch normal (staleTime por defecto), sin el gate de
 * auditoría de la tarjeta de telemetría.
 */
export function GpsEventosHistorial({ casoCobroId }: { casoCobroId: string }) {
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
		return null;
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<History className="h-5 w-5" />
					Historial de eventos GPS
				</CardTitle>
				<CardDescription>
					Eventos detectados automáticamente (desconexión de energía, ignición,
					GPS sin reportar, salida de Guatemala) para créditos en B4.
				</CardDescription>
			</CardHeader>
			<CardContent>
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
							return (
								<li
									className="flex items-center justify-between gap-3 rounded-md border p-3"
									key={evento.id}
								>
									<div className="flex items-center gap-3">
										<Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
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
										</div>
									</div>
									{mapsUrl && (
										<a
											className="shrink-0 text-primary text-xs hover:underline"
											href={mapsUrl}
											rel="noreferrer"
											target="_blank"
										>
											Ver en mapa
										</a>
									)}
								</li>
							);
						})}
					</ul>
				)}
			</CardContent>
		</Card>
	);
}
