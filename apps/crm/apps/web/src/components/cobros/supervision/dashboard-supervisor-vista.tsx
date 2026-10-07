import { ArrowUpRight, LayoutList, TriangleAlert } from "lucide-react";
import type * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	AprobacionesPendientes,
	type AprobacionesPendientesProps,
} from "./aprobaciones-pendientes";
import {
	CarteraEquipoBucket,
	type CarteraEquipoBucketProps,
} from "./cartera-equipo-bucket";
import { DesempenoEquipo, type DesempenoEquipoProps } from "./desempeno-equipo";
import { type Destino, EnlaceDestino } from "./destino";
import { EquipoTabla, type EquipoTablaProps } from "./equipo-tabla";
import { LinksPago, type LinksPagoProps } from "./links-pago";
import { PendientesHoy, type PendientesHoyProps } from "./pendientes-hoy";

/**
 * Dashboard del supervisor de cobros — Figma «CRM Ventas» › Supervisor ›
 * Dashboard · Supervisor (`1954:14`). Lo ven supervisión y administración.
 * Presentación pura: el contenedor (dashboard-supervisor.tsx) hace las
 * consultas y el showcase "cobros-dashboard-supervisor" la pinta con datos de
 * ejemplo.
 *
 * Orden del Figma: encabezado → Sus pendientes de hoy → Desempeño del equipo →
 * Links de pago → Aprobaciones pendientes | (Cartera del equipo por bucket +
 * Equipo). La tabla de casos del dashboard anterior se reemplazó por el
 * acceso a la Cartera general (botón del encabezado), que tiene los mismos
 * filtros. Los indicadores sueltos del dashboard anterior (KPIs, promesas,
 * metas de mora, embudo y seguimientos) se quitaron a pedido del usuario.
 */

export type EncabezadoSupervisorProps = {
	/** "Buen día" | "Buenas tardes" | "Buenas noches". */
	saludo: string;
	primerNombre: string;
	/** Reportería de cobros. */
	reporteria: Destino;
	carteraGeneral: Destino;
	/** El tablero no pudo leer todo de cartera (badge de "Datos parciales"). */
	datosParciales?: boolean;
};

function EncabezadoSupervisor({
	saludo,
	primerNombre,
	reporteria,
	carteraGeneral,
	datosParciales,
}: EncabezadoSupervisorProps) {
	return (
		<header className="flex flex-wrap items-start justify-between gap-4">
			<div className="flex min-w-0 flex-col gap-1">
				<p className="font-medium text-[12px] text-fg-tertiary uppercase leading-[1.26] tracking-wide">
					Dashboard · Supervisor
				</p>
				<h1 className="type-heading-lg text-fg">
					{saludo}
					{primerNombre ? `, ${primerNombre}` : ""}
				</h1>
				<p className="text-[15px] text-fg-secondary leading-[1.4]">
					Estos son sus pendientes y el estado de su equipo hoy.
				</p>
			</div>
			{/* La campana de notificaciones del Figma ya está en la barra del CRM. */}
			<div className="flex flex-wrap items-center gap-2">
				{datosParciales ? (
					<Badge variant="warning" className="gap-1.5">
						<TriangleAlert aria-hidden className="size-3.5" />
						Datos parciales
					</Badge>
				) : null}
				<Button variant="outline" size="sm" asChild>
					<EnlaceDestino destino={reporteria}>
						Reportería
						<ArrowUpRight aria-hidden />
					</EnlaceDestino>
				</Button>
				<Button size="sm" asChild>
					<EnlaceDestino destino={carteraGeneral}>
						<LayoutList aria-hidden />
						Cartera general
					</EnlaceDestino>
				</Button>
			</div>
		</header>
	);
}

export type DashboardSupervisorVistaProps = {
	encabezado: EncabezadoSupervisorProps;
	/** El ítem `aprobaciones` sin destino baja al bloque de Aprobaciones. */
	pendientes: PendientesHoyProps;
	desempeno: DesempenoEquipoProps;
	links: LinksPagoProps;
	aprobaciones: AprobacionesPendientesProps;
	cartera: CarteraEquipoBucketProps;
	equipo: EquipoTablaProps;
	/** Vista rápida u otros modales del contenedor. */
	extra?: React.ReactNode;
};

export function DashboardSupervisorVista({
	encabezado,
	pendientes,
	desempeno,
	links,
	aprobaciones,
	cartera,
	equipo,
	extra,
}: DashboardSupervisorVistaProps) {
	const irAAprobaciones = () =>
		document
			.getElementById("aprobaciones-pendientes")
			?.scrollIntoView({ behavior: "smooth", block: "start" });
	const items = pendientes.items.map((i) =>
		i.clave === "aprobaciones" && !i.destino && !i.onClick
			? { ...i, onClick: irAAprobaciones }
			: i,
	);

	return (
		<div className="flex w-full flex-col gap-8 px-4 py-6 sm:px-8 sm:py-7">
			<EncabezadoSupervisor {...encabezado} />
			<PendientesHoy {...pendientes} items={items} />
			<DesempenoEquipo {...desempeno} />
			<LinksPago {...links} />
			<div className="grid items-start gap-5 lg:grid-cols-5">
				<div className="min-w-0 lg:col-span-2">
					<AprobacionesPendientes {...aprobaciones} />
				</div>
				<div className="flex min-w-0 flex-col gap-5 lg:col-span-3">
					<CarteraEquipoBucket {...cartera} />
					<EquipoTabla {...equipo} />
				</div>
			</div>
			{extra}
		</div>
	);
}
