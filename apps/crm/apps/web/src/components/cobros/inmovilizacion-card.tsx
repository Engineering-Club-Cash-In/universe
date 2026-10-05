import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	Check,
	CheckCircle2,
	ChevronDown,
	CircleDashed,
	CircleDot,
	ClipboardList,
	FileText,
	Loader2,
	Lock,
	LockOpen,
	PhoneCall,
	RotateCcw,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MOTIVOS_INMOVILIZACION } from "server/src/lib/inmovilizacion-unidad";
import { toast } from "sonner";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { authClient } from "@/lib/auth-client";
import {
	BUCKETS_CON_CARD_INMOVILIZACION,
	debeMostrarCardInmovilizacion,
} from "@/lib/inmovilizacion-card-gate";
import {
	rechazadaReciente as buscarRechazadaReciente,
	estadoPasos,
	motivoSinSolicitud,
	pasosPendientes,
	type SiguientePaso,
} from "@/lib/inmovilizacion-siguiente-paso";
import { cn } from "@/lib/utils";
import { type client, orpc } from "@/utils/orpc";
import {
	type DecisionInmovilizacion,
	DecisionInmovilizacionModal,
} from "./inmovilizacion-decision-modal";
import { EjecutarInmovilizacionModal } from "./inmovilizacion-ejecutar-modal";
import { RespaldoReactivacionResumen } from "./inmovilizacion-respaldo";
import {
	type BorradorReactivacion,
	type PrecargaApagado,
	SolicitarInmovilizacionModal,
} from "./inmovilizacion-solicitar-modal";
import { UbicacionGuardada } from "./inmovilizacion-ubicacion";

const ESTADO_LABEL: Record<string, string> = {
	pendiente_aprobacion: "Pendiente de aprobación",
	aprobada: "Aprobada — por ejecutar",
	rechazada: "Rechazada",
	ejecutada: "Ejecutada",
	cancelada: "Cancelada",
};

function formatFechaGT(date: Date | string): string {
	return new Date(date).toLocaleDateString("es-GT", {
		timeZone: "America/Guatemala",
	});
}

function formatFechaHoraGT(date: Date | string): string {
	return new Date(date).toLocaleString("es-GT", {
		timeZone: "America/Guatemala",
	});
}

/**
 * CB-041 — Tarjeta de inmovilización (apagado/reactivación) en la Ficha 360.
 *
 * Modo manual: LEGION ejecuta el apagado/reactivación por fuera del CRM
 * (la integración `unit/exec_cmd` con el proveedor es futura).
 *
 * Apagado: el asesor solicita (con motivos y ubicación), el supervisor aprueba
 * y el ASESOR deja constancia de que LEGION lo aplicó (archivo y/o nota, más
 * la ubicación). Al registrarlo se abre solo "Registrar Contacto" para la
 * llamada al cliente; si se cierra sin guardar, el banner ofrece un botón para
 * volver a abrirlo. Reactivación: la ejecuta el supervisor desde la cola y el
 * asesor confirma su llamada con un select, como antes.
 *
 * La gestión de la llamada se registra con el flujo normal de contacto de la
 * Ficha 360 (no se duplica acá): la carta no crea contactos, pide abrirlos
 * (`onRegistrarLlamada`) y el `$id.tsx` enlaza la gestión creada.
 */

export function InmovilizacionCard({
	bucketNumero,
	casoCobroId,
	esSupervisor,
	onRegistrarLlamada,
	onRegistrarPromesa,
	onCrearConvenio,
	convenioBloqueo = null,
	reabrirReactivacion = false,
	onReactivacionReabierta,
	embedded = false,
}: {
	bucketNumero: number | null;
	casoCobroId: string;
	/** Supervisor o admin: puede ir directo a la cola de aprobación. */
	esSupervisor: boolean;
	/**
	 * Abre "Registrar Contacto" (llamada) para el apagado o la reactivación
	 * `inmovilizacionId` y, al guardarlo, enlaza la gestión a esa inmovilización
	 * (lo resuelve el padre: es quien tiene el modal de contacto).
	 */
	onRegistrarLlamada: (
		inmovilizacionId: string,
		accion: "apagado" | "reactivacion",
	) => void;
	/** Abre el formulario de promesa de la Ficha 360 (para respaldar una reactivación). */
	onRegistrarPromesa: () => void;
	/** Abre el modal de crear convenio de la Ficha 360. */
	onCrearConvenio: () => void;
	/** Por qué hoy no se puede crear un convenio; null si se puede. */
	convenioBloqueo?: string | null;
	/** Tras crear la promesa pedida desde el modal, vuelve a abrirlo. */
	reabrirReactivacion?: boolean;
	onReactivacionReabierta?: () => void;
	/**
	 * Dentro de una pestaña de VehiculoGpsTabs: sin marco de tarjeta ni título,
	 * y con aviso de vacío en vez de desaparecer (la pestaña ya existe).
	 */
	embedded?: boolean;
}) {
	const queryClient = useQueryClient();
	const { data: session } = authClient.useSession();
	const [modalAbierto, setModalAbierto] = useState<
		"apagado" | "reactivacion" | null
	>(null);
	// Lo que el asesor ya escribió en la reactivación: se conserva mientras va a
	// crear la promesa/convenio y vuelve; se descarta al cancelar o al abrirla de nuevo.
	const borradorRef = useRef<BorradorReactivacion | null>(null);
	// Motivos y detalle de un apagado rechazado, para corregirlo y volver a pedirlo.
	const [precargaApagado, setPrecargaApagado] =
		useState<PrecargaApagado | null>(null);
	const onReabiertaRef = useRef(onReactivacionReabierta);
	onReabiertaRef.current = onReactivacionReabierta;
	useEffect(() => {
		if (!reabrirReactivacion) return;
		// El respaldo recién creado (promesa/convenio) no está en la caché.
		queryClient.invalidateQueries({
			queryKey: orpc.getRespaldoReactivacion.key(),
		});
		setModalAbierto("reactivacion");
		onReabiertaRef.current?.();
	}, [reabrirReactivacion, queryClient]);
	const [ejecutando, setEjecutando] = useState<{
		id: string;
		accion: "apagado" | "reactivacion";
	} | null>(null);
	// Supervisor/admin decidiendo la solicitud abierta desde la Ficha 360.
	const [decision, setDecision] = useState<DecisionInmovilizacion | null>(null);

	const inmov = useQuery({
		...orpc.getInmovilizacionesCaso.queryOptions({
			input: { casoCobroId },
		}),
		staleTime: 30_000,
		refetchOnWindowFocus: false,
	});

	const invalidar = () =>
		queryClient.invalidateQueries({
			queryKey: orpc.getInmovilizacionesCaso.key({
				input: { casoCobroId },
			}),
		});

	const cancelar = useMutation({
		...orpc.cancelarSolicitud.mutationOptions(),
		onSuccess: () => {
			toast.success("Solicitud cancelada.");
			invalidar();
		},
		onError: (error) => {
			toast.error(error.message || "No se pudo cancelar la solicitud.");
		},
	});

	const sinInmovilizacion = embedded ? (
		<p className="text-muted-foreground text-sm">
			Este crédito no tiene inmovilización de unidad disponible.
		</p>
	) : null;

	if (inmov.isLoading) {
		const cargando = (
			<div className="flex items-center justify-center py-8">
				<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
			</div>
		);
		return embedded ? (
			cargando
		) : (
			<Card>
				<CardContent className="p-0">{cargando}</CardContent>
			</Card>
		);
	}

	if (!inmov.data) return sinInmovilizacion;

	const {
		estadoUnidad,
		solicitudAbierta,
		pendienteLlamar,
		pendienteLlamarReactivacion,
		tieneGps,
	} = inmov.data;
	// El apagado exige bucket B2/B3/B4 (mismo criterio que el server,
	// lib/inmovilizacion-unidad.ts) y unidad GPS vinculada (wialonUnitId != null).
	const puedeApagar =
		tieneGps &&
		estadoUnidad === "activa" &&
		!solicitudAbierta &&
		bucketNumero !== null &&
		BUCKETS_CON_CARD_INMOVILIZACION.includes(bucketNumero);
	const puedeReactivar =
		tieneGps && estadoUnidad === "inmovilizada" && !solicitudAbierta;
	const rechazada = buscarRechazadaReciente(
		inmov.data.historial,
		!!solicitudAbierta,
	);
	const pasos = pasosPendientes({
		solicitudAbierta,
		pendienteLlamar: !!pendienteLlamar,
		pendienteLlamarReactivacion: !!pendienteLlamarReactivacion,
		rechazadaReciente: rechazada,
		esSupervisor,
	});
	const motivoNoSolicita =
		puedeApagar || puedeReactivar
			? null
			: motivoSinSolicitud({
					tieneGps,
					estadoUnidad,
					hayAbierta: !!solicitudAbierta,
					bucketNumero,
					bucketsApagado: BUCKETS_CON_CARD_INMOVILIZACION,
				});
	// El rechazo no habilita lo que el crédito ya no permite (bucket, GPS, estado
	// de la unidad): el botón normal tampoco se mostraría.
	const volverASolicitarDeshabilitado = rechazada
		? rechazada.accion === "apagado"
			? !puedeApagar
			: !puedeReactivar
		: false;
	const volverASolicitar = () => {
		if (!rechazada) return;
		if (rechazada.accion === "apagado") {
			setPrecargaApagado({
				motivos: rechazada.motivos ?? [],
				detalle: rechazada.motivoDetalle ?? "",
			});
			setModalAbierto("apagado");
			return;
		}
		// El pago elegido pudo quedar desactualizado: se vuelve a elegir.
		borradorRef.current = {
			quePaso: (rechazada.quePaso ?? null) as BorradorReactivacion["quePaso"],
			pagoId: null,
			detalle: rechazada.motivoDetalle ?? "",
		};
		setModalAbierto("reactivacion");
	};

	if (
		!debeMostrarCardInmovilizacion({
			bucketNumero,
			haySolicitudAbierta: !!solicitudAbierta,
			hayPendienteLlamar: !!pendienteLlamar || !!pendienteLlamarReactivacion,
			historialLength: inmov.data.historial.length,
			unidadInmovilizada: estadoUnidad === "inmovilizada",
			tieneGps,
		})
	) {
		return sinInmovilizacion;
	}

	const Raiz = embedded ? "div" : Card;
	const Cabecera = embedded ? "div" : CardHeader;
	const Cuerpo = embedded ? "div" : CardContent;
	const Descripcion = embedded ? "p" : CardDescription;

	return (
		<Raiz>
			<Cabecera className={embedded ? "mb-3 space-y-1" : undefined}>
				<div className="flex items-center justify-between">
					{embedded ? (
						<span />
					) : (
						<CardTitle className="flex items-center gap-2 text-base">
							{estadoUnidad === "inmovilizada" ? (
								<Lock className="h-4 w-4 text-destructive" />
							) : (
								<LockOpen className="h-4 w-4 text-muted-foreground" />
							)}
							Apagado y reactivación de la unidad
						</CardTitle>
					)}
					<div className="flex items-center gap-2">
						{/* Solo supervisor/admin: la cola decide/ejecuta solicitudes de
						    TODOS los casos, no solo este — mismo gate que la ruta
						    (canAssignCobros). */}
						{esSupervisor && (
							<Button asChild size="sm" variant="outline">
								<Link to="/cobros/inmovilizaciones">
									<ClipboardList className="mr-2 h-4 w-4" />
									Ver cola de aprobación
								</Link>
							</Button>
						)}
						<Badge
							variant={
								estadoUnidad === "inmovilizada" ? "destructive" : "secondary"
							}
						>
							{estadoUnidad === "inmovilizada" ? "Inmovilizada" : "Activa"}
						</Badge>
					</div>
				</div>
				<Descripcion
					className={embedded ? "text-muted-foreground text-sm" : undefined}
				>
					Solicitud de apagado o reactivación, con aprobación del supervisor.
					Ejecución manual: LEGION la aplica por fuera del CRM.
				</Descripcion>
			</Cabecera>
			<Cuerpo className="space-y-4">
				{/* Un panel por pendiente: el rechazo reciente convive con otro trámite
				    en curso (p. ej. la llamada del apagado) en vez de quedar tapado. */}
				{pasos.map((paso, i) => (
					<GuiaPaso
						key={`${paso.accion}:${paso.accionSugerida}`}
						motivoNoSolicita={motivoNoSolicita}
						motivoRechazo={rechazada?.motivoRechazo ?? null}
						mostrarPasos={i === 0}
						onVolverASolicitar={volverASolicitar}
						paso={paso}
						solicitadoAt={
							solicitudAbierta?.estado === "pendiente_aprobacion"
								? solicitudAbierta.solicitadoAt
								: null
						}
						volverDeshabilitado={volverASolicitarDeshabilitado}
					/>
				))}
				{solicitudAbierta && (
					<div className="rounded-md border bg-muted/40 p-3 text-sm">
						<p className="font-medium">
							{solicitudAbierta.accion === "apagado"
								? "Apagado"
								: "Reactivación"}{" "}
							—{" "}
							{ESTADO_LABEL[solicitudAbierta.estado] ?? solicitudAbierta.estado}
						</p>
						{solicitudAbierta.accion === "apagado" && (
							<MotivoSolicitud fila={solicitudAbierta} />
						)}
						{solicitudAbierta.accion === "reactivacion" && (
							<div className="mt-2">
								<RespaldoReactivacionResumen
									bucket={
										bucketNumero !== null
											? `B${bucketNumero} (hoy)`
											: solicitudAbierta.bucketSnapshot != null
												? `B${solicitudAbierta.bucketSnapshot} (al solicitar)`
												: null
									}
									quePaso={solicitudAbierta.quePaso}
									respaldo={solicitudAbierta.respaldoReactivacion}
								/>
							</div>
						)}
						{solicitudAbierta.accion === "reactivacion" && (
							<MotivoSolicitud fila={solicitudAbierta} />
						)}
						<div className="mt-2">
							<UbicacionGuardada
								conMapa
								etiqueta="Ubicación al solicitar"
								ubicacion={solicitudAbierta.ubicacionSolicitud}
							/>
						</div>
						{/* Solo supervisor/admin (mismo gate que `decidirInmovilizacion` en
						    el server): aprobar o rechazar sin salir de la ficha. */}
						{esSupervisor &&
							solicitudAbierta.estado === "pendiente_aprobacion" && (
								<div className="mt-3 flex gap-2">
									<Button onClick={() => setDecision("aprobar")} size="sm">
										<Check className="mr-1 h-4 w-4" />
										Aprobar
									</Button>
									<Button
										onClick={() => setDecision("rechazar")}
										size="sm"
										variant="outline"
									>
										<X className="mr-1 h-4 w-4" />
										Rechazar
									</Button>
								</div>
							)}
						{/* El apagado lo ejecuta el asesor, no el supervisor: LEGION lo
						    aplica y acá se deja constancia con su confirmación. */}
						{solicitudAbierta.estado === "aprobada" && (
							<div className="mt-3 space-y-2">
								<div className="flex flex-wrap gap-2">
									<Button
										onClick={() =>
											setEjecutando({
												id: solicitudAbierta.id,
												accion: solicitudAbierta.accion,
											})
										}
										size="sm"
										variant={
											solicitudAbierta.accion === "apagado"
												? "destructive"
												: "default"
										}
									>
										{solicitudAbierta.accion === "apagado" ? (
											<Lock className="mr-2 h-4 w-4" />
										) : (
											<LockOpen className="mr-2 h-4 w-4" />
										)}
										{solicitudAbierta.accion === "apagado"
											? "Registrar apagado ejecutado"
											: "Registrar reactivación ejecutada"}
									</Button>
									<BotonCancelarConfirmado
										descripcion={
											solicitudAbierta.accion === "apagado"
												? "La solicitud de apagado ya está aprobada. Si la cancela, tendrá que solicitarla de nuevo y volver a esperar la aprobación del supervisor."
												: "La solicitud de reactivación ya está aprobada. Si la cancela, tendrá que solicitarla de nuevo y volver a esperar la aprobación del supervisor."
										}
										etiqueta={
											solicitudAbierta.accion === "apagado"
												? "Cancelar apagado"
												: "Cancelar reactivación"
										}
										onConfirmar={() =>
											cancelar.mutate({ id: solicitudAbierta.id })
										}
										pendiente={cancelar.isPending}
									/>
								</div>
							</div>
						)}
						{/* Antes de que se decida solo quien la pidió (el server aplica
						    la misma regla en cancelarSolicitud). */}
						{solicitudAbierta.estado === "pendiente_aprobacion" &&
							solicitudAbierta.solicitadoPor === session?.user?.id && (
								<BotonCancelarConfirmado
									className="mt-2"
									descripcion="Se retira la solicitud y el supervisor ya no tendrá que decidirla. Podrá solicitarla de nuevo cuando quiera."
									etiqueta="Cancelar solicitud"
									onConfirmar={() =>
										cancelar.mutate({ id: solicitudAbierta.id })
									}
									pendiente={cancelar.isPending}
								/>
							)}
					</div>
				)}

				{pendienteLlamar && (
					<LlamarClienteBanner
						accion="apagado"
						onRegistrarLlamada={() =>
							onRegistrarLlamada(pendienteLlamar.id, "apagado")
						}
					/>
				)}

				{pendienteLlamarReactivacion && (
					<LlamarClienteBanner
						accion="reactivacion"
						onRegistrarLlamada={() =>
							onRegistrarLlamada(pendienteLlamarReactivacion.id, "reactivacion")
						}
					/>
				)}

				{motivoNoSolicita &&
					!pasos.some((p) => p.accionSugerida === "volver_a_solicitar") && (
						<p className="text-muted-foreground text-sm">{motivoNoSolicita}</p>
					)}

				{!solicitudAbierta && (
					<div className="flex gap-2">
						{puedeApagar && (
							<Button
								onClick={() => setModalAbierto("apagado")}
								size="sm"
								variant="destructive"
							>
								<Lock className="mr-2 h-4 w-4" />
								Solicitar apagado
							</Button>
						)}
						{puedeReactivar && (
							<Button
								onClick={() => {
									borradorRef.current = null;
									setModalAbierto("reactivacion");
								}}
								size="sm"
								variant="outline"
							>
								<LockOpen className="mr-2 h-4 w-4" />
								Solicitar reactivación
							</Button>
						)}
					</div>
				)}

				{inmov.data.historial.length > 0 && (
					<HistorialInmovilizacion historial={inmov.data.historial} />
				)}
			</Cuerpo>

			{decision && solicitudAbierta && (
				<DecisionInmovilizacionModal
					decision={decision}
					id={solicitudAbierta.id}
					onOpenChange={(open) => !open && setDecision(null)}
					onResuelto={() => {
						invalidar();
						// La cola del supervisor también cambió.
						queryClient.invalidateQueries({
							queryKey: orpc.getColaInmovilizaciones.key(),
						});
					}}
					open
					resumen={`${
						solicitudAbierta.accion === "apagado" ? "Apagado" : "Reactivación"
					} — ${solicitudAbierta.motivo}`}
				/>
			)}

			{ejecutando && (
				<EjecutarInmovilizacionModal
					accion={ejecutando.accion}
					casoCobroId={casoCobroId}
					inmovilizacionId={ejecutando.id}
					onEjecutada={(id) => {
						invalidar();
						onRegistrarLlamada(id, ejecutando.accion);
					}}
					onOpenChange={(open) => !open && setEjecutando(null)}
					open={!!ejecutando}
				/>
			)}

			{modalAbierto && (
				<SolicitarInmovilizacionModal
					accion={modalAbierto}
					casoCobroId={casoCobroId}
					borrador={borradorRef.current}
					precargaApagado={precargaApagado}
					convenioBloqueo={convenioBloqueo}
					onBorradorChange={(b) => {
						borradorRef.current = b;
					}}
					onCrearConvenio={() => {
						setModalAbierto(null);
						onCrearConvenio();
					}}
					onOpenChange={(open) => {
						if (!open) {
							borradorRef.current = null;
							setPrecargaApagado(null);
							setModalAbierto(null);
						}
					}}
					onRegistrarPromesa={() => {
						setModalAbierto(null);
						onRegistrarPromesa();
					}}
					onSolicitado={() => {
						setPrecargaApagado(null);
						invalidar();
					}}
					open={!!modalAbierto}
				/>
			)}
		</Raiz>
	);
}

/** Cancelar una solicitud pide confirmación: deshace un trámite ya aprobado o en curso. */
function BotonCancelarConfirmado({
	etiqueta,
	descripcion,
	pendiente,
	onConfirmar,
	className,
}: {
	etiqueta: string;
	descripcion: string;
	pendiente: boolean;
	onConfirmar: () => void;
	className?: string;
}) {
	return (
		<AlertDialog>
			<AlertDialogTrigger asChild>
				<Button
					className={className}
					disabled={pendiente}
					size="sm"
					variant="outline"
				>
					{pendiente && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
					{etiqueta}
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>¿{etiqueta}?</AlertDialogTitle>
					<AlertDialogDescription>{descripcion}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Volver</AlertDialogCancel>
					<AlertDialogAction onClick={onConfirmar}>
						Sí, {etiqueta.toLowerCase()}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

/** Panel "qué sigue": paso actual del ciclo, instrucción y línea de pasos. */
function GuiaPaso({
	paso,
	motivoRechazo,
	solicitadoAt,
	onVolverASolicitar,
	volverDeshabilitado,
	motivoNoSolicita,
	mostrarPasos,
}: {
	paso: SiguientePaso;
	/** La línea de pasos solo en el primer panel: el rechazo no repite el ciclo. */
	mostrarPasos: boolean;
	motivoRechazo: string | null;
	solicitadoAt: Date | string | null;
	onVolverASolicitar: () => void;
	/** Hoy el crédito no permite volver a solicitar (bucket, GPS, estado de la unidad). */
	volverDeshabilitado: boolean;
	motivoNoSolicita: string | null;
}) {
	const rechazo = paso.accionSugerida === "volver_a_solicitar";
	return (
		<div
			className={cn(
				"rounded-md border p-3 text-sm",
				rechazo
					? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30"
					: "border-sky-200 bg-sky-50 dark:border-sky-900 dark:bg-sky-950/30",
			)}
		>
			{mostrarPasos && (
				<ol className="mb-3 flex flex-wrap items-center gap-x-1 gap-y-1 text-xs">
					{estadoPasos(paso.pasoActual).map((p, i) => (
						<li className="flex items-center gap-1" key={p.id}>
							{i > 0 && <span className="mx-1 text-muted-foreground">›</span>}
							{p.estado === "hecho" ? (
								<CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
							) : p.estado === "actual" ? (
								<CircleDot
									className={cn(
										"h-3.5 w-3.5",
										rechazo ? "text-red-600" : "text-sky-600",
									)}
								/>
							) : (
								<CircleDashed className="h-3.5 w-3.5 text-muted-foreground" />
							)}
							<span
								className={cn(
									p.estado === "actual" && "font-semibold",
									p.estado === "pendiente" && "text-muted-foreground",
								)}
							>
								{p.etiqueta}
							</span>
						</li>
					))}
				</ol>
			)}
			<p className="font-medium">{paso.titulo}</p>
			<p className="mt-0.5 text-muted-foreground">{paso.instruccion}</p>
			{solicitadoAt && (
				<p className="mt-1 text-muted-foreground text-xs">
					Enviada el {formatFechaHoraGT(solicitadoAt)}.
				</p>
			)}
			{rechazo && motivoRechazo && (
				<p className="mt-2">
					<span className="font-semibold">Motivo del rechazo:</span>{" "}
					{motivoRechazo}
				</p>
			)}
			{rechazo && (
				<Button
					className="mt-3"
					disabled={volverDeshabilitado}
					onClick={onVolverASolicitar}
					size="sm"
				>
					<RotateCcw className="mr-2 h-4 w-4" />
					Volver a solicitar
				</Button>
			)}
			{rechazo && volverDeshabilitado && motivoNoSolicita && (
				<p className="mt-2 text-muted-foreground text-xs">{motivoNoSolicita}</p>
			)}
		</div>
	);
}

/**
 * Se muestra cuando el apagado o la reactivación ya se ejecutó y falta la
 * llamada al cliente. Normalmente "Registrar Contacto" se abre solo al
 * ejecutarla; este banner es para quien lo cerró sin guardar (o vuelve
 * después): un botón para llamar de una vez. La gestión queda enlazada a la
 * inmovilización sola, sin elegirla de una lista.
 */
function LlamarClienteBanner({
	accion,
	onRegistrarLlamada,
}: {
	accion: "apagado" | "reactivacion";
	onRegistrarLlamada: () => void;
}) {
	return (
		<div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/30">
			<p className="flex items-center gap-2 font-medium text-amber-900 dark:text-amber-200">
				<PhoneCall className="h-4 w-4" />
				{accion === "apagado"
					? "Pendiente: llamar al cliente"
					: "Pendiente: llamar al cliente (unidad reactivada)"}
			</p>
			<p className="mt-1 text-amber-800 dark:text-amber-300">
				{accion === "apagado"
					? "Se ejecutó el apagado. Llame al cliente para informarle lo sucedido y registre la llamada."
					: "Se ejecutó la reactivación. Llame al cliente para informarle que ya puede usar el vehículo y registre la llamada."}
			</p>
			<Button className="mt-3" onClick={onRegistrarLlamada} size="sm">
				<PhoneCall className="mr-2 h-4 w-4" />
				Registrar llamada
			</Button>
		</div>
	);
}

const ESTADO_CONTACTO_LABEL: Record<string, string> = {
	contactado: "Contactado",
	no_contesta: "No contesta",
	mensaje_enviado: "Mensaje enviado",
	numero_equivocado: "Número equivocado",
	promesa_pago: "Promesa de pago",
	acuerdo_parcial: "Acuerdo parcial",
	rechaza_pagar: "Rechaza pagar",
};

type LlamadaHistorial = NonNullable<
	Awaited<
		ReturnType<typeof client.getInmovilizacionesCaso>
	>["historial"][number]["llamada"]
>;

function formatDuracion(segundos: number | null) {
	if (segundos == null) return null;
	const m = Math.floor(segundos / 60);
	const s = segundos % 60;
	return `${m}:${String(s).padStart(2, "0")} min`;
}

/** La llamada al cliente que quedó enlazada a la inmovilización, en solo lectura. */
function LlamadaDialog({
	llamada,
	onOpenChange,
}: {
	llamada: LlamadaHistorial | null;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<Dialog onOpenChange={onOpenChange} open={!!llamada}>
			<DialogContent className="sm:max-w-lg">
				{llamada && (
					<>
						<DialogHeader>
							<DialogTitle>Llamada al cliente</DialogTitle>
							<DialogDescription>
								{formatFechaHoraGT(llamada.fechaContacto)}
								{llamada.realizadoPorNombre
									? ` · registrada por ${llamada.realizadoPorNombre}`
									: ""}
							</DialogDescription>
						</DialogHeader>
						<dl className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-2 text-sm">
							<FilaDetalle etiqueta="Resultado">
								{ESTADO_CONTACTO_LABEL[llamada.estadoContacto] ??
									llamada.estadoContacto}
							</FilaDetalle>
							{formatDuracion(llamada.duracionLlamada) && (
								<FilaDetalle etiqueta="Duración">
									{formatDuracion(llamada.duracionLlamada)}
								</FilaDetalle>
							)}
							<FilaDetalle etiqueta="Comentarios">
								<span className="whitespace-pre-wrap">
									{llamada.comentarios}
								</span>
							</FilaDetalle>
							{llamada.acuerdosAlcanzados && (
								<FilaDetalle etiqueta="Acuerdos">
									<span className="whitespace-pre-wrap">
										{llamada.acuerdosAlcanzados}
									</span>
								</FilaDetalle>
							)}
						</dl>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}

const ESTADO_BADGE: Record<
	string,
	"default" | "secondary" | "destructive" | "outline"
> = {
	ejecutada: "default",
	aprobada: "secondary",
	pendiente_aprobacion: "outline",
	rechazada: "destructive",
	cancelada: "outline",
};

/** Una fila rotulada del detalle; no se pinta si no hay nada que mostrar. */
/**
 * Motivo de una solicitud con estructura: los motivos marcados como lista y
 * el detalle aparte. Filas viejas sin `motivos`/`motivoDetalle` caen al texto
 * compuesto de `motivo`.
 */
function MotivoSolicitud({
	fila,
}: {
	fila: {
		motivo: string;
		motivos?: string[] | null;
		motivoDetalle?: string | null;
	};
}) {
	const motivos = fila.motivos ?? [];
	const detalle = fila.motivoDetalle?.trim();
	if (motivos.length === 0 && !detalle) {
		return <p className="mt-1 text-muted-foreground">Motivo: {fila.motivo}</p>;
	}
	return (
		<div className="mt-2 space-y-2">
			{motivos.length > 0 && (
				<div>
					<p className="font-semibold">
						{motivos.length === 1 ? "Motivo" : "Motivos"}
					</p>
					<ul className="mt-0.5 list-disc space-y-0.5 pl-5 font-semibold">
						{motivos.map((m) => (
							<li key={m}>{MOTIVOS_INMOVILIZACION[m] ?? m}</li>
						))}
					</ul>
				</div>
			)}
			{detalle && (
				<div>
					<p className="font-semibold">Detalle</p>
					<p className="mt-0.5 whitespace-pre-wrap break-words">{detalle}</p>
				</div>
			)}
		</div>
	);
}

function FilaDetalle({
	etiqueta,
	children,
}: {
	etiqueta: string;
	children: React.ReactNode;
}) {
	return (
		<>
			<dt className="text-muted-foreground">{etiqueta}</dt>
			<dd className="min-w-0 break-words">{children}</dd>
		</>
	);
}

/**
 * Historial de la unidad: una tarjeta por solicitud. La línea de arriba (acción,
 * estado y fecha) siempre se ve; el detalle —motivo, quién la ejecutó, la
 * confirmación de LEGION, el respaldo y las ubicaciones— va debajo en filas
 * rotuladas, y solo la más reciente viene abierta.
 */
function HistorialInmovilizacion({
	historial,
}: {
	historial: Awaited<
		ReturnType<typeof client.getInmovilizacionesCaso>
	>["historial"];
}) {
	const [llamadaAbierta, setLlamadaAbierta] = useState<LlamadaHistorial | null>(
		null,
	);
	return (
		<div className="border-t pt-3">
			<p className="mb-2 font-medium text-muted-foreground text-xs">
				Historial
			</p>
			<LlamadaDialog
				llamada={llamadaAbierta}
				onOpenChange={() => setLlamadaAbierta(null)}
			/>
			<ul className="space-y-2">
				{historial.map((h, i) => {
					const ejecutada = h.estado === "ejecutada";
					return (
						<li className="rounded-md border" key={h.id}>
							<details className="group" open={i === 0}>
								<summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm [&::-webkit-details-marker]:hidden">
									<span className="flex items-center gap-2">
										{h.accion === "apagado" ? (
											<Lock className="h-4 w-4 text-destructive" />
										) : (
											<LockOpen className="h-4 w-4 text-muted-foreground" />
										)}
										<span className="font-medium">
											{h.accion === "apagado" ? "Apagado" : "Reactivación"}
										</span>
										<Badge variant={ESTADO_BADGE[h.estado] ?? "outline"}>
											{ESTADO_LABEL[h.estado] ?? h.estado}
										</Badge>
									</span>
									<span className="flex items-center gap-2 text-muted-foreground text-xs">
										{formatFechaGT(h.createdAt)}
										<ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
									</span>
								</summary>
								<dl className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-2 border-t px-3 py-2.5 text-xs">
									{h.accion === "reactivacion" &&
										(h.quePaso || h.respaldoReactivacion) && (
											<FilaDetalle etiqueta="Respaldo">
												<RespaldoReactivacionResumen
													quePaso={h.quePaso}
													respaldo={h.respaldoReactivacion}
												/>
											</FilaDetalle>
										)}
									{h.motivos?.length ? (
										<FilaDetalle etiqueta="Motivos">
											<ul className="list-disc pl-4 font-semibold">
												{h.motivos.map((m) => (
													<li key={m}>{MOTIVOS_INMOVILIZACION[m] ?? m}</li>
												))}
											</ul>
										</FilaDetalle>
									) : (
										// En una reactivación `motivo` es "opción — detalle": ambos ya
										// salen abajo (Respaldo y Detalle). Solo filas viejas sin ellos.
										h.motivo &&
										!h.motivoDetalle?.trim() &&
										!(h.accion === "reactivacion" && h.quePaso) && (
											<FilaDetalle etiqueta="Motivo">{h.motivo}</FilaDetalle>
										)
									)}
									{h.motivoDetalle?.trim() && (
										<FilaDetalle etiqueta="Detalle">
											<span className="whitespace-pre-wrap">
												{h.motivoDetalle}
											</span>
										</FilaDetalle>
									)}
									{h.estado === "rechazada" && h.motivoRechazo && (
										<FilaDetalle etiqueta="Rechazo">
											{h.motivoRechazo}
										</FilaDetalle>
									)}
									{ejecutada && h.ejecutadoPorNombre && (
										<FilaDetalle etiqueta="Registrado por">
											{h.ejecutadoPorNombre}
											{h.ejecutadoAt
												? ` · ${formatFechaHoraGT(h.ejecutadoAt)}`
												: ""}
										</FilaDetalle>
									)}
									{ejecutada && h.evidenciaNota && (
										<FilaDetalle etiqueta="Nota">{h.evidenciaNota}</FilaDetalle>
									)}
									{ejecutada && h.evidenciaUrl && (
										<FilaDetalle etiqueta="Confirmación">
											<a
												className="inline-flex items-center gap-1 text-primary hover:underline"
												href={h.evidenciaUrl}
												rel="noreferrer"
												target="_blank"
											>
												<FileText className="h-3.5 w-3.5" />
												{h.evidenciaNombreArchivo ?? "Confirmación de LEGION"}
											</a>
										</FilaDetalle>
									)}
									{h.llamada && (
										<FilaDetalle etiqueta="Llamada">
											{formatFechaHoraGT(h.llamada.fechaContacto)} ·{" "}
											{ESTADO_CONTACTO_LABEL[h.llamada.estadoContacto] ??
												h.llamada.estadoContacto}{" "}
											<button
												className="inline-flex items-center gap-1 text-primary hover:underline"
												onClick={() => setLlamadaAbierta(h.llamada)}
												type="button"
											>
												<PhoneCall className="h-3.5 w-3.5" />
												Ver llamada
											</button>
										</FilaDetalle>
									)}
									{h.accion === "apagado" && h.ubicacionSolicitud && (
										<FilaDetalle etiqueta="Ubicación al solicitar">
											<UbicacionGuardada
												historico
												ubicacion={h.ubicacionSolicitud}
											/>
										</FilaDetalle>
									)}
									{h.accion === "apagado" && h.ubicacionEjecucion && (
										<FilaDetalle etiqueta="Ubicación al ejecutar">
											<UbicacionGuardada
												historico
												ubicacion={h.ubicacionEjecucion}
											/>
										</FilaDetalle>
									)}
								</dl>
							</details>
						</li>
					);
				})}
			</ul>
		</div>
	);
}
