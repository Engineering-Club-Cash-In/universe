import {
	skipToken,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import {
	AlertTriangle,
	BadgeCheck,
	Briefcase,
	ExternalLink,
	Home,
	Loader2,
	Map as MapIcon,
	MapPin,
	RefreshCw,
	Repeat,
	Trash2,
	XCircle,
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

// Mismo margen que UMBRAL_CONFIRMACION_DOMICILIO_M del servidor
// (apps/server/src/services/wialon/geo.ts): una probable casa se confirma si
// queda a menos de radio + margen del domicilio declarado.
const UMBRAL_CONFIRMACION_DOMICILIO_M = 150;

type PuntoDomicilio = {
	lat: number;
	lon: number;
	// La dirección del cliente cambió desde que se ubicó el punto.
	desactualizado?: boolean;
};

// Haversine; el servidor tiene el mismo cálculo. Se repite acá para que la
// etiqueta se actualice al guardar el domicilio sin repetir la consulta
// auditada de ubicaciones.
function distanciaMetros(a: PuntoDomicilio, b: PuntoDomicilio): number {
	const rad = (g: number) => (g * Math.PI) / 180;
	const h =
		Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
		Math.cos(rad(a.lat)) *
			Math.cos(rad(b.lat)) *
			Math.sin(rad(b.lon - a.lon) / 2) ** 2;
	return 2 * 6371000 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function formatearDistancia(metros: number): string {
	return metros < 1000
		? `${Math.round(metros)} m`
		: `${(metros / 1000).toFixed(1)} km`;
}

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
	radioM?: number;
	// Calculados por el servidor contra el domicilio declarado (null = sin
	// domicilio ubicado; ausentes en consultas anteriores a esta función).
	distanciaDomicilioM?: number | null;
	confirmadaDomicilio?: boolean | null;
	domicilioDesactualizado?: boolean | null;
};

/** Lista de ubicaciones con su mapa bajo demanda; la usan la consulta en vivo y el historial. */
export function UbicacionesClaveLista({
	ubicaciones,
	casoCobroId,
}: {
	ubicaciones: UbicacionClaveItem[];
	// Solo en la vista en vivo: habilita comparar la probable casa con el
	// domicilio declarado. El historial (sin esto) muestra lo que vio el servidor.
	casoCobroId?: string;
}) {
	const domicilioQuery = useDomicilioDeclarado(casoCobroId);
	// Punto ubicado para un tipo de ubicación. undefined = historial (se usa lo
	// del snapshot); en vivo, null = sin punto ubicado.
	const puntoDomicilio = (tipo: string): PuntoDomicilio | null | undefined => {
		const clave = TIPO_DOMICILIO[tipo];
		if (!casoCobroId || !clave) return undefined;
		return domicilioQuery.data?.[clave]
			? domicilioQuery.data[clave].ubicado
			: undefined;
	};

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
				let distanciaDomicilioM = u.distanciaDomicilioM ?? null;
				let confirmada = u.confirmadaDomicilio ?? null;
				const tipoDomicilio = TIPO_DOMICILIO[u.tipo];
				const domicilio = puntoDomicilio(u.tipo);
				if (domicilio !== undefined) {
					if (domicilio) {
						distanciaDomicilioM = distanciaMetros(u, domicilio);
						// Con la dirección cambiada el punto ya no confirma nada.
						confirmada =
							!domicilio.desactualizado &&
							distanciaDomicilioM <=
								(u.radioM ?? 0) + UMBRAL_CONFIRMACION_DOMICILIO_M;
					} else {
						distanciaDomicilioM = null;
						confirmada = null;
					}
				}
				return (
					<li className="rounded-md border p-3" key={u.id}>
						<div className="flex items-start justify-between gap-3">
							<div className="flex items-start gap-3">
								<Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
								<div>
									<div className="flex flex-wrap items-center gap-1.5">
										<Badge className={config.badgeClass} variant="secondary">
											{config.label}
										</Badge>
										{confirmada && (
											<Badge
												className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
												variant="secondary"
											>
												<BadgeCheck className="mr-1 h-3 w-3" />
												Confirmado
											</Badge>
										)}
									</div>
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
						{casoCobroId &&
							tipoDomicilio &&
							domicilioQuery.data?.[tipoDomicilio] && (
								<VerificarDomicilio
									casoCobroId={casoCobroId}
									domicilio={domicilioQuery.data[tipoDomicilio]}
									lugar={{ lat: u.lat, lon: u.lon, radioM: u.radioM ?? 0 }}
									tipo={tipoDomicilio}
								/>
							)}
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

type TipoDomicilio = "casa" | "trabajo";

// Qué dirección declarada se compara con cada tipo de ubicación del GPS.
const TIPO_DOMICILIO: Record<string, TipoDomicilio | undefined> = {
	probable_casa: "casa",
	probable_trabajo: "trabajo",
};

const TEXTO_DOMICILIO: Record<
	TipoDomicilio,
	{
		pregunta: string;
		direccion: string;
		declarado: string;
		sinDireccion: string;
	}
> = {
	casa: {
		pregunta: "es su casa",
		direccion: "Dirección de residencia",
		declarado: "domicilio declarado",
		sinDireccion:
			"El cliente no tiene dirección de residencia registrada: no hay contra qué verificar este punto.",
	},
	trabajo: {
		pregunta: "es su trabajo",
		direccion: "Dirección del trabajo",
		declarado: "trabajo declarado",
		sinDireccion:
			"El cliente no tiene dirección de trabajo registrada: no hay contra qué verificar este punto.",
	},
};

type DomicilioCaso = {
	direccion: string | null;
	ubicado: PuntoDomicilio | null;
};

function useDomicilioDeclarado(casoCobroId: string | undefined) {
	return useQuery(
		orpc.getDomicilioDeclaradoCaso.queryOptions({
			input: casoCobroId ? { casoCobroId } : skipToken,
		}),
	);
}

/**
 * Dentro de la tarjeta de "Probable casa": el asesor busca la dirección que el
 * cliente declaró en Google Maps, pega el link (o las coordenadas) y se le dice
 * si ese punto coincide con la probable casa del GPS. No es una consulta
 * auditada: solo compara con datos del cliente que la ficha ya muestra.
 */
function VerificarDomicilio({
	casoCobroId,
	tipo,
	lugar,
	domicilio,
}: {
	casoCobroId: string;
	tipo: TipoDomicilio;
	lugar: { lat: number; lon: number; radioM: number };
	domicilio: DomicilioCaso;
}) {
	const textos = TEXTO_DOMICILIO[tipo];
	const queryClient = useQueryClient();
	const [entrada, setEntrada] = useState("");
	const [cambiando, setCambiando] = useState(false);

	const refrescar = () =>
		queryClient.invalidateQueries({
			queryKey: orpc.getDomicilioDeclaradoCaso.key(),
		});
	const guardar = useMutation({
		...orpc.setDomicilioDeclaradoCaso.mutationOptions(),
		onSuccess: () => {
			setEntrada("");
			setCambiando(false);
			refrescar();
		},
		onError: (error) => {
			toast.error(error.message || "No se pudo leer el link.");
		},
	});
	const quitar = useMutation({
		...orpc.borrarDomicilioDeclaradoCaso.mutationOptions(),
		onSuccess: () => refrescar(),
		onError: (error) => {
			toast.error(error.message || "No se pudo quitar el punto.");
		},
	});

	const { direccion, ubicado } = domicilio;
	const buscarUrl = direccion
		? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
				`${direccion}, Guatemala`,
			)}`
		: null;

	const distanciaM = ubicado ? distanciaMetros(lugar, ubicado) : null;
	const coincide =
		distanciaM != null &&
		distanciaM <= lugar.radioM + UMBRAL_CONFIRMACION_DOMICILIO_M;
	const desactualizado = ubicado?.desactualizado === true;

	// Sin dirección declarada no hay contra qué comparar: no se ofrece el
	// formulario (el servidor también lo rechaza). Si había un punto de antes,
	// solo se puede quitar.
	if (!direccion) {
		return (
			<div className="mt-3 space-y-2 border-t pt-3">
				<p className="text-muted-foreground text-xs italic">
					{textos.sinDireccion}
				</p>
				{ubicado && (
					<Button
						disabled={quitar.isPending}
						onClick={() => quitar.mutate({ casoCobroId, tipo })}
						size="sm"
						type="button"
						variant="ghost"
					>
						{quitar.isPending ? (
							<Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
						) : (
							<Trash2 className="mr-1.5 h-3.5 w-3.5" />
						)}
						Quitar el punto anterior
					</Button>
				)}
			</div>
		);
	}

	const mostrarFormulario = !ubicado || cambiando || desactualizado;

	return (
		<div className="mt-3 space-y-2 border-t pt-3">
			{desactualizado && (
				<p className="flex items-start gap-1.5 font-medium text-amber-700 text-sm dark:text-amber-400">
					<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
					La dirección del cliente cambió desde que se ubicó este punto.
					Búsquela de nuevo y compárela otra vez.
				</p>
			)}

			{ubicado && !cambiando && !desactualizado && distanciaM != null && (
				<div className="space-y-2">
					<p
						className={
							coincide
								? "flex items-center gap-1.5 font-medium text-green-700 text-sm dark:text-green-400"
								: "flex items-center gap-1.5 font-medium text-amber-700 text-sm dark:text-amber-400"
						}
					>
						{coincide ? (
							<BadgeCheck className="h-4 w-4" />
						) : (
							<XCircle className="h-4 w-4" />
						)}
						{coincide
							? `Coincide con el ${textos.declarado} (a ${formatearDistancia(distanciaM)})`
							: `No coincide: está a ${formatearDistancia(distanciaM)} del ${textos.declarado}`}
					</p>
					<div className="flex flex-wrap gap-1.5">
						<Button
							onClick={() => setCambiando(true)}
							size="sm"
							type="button"
							variant="outline"
						>
							Probar otro link
						</Button>
						<Button
							disabled={quitar.isPending}
							onClick={() => quitar.mutate({ casoCobroId, tipo })}
							size="sm"
							type="button"
							variant="ghost"
						>
							{quitar.isPending ? (
								<Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
							) : (
								<Trash2 className="mr-1.5 h-3.5 w-3.5" />
							)}
							Quitar
						</Button>
					</div>
				</div>
			)}

			{mostrarFormulario && (
				<form
					className="space-y-2"
					onSubmit={(e) => {
						e.preventDefault();
						if (entrada.trim().length >= 3) {
							guardar.mutate({ casoCobroId, tipo, entrada: entrada.trim() });
						}
					}}
				>
					<p className="text-muted-foreground text-xs">
						Verifique si {textos.pregunta}: busque la dirección del cliente en
						Google Maps, copie el link (o las coordenadas) y péguelo aquí. Use
						el link completo del navegador: los links cortos del botón
						«Compartir» del celular no traen coordenadas.
					</p>
					<p className="break-words text-xs">
						<span className="text-muted-foreground">{textos.direccion}: </span>
						{direccion}
					</p>
					<div className="flex flex-wrap items-center gap-1.5">
						{buscarUrl && (
							<Button asChild size="sm" type="button" variant="outline">
								<a href={buscarUrl} rel="noreferrer" target="_blank">
									<ExternalLink className="mr-1.5 h-3.5 w-3.5" />
									Buscar en Google Maps
								</a>
							</Button>
						)}
						<Input
							aria-label="Link de Google Maps o coordenadas"
							className="h-8 min-w-48 flex-1"
							onChange={(e) => setEntrada(e.target.value)}
							placeholder="Link de Maps o 14.5951, -90.5069"
							value={entrada}
						/>
						<Button
							disabled={entrada.trim().length < 3 || guardar.isPending}
							size="sm"
							type="submit"
						>
							{guardar.isPending && (
								<Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
							)}
							Comparar
						</Button>
						{cambiando && (
							<Button
								onClick={() => {
									setCambiando(false);
									setEntrada("");
								}}
								size="sm"
								type="button"
								variant="ghost"
							>
								Cancelar
							</Button>
						)}
					</div>
				</form>
			)}
		</div>
	);
}

const MENSAJE_CALCULO: Record<string, string> = {
	en_proceso:
		"Este vehículo se está calculando ahora mismo. Espere un momento.",
	incompleto:
		"Wialon no devolvió el historial completo. Intente de nuevo en unos minutos.",
	sin_unidad:
		"Este vehículo no tiene una unidad GPS vinculada. Abra la pestaña GPS / Wialon para identificarla.",
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
		return (
			<UbicacionesClaveLista
				casoCobroId={casoCobroId}
				ubicaciones={ubicaciones.data.ubicaciones}
			/>
		);
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
					historial GPS. Orienta la búsqueda si es necesario recuperar el
					vehículo.
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
								placeholder="Ej.: Preparar visita de recuperación"
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
