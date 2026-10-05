import { ChartColumn, type LucideIcon, UserRound, Users } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Dashboard/RoleHeader — Figma "03 · Componentes CRM › Componentes Fuente (Masters)" (111:1098).
 *
 * Encabezado de dashboard por rol. Variante de Figma → prop:
 *   Rol = Asesor · Supervisor · Gerencia → `rol` "asesor" | "supervisor" | "gerencia"
 * El rol cambia la barra de acento, el ícono, los colores y la etiqueta (tag).
 *   Asesor     → status/success (barra y tag), bucket/b0/bg, ícono user-round (Marca)
 *   Supervisor → accent/default, accent/alt-bg, ícono users (Alerta)
 *   Gerencia   → status/info, ícono chart-column (Default)
 * `title`, `subtitle` y `tag` sobreescriben los textos de Figma. `children` se pinta a la
 * derecha, antes del tag (p. ej. un selector de período); no existe en Figma.
 */

export type DashboardRole = "asesor" | "supervisor" | "gerencia";

const roleConfig: Record<
	DashboardRole,
	{
		icon: LucideIcon;
		title: string;
		subtitle: string;
		tag: string;
		bar: string;
		iconWrap: string;
		iconColor: string;
		tagWrap: string;
		dot: string;
		tagText: string;
	}
> = {
	asesor: {
		icon: UserRound,
		title: "Dashboard · Asesor",
		subtitle: "Operación diaria · Gestión individual de cartera",
		tag: "Operación",
		bar: "bg-success-solid",
		iconWrap: "bg-bucket-b0-bg",
		iconColor: "text-brand",
		tagWrap: "bg-bucket-b0-bg",
		dot: "bg-success-solid",
		tagText: "text-success-solid",
	},
	supervisor: {
		icon: Users,
		title: "Dashboard · Supervisor",
		subtitle: "Supervisión de equipo · Control operativo",
		tag: "Supervisión",
		bar: "bg-accent-default",
		iconWrap: "bg-accent-alt",
		iconColor: "text-warning-solid",
		tagWrap: "bg-accent-alt",
		dot: "bg-accent-default",
		tagText: "text-accent-default",
	},
	gerencia: {
		icon: ChartColumn,
		title: "Dashboard · Gerencia",
		subtitle: "Indicadores estratégicos · Salud del negocio",
		tag: "Estrategia",
		bar: "bg-info-solid",
		iconWrap: "bg-info-subtle",
		iconColor: "text-fg",
		tagWrap: "bg-info-subtle",
		dot: "bg-info-solid",
		tagText: "text-info-solid",
	},
};

type DashboardRoleHeaderProps = Omit<
	React.ComponentProps<"header">,
	"title"
> & {
	/** Figma "Rol". */
	rol?: DashboardRole;
	title?: React.ReactNode;
	subtitle?: React.ReactNode;
	/** Etiqueta de la derecha; `false` la oculta. */
	tag?: React.ReactNode | false;
};

function DashboardRoleHeader({
	rol = "asesor",
	title,
	subtitle,
	tag,
	children,
	className,
	...props
}: DashboardRoleHeaderProps) {
	const c = roleConfig[rol];
	const Icon = c.icon;
	const tagContent = tag === undefined ? c.tag : tag;
	return (
		<header
			data-slot="dashboard-role-header"
			data-rol={rol}
			className={cn(
				"flex w-full min-w-0 items-center gap-4 rounded-2xl bg-surface py-5 pr-6 pl-5 shadow-clay-raised",
				className,
			)}
			{...props}
		>
			<span
				aria-hidden
				className={cn("h-11 w-1 shrink-0 rounded-full", c.bar)}
			/>
			<span
				aria-hidden
				className={cn(
					"flex w-12 shrink-0 items-center justify-center rounded-xl",
					c.iconWrap,
				)}
			>
				<Icon className={cn("size-6", c.iconColor)} />
			</span>
			<div className="flex min-w-0 flex-col gap-0.5">
				<h2 className="truncate font-bold text-fg text-lg leading-[1.26]">
					{title ?? c.title}
				</h2>
				<p className="truncate text-[13px] text-fg-secondary leading-[1.26]">
					{subtitle ?? c.subtitle}
				</p>
			</div>
			<div className="flex min-w-0 flex-1 items-center justify-end gap-3">
				{children}
			</div>
			{tagContent ? (
				<span
					className={cn(
						"inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1",
						c.tagWrap,
					)}
				>
					<span
						aria-hidden
						className={cn("size-1.75 shrink-0 rounded-full", c.dot)}
					/>
					<span
						className={cn("font-semibold text-xs leading-[1.26]", c.tagText)}
					>
						{tagContent}
					</span>
				</span>
			) : null}
		</header>
	);
}

export { DashboardRoleHeader };
