import { Link } from "@tanstack/react-router";
import type * as React from "react";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TabEquipo } from "./search";

/**
 * «Mi equipo» (`/cobros/equipo`) — Figma «Equipo · Supervisor» (2028:13):
 * migas «Dashboard / Equipo», título, subtítulo «N asesores · x Junior · y
 * Senior», las acciones «Trasladar cartera» y «Marcar ausente» (en las tres
 * pestañas) y tres pestañas (`?tab=`):
 *   - Asesores: las tarjetas del Figma.
 *   - Día: Apertura, Cierre y Gestiones del equipo.
 *   - Carga y asignación: carga, traslados, ausencias y su historial.
 * Presentación pura: cada pestaña llega armada por la ruta (o el showcase).
 */
export function MiEquipoVista({
	tab,
	onTab,
	subtitulo,
	acciones,
	asesores,
	dia,
	asignacion,
}: {
	tab: TabEquipo;
	onTab: (tab: TabEquipo) => void;
	/** «10 asesores · 6 Junior · 4 Senior»; null mientras carga. */
	subtitulo: string | null;
	/** «Trasladar cartera» y «Marcar ausente», visibles en las tres pestañas. */
	acciones?: React.ReactNode;
	asesores: React.ReactNode;
	dia: React.ReactNode;
	asignacion: React.ReactNode;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-4 px-4 py-6 sm:px-8 sm:py-7">
			<Breadcrumb>
				<BreadcrumbList>
					<BreadcrumbItem>
						<BreadcrumbLink asChild>
							<Link to="/cobros">Dashboard</Link>
						</BreadcrumbLink>
					</BreadcrumbItem>
					<BreadcrumbSeparator />
					<BreadcrumbItem>
						<BreadcrumbPage>Equipo</BreadcrumbPage>
					</BreadcrumbItem>
				</BreadcrumbList>
			</Breadcrumb>

			<header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
				<div className="flex min-w-0 flex-col gap-1">
					<h1 className="font-semibold text-[28px] text-fg leading-9">
						Mi equipo
					</h1>
					{subtitulo ? (
						<p className="type-body-base text-fg-secondary">{subtitulo}</p>
					) : (
						<Skeleton className="h-5 w-56" />
					)}
				</div>
				{acciones}
			</header>

			<Tabs
				value={tab}
				onValueChange={(v) => onTab(v as TabEquipo)}
				className="min-w-0 gap-5"
			>
				<TabsList className="overflow-x-auto">
					<TabsTrigger value="asesores">Asesores</TabsTrigger>
					<TabsTrigger value="dia">Día</TabsTrigger>
					<TabsTrigger value="asignacion">Carga y asignación</TabsTrigger>
				</TabsList>
				<TabsContent value="asesores" className="min-w-0">
					{asesores}
				</TabsContent>
				<TabsContent value="dia" className="min-w-0">
					{dia}
				</TabsContent>
				<TabsContent value="asignacion" className="min-w-0">
					{asignacion}
				</TabsContent>
			</Tabs>
		</div>
	);
}
