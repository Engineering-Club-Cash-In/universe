import {
	keepPreviousData,
	skipToken,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { Copy, ExternalLink, Gauge, Link2, Loader2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { useHistorialConsultasGps } from "@/components/cobros/gps-consultas-historial";
import type { EnVivoGps } from "@/components/cobros/ubicaciones/gps-derivar";
import { GpsUbicacionVista } from "@/components/cobros/ubicaciones/gps-ubicacion-vista";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { limpiarPlacaParaBusqueda } from "@/routes/cobros/-gps-ficha";
import { orpc } from "@/utils/orpc";

/**
 * Pestaña GPS / Wialon de la Ficha 360 (CB-118): datos y acciones. La vista
 * está en `ubicaciones/gps-ubicacion-vista.tsx`.
 *
 * Va como componente aparte y no inline en $id.tsx y con sus propias queries,
 * para que una consulta a Wialon —un proveedor externo que puede tardar o
 * estar caído— nunca retrase ni bloquee el resto de la ficha.
 *
 * Por defecto se ve la última consulta registrada (sale del historial, que
 * guarda lo que respondió Wialon): no hace falta consultar de nuevo para saber
 * dónde estaba el vehículo. Una consulta NUEVA sigue exigiendo motivo, porque
 * la historia pide que «cada consulta quede auditada con usuario, motivo y
 * cuenta». Por eso NO hay refetchInterval: un refresco silencioso no tendría
 * motivo que auditar.
 */
export function GpsVehiculoCard({
	casoCobroId,
	vehicleId,
	esSupervisor,
	embedded = false,
	activo = true,
	mapa,
}: {
	// El servidor valida acceso al caso y que el vehículo sea el suyo, y toma
	// de ahí el SIFCO de la bitácora (no se manda desde el cliente).
	casoCobroId: string;
	vehicleId: string;
	esSupervisor: boolean;
	// Dentro de una pestaña de VehiculoGpsTabs: sin marco de tarjeta ni título.
	embedded?: boolean;
	/**
	 * La pestaña está visible. Las pestañas quedan montadas: el historial se
	 * pide la primera vez que se abre (p. ej. no al llegar por el deep link de
	 * apagado).
	 */
	activo?: boolean;
	mapa?: ReactNode;
}) {
	const queryClient = useQueryClient();
	const [motivoConfirmado, setMotivoConfirmado] = useState<string | null>(null);
	const [abierta, setAbierta] = useState(activo);
	useEffect(() => {
		if (activo) setAbierta(true);
	}, [activo]);

	const gps = useQuery({
		...orpc.getGpsVehiculo.queryOptions({
			// skipToken es la forma que oRPC/TanStack reconocen para bloquear el
			// fetch de raíz: sin motivo confirmado ni siquiera se construye un
			// input inválido. Un `enabled` manual aparte no lo garantizaba —
			// alcanzaba a disparar la consulta con motivo:"" antes de tiempo.
			input:
				motivoConfirmado == null
					? skipToken
					: { casoCobroId, vehicleId, motivo: motivoConfirmado },
		}),
		// Cada fetch inserta una fila de auditoría en el servidor: ningún
		// refetch implícito (foco de ventana, reconexión, dato "stale", reintento)
		// puede dispararlo, o la bitácora registraría vistas que nadie pidió con
		// el motivo de una consulta anterior. gcTime 0: al desmontar la pestaña
		// la respuesta se descarta en vez de servirse desde caché.
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: 0,
		// El "retry" del toast global de errores invalida todas las queries;
		// esta marca la excluye (ver utils/orpc.ts).
		meta: { auditada: true },
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		refetchOnMount: false,
		retry: false,
	});

	const historial = useHistorialConsultasGps({
		casoCobroId,
		vehicleId,
		habilitado: abierta,
	});

	// La consulta inserta una fila en gps_consulta_logs: el historial se
	// refresca cuando termina, no antes (la fila aún no existe).
	const { dataUpdatedAt } = gps;
	useEffect(() => {
		if (dataUpdatedAt > 0) {
			queryClient.invalidateQueries({
				queryKey: orpc.getGpsConsultasCaso.key(),
			});
		}
	}, [dataUpdatedAt, queryClient]);

	const nuevaConsulta = (motivo: string) => {
		// Volver a consultar exige un motivo de nuevo, aunque sea el mismo
		// texto: cada vista queda auditada por separado. Con el mismo texto la
		// query no cambia de clave, así que se repite a mano.
		if (motivo === motivoConfirmado) void gps.refetch();
		else setMotivoConfirmado(motivo);
	};

	const enVivo: EnVivoGps | null =
		motivoConfirmado == null
			? null
			: gps.isFetching
				? { estado: "cargando", motivo: motivoConfirmado }
				: gps.data
					? {
							estado: "listo",
							motivo: motivoConfirmado,
							datos: gps.data,
							at: new Date(gps.dataUpdatedAt),
						}
					: gps.isError
						? {
								estado: "error",
								motivo: motivoConfirmado,
								mensaje:
									gps.error?.message || "Error inesperado al consultar el GPS.",
							}
						: { estado: "cargando", motivo: motivoConfirmado };

	const vinculado = gps.data?.estado === "vinculado" ? gps.data : null;

	const vista = (
		<GpsUbicacionVista
			enVivo={enVivo}
			esSupervisor={esSupervisor}
			extrasEnVivo={{
				acciones:
					esSupervisor && vinculado ? (
						<TrackingLinkDialog
							// key: al corregir el vínculo cambia la unidad y el diálogo se
							// reutilizaría con la URL de rastreo de la unidad ANTERIOR.
							key={vinculado.unitId}
							unitId={vinculado.unitId}
							unitName={vinculado.unitName}
						/>
					) : null,
				pie: vinculado ? (
					<>
						{vinculado.vinculoOrigen === "placa" ? (
							<p className="text-fg-tertiary text-xs">
								Unidad identificada automáticamente por la placa.
							</p>
						) : null}
						{/* También para vínculos que fijó un supervisor: si eligió mal,
						    esta es la única forma de corregirlo desde la UI. */}
						{esSupervisor ? (
							<CorregirVinculo
								onVinculado={() => gps.refetch()}
								placa={vinculado.placa}
								vehicleId={vehicleId}
							/>
						) : null}
					</>
				) : null,
				sinVinculo: (datos) =>
					esSupervisor ? (
						<SelectorUnidad
							candidatos={datos.candidatos}
							onVinculado={() => gps.refetch()}
							placaSugerida={datos.placa}
							vehicleId={vehicleId}
						/>
					) : (
						<p className="text-fg-secondary text-xs">
							Un supervisor puede vincular la unidad GPS de este vehículo.
						</p>
					),
			}}
			historial={historial.historial}
			historialActualizado={historial.dataUpdatedAt > gps.dataUpdatedAt}
			idCampo={`motivo-gps-${vehicleId}`}
			mapa={mapa}
			onConsultar={nuevaConsulta}
			paginacion={historial.paginacion}
		/>
	);

	if (embedded) return vista;
	return (
		<Card>
			<CardHeader>
				<CardTitle>GPS / Wialon</CardTitle>
			</CardHeader>
			<CardContent>{vista}</CardContent>
		</Card>
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
				¿No es la unidad correcta? Cambiar unidad
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
			// flags:1 = solo id/nm, que es lo único que usa el selector. Sin esto
			// Wialon aplica el default pesado (sensores, posición, mensajes) por
			// cada unidad que coincide y puede topar sus límites de paquete.
			input: filtroDebounced
				? { filterName: filtroDebounced, flags: 1 }
				: { flags: 1 },
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
						? "Buscar otra unidad en el catálogo de La Legión"
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
								placeholder="Ej.: Entrega a gestor de recuperación"
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
