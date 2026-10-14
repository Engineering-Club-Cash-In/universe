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
	MapPinned,
	RefreshCw,
	Repeat,
	Trash2,
	XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { GpsMapaPreview } from "@/components/cobros/gps-mapa-preview";
import { useHistorialUbicaciones } from "@/components/cobros/gps-ubicaciones-historial";
import {
	type EnVivoFrecuentes,
	TIPO_UBICACION_LABEL,
	type TipoUbicacionClave,
	UbicacionesFrecuentesVista,
} from "@/components/cobros/ubicaciones/frecuentes-vista";
import {
	PanelCargando,
	PanelError,
	PanelVacio,
} from "@/components/cobros/ubicaciones/panel";
import { CrmCard, CrmPill } from "@/components/ds/cards-credito";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatFechaSenal, googleMapsUrl } from "@/routes/cobros/-gps-ficha";
import { orpc } from "@/utils/orpc";

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

const TIPO_CONFIG: Record<
	TipoUbicacionClave,
	{ icon: typeof Home; circulo: string }
> = {
	probable_casa: { icon: Home, circulo: "bg-brand-subtle text-brand" },
	probable_trabajo: {
		icon: Briefcase,
		circulo: "bg-info-subtle text-info-text",
	},
	recurrente: { icon: Repeat, circulo: "bg-success-subtle text-success-text" },
	frecuente: { icon: MapPin, circulo: "bg-muted text-fg-secondary" },
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
 * Qué tan segura es una "probable casa": en cuántas de las noches en que el
 * carro estuvo en algún lugar conocido durmió ahí. Con carros muy quietos el
 * porcentaje de horas nocturnas no dice nada (ronda el 33 %), las noches sí.
 */
export function describirNoches(patron: unknown, tipo: string): string | null {
	if (tipo !== "probable_casa" || !patron || typeof patron !== "object") {
		return null;
	}
	const p = patron as { noches?: number; nochesTotales?: number };
	if (typeof p.noches !== "number" || p.noches <= 0) return null;
	const noches = (n: number) => (n === 1 ? "noche" : "noches");
	if (typeof p.nochesTotales === "number" && p.nochesTotales >= p.noches) {
		return `Pasó la noche aquí ${p.noches} de ${p.nochesTotales} ${noches(p.nochesTotales)}`;
	}
	return `Pasó la noche aquí ${p.noches} ${noches(p.noches)}`;
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
		<ul className="flex flex-col gap-2">
			{ubicaciones.map((u) => {
				const config =
					TIPO_CONFIG[u.tipo as TipoUbicacionClave] ?? TIPO_CONFIG.frecuente;
				const etiqueta =
					TIPO_UBICACION_LABEL[u.tipo as TipoUbicacionClave] ?? "Ubicación";
				const Icon = config.icon;
				const mapsUrl = googleMapsUrl(u.lat, u.lon);
				const mapaAbierto = mapaAbiertoId === u.id;
				const patronTexto = describirPatron(u.patron, u.horasTotales);
				const nochesTexto = describirNoches(u.patron, u.tipo);
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
				const horas = Math.round(u.horasTotales);
				return (
					<li
						className="rounded-xl border border-line-subtle bg-surface px-3.5 py-3"
						key={u.id}
					>
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
								<div className="flex flex-wrap items-center gap-1.5">
									<span className="font-semibold text-fg text-sm leading-[1.26]">
										{etiqueta}
									</span>
									{confirmada ? (
										<CrmPill dot={false} kind="chip" tone="success">
											<BadgeCheck aria-hidden className="size-3" />
											Confirmado
										</CrmPill>
									) : null}
								</div>
								<p className="text-fg-secondary text-xs">
									{horas} h en total · {u.visitas} visitas en {u.diasDistintos}{" "}
									días
									{patronTexto ? ` · ${patronTexto}` : ""}
								</p>
								{nochesTexto ? (
									<p className="text-fg-secondary text-xs">{nochesTexto}</p>
								) : null}
								<p className="text-[11px] text-fg-tertiary">
									Última vez: {formatFechaSenal(u.ultimaVisita)}
								</p>
							</div>
							{mapsUrl ? (
								<Button
									aria-expanded={mapaAbierto}
									aria-label={mapaAbierto ? "Ocultar mapa" : "Ver mapa"}
									className="shrink-0"
									onClick={() => setMapaAbiertoId(mapaAbierto ? null : u.id)}
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
						{casoCobroId &&
						tipoDomicilio &&
						domicilioQuery.data?.[tipoDomicilio] ? (
							<VerificarDomicilio
								casoCobroId={casoCobroId}
								domicilio={domicilioQuery.data[tipoDomicilio]}
								lugar={{ lat: u.lat, lon: u.lon, radioM: u.radioM ?? 0 }}
								tipo={tipoDomicilio}
							/>
						) : null}
						{mapaAbierto && mapsUrl ? (
							<div className="mt-3 flex flex-col gap-1.5">
								<GpsMapaPreview latitude={u.lat} longitude={u.lon} />
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
			<div className="mt-3 space-y-2 border-line-subtle border-t pt-3">
				<p className="text-fg-tertiary text-xs">{textos.sinDireccion}</p>
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
		<div className="mt-3 space-y-2 border-line-subtle border-t pt-3">
			{desactualizado && (
				<p className="flex items-start gap-1.5 font-medium text-sm text-warning-text">
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
								? "flex items-center gap-1.5 font-medium text-sm text-success-text"
								: "flex items-center gap-1.5 font-medium text-sm text-warning-text"
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
					<p className="text-fg-secondary text-xs">
						Verifique si {textos.pregunta}: busque la dirección del cliente en
						Google Maps, copie el link (o las coordenadas) y péguelo aquí. Use
						el link completo del navegador: los links cortos del botón
						«Compartir» del celular no traen coordenadas.
					</p>
					<p className="break-words text-xs">
						<span className="text-fg-tertiary">{textos.direccion}: </span>
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
		<Button
			disabled={calcular.isPending}
			onClick={() => calcular.mutate({ casoCobroId, vehicleId })}
			size="sm"
			type="button"
			variant="outline"
		>
			{calcular.isPending ? (
				<Loader2 aria-hidden className="animate-spin" />
			) : (
				<RefreshCw aria-hidden />
			)}
			{calcular.isPending ? "Calculando…" : "Calcular ahora"}
		</Button>
	);
}

/** Resultado de la consulta en vivo: carga, error, la lista o «Calcular ahora». */
export function UbicacionesClaveResultado({
	ubicaciones,
	casoCobroId,
	vehicleId,
}: {
	ubicaciones: ReturnType<typeof useUbicacionesClaveQuery>;
	casoCobroId: string;
	vehicleId: string;
}) {
	// isFetching (no isLoading): repetir la consulta con el mismo motivo no
	// cambia la clave, y sin esto se verían los datos viejos como nuevos.
	if (ubicaciones.isFetching) {
		return <PanelCargando texto="Consultando las ubicaciones frecuentes…" />;
	}
	if (ubicaciones.isError) {
		return (
			<PanelError
				detalle={ubicaciones.error?.message ?? "Error inesperado"}
				texto="No se pudieron cargar las ubicaciones frecuentes."
			/>
		);
	}
	if (ubicaciones.data?.auditada === false) {
		return (
			<PanelError texto="No se pudo registrar la auditoría de la consulta. Por seguridad no se muestran las ubicaciones." />
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
		<PanelVacio
			accion={
				<CalcularAhora
					casoCobroId={casoCobroId}
					onCalculado={() => ubicaciones.refetch()}
					vehicleId={vehicleId}
				/>
			}
			descripcion="Si es la primera vez que se consulta este vehículo, calcúlelas ahora: puede tardar unos segundos, porque se baja su historial de los últimos 60 días."
			icono={<MapPinned />}
			titulo="No hay suficientes datos todavía para identificar ubicaciones frecuentes"
		/>
	);
}

/**
 * Ubicaciones frecuentes (CB-119, D-15): datos y acciones. La vista está en
 * `ubicaciones/frecuentes-vista.tsx`. La usan la pestaña de la Ficha 360
 * (`embedded`) y el diálogo de visita (con su propio marco).
 *
 * Por defecto se ve lo último que ya se consultó: cada consulta guarda lo que
 * mostró, y verlo no es una consulta nueva. Una consulta NUEVA sigue pidiendo
 * motivo y queda en gps_consulta_logs, porque revela dónde vive o trabaja el
 * cliente.
 */
export function GpsUbicacionesClaveCard({
	casoCobroId,
	vehicleId,
	embedded = false,
	activo = true,
}: {
	casoCobroId: string;
	vehicleId: string;
	// Dentro de una pestaña de VehiculoGpsTabs: sin marco de tarjeta.
	embedded?: boolean;
	/**
	 * La pestaña está visible. Las pestañas quedan montadas: el historial se
	 * pide la primera vez que se abre, no al entrar a la ficha.
	 */
	activo?: boolean;
}) {
	const [motivoConfirmado, setMotivoConfirmado] = useState<string | null>(null);
	const [abierta, setAbierta] = useState(activo);
	useEffect(() => {
		if (activo) setAbierta(true);
	}, [activo]);

	const ubicaciones = useUbicacionesClaveQuery({
		casoCobroId,
		vehicleId,
		motivo: motivoConfirmado,
	});
	const historial = useHistorialUbicaciones({
		casoCobroId,
		vehicleId,
		habilitado: abierta,
	});

	const consultar = (motivo: string) => {
		// Mismo texto que la anterior: la clave no cambia y se repite a mano
		// (cada vista queda auditada por separado).
		if (motivo === motivoConfirmado) void ubicaciones.refetch();
		else setMotivoConfirmado(motivo);
	};

	const enVivo: EnVivoFrecuentes | null =
		motivoConfirmado == null
			? null
			: {
					motivo: motivoConfirmado,
					cargando: ubicaciones.isFetching,
					registrada: ubicaciones.data?.auditada === true,
					at: ubicaciones.dataUpdatedAt
						? new Date(ubicaciones.dataUpdatedAt)
						: null,
					contenido: (
						<UbicacionesClaveResultado
							casoCobroId={casoCobroId}
							ubicaciones={ubicaciones}
							vehicleId={vehicleId}
						/>
					),
				};

	const vista = (
		<UbicacionesFrecuentesVista
			casoCobroId={casoCobroId}
			enVivo={enVivo}
			historial={historial.historial}
			historialActualizado={historial.dataUpdatedAt > ubicaciones.dataUpdatedAt}
			idCampo={`motivo-ubicaciones-${vehicleId}`}
			onConsultar={consultar}
			paginacion={historial.paginacion}
			renderLugares={(lugares, caso) => (
				<UbicacionesClaveLista casoCobroId={caso} ubicaciones={lugares} />
			)}
		/>
	);

	if (embedded) return vista;
	return (
		<CrmCard className="gap-4 p-4" superficie="outline">
			{vista}
		</CrmCard>
	);
}
