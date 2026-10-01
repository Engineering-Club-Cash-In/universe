import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	Car,
	Check,
	ChevronDown,
	ExternalLink,
	Loader2,
	X,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import {
	ESTADO_SOLICITUD_LABEL,
	type EstadoSolicitudRecuperacion,
	resumenChecklist,
} from "server/src/lib/recuperacion-solicitud";
import {
	ESTADOS_VEHICULO,
	etiquetaMotivo,
} from "server/src/lib/recuperacion-vehiculo";
import {
	ChecklistVista,
	DecidirSolicitudDialog,
	EstadoSolicitudBadge,
} from "@/components/cobros/recuperacion-checklist";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authClient } from "@/lib/auth-client";
import { PERMISSIONS } from "@/lib/roles";
import { googleMapsUrl } from "@/routes/cobros/-gps-ficha";
import { type client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/cobros/recuperaciones")({
	component: RecuperacionesPage,
});

/**
 * CB-043 — Solicitudes de recuperación de vehículo: lo que los asesores
 * pidieron mandar a B4, con la justificación y el checklist de lo que ya se
 * hizo, para que el supervisor apruebe o rechace sin abrir cada ficha. Solo
 * supervisor y admin (el servidor lo exige igual).
 */
function RecuperacionesPage() {
	// Mientras la sesión carga no se pinta "sin permiso" (mismo criterio que
	// inmovilizaciones.tsx y apertura.tsx).
	const { data: session, isPending: sesionCargando } = authClient.useSession();
	const userRole = session?.user?.role;

	if (sesionCargando) {
		return (
			<div className="flex min-h-[50vh] items-center justify-center text-muted-foreground">
				<Loader2 className="mr-2 h-5 w-5 animate-spin" />
				Cargando…
			</div>
		);
	}

	if (!userRole || !PERMISSIONS.canAssignCobros(userRole)) {
		return (
			<div className="p-6">
				<Card>
					<CardContent className="pt-6 text-center text-muted-foreground">
						No tiene permiso para ver esta página.
					</CardContent>
				</Card>
			</div>
		);
	}

	return <Bandeja />;
}

type Datos = Awaited<ReturnType<typeof client.getSolicitudesRecuperacion>>;
type Solicitud = Datos["pendientes"][number];

const fecha = (v: Date | string | null | undefined) =>
	v ? new Date(v).toLocaleDateString("es-GT") : "—";

const quetzales = (v: string | number | null | undefined) =>
	v == null
		? "—"
		: `Q${Number(v).toLocaleString("es-GT", {
				minimumFractionDigits: 2,
				maximumFractionDigits: 2,
			})}`;

/** "hace 3 horas" / "hace 2 días": cuánto lleva esperando. */
function haceCuanto(v: Date | string): string {
	const horas = Math.round((Date.now() - new Date(v).getTime()) / 3_600_000);
	const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
	if (horas < 24) return rtf.format(-horas, "hour");
	return rtf.format(-Math.round(horas / 24), "day");
}

const quienEs = (s: Solicitud) =>
	s.cliente?.trim() ? s.cliente.trim() : `El crédito ${s.numeroSifco}`;

function Bandeja() {
	const datos = useQuery({
		...orpc.getSolicitudesRecuperacion.queryOptions(),
		refetchOnWindowFocus: true,
	});
	const pendientes = datos.data?.pendientes ?? [];

	return (
		<div className="space-y-4 p-4 md:p-6">
			<div>
				<h1 className="flex items-center gap-2 font-semibold text-2xl">
					<Car className="h-6 w-6" />
					Recuperación del vehículo
				</h1>
				<p className="text-muted-foreground text-sm">
					Solicitudes de los asesores para enviar un crédito a B4. Al aprobarse,
					el crédito pasa a B4 en estado En recuperación.
				</p>
			</div>
			<Tabs className="w-full" defaultValue="pendientes">
				<TabsList>
					<TabsTrigger value="pendientes">
						Por aprobar
						{pendientes.length > 0 && (
							<Badge
								variant="secondary"
								className="ml-1.5 h-4 px-1 text-[10px]"
							>
								{pendientes.length}
							</Badge>
						)}
					</TabsTrigger>
					<TabsTrigger value="historial">Historial</TabsTrigger>
				</TabsList>
				<TabsContent value="pendientes">
					{datos.isLoading ? (
						<Cargando />
					) : datos.isError ? (
						<ErrorCarga mensaje={datos.error.message} />
					) : pendientes.length === 0 ? (
						<Card>
							<CardContent className="py-10 text-center text-muted-foreground text-sm">
								No hay solicitudes esperando aprobación.
							</CardContent>
						</Card>
					) : (
						<Card className="py-0">
							<ul className="divide-y">
								{pendientes.map((s) => (
									<SolicitudPorAprobar key={s.id} s={s} />
								))}
							</ul>
						</Card>
					)}
				</TabsContent>
				<TabsContent value="historial">
					{datos.isLoading ? (
						<Cargando />
					) : datos.isError ? (
						<ErrorCarga mensaje={datos.error.message} />
					) : (
						<Historial historial={datos.data?.historial ?? []} />
					)}
				</TabsContent>
			</Tabs>
		</div>
	);
}

function Cargando() {
	return (
		<Card>
			<CardContent className="flex items-center justify-center py-10 text-muted-foreground">
				<Loader2 className="mr-2 h-4 w-4 animate-spin" />
				Cargando…
			</CardContent>
		</Card>
	);
}

function ErrorCarga({ mensaje }: { mensaje: string }) {
	return (
		<Card>
			<CardContent className="py-10 text-center text-red-600 text-sm">
				{mensaje || "No se pudieron cargar las solicitudes."}
			</CardContent>
		</Card>
	);
}

/**
 * Una solicitud en pocas líneas: quién y dónde, por qué y los números. El
 * detalle (justificación completa, ubicación, checklist) queda plegado.
 */
function FilaSolicitud({
	s,
	acciones,
	pie,
}: {
	s: Solicitud;
	/** A la derecha: los botones de decisión, o el estado en el historial. */
	acciones: ReactNode;
	/** Una línea más abajo, para lo que se decidió (historial). */
	pie?: ReactNode;
}) {
	const motivos = s.motivos.filter((m) => m !== "otro").map(etiquetaMotivo);
	const resumen = resumenChecklist(s.checklist);
	return (
		<li className="px-4 py-3">
			<Collapsible>
				<div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
					<div className="min-w-0 flex-1 space-y-0.5">
						<div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
							<Link
								className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
								params={{ id: s.casoCobroId }}
								search={{ tipo: "caso" as const }}
								to="/cobros/$id"
							>
								{quienEs(s)}
								<ExternalLink className="h-3 w-3 opacity-60" />
							</Link>
							{s.bucketOrigen != null && (
								<Badge variant="outline" className="h-5 px-1.5 text-[11px]">
									B{s.bucketOrigen}
								</Badge>
							)}
							<span className="text-muted-foreground text-xs">
								{s.solicitante ?? "—"} · {haceCuanto(s.solicitadoAt)}
							</span>
						</div>
						<p className="line-clamp-2 text-sm">
							{motivos.length > 0 && (
								<span className="font-medium">{motivos.join(", ")}</span>
							)}
							{motivos.length > 0 && s.motivoDetalle ? " — " : ""}
							{s.motivoDetalle && (
								<span className="text-muted-foreground">
									“{s.motivoDetalle}”
								</span>
							)}
						</p>
						<p className="text-muted-foreground text-xs">
							{s.cuotasVencidas ?? "—"} cuotas vencidas ·{" "}
							{quetzales(s.totalParaPonerseAlDia)} para ponerse al día ·
							checklist {resumen.hechos}/{resumen.total}
						</p>
						{pie}
					</div>
					<div className="flex items-center gap-1.5">
						{acciones}
						<CollapsibleTrigger asChild>
							<Button size="sm" variant="ghost" className="h-8 px-2">
								<ChevronDown className="mr-1 h-4 w-4" />
								Detalle
							</Button>
						</CollapsibleTrigger>
					</div>
				</div>
				<CollapsibleContent className="mt-3 space-y-3 rounded-md bg-muted/40 p-3">
					<DetalleSolicitud s={s} />
					<ChecklistVista pasos={s.checklist} />
				</CollapsibleContent>
			</Collapsible>
		</li>
	);
}

/** Lo que no entra en la fila: la justificación completa, el vehículo y el saldo. */
function DetalleSolicitud({ s }: { s: Solicitud }) {
	const lat = s.ubicacionLat != null ? Number(s.ubicacionLat) : undefined;
	const lng = s.ubicacionLng != null ? Number(s.ubicacionLng) : undefined;
	const mapa = s.ubicacionEnlace ?? googleMapsUrl(lat, lng);
	const estadoVehiculo = s.estadoVehiculo
		? ((ESTADOS_VEHICULO as Record<string, string>)[s.estadoVehiculo] ??
			s.estadoVehiculo)
		: "no se indicó";
	return (
		<div className="space-y-1.5 text-sm">
			{s.motivoDetalle && <p>“{s.motivoDetalle}”</p>}
			<p className="text-muted-foreground text-xs">
				Saldo pendiente {quetzales(s.saldoPendiente)} · Vehículo:{" "}
				{estadoVehiculo}
				{s.ubicacionDireccion ? ` · ${s.ubicacionDireccion}` : ""}
				{mapa && (
					<>
						{" · "}
						<a
							href={mapa}
							target="_blank"
							rel="noopener noreferrer"
							className="text-primary hover:underline"
						>
							Abrir en el mapa
						</a>
					</>
				)}
			</p>
			{s.observaciones && (
				<p className="text-muted-foreground text-xs">
					Observaciones: {s.observaciones}
				</p>
			)}
		</div>
	);
}

function SolicitudPorAprobar({ s }: { s: Solicitud }) {
	const [decision, setDecision] = useState<"aprobar" | "rechazar" | null>(null);
	return (
		<>
			<FilaSolicitud
				s={s}
				acciones={
					// Cuatro ojos: la propia no se decide (el servidor lo exige igual).
					s.esMia ? (
						<Badge
							variant="secondary"
							title="Debe aprobarla otro supervisor o administrador. Si ya no aplica, cancélela desde la ficha."
						>
							Su solicitud
						</Badge>
					) : (
						<>
							<Button
								size="sm"
								className="h-8"
								onClick={() => setDecision("aprobar")}
							>
								<Check className="mr-1 h-4 w-4" />
								Aprobar
							</Button>
							<Button
								size="sm"
								variant="outline"
								className="h-8"
								onClick={() => setDecision("rechazar")}
							>
								<X className="mr-1 h-4 w-4" />
								Rechazar
							</Button>
						</>
					)
				}
			/>
			{decision && (
				<DecidirSolicitudDialog
					solicitud={{ id: s.id, quien: quienEs(s) }}
					decision={decision}
					onOpenChange={(abierto) => {
						if (!abierto) setDecision(null);
					}}
				/>
			)}
		</>
	);
}

const FILTROS_HISTORIAL = [
	"todas",
	"aprobada",
	"rechazada",
	"cancelada",
	"sin_efecto",
] as const;

function Historial({ historial }: { historial: Solicitud[] }) {
	const [filtro, setFiltro] =
		useState<(typeof FILTROS_HISTORIAL)[number]>("todas");
	const visibles =
		filtro === "todas"
			? historial
			: historial.filter((s) => s.estadoSolicitud === filtro);
	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<p className="text-muted-foreground text-sm">
					Las últimas {historial.length} solicitudes decididas.
				</p>
				<Select
					value={filtro}
					onValueChange={(v) =>
						setFiltro(v as (typeof FILTROS_HISTORIAL)[number])
					}
				>
					<SelectTrigger className="w-44" aria-label="Filtrar por estado">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{FILTROS_HISTORIAL.map((f) => (
							<SelectItem key={f} value={f}>
								{f === "todas"
									? "Todas"
									: ESTADO_SOLICITUD_LABEL[f as EstadoSolicitudRecuperacion]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			{visibles.length === 0 ? (
				<Card>
					<CardContent className="py-10 text-center text-muted-foreground text-sm">
						No hay solicitudes en este estado.
					</CardContent>
				</Card>
			) : (
				<Card className="py-0">
					<ul className="divide-y">
						{visibles.map((s) => (
							<FilaSolicitud
								key={s.id}
								s={s}
								acciones={<EstadoSolicitudBadge estado={s.estadoSolicitud} />}
								pie={
									<p className="text-muted-foreground text-xs">
										{s.estadoSolicitud === "cancelada"
											? "Cancelada por"
											: "Decidida por"}{" "}
										{s.decidioPor ?? "—"} el {fecha(s.decididoAt)}
										{s.motivoDecision ? `: ${s.motivoDecision}` : ""}
									</p>
								}
							/>
						))}
					</ul>
				</Card>
			)}
		</div>
	);
}
