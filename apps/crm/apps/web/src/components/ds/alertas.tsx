import {
	CircleAlert,
	Info,
	type LucideIcon,
	TrendingUp,
	TriangleAlert,
} from "lucide-react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Alertas — Figma "03 · Componentes CRM › Panel de Alertas".
 *
 * Alert/Item (148:1994), 24 variantes = Tipo × Prioridad → <AlertItem>
 *   Tipo = PromesaVencida · PagoRecibido · CambioBucket · VehiculoApagado · GPSDesconectado ·
 *          CasoCritico → `type` "promesa-vencida" | "pago-recibido" | "cambio-bucket" |
 *          "vehiculo-apagado" | "gps-desconectado" | "caso-critico" (pone el título por defecto)
 *   Prioridad = Crítica · Alta · Media · Informativa → `priority` "critica" | "alta" | "media" |
 *          "informativa" (pone colores, ícono, peso del título y la píldora)
 *     Crítica     → fondo danger/subtle, borde 1.5 danger/text, acento danger/text, circle-alert,
 *                   título 700, píldora "Crítica"
 *     Alta        → fondo surface, borde border/subtle, acento danger/solid, triangle-alert,
 *                   píldora "Alta"
 *     Media       → acento warning/solid, trending-up, sin píldora
 *     Informativa → acento info/solid, info, sin píldora
 *   En Figma el ícono depende de la prioridad, no del tipo; `icon` permite cambiarlo.
 *   Con `onClick` el ítem es un <button> (hover y focus no están en Figma; se agregan).
 *
 * Panel/Alertas (148:1995) → <PanelAlertas>
 *   "Mostrar acción" (boolean) → `showAction`; la acción es Button Text/Small "Ver todas →".
 *   Los ítems se pasan como children (<AlertItem>).
 */

export type AlertType =
	| "promesa-vencida"
	| "pago-recibido"
	| "cambio-bucket"
	| "vehiculo-apagado"
	| "gps-desconectado"
	| "caso-critico";

export type AlertPriority = "critica" | "alta" | "media" | "informativa";

export const alertTypeTitle: Record<AlertType, string> = {
	"promesa-vencida": "Promesa vencida",
	"pago-recibido": "Pago recibido",
	"cambio-bucket": "Cambio de Bucket",
	"vehiculo-apagado": "Vehículo apagado",
	"gps-desconectado": "GPS desconectado",
	"caso-critico": "Caso crítico",
};

export const alertPriorityLabel: Record<AlertPriority, string> = {
	critica: "Crítica",
	alta: "Alta",
	media: "Media",
	informativa: "Informativa",
};

const priorityConfig: Record<
	AlertPriority,
	{
		icon: LucideIcon;
		root: string;
		accent: string;
		iconWrap: string;
		iconColor: string;
		title: string;
		/** Clases de la píldora; `null` = sin píldora (Media/Informativa). */
		pill: string | null;
		hover: string;
	}
> = {
	critica: {
		icon: CircleAlert,
		root: "bg-danger-subtle after:border-[1.5px] after:border-danger-text",
		accent: "bg-danger-text",
		iconWrap: "border-[1.5px] border-danger-text bg-danger-subtle",
		iconColor: "text-danger-solid",
		title: "font-bold",
		pill: "bg-danger-subtle text-danger-text",
		hover: "hover:brightness-[0.98] dark:hover:brightness-110",
	},
	alta: {
		icon: TriangleAlert,
		root: "bg-surface after:border after:border-line-subtle",
		accent: "bg-danger-solid",
		iconWrap: "bg-danger-subtle",
		iconColor: "text-danger-solid",
		title: "font-semibold",
		pill: "bg-danger-subtle text-danger-solid",
		hover: "hover:bg-muted",
	},
	media: {
		icon: TrendingUp,
		root: "bg-surface after:border after:border-line-subtle",
		accent: "bg-warning-solid",
		iconWrap: "bg-warning-subtle",
		iconColor: "text-warning-solid",
		title: "font-semibold",
		pill: null,
		hover: "hover:bg-muted",
	},
	informativa: {
		icon: Info,
		root: "bg-surface after:border after:border-line-subtle",
		accent: "bg-info-solid",
		iconWrap: "bg-info-subtle",
		iconColor: "text-fg",
		title: "font-semibold",
		pill: null,
		hover: "hover:bg-muted",
	},
};

type AlertItemOwnProps = {
	type?: AlertType;
	priority?: AlertPriority;
	/** Por defecto, el título del `type` ("Promesa vencida", …). */
	title?: React.ReactNode;
	/** Línea secundaria, p. ej. "Crédito #48213 · venció hace 2 días". */
	description?: React.ReactNode;
	/** Cambia el ícono de la prioridad. */
	icon?: LucideIcon;
	className?: string;
};

type AlertItemProps = AlertItemOwnProps &
	(
		| ({ onClick: React.MouseEventHandler<HTMLButtonElement> } & Omit<
				React.ComponentProps<"button">,
				keyof AlertItemOwnProps | "onClick" | "children"
		  >)
		| ({ onClick?: undefined } & Omit<
				React.ComponentProps<"div">,
				keyof AlertItemOwnProps | "onClick" | "children"
		  >)
	);

function AlertItem({
	type = "promesa-vencida",
	priority = "critica",
	title,
	description,
	icon,
	className,
	...props
}: AlertItemProps) {
	const p = priorityConfig[priority];
	const Icon = icon ?? p.icon;
	const interactive = typeof props.onClick === "function";

	const classes = cn(
		// El borde de Figma es "inside" y se dibuja encima del acento: va en un ::after.
		"relative flex w-full min-w-0 items-stretch overflow-hidden rounded-xl text-left",
		"after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit]",
		p.root,
		interactive &&
			cn(
				"cursor-pointer outline-none transition-[background-color,filter] duration-150 focus-visible:ring-2 focus-visible:ring-ring",
				p.hover,
			),
		className,
	);

	const content = (
		<>
			<span aria-hidden className={cn("w-1 shrink-0", p.accent)} />
			<span className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3">
				<span
					aria-hidden
					className={cn(
						"flex h-7 w-9 shrink-0 items-center justify-center rounded-xl",
						p.iconWrap,
					)}
				>
					<Icon className={cn("size-5", p.iconColor)} />
				</span>
				<span className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span
						className={cn(
							"truncate text-[13px] text-fg leading-[1.26]",
							p.title,
						)}
					>
						{title ?? alertTypeTitle[type]}
					</span>
					{description ? (
						<span className="truncate text-[11px] text-fg-secondary leading-[1.26]">
							{description}
						</span>
					) : null}
				</span>
				{p.pill ? (
					<span
						className={cn(
							"shrink-0 rounded-full px-2 py-0.5 font-semibold text-[10px] leading-[1.26]",
							p.pill,
						)}
					>
						{alertPriorityLabel[priority]}
					</span>
				) : (
					<span className="sr-only">
						Prioridad {alertPriorityLabel[priority].toLowerCase()}
					</span>
				)}
				<span
					aria-hidden
					className="shrink-0 font-bold text-base text-fg-tertiary leading-[1.26]"
				>
					›
				</span>
			</span>
		</>
	);

	if (interactive) {
		return (
			<button
				type="button"
				data-slot="alert-item"
				data-priority={priority}
				className={classes}
				{...(props as React.ComponentProps<"button">)}
			>
				{content}
			</button>
		);
	}
	return (
		<div
			data-slot="alert-item"
			data-priority={priority}
			className={classes}
			{...(props as React.ComponentProps<"div">)}
		>
			{content}
		</div>
	);
}

type PanelAlertasProps = Omit<React.ComponentProps<"section">, "title"> & {
	title?: React.ReactNode;
	/** Cantidad de alertas nuevas ("4 nuevas"); 0 o sin valor oculta la píldora. */
	newCount?: number;
	/** Figma "Mostrar acción". */
	showAction?: boolean;
	actionLabel?: React.ReactNode;
	onAction?: () => void;
};

function PanelAlertas({
	title = "Alertas",
	newCount,
	showAction = true,
	actionLabel = "Ver todas →",
	onAction,
	children,
	className,
	...props
}: PanelAlertasProps) {
	return (
		<section
			data-slot="panel-alertas"
			className={cn(
				"flex w-full min-w-0 flex-col gap-2.5 rounded-2xl bg-surface p-5 shadow-clay-raised",
				className,
			)}
			{...props}
		>
			<div className="flex min-h-8 items-center justify-between gap-2">
				<div className="flex min-w-0 items-center gap-2">
					<h3 className="truncate font-semibold text-[15px] text-fg leading-[1.26]">
						{title}
					</h3>
					{newCount ? (
						<span className="shrink-0 rounded-full bg-danger-subtle px-2 py-0.5 font-semibold text-[11px] text-danger-text leading-[1.26]">
							{newCount} {newCount === 1 ? "nueva" : "nuevas"}
						</span>
					) : null}
				</div>
				{showAction ? (
					<Button variant="text" size="sm" onClick={onAction}>
						{actionLabel}
					</Button>
				) : null}
			</div>
			{children}
		</section>
	);
}

export { AlertItem, PanelAlertas };
