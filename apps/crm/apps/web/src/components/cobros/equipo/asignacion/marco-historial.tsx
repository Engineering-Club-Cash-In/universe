import type * as React from "react";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { cn } from "@/lib/utils";

/**
 * Marco de las tablas del historial de «Mi equipo» › Carga y asignación
 * (Reasignaciones · Traslados · Coberturas), con el aspecto de la tabla del
 * design system (Figma Table/Cartera 131:1355): card con borde sutil y
 * Clay-Raised, barra de filtros arriba, encabezados en `bg/canvas` y la
 * paginación del DS al pie.
 */
export function MarcoHistorial({
	filtros,
	resumen,
	pie,
	children,
	className,
}: {
	/** Barra de filtros (controles compactos, hacen wrap). */
	filtros?: React.ReactNode;
	/** Línea de totales bajo los filtros. */
	resumen?: React.ReactNode;
	/** Paginación (`PieHistorial`). */
	pie?: React.ReactNode;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line-subtle bg-surface shadow-clay-raised contain-inline-size",
				className,
			)}
		>
			{filtros ? (
				<div className="flex flex-wrap items-center gap-2.5 px-4 py-3">
					{filtros}
				</div>
			) : null}
			{resumen ? (
				<div className="flex flex-wrap items-center gap-2 px-4 pb-3">
					{resumen}
				</div>
			) : null}
			{children}
			{pie}
		</div>
	);
}

/** Cargando, error o vacío dentro del marco. */
export function EstadoTabla({
	estado,
	onReintentar,
	children,
}: {
	estado: "cargando" | "error" | "vacio";
	onReintentar?: () => void;
	/** Texto del vacío o del error. */
	children?: React.ReactNode;
}) {
	return (
		<div
			role={estado === "error" ? "alert" : undefined}
			className="flex flex-col items-center gap-3 border-divider border-t px-4 py-10 text-center"
		>
			<p
				className={cn(
					"type-body-sm",
					estado === "error" ? "text-danger-text" : "text-fg-tertiary",
				)}
			>
				{estado === "cargando" ? "Cargando…" : children}
			</p>
			{estado === "error" && onReintentar ? (
				<Button variant="outline" size="sm" onClick={onReintentar}>
					Reintentar
				</Button>
			) : null}
		</div>
	);
}

/** Paginación del DS al pie del marco. */
export function PieHistorial(props: React.ComponentProps<typeof Pagination>) {
	return (
		<Pagination
			{...props}
			className={cn(
				"rounded-none border-0 border-divider border-t",
				props.className,
			)}
		/>
	);
}

/** «2026-10-06T15:20:00Z» → { fecha: «06/10/2026», hora: «09:20» } en Guatemala. */
export function fechaHoraGT(valor: string) {
	const d = new Date(valor);
	if (Number.isNaN(d.getTime())) return { fecha: valor, hora: "" };
	return {
		fecha: d.toLocaleDateString("es-GT", {
			timeZone: "America/Guatemala",
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
		}),
		hora: d.toLocaleTimeString("es-GT", {
			timeZone: "America/Guatemala",
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
		}),
	};
}

/** Celda de fecha: día 13/500 y hora 11 terciaria. */
export function CeldaFecha({ valor }: { valor: string }) {
	const { fecha, hora } = fechaHoraGT(valor);
	return (
		<span className="flex flex-col gap-0.5">
			<span className="font-medium text-[13px] text-fg leading-[1.26]">
				{fecha}
			</span>
			{hora ? (
				<span className="text-[11px] text-fg-tertiary leading-[1.26]">
					{hora}
				</span>
			) : null}
		</span>
	);
}

/** «2026-10-12» → «12/10/2026». */
export function fechaLegible(fecha: string) {
	const [y, m, d] = fecha.split("-");
	return y && m && d ? `${d}/${m}/${y}` : fecha;
}
