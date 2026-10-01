import {
	skipToken,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import {
	Briefcase,
	Home,
	Loader2,
	Map as MapIcon,
	MapPin,
	RefreshCw,
	Repeat,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { GpsMapaPreview } from "@/components/cobros/gps-mapa-preview";
import { GpsUbicacionesHistorial } from "@/components/cobros/gps-ubicaciones-historial";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatFechaSenal, googleMapsUrl } from "@/routes/cobros/-gps-ficha";
import { orpc } from "@/utils/orpc";

const MOTIVO_MIN_LENGTH = 5;

type TipoUbicacionClave =
	| "probable_casa"
	| "probable_trabajo"
	| "recurrente"
	| "frecuente";

const TIPO_CONFIG: Record<
	TipoUbicacionClave,
	{ label: string; icon: typeof Home; badgeClass: string }
> = {
	probable_casa: {
		label: "Probable casa",
		icon: Home,
		badgeClass:
			"bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
	},
	probable_trabajo: {
		label: "Probable trabajo",
		icon: Briefcase,
		badgeClass:
			"bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
	},
	recurrente: {
		label: "Lugar recurrente",
		icon: Repeat,
		badgeClass:
			"bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
	},
	frecuente: {
		label: "Visitado con frecuencia",
		icon: MapPin,
		badgeClass: "bg-muted text-muted-foreground",
	},
};

// Días de la semana en el orden que devuelve patron.visitasPorDiaSemana
// (0=domingo..6=sábado, mismo criterio que Date.getUTCDay en el servidor).
const DIAS_SEMANA = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

export function describirPatron(
	patron: unknown,
	horasTotales?: number,
): string | null {
	if (!patron || typeof patron !== "object") return null;
	const p = patron as {
		nocturna?: number;
		laboral?: number;
		finDeSemana?: number;
		visitasPorDiaSemana?: number[];
	};

	if (Array.isArray(p.visitasPorDiaSemana)) {
		const max = Math.max(...p.visitasPorDiaSemana);
		const total = p.visitasPorDiaSemana.reduce((a, b) => a + b, 0);
		if (total > 0 && max / total >= 0.6) {
			const dia = p.visitasPorDiaSemana.indexOf(max);
			return `Sobre todo los ${DIAS_SEMANA[dia]}`;
		}
	}

	// Se usa horasTotales en el denominador si está disponible para incluir el
	// tiempo de estancia no clasificado (ej. 18:00–22:00) y no sesgar el porcentaje
	// cuando una estancia de tarde/noche solo tiene 1h nocturna.
	const total =
		horasTotales != null && horasTotales > 0
			? horasTotales
			: (p.nocturna ?? 0) + (p.laboral ?? 0) + (p.finDeSemana ?? 0);
	if (total <= 0) return null;
	if ((p.nocturna ?? 0) / total >= 0.5) return "Sobre todo de noche";
	if ((p.laboral ?? 0) / total >= 0.5) return "Sobre todo en horario laboral";
	if ((p.finDeSemana ?? 0) / total >= 0.5) return "Sobre todo fin de semana";
	return null;
}

/**
 * Consulta de ubicaciones clave (CB-119, D-15): casa, trabajo y lugares
 * recurrentes del vehículo, calculados por el job nocturno contra el historial
 * de Wialon de los últimos 60 días.
 *
 * Mismo gate de motivo auditado que la telemetría (CB-118): esto revela dónde
 * vive/trabaja el cliente, así que no se consulta hasta que el asesor escribe
 * por qué lo necesita (`motivo` null = no se consulta), y cada consulta queda
 * en gps_consulta_logs.
 */
export function useUbicacionesClaveQuery({
	casoCobroId,
	vehicleId,
	motivo,
}: {
	casoCobroId: string;
	vehicleId: string;
	motivo: string | null;
}) {
	const queryClient = useQueryClient();
	const ubicaciones = useQuery({
		...orpc.getUbicacionesClaveCaso.queryOptions({
			input: motivo == null ? skipToken : { casoCobroId, vehicleId, motivo },
		}),
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: 0,
		meta: { auditada: true },
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		refetchOnMount: false,
		retry: false,
	});

	// Cada consulta inserta una fila en gps_consulta_logs: el historial de la
	// ficha se refresca al terminar, no antes (la fila aún no existe).
	const { dataUpdatedAt } = ubicaciones;
	useEffect(() => {
		if (dataUpdatedAt > 0) {
			queryClient.invalidateQueries({
				queryKey: orpc.getGpsConsultasCaso.key(),
			});
			queryClient.invalidateQueries({
				queryKey: orpc.getUbicacionesConsultasCaso.key(),
			});
		}
	}, [dataUpdatedAt, queryClient]);

	return ubicaciones;
}

export type UbicacionClaveItem = {
	id: string;
	lat: number;
	lon: number;
	tipo: string;
	horasTotales: number;
	diasDistintos: number;
	visitas: number;
	patron?: unknown;
	ultimaVisita: Date;
};

/** Lista de ubicaciones con su mapa bajo demanda; la usan la consulta en vivo y el historial. */
export function UbicacionesClaveLista({
	ubicaciones,
}: {
	ubicaciones: UbicacionClaveItem[];
}) {
	// Un solo mapa abierto a la vez: el iframe se monta recién al abrirlo, así
	// que no se pide nada a Google hasta que el asesor lo pide.
	const [mapaAbiertoId, setMapaAbiertoId] = useState<string | null>(null);

	return (
		<ul className="space-y-2">
			{ubicaciones.map((u) => {
				const config = TIPO_CONFIG[u.tipo as TipoUbicacionClave];
				const Icon = config.icon;
				const mapsUrl = googleMapsUrl(u.lat, u.lon);
				const mapaAbierto = mapaAbiertoId === u.id;
				const patronTexto = describirPatron(u.patron, u.horasTotales);
				return (
					<li className="rounded-md border p-3" key={u.id}>
						<div className="flex items-start justify-between gap-3">
							<div className="flex items-start gap-3">
								<Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
								<div>
									<Badge className={config.badgeClass} variant="secondary">
										{config.label}
									</Badge>
									<p className="mt-1 text-muted-foreground text-xs">
										{Math.round(u.horasTotales)} h en total · {u.visitas}{" "}
										visitas en {u.diasDistintos} días
										{patronTexto ? ` · ${patronTexto}` : ""}
									</p>
									<p className="text-muted-foreground text-xs">
										Última vez: {formatFechaSenal(u.ultimaVisita)}
									</p>
								</div>
							</div>
							{mapsUrl && (
								<Button
									aria-expanded={mapaAbierto}
									className="shrink-0"
									onClick={() => setMapaAbiertoId(mapaAbierto ? null : u.id)}
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
								<GpsMapaPreview latitude={u.lat} longitude={u.lon} />
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
	);
}

const MENSAJE_CALCULO: Record<string, string> = {
	en_proceso:
		"Este vehículo se está calculando ahora mismo. Espera un momento.",
	incompleto:
		"Wialon no devolvió el historial completo. Intenta de nuevo en unos minutos.",
	sin_unidad:
		"Este vehículo no tiene una unidad GPS vinculada. Abre la pestaña GPS / Wialon para identificarla.",
};

/**
 * Para el vehículo que todavía no tiene datos: el cálculo nocturno reparte el
 * historial de 60 días en varias noches cuando hay muchos vehículos, y esto
 * deja calcularlo ahora sin esperar el turno. Calcular no muestra nada por sí
 * solo: al terminar se vuelve a consultar, y esa consulta queda registrada con
 * el mismo motivo.
 */
function CalcularAhora({
	casoCobroId,
	vehicleId,
	onCalculado,
}: {
	casoCobroId: string;
	vehicleId: string;
	onCalculado: () => void;
}) {
	const calcular = useMutation({
		...orpc.calcularUbicacionesClaveCaso.mutationOptions(),
		onSuccess: (res) => {
			if (res.estado === "calculado") {
				// Calculado sin ubicaciones no es un fallo: el vehículo no tiene
				// paradas suficientes en 60 días. Se dice, para que no parezca que
				// el botón no hizo nada.
				if (res.ubicaciones > 0) {
					toast.success(
						res.ubicaciones === 1
							? "1 ubicación calculada."
							: `${res.ubicaciones} ubicaciones calculadas.`,
					);
				} else {
					toast.info(
						"Cálculo completado: no se encontraron paradas frecuentes suficientes en los últimos 60 días.",
					);
				}
				onCalculado();
				return;
			}
			toast.info(MENSAJE_CALCULO[res.estado] ?? "No se pudo calcular.");
		},
		onError: (error) => {
			toast.error(error.message || "No se pudo calcular las ubicaciones.");
		},
	});

	return (
		<div className="mt-3 space-y-1.5">
			<Button
				disabled={calcular.isPending}
				onClick={() => calcular.mutate({ casoCobroId, vehicleId })}
				size="sm"
				type="button"
				variant="outline"
			>
				{calcular.isPending ? (
					<Loader2 className="mr-2 h-4 w-4 animate-spin" />
				) : (
					<RefreshCw className="mr-2 h-4 w-4" />
				)}
				{calcular.isPending ? "Calculando…" : "Calcular ahora"}
			</Button>
			<p className="text-muted-foreground text-xs">
				Si es la primera vez que se consulta este vehículo, puede tardar unos
				segundos: se baja su historial de los últimos 60 días.
			</p>
		</div>
	);
}

export function UbicacionesClaveResultado({
	ubicaciones,
	casoCobroId,
	vehicleId,
}: {
	ubicaciones: ReturnType<typeof useUbicacionesClaveQuery>;
	casoCobroId: string;
	vehicleId: string;
}) {
	if (ubicaciones.isLoading) {
		return (
			<div className="flex justify-center py-4">
				<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
			</div>
		);
	}
	if (ubicaciones.isError) {
		return (
			<p className="text-destructive text-sm">
				No se pudieron cargar las ubicaciones clave:{" "}
				{ubicaciones.error?.message ?? "Error inesperado"}
			</p>
		);
	}
	if (ubicaciones.data?.auditada === false) {
		return (
			<p className="text-destructive text-sm">
				No se pudo registrar la auditoría de la consulta. Por seguridad no se
				muestran las ubicaciones.
			</p>
		);
	}
	if (ubicaciones.data && ubicaciones.data.ubicaciones.length > 0) {
		return <UbicacionesClaveLista ubicaciones={ubicaciones.data.ubicaciones} />;
	}
	return (
		<div>
			<p className="text-muted-foreground text-sm italic">
				No hay suficientes datos todavía para identificar ubicaciones clave de
				este vehículo.
			</p>
			<CalcularAhora
				casoCobroId={casoCobroId}
				onCalculado={() => ubicaciones.refetch()}
				vehicleId={vehicleId}
			/>
		</div>
	);
}

/**
 * Tarjeta independiente de ubicaciones clave (con su propio gate de motivo).
 * La Ficha 360 ya no la usa: ahí va dentro de la carta GPS / Wialon. Sigue
 * en el diálogo de visita, que no tiene carta GPS.
 */
export function GpsUbicacionesClaveCard({
	casoCobroId,
	vehicleId,
	embedded = false,
}: {
	casoCobroId: string;
	vehicleId: string;
	// Dentro de una pestaña de VehiculoGpsTabs: sin marco de tarjeta ni título.
	embedded?: boolean;
}) {
	const [motivo, setMotivo] = useState("");
	const [motivoConfirmado, setMotivoConfirmado] = useState<string | null>(null);

	const ubicaciones = useUbicacionesClaveQuery({
		casoCobroId,
		vehicleId,
		motivo: motivoConfirmado,
	});

	const motivoValido = motivo.trim().length >= MOTIVO_MIN_LENGTH;

	const Raiz = embedded ? "div" : Card;
	const Cabecera = embedded ? "div" : CardHeader;
	const Cuerpo = embedded ? "div" : CardContent;
	const Descripcion = embedded ? "p" : CardDescription;

	return (
		<Raiz>
			<Cabecera className={embedded ? "mb-3 space-y-1" : undefined}>
				{!embedded && (
					<CardTitle className="flex items-center gap-2">
						<MapPin className="h-5 w-5" />
						Ubicaciones clave
					</CardTitle>
				)}
				<Descripcion
					className={embedded ? "text-muted-foreground text-sm" : undefined}
				>
					Lugares donde el vehículo pasa más tiempo (casa, trabajo, lugares
					recurrentes), calculados automáticamente contra los últimos 60 días de
					historial GPS. Orienta la búsqueda si el vehículo hay que recuperarlo.
				</Descripcion>
			</Cabecera>
			<Cuerpo>
				{motivoConfirmado == null ? (
					<form
						className="space-y-3"
						onSubmit={(e) => {
							e.preventDefault();
							if (motivoValido) setMotivoConfirmado(motivo.trim());
						}}
					>
						<p className="text-muted-foreground text-sm">
							Esta información revela dónde vive o trabaja el cliente. Cada
							consulta queda registrada con su motivo.
						</p>
						<div>
							<Label htmlFor={`motivo-ubicaciones-${vehicleId}`}>Motivo</Label>
							<Input
								id={`motivo-ubicaciones-${vehicleId}`}
								onChange={(e) => setMotivo(e.target.value)}
								placeholder="Ej: Preparar visita de recuperación"
								value={motivo}
							/>
						</div>
						<Button disabled={!motivoValido} type="submit">
							<MapPin className="mr-2 h-4 w-4" />
							Ver ubicaciones clave
						</Button>
					</form>
				) : (
					<UbicacionesClaveResultado
						casoCobroId={casoCobroId}
						ubicaciones={ubicaciones}
						vehicleId={vehicleId}
					/>
				)}
				{motivoConfirmado != null && (
					<div className="mt-4 flex items-center justify-between border-t pt-3">
						<p className="text-muted-foreground text-xs">
							{ubicaciones.isLoading
								? "Registrando consulta"
								: ubicaciones.data?.auditada
									? "Consulta registrada"
									: "Consulta no registrada"}{" "}
							— motivo: "{motivoConfirmado}"
						</p>
						<Button
							onClick={() => {
								setMotivoConfirmado(null);
								setMotivo("");
							}}
							size="sm"
							variant="ghost"
						>
							Consultar de nuevo
						</Button>
					</div>
				)}
				<div className="mt-2">
					<GpsUbicacionesHistorial
						casoCobroId={casoCobroId}
						vehicleId={vehicleId}
					/>
				</div>
			</Cuerpo>
		</Raiz>
	);
}
