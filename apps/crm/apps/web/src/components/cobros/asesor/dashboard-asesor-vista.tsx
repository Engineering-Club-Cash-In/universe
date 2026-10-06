import { Bell, TriangleAlert } from "lucide-react";
import type * as React from "react";
import { useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { AgendaHoy, type AgendaHoyProps } from "./agenda-hoy";
import { CasosAtencion, type CasosAtencionProps } from "./casos-atencion";
import {
	DistribucionCartera,
	type DistribucionCarteraProps,
} from "./dashboard-distribucion";
import { MiDesempeno, type MiDesempenoProps } from "./mi-desempeno";

/**
 * Dashboard del asesor de cobros — Figma «CRM Ventas» › Asesor Junior ›
 * 01 · Dashboard (junior y senior son la misma pantalla: cambian sus buckets).
 * Presentación pura: el contenedor (dashboard-asesor.tsx) hace las consultas y
 * el showcase "cobros-dashboard-asesor" la pinta con datos de ejemplo.
 *
 * Orden: encabezado → pendientes de apagado/reactivación → Agenda de hoy →
 * Mi desempeño → Distribución de mi cartera → Casos que requieren atención hoy.
 */

export type EncabezadoAsesorProps = {
	/** "Buen día" | "Buenas tardes" | "Buenas noches". */
	saludo: string;
	primerNombre: string;
	/** Notificaciones sin leer; `undefined` mientras carga. */
	noLeidas?: number;
	onCampana: () => void;
	/** El tablero no pudo leer todo de cartera (badge de "Datos parciales"). */
	datosParciales?: boolean;
};

export function saludoPorHora(fecha: Date = new Date()) {
	const h = fecha.getHours();
	if (h < 12) return "Buen día";
	if (h < 19) return "Buenas tardes";
	return "Buenas noches";
}

function EncabezadoAsesor({
	saludo,
	primerNombre,
	noLeidas,
	onCampana,
	datosParciales,
}: EncabezadoAsesorProps) {
	const n = noLeidas ?? 0;
	return (
		<header className="flex items-start justify-between gap-4">
			<div className="flex min-w-0 flex-col gap-1">
				<p className="font-medium text-[12px] text-fg-tertiary uppercase leading-[1.26] tracking-wide">
					Dashboard de cobros
				</p>
				<h1 className="type-heading-lg text-fg">
					{saludo}
					{primerNombre ? `, ${primerNombre}` : ""}
				</h1>
				<p className="text-[15px] text-fg-secondary leading-[1.4]">
					Este es el estado de su cartera hoy. Priorice la mora temprana y
					proteja su recuperación.
				</p>
			</div>
			<div className="flex shrink-0 items-center gap-2">
				{datosParciales ? (
					<Badge variant="warning" className="gap-1.5">
						<TriangleAlert aria-hidden className="size-3.5" />
						Datos parciales
					</Badge>
				) : null}
				<button
					type="button"
					onClick={onCampana}
					aria-label={
						n > 0
							? `Notificaciones: ${n} sin leer`
							: "Notificaciones: ninguna sin leer"
					}
					className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-line-subtle bg-surface px-3 text-fg-secondary shadow-clay-subtle outline-none transition-colors hover:bg-muted hover:text-fg focus-visible:ring-2 focus-visible:ring-ring"
				>
					<Bell aria-hidden className="size-4" />
					{n > 0 ? (
						<span className="inline-flex items-center gap-1 rounded-full bg-danger-subtle px-2 py-0.5 font-semibold text-[11px] text-danger-text tabular-nums leading-[1.26]">
							<span
								aria-hidden
								className="size-1.5 rounded-full bg-danger-solid"
							/>
							{n > 99 ? "99+" : n}
						</span>
					) : null}
				</button>
			</div>
		</header>
	);
}

export type DashboardAsesorVistaProps = {
	encabezado: EncabezadoAsesorProps;
	/** Trámites de apagado/reactivación (MisPendientesInmovilizacion). */
	pendientes?: React.ReactNode;
	agenda: AgendaHoyProps;
	desempeno: MiDesempenoProps;
	distribucion: DistribucionCarteraProps;
	casos: CasosAtencionProps;
	/** Vista rápida (PanelGestionRapida). */
	panel?: React.ReactNode;
};

export function DashboardAsesorVista({
	encabezado,
	pendientes,
	agenda,
	desempeno,
	distribucion,
	casos,
	panel,
}: DashboardAsesorVistaProps) {
	const tablaRef = useRef<HTMLDivElement>(null);
	const filtrar: AgendaHoyProps["onFiltro"] = (clave) => {
		agenda.onFiltro(clave);
		tablaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
	};

	return (
		<div className="flex w-full flex-col gap-8 px-4 py-6 sm:px-8 sm:py-7">
			<EncabezadoAsesor {...encabezado} />
			{pendientes}
			<AgendaHoy {...agenda} onFiltro={filtrar} />
			<MiDesempeno {...desempeno} />
			{/* Orden de Figma: Agenda → Mi desempeño → Casos de hoy. La distribución
			    (definición funcional del dashboard) va después para no correr la tabla. */}
			<div ref={tablaRef} className="scroll-mt-4">
				<CasosAtencion {...casos} />
			</div>
			<DistribucionCartera {...distribucion} />
			{panel}
		</div>
	);
}
