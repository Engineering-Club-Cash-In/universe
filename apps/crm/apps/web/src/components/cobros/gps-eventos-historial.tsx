import { useQuery } from "@tanstack/react-query";
import {
	BatteryWarning,
	BellOff,
	History,
	Map as MapIcon,
	Power,
	SatelliteDish,
} from "lucide-react";
import { useState } from "react";
import { GpsMapaPreview } from "@/components/cobros/gps-mapa-preview";
import {
	PanelCargando,
	PanelEncabezado,
	PanelError,
	PanelVacio,
} from "@/components/cobros/ubicaciones/panel";
import { CrmCard, CrmPill } from "@/components/ds/cards-credito";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatFechaSenal, googleMapsUrl } from "@/routes/cobros/-gps-ficha";
import { type client, orpc } from "@/utils/orpc";

const DESCRIPCION_EVENTOS =
	"Eventos detectados automáticamente. Desconexión de energía en todos los buckets; ignición y GPS sin reportar solo para créditos en B4.";

export type EventoGps = Awaited<
	ReturnType<typeof client.getGpsEventosCaso>
>[number];

type GpsEventoTipo = "desconexion_energia" | "ignicion" | "sin_reportar";

const EVENTO_CONFIG: Record<
	GpsEventoTipo,
	{
		label: string;
		descripcion?: string;
		icon: typeof BatteryWarning;
		circulo: string;
	}
> = {
	desconexion_energia: {
		label: "Desconexión de energía",
		descripcion:
			"El GPS dejó de recibir corriente del vehículo (voltaje externo bajo 3 V). Es posible que se haya desconectado el equipo.",
		icon: BatteryWarning,
		circulo: "bg-danger-subtle text-danger-text",
	},
	ignicion: {
		label: "Ignición",
		descripcion: "El vehículo se encendió (estaba apagado).",
		icon: Power,
		circulo: "bg-info-subtle text-info-text",
	},
	sin_reportar: {
		label: "Sin reportar",
		descripcion:
			"El GPS lleva más de 2 horas sin enviar señal. Puede estar sin cobertura, apagado o manipulado.",
		icon: SatelliteDish,
		circulo: "bg-warning-subtle text-warning-text",
	},
};

// Fallback defensivo: si el enum de BD gana un tipo nuevo antes de que este
// componente se actualice, `EVENTO_CONFIG[tipo]` sería `undefined` y
// `config.icon` tumbaría el render de la Ficha 360 entera, no solo esta
// pestaña. Con esto, un tipo desconocido se muestra genérico en vez de crashear.
const EVENTO_CONFIG_FALLBACK = {
	label: "Evento GPS",
	descripcion: undefined,
	icon: History,
	circulo: "bg-muted text-fg-secondary",
};

/** Lista de notificaciones GPS, solo presentación (también la usa el catálogo). */
export function NotificacionesGpsVista({
	estado,
	eventos,
	error,
}: {
	estado: "cargando" | "error" | "listo";
	eventos: EventoGps[];
	error?: string;
}) {
	// Un solo mapa abierto a la vez; el iframe se monta recién al abrirlo.
	const [mapaAbiertoId, setMapaAbiertoId] = useState<string | null>(null);

	return (
		<div className="flex flex-col gap-4">
			<PanelEncabezado
				descripcion={DESCRIPCION_EVENTOS}
				titulo="Notificaciones del GPS"
			/>
			{estado === "cargando" ? (
				<PanelCargando texto="Cargando notificaciones…" />
			) : estado === "error" ? (
				<PanelError
					detalle={error}
					texto="No se pudo cargar el historial de eventos GPS."
				/>
			) : eventos.length === 0 ? (
				<PanelVacio
					descripcion="Cuando el GPS detecte una desconexión de energía, una ignición o que dejó de reportar, aparecerá aquí."
					icono={<BellOff />}
					titulo="Este crédito no tiene notificaciones GPS"
				/>
			) : (
				<ul className="divide-y divide-line-subtle rounded-xl border border-line-subtle">
					{eventos.map((evento) => {
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
							<li className="px-3.5 py-3" key={evento.id}>
								<div className="flex items-start gap-3">
									<span
										aria-hidden
										className={cn(
											"flex size-8 shrink-0 items-center justify-center rounded-full",
											config.circulo,
										)}
									>
										<Icon className="size-4" />
									</span>
									<div className="flex min-w-0 flex-1 flex-col gap-0.5">
										<div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
											<span className="font-semibold text-fg text-sm leading-[1.26]">
												{config.label}
											</span>
											{evento.notificado ? (
												<CrmPill
													className="px-2 py-0.5 text-[11px]"
													dot={false}
													kind="chip"
													tone="neutral"
												>
													Notificado
												</CrmPill>
											) : null}
										</div>
										<p className="text-[11px] text-fg-tertiary">
											{formatFechaSenal(evento.ocurridoAt)}
										</p>
										{config.descripcion ? (
											<p className="text-fg-secondary text-xs">
												{config.descripcion}
											</p>
										) : null}
									</div>
									{mapsUrl ? (
										<Button
											aria-expanded={mapaAbierto}
											aria-label={mapaAbierto ? "Ocultar mapa" : "Ver mapa"}
											className="shrink-0"
											onClick={() =>
												setMapaAbiertoId(mapaAbierto ? null : evento.id)
											}
											size="sm"
											type="button"
											variant={mapaAbierto ? "secondary" : "ghost"}
										>
											<MapIcon aria-hidden />
											<span className="hidden sm:inline">
												{mapaAbierto ? "Ocultar mapa" : "Ver mapa"}
											</span>
										</Button>
									) : null}
								</div>
								{mapaAbierto && mapsUrl ? (
									<div className="mt-3 flex flex-col gap-1.5">
										<GpsMapaPreview
											latitude={evento.lat ?? undefined}
											longitude={evento.lon ?? undefined}
										/>
										<a
											className="text-brand text-xs hover:underline"
											href={mapsUrl}
											rel="noreferrer"
											target="_blank"
										>
											Abrir en Google Maps
										</a>
									</div>
								) : null}
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}

/** Misma consulta que usa la pestaña y su contador (React Query la comparte). */
export function useEventosGpsCaso(casoCobroId: string) {
	return useQuery({
		...orpc.getGpsEventosCaso.queryOptions({
			input: { casoCobroId, limit: 20 },
		}),
	});
}

/**
 * Historial de eventos GPS (CB-119) en la Ficha 360: desconexión de energía
 * (todos los buckets), ignición y sin reportar (solo B4), detectados por el
 * job de polling.
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
	// Dentro de una pestaña de VehiculoGpsTabs: sin marco de tarjeta, y con
	// aviso de vacío en vez de desaparecer (la pestaña ya existe).
	embedded?: boolean;
}) {
	const eventos = useEventosGpsCaso(casoCobroId);

	// Fuera de la pestaña, silencioso si no hay eventos: la mayoría de casos
	// nunca tendrá uno, y una tarjeta vacía todo el tiempo sería ruido. !isError
	// es a propósito: un fallo real deja data en undefined y la tarjeta
	// desaparecería en silencio en vez de mostrar el aviso de error.
	if (
		!embedded &&
		!eventos.isLoading &&
		!eventos.isError &&
		(eventos.data?.length ?? 0) === 0
	) {
		return null;
	}

	const vista = (
		<NotificacionesGpsVista
			error={eventos.error?.message}
			estado={
				eventos.isLoading ? "cargando" : eventos.isError ? "error" : "listo"
			}
			eventos={eventos.data ?? []}
		/>
	);
	if (embedded) return vista;
	return (
		<CrmCard className="gap-4 p-4" superficie="outline">
			{vista}
		</CrmCard>
	);
}
