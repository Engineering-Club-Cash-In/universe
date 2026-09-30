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
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
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
						No tenés permiso para ver esta página.
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

const fechaHora = (v: Date | string | null | undefined) =>
	v
		? new Date(v).toLocaleString("es-GT", {
				day: "2-digit",
				month: "2-digit",
				year: "numeric",
				hour: "2-digit",
				minute: "2-digit",
			})
		: "—";

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
					Recuperación de vehículo
				</h1>
				<p className="text-muted-foreground text-sm">
					Solicitudes de los asesores para mandar un crédito a B4 y recuperar la
					unidad. Al aprobar, el crédito pasa a B4 · Última Instancia / Pre
					Jurídico en estado En recuperación.
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
				<TabsContent value="pendientes" className="space-y-3">
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
						pendientes.map((s) => <SolicitudPorAprobar key={s.id} s={s} />)
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

function LinkFicha({ s }: { s: Solicitud }) {
	return (
		<Link
			className="group inline-flex flex-col hover:underline"
			params={{ id: s.casoCobroId }}
			search={{ tipo: "caso" as const }}
			to="/cobros/$id"
		>
			<span className="flex items-center gap-1 font-semibold text-primary">
				{quienEs(s)}
				<ExternalLink className="h-3.5 w-3.5 opacity-60" />
			</span>
			<span className="font-mono text-muted-foreground text-xs">
				{s.numeroSifco}
			</span>
		</Link>
	);
}

function Dato({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="min-w-0">
			<p className="text-muted-foreground text-xs">{label}</p>
			<div className="break-words font-medium text-sm">{children}</div>
		</div>
	);
}

/** Lo que el supervisor necesita para decidir, sin abrir la ficha. */
function DetalleSolicitud({ s }: { s: Solicitud }) {
	const motivos = s.motivos.filter((m) => m !== "otro").map(etiquetaMotivo);
	const lat = s.ubicacionLat != null ? Number(s.ubicacionLat) : undefined;
	const lng = s.ubicacionLng != null ? Number(s.ubicacionLng) : undefined;
	const mapa = s.ubicacionEnlace ?? googleMapsUrl(lat, lng);
	const estadoVehiculo = s.estadoVehiculo
		? ((ESTADOS_VEHICULO as Record<string, string>)[s.estadoVehiculo] ??
			s.estadoVehiculo)
		: null;
	return (
		<div className="space-y-3">
			{motivos.length > 0 && (
				<div className="flex flex-wrap gap-1.5">
					{motivos.map((m) => (
						<Badge key={m} variant="outline" className="font-normal">
							{m}
						</Badge>
					))}
				</div>
			)}
			{s.motivoDetalle && (
				<div className="rounded-md bg-muted/50 p-3">
					<p className="mb-1 text-muted-foreground text-xs">Justificación</p>
					<p className="text-sm">“{s.motivoDetalle}”</p>
				</div>
			)}
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				<Dato label="Cuotas vencidas">{s.cuotasVencidas ?? "—"}</Dato>
				<Dato label="Para ponerse al día">
					{quetzales(s.totalParaPonerseAlDia)}
				</Dato>
				<Dato label="Saldo pendiente">{quetzales(s.saldoPendiente)}</Dato>
				<Dato label="Estado del vehículo">
					{estadoVehiculo ?? "No se indicó"}
				</Dato>
			</div>
			{(s.ubicacionDireccion || mapa) && (
				<Dato label="Dónde está el vehículo">
					{s.ubicacionDireccion && <span>{s.ubicacionDireccion} </span>}
					{mapa && (
						<a
							href={mapa}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-1 text-primary text-xs hover:underline"
						>
							<ExternalLink className="h-3 w-3" />
							Abrir en el mapa
						</a>
					)}
				</Dato>
			)}
			{s.observaciones && (
				<Dato label="Observaciones">
					<span className="font-normal">{s.observaciones}</span>
				</Dato>
			)}
		</div>
	);
}

function SolicitudPorAprobar({ s }: { s: Solicitud }) {
	const [decision, setDecision] = useState<"aprobar" | "rechazar" | null>(null);
	const resumen = resumenChecklist(s.checklist);
	return (
		<Card>
			<CardHeader className="pb-3">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="space-y-1">
						<LinkFicha s={s} />
						<CardDescription>
							La pidió {s.solicitante ?? "—"} {haceCuanto(s.solicitadoAt)} (
							{fechaHora(s.solicitadoAt)})
							{s.bucketOrigen != null ? ` · en B${s.bucketOrigen}` : ""}
						</CardDescription>
					</div>
					{/* Cuatro ojos: la propia no se decide (el servidor lo exige igual). */}
					{s.esMia ? (
						<p className="max-w-56 text-right text-muted-foreground text-xs">
							Es tu solicitud: la tiene que aprobar otro supervisor o admin. Si
							ya no aplica, cancelala desde la ficha.
						</p>
					) : (
						<div className="flex gap-2">
							<Button size="sm" onClick={() => setDecision("aprobar")}>
								<Check className="mr-1 h-4 w-4" />
								Aprobar
							</Button>
							<Button
								size="sm"
								variant="outline"
								onClick={() => setDecision("rechazar")}
							>
								<X className="mr-1 h-4 w-4" />
								Rechazar
							</Button>
						</div>
					)}
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				<DetalleSolicitud s={s} />
				<Collapsible defaultOpen className="border-t pt-3">
					<CollapsibleTrigger className="flex items-center gap-1 font-medium text-sm hover:underline">
						<ChevronDown className="h-4 w-4" />
						Checklist · {resumen.texto}
						{resumen.justificados > 0
							? `, ${resumen.justificados} justificados`
							: ""}
					</CollapsibleTrigger>
					<CollapsibleContent className="mt-2">
						<ChecklistVista pasos={s.checklist} />
					</CollapsibleContent>
				</Collapsible>
			</CardContent>
			{decision && (
				<DecidirSolicitudDialog
					solicitud={{ id: s.id, quien: quienEs(s) }}
					decision={decision}
					onOpenChange={(abierto) => {
						if (!abierto) setDecision(null);
					}}
				/>
			)}
		</Card>
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
		<Card>
			<CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
				<div>
					<CardTitle>Historial</CardTitle>
					<CardDescription>
						Las últimas {historial.length} solicitudes decididas.
					</CardDescription>
				</div>
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
			</CardHeader>
			<CardContent>
				{visibles.length === 0 ? (
					<p className="py-6 text-center text-muted-foreground text-sm">
						No hay solicitudes en este estado.
					</p>
				) : (
					<ul className="divide-y">
						{visibles.map((s) => (
							<li key={s.id}>
								<Collapsible>
									<div className="flex flex-wrap items-start justify-between gap-3 py-3">
										<div className="min-w-0 space-y-1">
											<LinkFicha s={s} />
											<p className="text-muted-foreground text-xs">
												Pidió {s.solicitante ?? "—"} el {fecha(s.solicitadoAt)}
												{s.decidioPor
													? ` · ${s.estadoSolicitud === "cancelada" ? "canceló" : "decidió"} ${s.decidioPor}`
													: ""}
												{s.decididoAt ? ` el ${fecha(s.decididoAt)}` : ""}
												{s.bucketOrigen != null
													? ` · B${s.bucketOrigen}${s.estadoSolicitud === "aprobada" ? ` → B${s.bucketDestino ?? 4}` : ""}`
													: ""}
											</p>
											{s.motivoDecision && (
												<p className="text-sm">{s.motivoDecision}</p>
											)}
										</div>
										<div className="flex items-center gap-2">
											<EstadoSolicitudBadge estado={s.estadoSolicitud} />
											<CollapsibleTrigger asChild>
												<Button size="sm" variant="ghost">
													<ChevronDown className="mr-1 h-4 w-4" />
													Ver
												</Button>
											</CollapsibleTrigger>
										</div>
									</div>
									<CollapsibleContent className="space-y-3 pb-4">
										<DetalleSolicitud s={s} />
										<ChecklistVista pasos={s.checklist} />
									</CollapsibleContent>
								</Collapsible>
							</li>
						))}
					</ul>
				)}
			</CardContent>
		</Card>
	);
}
