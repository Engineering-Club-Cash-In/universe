import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	CheckCircle2,
	ClipboardList,
	Loader2,
	Lock,
	LockOpen,
	PhoneCall,
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
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { authClient } from "@/lib/auth-client";
import { debeMostrarCardInmovilizacion } from "@/lib/inmovilizacion-card-gate";
import { client, orpc } from "@/utils/orpc";
import { SolicitarInmovilizacionModal } from "./inmovilizacion-solicitar-modal";

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
 * (integración `unit/exec_cmd` bloqueada, ver CB-120) — acá se solicita, se
 * aprueba, se deja constancia de la ejecución, y se enlaza la llamada
 * posterior al cliente con `registrarResultadoLlamada`.
 *
 * La gestión de la llamada se registra con el flujo normal de contacto de la
 * Ficha 360 (no se duplica acá) — este card solo ofrece ENLAZAR esa gestión
 * ya creada con la inmovilización, para no tocar `ContactoModal` (compartido
 * por toda la ficha) desde un componente de alcance chico.
 */
const BUCKETS_INMOVILIZACION = [2, 3];

export function InmovilizacionCard({
	bucketNumero,
	casoCobroId,
	esSupervisor,
}: {
	bucketNumero: number | null;
	casoCobroId: string;
	/** Supervisor o admin: puede ir directo a la cola de aprobación. */
	esSupervisor: boolean;
}) {
	const queryClient = useQueryClient();
	const { data: session } = authClient.useSession();
	const [modalAbierto, setModalAbierto] = useState<
		"apagado" | "reactivacion" | null
	>(null);

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
	// El apagado exige bucket B2/B3 (mismo criterio que el server,
	// lib/inmovilizacion-unidad.ts) y unidad GPS vinculada (wialonUnitId != null).
	const puedeApagar =
		tieneGps &&
		estadoUnidad === "activa" &&
		!solicitudAbierta &&
		bucketNumero !== null &&
		BUCKETS_INMOVILIZACION.includes(bucketNumero);
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
						{/* Solo quien la pidió, y solo antes de que se decida: el server
						    aplica la misma regla (cancelarSolicitud). */}
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
						casoCobroId={casoCobroId}
						ejecutadoAt={pendienteLlamar.ejecutadoAt}
						inmovilizacionId={pendienteLlamar.id}
						onEnlazado={invalidar}
					/>
				)}

				{pendienteLlamarReactivacion && (
					<LlamarClienteReactivacionBanner
						casoCobroId={casoCobroId}
						ejecutadoAt={pendienteLlamarReactivacion.ejecutadoAt}
						inmovilizacionId={pendienteLlamarReactivacion.id}
						onEnlazado={invalidar}
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

type ContactosCaso = Awaited<ReturnType<typeof client.getHistorialContactos>>;

/**
 * Se muestra cuando el apagado ya se ejecutó y falta registrar el resultado
 * de la llamada. La gestión (contacto) se registra con el flujo normal de la
 * ficha (Registrar Contacto) — acá solo se elige cuál de las gestiones
 * recientes fue esa llamada y se enlaza.
 */
function LlamarClienteBanner({
	casoCobroId,
	ejecutadoAt,
	inmovilizacionId,
	onEnlazado,
}: {
	casoCobroId: string;
	ejecutadoAt?: Date | string | null;
	inmovilizacionId: string;
	onEnlazado: () => void;
}) {
	const [contactoId, setContactoId] = useState<string>("");
	const [enviando, setEnviando] = useState(false);

	const contactos = useQuery({
		...orpc.getHistorialContactos.queryOptions({
			input: { casoCobroId, limit: 200 },
		}),
	});

	const disponibles: ContactosCaso =
		contactos.data?.filter(
			(c) =>
				!c.inmovilizacionId &&
				c.metodoContacto === "llamada" &&
				(!ejecutadoAt || new Date(c.fechaContacto) > new Date(ejecutadoAt)),
		) ?? [];

	async function registrar(resultado: "paga" | "no_paga") {
		if (!contactoId) {
			toast.error("Elegí primero la gestión que registra la llamada.");
			return;
		}
		setEnviando(true);
		try {
			await client.registrarResultadoLlamada({
				inmovilizacionId,
				contactoId,
				resultado,
			});
			toast.success(
				resultado === "paga"
					? "Registrado. Se abrió una solicitud de reactivación."
					: "Registrado. Podés enviar el crédito a recuperación desde el menú de acciones.",
			);
			onEnlazado();
		} catch (error) {
			toast.error(
				(error as { message?: string })?.message ??
					"No se pudo registrar el resultado de la llamada.",
			);
		} finally {
			setEnviando(false);
		}
	}

	return (
		<div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/30">
			<p className="flex items-center gap-2 font-medium text-amber-900 dark:text-amber-200">
				<PhoneCall className="h-4 w-4" />
				Pendiente: llamar al cliente
			</p>
			<p className="mt-1 text-amber-800 dark:text-amber-300">
				Se ejecutó el apagado. Registrá la llamada con "Registrar Contacto" y
				después elegila acá para cerrar el ciclo.
			</p>
			<div className="mt-3 flex flex-wrap items-center gap-2">
				<Select onValueChange={setContactoId} value={contactoId}>
					<SelectTrigger className="w-64">
						<SelectValue
							placeholder={
								contactos.isLoading
									? "Cargando llamadas..."
									: disponibles.length === 0
										? "Sin llamadas posteriores disponibles"
										: "Elegí la gestión de la llamada"
							}
						/>
					</SelectTrigger>
					<SelectContent>
						{disponibles.map((c) => (
							<SelectItem key={c.id} value={c.id}>
								{formatFechaHoraGT(c.fechaContacto)} —{" "}
								{c.metodoContacto} ({c.estadoContacto})
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Button
					disabled={enviando || !contactoId}
					onClick={() => registrar("paga")}
					size="sm"
				>
					<CheckCircle2 className="mr-2 h-4 w-4" />
					Pagó
				</Button>
				<Button
					disabled={enviando || !contactoId}
					onClick={() => registrar("no_paga")}
					size="sm"
					variant="outline"
				>
					No pagó
				</Button>
			</div>
		</div>
	);
}

/**
 * Se muestra cuando la reactivación ya se ejecutó y falta confirmar que el
 * asesor llamó al cliente. Sin bifurcación paga/no_paga: acá solo cierra el
 * ciclo, no hay siguiente paso que decidir.
 */
function LlamarClienteReactivacionBanner({
	casoCobroId,
	ejecutadoAt,
	inmovilizacionId,
	onEnlazado,
}: {
	casoCobroId: string;
	ejecutadoAt?: Date | string | null;
	inmovilizacionId: string;
	onEnlazado: () => void;
}) {
	const [contactoId, setContactoId] = useState<string>("");
	const [enviando, setEnviando] = useState(false);

	const contactos = useQuery({
		...orpc.getHistorialContactos.queryOptions({
			input: { casoCobroId, limit: 200 },
		}),
	});

	const disponibles: ContactosCaso =
		contactos.data?.filter(
			(c) =>
				!c.inmovilizacionId &&
				c.metodoContacto === "llamada" &&
				(!ejecutadoAt || new Date(c.fechaContacto) > new Date(ejecutadoAt)),
		) ?? [];

	async function registrar() {
		if (!contactoId) {
			toast.error("Elegí primero la gestión que registra la llamada.");
			return;
		}
		setEnviando(true);
		try {
			await client.registrarLlamadaReactivacion({ inmovilizacionId, contactoId });
			toast.success("Registrado.");
			onEnlazado();
		} catch (error) {
			toast.error(
				(error as { message?: string })?.message ??
					"No se pudo registrar la llamada.",
			);
		} finally {
			setEnviando(false);
		}
	}

	return (
		<div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/30">
			<p className="flex items-center gap-2 font-medium text-amber-900 dark:text-amber-200">
				<PhoneCall className="h-4 w-4" />
				Pendiente: llamar al cliente (unidad reactivada)
			</p>
			<p className="mt-1 text-amber-800 dark:text-amber-300">
				Se ejecutó la reactivación. Registrá la llamada con "Registrar
				Contacto" y después elegila acá para cerrar el ciclo.
			</p>
			<div className="mt-3 flex flex-wrap items-center gap-2">
				<Select onValueChange={setContactoId} value={contactoId}>
					<SelectTrigger className="w-64">
						<SelectValue
							placeholder={
								contactos.isLoading
									? "Cargando llamadas..."
									: disponibles.length === 0
										? "Sin llamadas posteriores disponibles"
										: "Elegí la gestión de la llamada"
							}
						/>
					</SelectTrigger>
					<SelectContent>
						{disponibles.map((c) => (
							<SelectItem key={c.id} value={c.id}>
								{formatFechaHoraGT(c.fechaContacto)} —{" "}
								{c.metodoContacto} ({c.estadoContacto})
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Button disabled={enviando || !contactoId} onClick={registrar} size="sm">
					<CheckCircle2 className="mr-2 h-4 w-4" />
					Ya llamé
				</Button>
			</div>
		</div>
	);
}

function HistorialInmovilizacion({
	historial,
}: {
	historial: Awaited<
		ReturnType<typeof client.getInmovilizacionesCaso>
	>["historial"];
}) {
	return (
		<div className="border-t pt-3">
			<p className="mb-2 font-medium text-muted-foreground text-xs">
				Historial
			</p>
			<ul className="space-y-1.5 text-xs">
				{historial.map((h) => (
					<li className="flex items-start justify-between gap-2" key={h.id}>
						<span>
							{h.accion === "apagado" ? "Apagado" : "Reactivación"} —{" "}
							{ESTADO_LABEL[h.estado] ?? h.estado}
						</span>
						<span className="whitespace-nowrap text-muted-foreground">
							{formatFechaGT(h.createdAt)}
						</span>
					</li>
				))}
			</ul>
		</div>
	);
}
