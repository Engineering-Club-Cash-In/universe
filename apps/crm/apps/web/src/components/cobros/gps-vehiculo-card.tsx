import {
	keepPreviousData,
	skipToken,
	useMutation,
	useQuery,
} from "@tanstack/react-query";
import {
	Copy,
	ExternalLink,
	Gauge,
	Link2,
	Loader2,
	MapPin,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	ESTADO_SENAL_CONFIG,
	formatCoordenadas,
	formatFechaSenal,
	formatIgnicion,
	formatUltimaSenal,
	formatVelocidad,
	googleMapsUrl,
	limpiarPlacaParaBusqueda,
	MOTIVO_SIN_VINCULO,
	resolveEstadoSenal,
} from "@/routes/cobros/-gps-ficha";
import { type client, orpc } from "@/utils/orpc";

const MOTIVO_MIN_LENGTH = 5;

/**
 * Tarjeta de GPS/Wialon en el tab Vehículo de la Ficha 360 (CB-118).
 *
 * Va como componente aparte y no inline en $id.tsx (que ya pasa de 4500 líneas)
 * y con su propia query, para que una consulta a Wialon —un proveedor externo
 * que puede tardar o estar caído— nunca retrase ni bloquee el resto de la ficha.
 *
 * La historia exige que "cada consulta quede auditada con usuario, motivo y
 * cuenta": no se muestra ubicación de nada hasta que el asesor escribe por
 * qué la necesita. Por eso NO hay refetchInterval — un refresco silencioso en
 * segundo plano no tendría motivo que auditar, y cada actualización real pasa
 * de nuevo por este mismo gate.
 */
export function GpsVehiculoCard({
	vehicleId,
	esSupervisor,
	numeroCreditoSifco,
}: {
	vehicleId: string;
	esSupervisor: boolean;
	numeroCreditoSifco?: string | null;
}) {
	const [motivo, setMotivo] = useState("");
	const [motivoConfirmado, setMotivoConfirmado] = useState<string | null>(null);

	const gps = useQuery({
		...orpc.getGpsVehiculo.queryOptions({
			// skipToken es la forma que oRPC/TanStack reconocen para bloquear el
			// fetch de raíz: sin motivo confirmado ni siquiera se construye un
			// input inválido. Un `enabled` manual aparte no lo garantizaba —
			// alcanzaba a disparar la consulta con motivo:"" antes de tiempo.
			input:
				motivoConfirmado == null
					? skipToken
					: {
							vehicleId,
							motivo: motivoConfirmado,
							...(numeroCreditoSifco ? { numeroCreditoSifco } : {}),
						},
		}),
		// Cada fetch inserta una fila de auditoría en el servidor: ningún
		// refetch implícito (foco de ventana, reconexión, dato "stale", reintento)
		// puede dispararlo, o la bitácora registraría vistas que nadie pidió con
		// el motivo de una consulta anterior. gcTime 0 hace lo inverso: al volver
		// al gate (o desmontar la tarjeta) la respuesta se descarta, así que
		// confirmar de nuevo —aunque sea con el mismo texto— sí va al servidor y
		// queda auditado, en vez de servir la ubicación vieja desde caché.
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: 0,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		refetchOnMount: false,
		retry: false,
	});

	const motivoValido = motivo.trim().length >= MOTIVO_MIN_LENGTH;

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<CardTitle className="flex items-center gap-2">
						<MapPin className="h-5 w-5" />
						GPS / Wialon
					</CardTitle>
					{gps.data?.estado === "vinculado" && (
						<span className="text-muted-foreground text-xs">
							{gps.data.unitName}
						</span>
					)}
				</div>
				{gps.data?.estado === "vinculado" &&
					gps.data.vinculoOrigen === "placa" && (
						<CardDescription>
							Unidad identificada automáticamente por la placa.
						</CardDescription>
					)}
			</CardHeader>
			<CardContent>
				{motivoConfirmado == null ? (
					// <form> para que Enter confirme el motivo igual que el botón (y
					// respete su disabled): el asesor no tiene que soltar el teclado.
					<form
						className="space-y-3"
						onSubmit={(e) => {
							e.preventDefault();
							if (motivoValido) setMotivoConfirmado(motivo.trim());
						}}
					>
						<p className="text-muted-foreground text-sm">
							Cada consulta de ubicación queda registrada con su motivo. Escriba
							por qué necesita ver el GPS de este vehículo.
						</p>
						<div>
							<Label htmlFor={`motivo-gps-${vehicleId}`}>Motivo</Label>
							<Input
								id={`motivo-gps-${vehicleId}`}
								onChange={(e) => setMotivo(e.target.value)}
								placeholder="Ej: Cliente en mora crítica, ubicar para gestión de recuperación"
								value={motivo}
							/>
						</div>
						<Button disabled={!motivoValido} type="submit">
							<MapPin className="mr-2 h-4 w-4" />
							Ver ubicación
						</Button>
					</form>
				) : gps.isLoading ? (
					<div className="flex justify-center py-4">
						<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
					</div>
				) : gps.data?.estado === "vinculado" ? (
					<TelemetriaVinculada
						datos={gps.data}
						esSupervisor={esSupervisor}
						onVinculado={() => gps.refetch()}
						vehicleId={vehicleId}
					/>
				) : gps.data?.estado === "sin_vinculo" ? (
					<SinVinculo
						datos={gps.data}
						esSupervisor={esSupervisor}
						onVinculado={() => gps.refetch()}
						vehicleId={vehicleId}
					/>
				) : (
					// Wialon caído: nota discreta, no una alerta roja. Que el proveedor
					// no responda no es un problema del crédito ni del asesor.
					<p className="py-2 text-muted-foreground text-sm italic">
						No se pudo consultar el GPS en este momento
						{gps.data?.estado === "no_disponible" && gps.data.error.message
							? `: ${gps.data.error.message}`
							: "."}
					</p>
				)}
				{motivoConfirmado != null && (
					<div className="mt-4 flex items-center justify-between border-t pt-3">
						<p className="text-muted-foreground text-xs">
							Consulta registrada — motivo: "{motivoConfirmado}"
						</p>
						<Button
							onClick={() => {
								// Volver a consultar exige un motivo de nuevo, aunque sea el
								// mismo texto: cada vista queda auditada por separado.
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
			</CardContent>
		</Card>
	);
}

// El contrato lo define el servidor (gpsVehiculoOutputSchema); acá solo se
// extraen las ramas de la unión para tipar cada sub-componente.
type GpsVehiculoOutput = Awaited<ReturnType<typeof client.getGpsVehiculo>>;
type GpsVinculado = Extract<GpsVehiculoOutput, { estado: "vinculado" }>;
type GpsSinVinculo = Extract<GpsVehiculoOutput, { estado: "sin_vinculo" }>;

function TelemetriaVinculada({
	datos,
	esSupervisor,
	onVinculado,
	vehicleId,
}: {
	datos: GpsVinculado;
	esSupervisor: boolean;
	onVinculado: () => void;
	vehicleId: string;
}) {
	const { telemetria } = datos;
	const ignicion = formatIgnicion(telemetria.isIgnitionOn);
	const IgnicionIcon = ignicion.icon;
	const estadoSenal = resolveEstadoSenal(telemetria.ultimaSenalAt);
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

			<div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
				<Dato
					label="Última señal"
					value={formatUltimaSenal(telemetria.ultimaSenalAt)}
					hint={formatFechaSenal(telemetria.ultimaSenalAt)}
				/>
				<Dato label="Velocidad" value={formatVelocidad(telemetria.speedKmh)} />
				<Dato
					label="Ubicación"
					value={formatCoordenadas(telemetria.latitude, telemetria.longitude)}
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
				<Dato label="Unidad GPS" value={datos.unitName} />
			</div>

			<div className="flex flex-wrap gap-2">
				{mapsUrl && (
					<Button asChild size="sm" variant="outline">
						<a href={mapsUrl} rel="noopener noreferrer" target="_blank">
							<MapPin className="mr-2 h-4 w-4" />
							Abrir en Google Maps
						</a>
					</Button>
				)}
				{esSupervisor && (
					<TrackingLinkDialog unitId={datos.unitId} unitName={datos.unitName} />
				)}
			</div>

			{esSupervisor && datos.vinculoOrigen === "placa" && (
				<CorregirVinculo
					onVinculado={onVinculado}
					placa={datos.placa}
					vehicleId={vehicleId}
				/>
			)}
		</div>
	);
}

function Dato({
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

function SinVinculo({
	datos,
	esSupervisor,
	onVinculado,
	vehicleId,
}: {
	datos: GpsSinVinculo;
	esSupervisor: boolean;
	onVinculado: () => void;
	vehicleId: string;
}) {
	return (
		<div className="space-y-4">
			<p className="text-muted-foreground text-sm">
				{MOTIVO_SIN_VINCULO[datos.motivo]}
			</p>
			{esSupervisor ? (
				<SelectorUnidad
					candidatos={datos.candidatos}
					onVinculado={onVinculado}
					placaSugerida={datos.placa}
					vehicleId={vehicleId}
				/>
			) : (
				<p className="text-muted-foreground text-xs italic">
					Un supervisor puede vincular la unidad GPS de este vehículo.
				</p>
			)}
		</div>
	);
}

/** Atajo para volver a abrir el selector cuando el vínculo fue deducido. */
function CorregirVinculo({
	onVinculado,
	placa,
	vehicleId,
}: {
	onVinculado: () => void;
	placa: string | null;
	vehicleId: string;
}) {
	const [abierto, setAbierto] = useState(false);

	if (!abierto) {
		return (
			<Button
				className="px-0 text-muted-foreground text-xs"
				onClick={() => setAbierto(true)}
				size="sm"
				variant="link"
			>
				¿No es esta la unidad? Cambiarla
			</Button>
		);
	}
	return (
		<div className="space-y-2">
			<SelectorUnidad
				candidatos={[]}
				onVinculado={() => {
					// Sin recargar, la tarjeta seguía mostrando la unidad deducida
					// aunque el vínculo nuevo ya estuviera guardado.
					setAbierto(false);
					onVinculado();
				}}
				placaSugerida={placa}
				vehicleId={vehicleId}
			/>
			<Button
				className="px-0 text-muted-foreground text-xs"
				onClick={() => setAbierto(false)}
				size="sm"
				variant="link"
			>
				Cancelar
			</Button>
		</div>
	);
}

/**
 * Selector de unidad para el supervisor. Busca en el catálogo de Wialon con
 * debounce de 300 ms: sin él, escribir rápido dispara una consulta por tecla y
 * se topa el límite de solicitudes concurrentes del proveedor (error 10).
 */
function SelectorUnidad({
	candidatos,
	onVinculado,
	placaSugerida,
	vehicleId,
}: {
	candidatos: { id: number; nm: string }[];
	onVinculado?: () => void;
	placaSugerida?: string | null;
	vehicleId: string;
}) {
	// Solo la placa SUGERIDA se reduce a dígitos: viene del CRM con el formato
	// que haya escrito alguien ("P - 278KJQ") y buscarla tal cual no encuentra
	// la unidad ("P-278KJQ SIN APAGADO"). Lo que escribe el supervisor va
	// literal, porque también busca por nombre ("A-04", "Bidgar") y reducir eso
	// a dígitos lo dejaría vacío o por debajo del mínimo de 3 caracteres.
	const filtroInicial = limpiarPlacaParaBusqueda(placaSugerida ?? "");
	const [filtro, setFiltro] = useState(filtroInicial);
	const [filtroDebounced, setFiltroDebounced] = useState(filtroInicial);

	useEffect(() => {
		const timer = setTimeout(() => setFiltroDebounced(filtro.trim()), 300);
		return () => clearTimeout(timer);
	}, [filtro]);

	// Caso ambiguo: se arranca con los candidatos que ya resolvió el servidor,
	// sin ir al catálogo. Pero si ninguno es el correcto el supervisor tiene
	// que poder buscar otro: en cuanto cambia el filtro, manda la búsqueda.
	const usarCandidatos =
		candidatos.length > 0 && filtroDebounced === filtroInicial;

	const unidades = useQuery({
		...orpc.getWialonUnits.queryOptions({
			input: filtroDebounced ? { filterName: filtroDebounced } : {},
		}),
		enabled: !usarCandidatos && filtroDebounced.length >= 3,
		placeholderData: keepPreviousData,
	});

	const vincular = useMutation({
		...orpc.vincularUnidadWialon.mutationOptions(),
		onSuccess: (data) => {
			toast.success(`Unidad vinculada: ${data.unitName}`);
			onVinculado?.();
		},
		onError: (error) => {
			toast.error(error.message || "No se pudo vincular la unidad GPS");
		},
	});

	const opciones = usarCandidatos
		? candidatos
		: (unidades.data?.items ?? []).map((u) => ({ id: u.id, nm: u.nm }));

	return (
		<div className="space-y-3">
			<div>
				<Label className="text-xs" htmlFor={`buscar-unidad-${vehicleId}`}>
					{candidatos.length > 0
						? "¿Ninguna es la correcta? Buscar otra unidad en el catálogo de La Legión"
						: "Buscar unidad en el catálogo de La Legión"}
				</Label>
				<Input
					id={`buscar-unidad-${vehicleId}`}
					onChange={(e) => setFiltro(e.target.value)}
					placeholder="Placa o nombre de la unidad"
					value={filtro}
				/>
			</div>

			{!usarCandidatos && unidades.isFetching ? (
				<div className="flex justify-center py-2">
					<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
				</div>
			) : opciones.length === 0 ? (
				<p className="text-muted-foreground text-xs italic">
					{filtroDebounced.length >= 3
						? "Ninguna unidad coincide con la búsqueda."
						: "Escriba al menos 3 caracteres para buscar."}
				</p>
			) : (
				<ul className="divide-y rounded-md border">
					{opciones.slice(0, 20).map((unidad) => (
						<li
							className="flex items-center justify-between gap-2 px-3 py-2"
							key={unidad.id}
						>
							<span className="truncate text-sm">{unidad.nm}</span>
							<Button
								disabled={vincular.isPending}
								onClick={() =>
									vincular.mutate({
										unitId: unidad.id,
										unitName: unidad.nm,
										vehicleId,
									})
								}
								size="sm"
								variant="outline"
							>
								<Link2 className="mr-2 h-4 w-4" />
								Vincular
							</Button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

/**
 * Enlace público de rastreo en vivo (Wialon Locator). Solo supervisores: genera
 * una URL que funciona sin credenciales, y queda auditada en el servidor.
 */
function TrackingLinkDialog({
	unitId,
	unitName,
}: {
	unitId: number;
	unitName: string;
}) {
	const [abierto, setAbierto] = useState(false);
	const [horas, setHoras] = useState("24");
	const [nota, setNota] = useState("");
	const [url, setUrl] = useState<string | null>(null);

	const crear = useMutation({
		...orpc.createWialonTrackingLink.mutationOptions(),
		onSuccess: (data) => {
			setUrl(data.url);
			toast.success("Enlace de rastreo generado");
		},
		onError: (error) => {
			toast.error(error.message || "No se pudo generar el enlace de rastreo");
		},
	});

	const horasNum = Number(horas);
	const horasValidas =
		Number.isFinite(horasNum) && horasNum > 0 && horasNum <= 30 * 24;

	return (
		<>
			<Button onClick={() => setAbierto(true)} size="sm" variant="outline">
				<ExternalLink className="mr-2 h-4 w-4" />
				Generar enlace de rastreo
			</Button>

			<Dialog onOpenChange={setAbierto} open={abierto}>
				{/* grid-cols-1 = minmax(0, 1fr): sin esto la columna implícita del grid
				    toma el ancho completo de la URL generada (una sola "palabra" de
				    ~150 caracteres) y todo el contenido se sale del modal. */}
				<DialogContent className="grid-cols-1">
					<DialogHeader>
						<DialogTitle>Enlace de rastreo en vivo</DialogTitle>
						<DialogDescription className="break-words">
							Genera una URL pública para seguir a {unitName} en el mapa sin
							necesidad de credenciales. Compártala solo con quien deba ubicar
							el vehículo.
						</DialogDescription>
					</DialogHeader>

					<div className="space-y-3">
						<div>
							<Label htmlFor="duracion-tracking">Duración (horas)</Label>
							<Input
								id="duracion-tracking"
								max={30 * 24}
								min={1}
								onChange={(e) => setHoras(e.target.value)}
								type="number"
								value={horas}
							/>
							{!horasValidas && (
								<p className="mt-1 text-destructive text-xs">
									Ingrese entre 1 y 720 horas (30 días).
								</p>
							)}
						</div>
						<div>
							<Label htmlFor="nota-tracking">Motivo o nota</Label>
							<Input
								id="nota-tracking"
								maxLength={200}
								onChange={(e) => setNota(e.target.value)}
								placeholder="Ej: Entrega a gestor de recuperación"
								value={nota}
							/>
						</div>

						{url && (
							<div className="flex items-center gap-2 rounded-md border bg-muted/50 p-2">
								<span
									className="min-w-0 flex-1 select-all truncate text-xs"
									title={url}
								>
									{url}
								</span>
								<Button
									onClick={async () => {
										// En HTTP (contexto no seguro) navigator.clipboard ni
										// existe, y writeText también rechaza si la pestaña
										// pierde el foco: avisar en vez de fallar en silencio.
										try {
											await navigator.clipboard.writeText(url);
											toast.success("Enlace copiado");
										} catch {
											toast.error(
												"No se pudo copiar el enlace. Selecciónelo y cópielo manualmente.",
											);
										}
									}}
									size="sm"
									variant="ghost"
								>
									<Copy className="h-4 w-4" />
								</Button>
							</div>
						)}
					</div>

					<DialogFooter>
						<Button
							disabled={crear.isPending || !horasValidas}
							onClick={() =>
								crear.mutate({
									durationSeconds: Math.round(horasNum * 3600),
									unitId,
									...(nota.trim() ? { note: nota.trim() } : {}),
								})
							}
						>
							{crear.isPending ? (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							) : (
								<Gauge className="mr-2 h-4 w-4" />
							)}
							Generar enlace
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
