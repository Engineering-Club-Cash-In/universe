import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	Check,
	ChevronDown,
	ClipboardList,
	FileText,
	Loader2,
	Lock,
	LockOpen,
	PhoneCall,
	X,
} from "lucide-react";
import { useState } from "react";
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
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { authClient } from "@/lib/auth-client";
import {
	BUCKETS_CON_CARD_INMOVILIZACION,
	debeMostrarCardInmovilizacion,
} from "@/lib/inmovilizacion-card-gate";
import { type client, orpc } from "@/utils/orpc";
import {
	type DecisionInmovilizacion,
	DecisionInmovilizacionModal,
} from "./inmovilizacion-decision-modal";
import { EjecutarInmovilizacionModal } from "./inmovilizacion-ejecutar-modal";
import { RespaldoReactivacionResumen } from "./inmovilizacion-respaldo";
import { SolicitarInmovilizacionModal } from "./inmovilizacion-solicitar-modal";
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
}) {
	const queryClient = useQueryClient();
	const { data: session } = authClient.useSession();
	const [modalAbierto, setModalAbierto] = useState<
		"apagado" | "reactivacion" | null
	>(null);
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

	if (inmov.isLoading) {
		return (
			<Card>
				<CardContent className="flex items-center justify-center py-8">
					<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
				</CardContent>
			</Card>
		);
	}

	if (!inmov.data) return null;

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
		return null;
	}

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<CardTitle className="flex items-center gap-2 text-base">
						{estadoUnidad === "inmovilizada" ? (
							<Lock className="h-4 w-4 text-destructive" />
						) : (
							<LockOpen className="h-4 w-4 text-muted-foreground" />
						)}
						Inmovilización de unidad
					</CardTitle>
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
				<CardDescription>
					Solicitud de apagado o reactivación, con aprobación del supervisor.
					Ejecución manual: LEGION la aplica por fuera del CRM.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{solicitudAbierta && (
					<div className="rounded-md border bg-muted/40 p-3 text-sm">
						<p className="font-medium">
							{solicitudAbierta.accion === "apagado"
								? "Apagado"
								: "Reactivación"}{" "}
							—{" "}
							{ESTADO_LABEL[solicitudAbierta.estado] ?? solicitudAbierta.estado}
						</p>
						<p className="mt-1 text-muted-foreground">
							Motivo: {solicitudAbierta.motivo}
						</p>
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
								<p className="text-muted-foreground">
									Aprobada. Pedile a LEGION que{" "}
									{solicitudAbierta.accion === "apagado"
										? "apague"
										: "reactive"}{" "}
									la unidad y, cuando lo confirme, registralo acá con su
									confirmación.
								</p>
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
									{/* Si LEGION no lo aplica o ya no corresponde: sin esto la
									    solicitud quedaba aprobada para siempre. El server exige el
									    mismo acceso que para ejecutarlo. Solo para el apagado: la
									    cancelación de una reactivación aprobada no existe en el
									    server. */}
									{solicitudAbierta.accion === "apagado" && (
										<Button
											disabled={cancelar.isPending}
											onClick={() =>
												cancelar.mutate({ id: solicitudAbierta.id })
											}
											size="sm"
											variant="outline"
										>
											{cancelar.isPending && (
												<Loader2 className="mr-2 h-4 w-4 animate-spin" />
											)}
											Cancelar apagado
										</Button>
									)}
								</div>
							</div>
						)}
						{/* Antes de que se decida solo quien la pidió (el server aplica
						    la misma regla en cancelarSolicitud). */}
						{solicitudAbierta.estado === "pendiente_aprobacion" &&
							solicitudAbierta.solicitadoPor === session?.user?.id && (
								<Button
									className="mt-2"
									disabled={cancelar.isPending}
									onClick={() => cancelar.mutate({ id: solicitudAbierta.id })}
									size="sm"
									variant="outline"
								>
									{cancelar.isPending && (
										<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									)}
									Cancelar solicitud
								</Button>
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
								onClick={() => setModalAbierto("reactivacion")}
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
			</CardContent>

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
					onOpenChange={(open) => !open && setModalAbierto(null)}
					onSolicitado={invalidar}
					open={!!modalAbierto}
				/>
			)}
		</Card>
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
					? "Se ejecutó el apagado. Llamá al cliente para avisarle lo sucedido y registrá la llamada."
					: "Se ejecutó la reactivación. Llamá al cliente para avisarle que ya puede usar el vehículo y registrá la llamada."}
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
									{h.motivo && (
										<FilaDetalle etiqueta="Motivo">{h.motivo}</FilaDetalle>
									)}
									{h.estado === "rechazada" && h.motivoRechazo && (
										<FilaDetalle etiqueta="Rechazo">
											{h.motivoRechazo}
										</FilaDetalle>
									)}
									{h.accion === "reactivacion" &&
										(h.quePaso || h.respaldoReactivacion) && (
											<FilaDetalle etiqueta="Respaldo">
												<RespaldoReactivacionResumen
													quePaso={h.quePaso}
													respaldo={h.respaldoReactivacion}
												/>
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
