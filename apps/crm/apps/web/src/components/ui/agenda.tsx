import { cva } from "class-variance-authority";
import { Calendar, type LucideIcon, Phone } from "lucide-react";
import { Collapsible } from "radix-ui";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/section-header";
import { cn } from "@/lib/utils";

/**
 * Agenda + Agenda / Item — Figma "02 · Componentes › Navegación de bloques"
 * (Agenda 338:4259, Agenda / Item 336:1451).
 *
 * Agenda de trabajo expandible: el resumen queda siempre visible y el timeline se despliega
 * debajo, empujando el contenido (Radix Collapsible; sin overlays).
 *
 * Agenda · Figma → props:
 *   Estado=Colapsada | Expandida    → `expanded` / `defaultExpanded` / `onExpandedChange`
 *   Section Header (icono + título) → `title` (default "Agenda de hoy"), `icon` (default Calendar)
 *   acción "Expandir ▾ / Ocultar ▴" → botón Text/Small (`expandLabel` / `collapseLabel`)
 *   "Progreso del día" (solo Colapsada) → `progress={{ done, total, label? }}`
 *   Operational Summary Bar         → `summary` (slot; va siempre visible)
 *   timeline de Agenda / Item       → `children` (solo Expandida, bajo un divisor)
 *   Contenedor: brand/primary-subtle + borde brand/primary, r:16, p 16/20, gap 12.
 *
 * Agenda / Item · Figma → props:
 *   Estado=Pendiente | En progreso | Completada → `status` = "pendiente" | "en-progreso" | "completada"
 *     (punto border/default · brand/primary · status/success/solid; Completada atenúa el título)
 *   Hora · Título · Descripción     → `time` · `title` · `description` (Mostrar descripción = si viene)
 *   Icono                           → `icon` (default Phone, 16px, text/secondary)
 *   Acción (swap) + Mostrar acción  → `action` (Figma: Button Ghost/Small → `<Button variant="outline" size="sm">`)
 */

type AgendaItemStatus = "pendiente" | "en-progreso" | "completada";

const statusLabel: Record<AgendaItemStatus, string> = {
	pendiente: "Pendiente",
	"en-progreso": "En progreso",
	completada: "Completada",
};

const agendaDotVariants = cva("size-2 shrink-0 rounded-full", {
	variants: {
		status: {
			pendiente: "bg-line",
			"en-progreso": "bg-brand",
			completada: "bg-success-solid",
		},
	},
	defaultVariants: { status: "pendiente" },
});

function AgendaItem({
	time,
	title,
	description,
	status = "pendiente",
	icon: Icon = Phone,
	action,
	className,
	...props
}: Omit<React.ComponentProps<"li">, "title"> & {
	time: React.ReactNode;
	title: React.ReactNode;
	description?: React.ReactNode;
	status?: AgendaItemStatus;
	icon?: LucideIcon;
	action?: React.ReactNode;
}) {
	return (
		<li
			data-slot="agenda-item"
			data-status={status}
			className={cn("flex w-full items-center gap-3 py-2.5", className)}
			{...props}
		>
			<span aria-hidden className={agendaDotVariants({ status })} />
			<span className="sr-only">{statusLabel[status]}:</span>
			<span className="type-body-sm w-10.5 shrink-0 font-semibold text-fg-secondary tabular-nums">
				{time}
			</span>
			<Icon aria-hidden className="size-4 shrink-0 text-fg-secondary" />
			<div className="flex min-w-0 flex-1 flex-col gap-px">
				<span
					className={cn(
						"type-label-base truncate",
						status === "completada" ? "text-fg-tertiary" : "text-fg",
					)}
				>
					{title}
				</span>
				{description ? (
					<span className="type-caption truncate text-fg-tertiary">
						{description}
					</span>
				) : null}
			</div>
			{action ? (
				<div className="flex shrink-0 items-center">{action}</div>
			) : null}
		</li>
	);
}

type AgendaProgress = {
	done: number;
	total: number;
	/** Texto a la derecha de la barra; por defecto "4 de 16 tareas realizadas hoy". */
	label?: React.ReactNode;
};

function Agenda({
	title = "Agenda de hoy",
	icon = Calendar,
	expanded,
	defaultExpanded = false,
	onExpandedChange,
	progress,
	summary,
	expandLabel = "Expandir ▾",
	collapseLabel = "Ocultar ▴",
	children,
	className,
	...props
}: Omit<React.ComponentProps<"section">, "title"> & {
	title?: React.ReactNode;
	icon?: LucideIcon;
	expanded?: boolean;
	defaultExpanded?: boolean;
	onExpandedChange?: (expanded: boolean) => void;
	progress?: AgendaProgress;
	/** Operational Summary Bar (o cualquier resumen): siempre visible. */
	summary?: React.ReactNode;
	expandLabel?: React.ReactNode;
	collapseLabel?: React.ReactNode;
}) {
	const [internalOpen, setInternalOpen] = React.useState(defaultExpanded);
	const open = expanded ?? internalOpen;
	const setOpen = (next: boolean) => {
		if (expanded === undefined) setInternalOpen(next);
		onExpandedChange?.(next);
	};

	const percent =
		progress && progress.total > 0
			? Math.min(Math.max(progress.done / progress.total, 0), 1) * 100
			: 0;

	return (
		<Collapsible.Root open={open} onOpenChange={setOpen} asChild>
			<section
				data-slot="agenda"
				data-state={open ? "open" : "closed"}
				className={cn(
					"flex w-full flex-col gap-3 rounded-[16px] border border-brand bg-brand-subtle px-5 py-4",
					className,
				)}
				{...props}
			>
				<SectionHeader
					title={title}
					icon={icon}
					action={
						<Collapsible.Trigger asChild>
							<Button variant="link" size="sm">
								{open ? collapseLabel : expandLabel}
							</Button>
						</Collapsible.Trigger>
					}
				/>
				{!open && progress ? (
					<div className="flex items-center gap-2.5">
						<div
							role="progressbar"
							aria-valuemin={0}
							aria-valuemax={progress.total}
							aria-valuenow={progress.done}
							className="h-1.5 w-30 shrink-0 overflow-hidden rounded-[3px] bg-line-subtle"
						>
							<div
								className="h-full rounded-[3px] bg-success-solid transition-[width] duration-250 ease-out"
								style={{ width: `${percent}%` }}
							/>
						</div>
						<span className="type-label-sm text-fg-secondary">
							{progress.label ??
								`${progress.done} de ${progress.total} tareas realizadas hoy`}
						</span>
					</div>
				) : null}
				{summary}
				<Collapsible.Content className="flex flex-col gap-3">
					<div aria-hidden className="h-px w-full bg-line-subtle" />
					<ul className="flex flex-col gap-1">{children}</ul>
				</Collapsible.Content>
			</section>
		</Collapsible.Root>
	);
}

export {
	Agenda,
	AgendaItem,
	agendaDotVariants,
	type AgendaItemStatus,
	type AgendaProgress,
};
