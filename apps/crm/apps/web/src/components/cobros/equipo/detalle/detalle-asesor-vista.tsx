import {
	ArrowLeft,
	ArrowLeftRight,
	LayoutList,
	TriangleAlert,
	UserRound,
	UserX,
} from "lucide-react";
import type * as React from "react";
import {
	ESTADO_ASESOR_CLASE,
	ESTADO_ASESOR_LABEL,
	type EstadoAsesor,
	etiquetaNivel,
	iniciales,
	type NivelAsesor,
} from "@/components/cobros/equipo/estado-asesor";
import { EnlaceDestino } from "@/components/cobros/supervision/destino";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
	ETIQUETA_TAB,
	enlacesAsesor,
	TABS_DETALLE,
	type TabDetalle,
} from "./enlaces";

/**
 * Detalle del asesor — Figma «CRM Ventas» › Supervisor › Detalle de asesor
 * (2082:13). Presentación pura del marco de la pantalla: migas, «← Volver a
 * Mi equipo», encabezado (avatar, nombre, nivel, chip de estado, acciones y
 * selector de asesor) y las pestañas Resumen, Agenda, Actividad y Solicitudes.
 * El contenido de cada pestaña llega ya armado (el contenedor pasa los
 * contenedores; el showcase, las vistas con datos de ejemplo).
 *
 * Los frames 3650:5563 (Cartera del asesor), 3662:5853 (Casos críticos),
 * 4063:12 (Historial de actividad) y 3654:5711 (Solicitudes) no son páginas
 * aparte: la cartera y los casos críticos abren la Cartera general con
 * `?asesor=` y su filtro, y la actividad y las solicitudes son pestañas.
 */

export type AsesorEncabezado = {
	asesorId: number;
	nombre: string;
	nivel: NivelAsesor | null;
	/** `null` mientras se calcula (agenda, contactabilidad y coberturas). */
	estado: EstadoAsesor | null;
	/** «Ausente · Vacaciones · vuelve el 30 sep». */
	ausencia?: string | null;
};

export type CargaDetalle =
	| { tipo: "cargando" }
	| {
			tipo: "error";
			titulo: string;
			descripcion: string;
			onReintentar?: () => void;
	  }
	| { tipo: "listo"; asesor: AsesorEncabezado };

export type DetalleAsesorVistaProps = {
	/** `asesor_id` de la URL (sirve aunque el asesor no se haya resuelto). */
	asesorId: number;
	carga: CargaDetalle;
	/** Opciones del selector de asesor (catálogo de cartera). */
	asesores: { asesorId: number; nombre: string }[];
	onCambiarAsesor: (asesorId: number) => void;
	tab: TabDetalle;
	onTab: (tab: TabDetalle) => void;
	contenido: Record<TabDetalle, React.ReactNode>;
	/**
	 * Pestañas que ya se abrieron: quedan montadas (ocultas) para no perder sus
	 * filtros y su página al ir y volver. Por defecto, solo la activa.
	 */
	montadas?: readonly TabDetalle[];
	/** Avisos sobre los datos del asesor (p. ej. sin usuario del CRM). */
	avisos?: string[];
	/** Abre «Trasladar cartera» sobre el detalle (si falta, enlaza a Mi equipo). */
	onTrasladar?: () => void;
	/** Abre «Marcar ausente» sobre el detalle (si falta, enlaza a Mi equipo). */
	onMarcarAusente?: () => void;
};

export function EstadoAsesorChip({
	estado,
	className,
}: {
	estado: EstadoAsesor | null;
	className?: string;
}) {
	if (!estado) return <Skeleton className="h-6 w-28 rounded-full" />;
	const clase = ESTADO_ASESOR_CLASE[estado];
	return (
		<span
			className={cn(
				"type-label-sm inline-flex w-fit shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1",
				clase.chip,
				className,
			)}
		>
			<span aria-hidden className={cn("size-1.5 rounded-full", clase.punto)} />
			{ESTADO_ASESOR_LABEL[estado]}
		</span>
	);
}

function SelectorAsesorDetalle({
	asesorId,
	asesores,
	onCambiar,
	nombreActual,
}: {
	asesorId: number;
	asesores: { asesorId: number; nombre: string }[];
	onCambiar: (asesorId: number) => void;
	nombreActual?: string;
}) {
	// Un asesor que ya no está en el catálogo (inactivo) igual se muestra.
	const opciones = asesores.some((a) => a.asesorId === asesorId)
		? asesores
		: [
				...asesores,
				{ asesorId, nombre: nombreActual ?? `Asesor #${asesorId}` },
			];
	return (
		<Select
			value={String(asesorId)}
			onValueChange={(v) => onCambiar(Number(v))}
		>
			<SelectTrigger
				size="sm"
				className="w-full sm:w-60"
				aria-label="Cambiar de asesor"
			>
				<span className="flex min-w-0 items-center gap-2">
					<UserRound aria-hidden className="size-3.5 shrink-0" />
					<SelectValue placeholder="Elegir asesor" />
				</span>
			</SelectTrigger>
			<SelectContent size="sm">
				{opciones.map((a) => (
					<SelectItem key={a.asesorId} value={String(a.asesorId)}>
						{a.nombre}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

export function DetalleAsesorVista({
	asesorId,
	carga,
	asesores,
	onCambiarAsesor,
	tab,
	onTab,
	contenido,
	montadas = [tab],
	avisos = [],
	onTrasladar,
	onMarcarAusente,
}: DetalleAsesorVistaProps) {
	const enlaces = enlacesAsesor(asesorId);
	const asesor = carga.tipo === "listo" ? carga.asesor : null;
	const nombreMigas =
		asesor?.nombre ??
		asesores.find((a) => a.asesorId === asesorId)?.nombre ??
		`Asesor #${asesorId}`;
	const visibles = new Set<TabDetalle>([...montadas, tab]);

	return (
		<div className="flex w-full min-w-0 flex-col gap-6 px-4 py-6 sm:px-8 sm:py-7">
			<div className="flex flex-col gap-3">
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink asChild>
								<EnlaceDestino destino={enlaces.dashboard}>
									Dashboard
								</EnlaceDestino>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbLink asChild>
								<EnlaceDestino destino={enlaces.equipo}>Equipo</EnlaceDestino>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>{nombreMigas}</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
				<EnlaceDestino
					destino={enlaces.equipo}
					className="inline-flex w-fit items-center gap-1 rounded-sm font-medium text-brand text-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
				>
					<ArrowLeft aria-hidden className="size-3.5" />
					Volver a Mi equipo
				</EnlaceDestino>
			</div>

			<header className="flex flex-wrap items-start justify-between gap-4">
				<div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-3">
					<div className="flex min-w-0 items-center gap-3">
						<Avatar size="md">
							{asesor ? (
								<AvatarFallback>{iniciales(asesor.nombre)}</AvatarFallback>
							) : (
								<AvatarFallback variant="empty" />
							)}
						</Avatar>
						<div className="flex min-w-0 flex-col gap-0.5">
							{asesor ? (
								<>
									<h1 className="type-heading-lg wrap-break-word text-fg">
										{asesor.nombre}
									</h1>
									<p className="text-[15px] text-fg-secondary leading-[1.4]">
										{etiquetaNivel(asesor.nivel)}
										{asesor.ausencia ? (
											<span className="text-fg-tertiary">
												{" "}
												· {asesor.ausencia}
											</span>
										) : null}
									</p>
								</>
							) : carga.tipo === "cargando" ? (
								<>
									<Skeleton className="h-7 w-48" />
									<Skeleton className="h-4 w-28" />
								</>
							) : (
								<h1 className="type-heading-lg text-fg">{nombreMigas}</h1>
							)}
						</div>
					</div>
					{asesor ? <EstadoAsesorChip estado={asesor.estado} /> : null}
					{/* Las acciones solo con el asesor resuelto: con un número que no
					    está en el pool no hay a quién trasladar ni marcar ausente. */}
					{asesor ? (
						<div className="flex flex-wrap items-center gap-2">
							{/* Las dos acciones son primarias, como en Mi equipo. Con
							    `onTrasladar`/`onMarcarAusente` abren el modal aquí mismo;
							    sin ellos (showcase) llevan a Mi equipo con el modal abierto. */}
							{onTrasladar ? (
								<Button size="sm" onClick={onTrasladar}>
									<ArrowLeftRight aria-hidden />
									Trasladar cartera
								</Button>
							) : (
								<Button size="sm" asChild>
									<EnlaceDestino destino={enlaces.trasladar}>
										<ArrowLeftRight aria-hidden />
										Trasladar cartera
									</EnlaceDestino>
								</Button>
							)}
							{onMarcarAusente ? (
								<Button size="sm" onClick={onMarcarAusente}>
									<UserX aria-hidden />
									Marcar ausente
								</Button>
							) : (
								<Button size="sm" asChild>
									<EnlaceDestino destino={enlaces.ausente}>
										<UserX aria-hidden />
										Marcar ausente
									</EnlaceDestino>
								</Button>
							)}
							<Button variant="outline" size="sm" asChild>
								<EnlaceDestino destino={enlaces.casos}>
									<LayoutList aria-hidden />
									Ver sus casos
								</EnlaceDestino>
							</Button>
						</div>
					) : null}
				</div>
				<SelectorAsesorDetalle
					asesorId={asesorId}
					asesores={asesores}
					onCambiar={onCambiarAsesor}
					nombreActual={asesor?.nombre}
				/>
			</header>

			{avisos.length > 0 ? (
				<ul className="flex flex-col gap-2">
					{avisos.map((a) => (
						<li
							key={a}
							className="type-body-sm flex items-start gap-2 rounded-xl bg-warning-subtle px-3 py-2 text-warning-text"
						>
							<TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
							{a}
						</li>
					))}
				</ul>
			) : null}

			{carga.tipo === "error" ? (
				<div className="rounded-2xl bg-surface shadow-clay-raised">
					<EmptyState
						variant="error"
						title={carga.titulo}
						description={carga.descripcion}
						action={
							carga.onReintentar ? (
								<Button size="sm" onClick={carga.onReintentar}>
									Reintentar
								</Button>
							) : (
								<Button size="sm" variant="outline" asChild>
									<EnlaceDestino destino={enlaces.equipo}>
										Volver a Mi equipo
									</EnlaceDestino>
								</Button>
							)
						}
					/>
				</div>
			) : carga.tipo === "cargando" ? (
				<div className="flex flex-col gap-4">
					<Skeleton className="h-11 w-full max-w-md" />
					<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
						{[0, 1, 2, 3].map((i) => (
							<Skeleton key={i} className="h-32 rounded-2xl" />
						))}
					</div>
				</div>
			) : (
				<Tabs value={tab} onValueChange={(v) => onTab(v as TabDetalle)}>
					<div className="overflow-x-auto contain-inline-size">
						<TabsList>
							{TABS_DETALLE.map((t) => (
								<TabsTrigger key={t} value={t}>
									{ETIQUETA_TAB[t]}
								</TabsTrigger>
							))}
						</TabsList>
					</div>
					{TABS_DETALLE.filter((t) => visibles.has(t)).map((t) => (
						// forceMount: una pestaña ya abierta se oculta en vez de
						// desmontarse, así conserva su página, su búsqueda por SIFCO y
						// sus filtros al ir y volver (como en el Historial de agendas).
						<TabsContent
							key={t}
							value={t}
							forceMount
							className="mt-4 min-w-0 data-[state=inactive]:hidden"
						>
							{contenido[t]}
						</TabsContent>
					))}
				</Tabs>
			)}
		</div>
	);
}
