import {
	CircleCheck,
	CircleX,
	Info,
	Loader2,
	type LucideIcon,
	TriangleAlert,
	X,
} from "lucide-react";
import type * as React from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useTheme } from "@/components/theme-provider";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Toaster — Figma "02 · Componentes › Toast" (component set `122:957`).
 *
 * Tipo (variante de Figma) → llamada de sonner:
 *   Success → toast.success(…) · Error → toast.error(…) · Warning → toast.warning(…) · Info → toast.info(…)
 *   "Título" → primer argumento · "Descripción" → `{ description }`.
 *
 * Anatomía: 380px · p 16 · gap 12 · radius/md (14) · bg/surface · borde 1px status/…/solid ·
 * Elevation/Dropdown. Barra 4px del color del estado + ícono 14px en píldora 24×18 con el
 * fondo suave + título 14/600 + descripción 12/400 + ✕ text/tertiary.
 *
 * Los toasts van `unstyled` y se pintan con clases de tokens. El Toaster se monta en
 * routes/__root.tsx con `richColors`: esas reglas de sonner no van en capa y ganan a las
 * utilidades, así que sus variables (--success-bg, --error-border…) se apuntan a los tokens
 * para que coincidan. La barra y la píldora viajan en `icons`, el único hueco que sonner deja
 * antes del texto. Figma pide que Error y Warning no se cierren solos; eso cambia el
 * comportamiento de cientos de avisos, así que la duración se deja como estaba.
 */

type ToastTone = "success" | "error" | "warning" | "info";

const toneStyles: Record<
	ToastTone,
	{ bar: string; pill: string; icon: string; Icon: LucideIcon }
> = {
	success: {
		bar: "bg-success-solid",
		pill: "bg-bucket-b0-bg",
		icon: "text-success-solid",
		Icon: CircleCheck,
	},
	error: {
		bar: "bg-danger-solid",
		pill: "bg-danger-subtle",
		icon: "text-danger-solid",
		Icon: CircleX,
	},
	warning: {
		bar: "bg-warning-solid",
		pill: "bg-warning-subtle",
		icon: "text-warning-solid",
		Icon: TriangleAlert,
	},
	info: {
		bar: "bg-info-solid",
		pill: "bg-info-subtle",
		icon: "text-fg",
		Icon: Info,
	},
};

const toastClassNames = {
	// El borde por tipo va con data-[type=…] para ganarle a border-line-subtle sin depender
	// del orden del CSS (sonner une las clases sin tailwind-merge).
	toast:
		"flex w-(--width) items-start gap-3 rounded-xl border border-line-subtle bg-surface p-4 font-sans text-fg shadow-dropdown data-[type=error]:border-danger-solid data-[type=info]:border-info-solid data-[type=success]:border-success-solid data-[type=warning]:border-warning-solid data-[expanded=false]:data-[front=false]:*:opacity-0",
	icon: "relative flex min-h-4.5 min-w-6 shrink-0 gap-3 self-stretch",
	content: "flex min-w-0 flex-1 flex-col gap-0.5",
	title: "font-semibold text-fg text-sm leading-[1.26]",
	// `!`: sonner fija el color de la descripción en oscuro con una regla fuera de capa.
	description: "text-fg-secondary! text-xs leading-[1.26]",
	closeButton:
		"order-last flex h-4 shrink-0 cursor-pointer items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5 [&_svg]:text-fg-tertiary hover:[&_svg]:text-fg-secondary",
	actionButton: cn(
		buttonVariants({ variant: "secondary", size: "sm" }),
		"h-7 self-center px-3",
	),
	cancelButton: cn(
		buttonVariants({ variant: "outline", size: "sm" }),
		"h-7 self-center px-3",
	),
} satisfies NonNullable<ToasterProps["toastOptions"]>["classNames"];

/** Barra de color + ícono en píldora (Figma "Rectangle" 4px + "Frame" 24×18). */
function ToastGlyph({ tone }: { tone: ToastTone }) {
	const { bar, pill, icon, Icon } = toneStyles[tone];
	return (
		<>
			<span aria-hidden className={cn("w-1 self-stretch rounded-full", bar)} />
			<span
				aria-hidden
				className={cn(
					"flex h-4.5 w-6 items-center justify-center rounded-full",
					pill,
				)}
			>
				<Icon className={cn("size-3.5", icon)} />
			</span>
		</>
	);
}

const Toaster = ({ toastOptions, icons, style, ...props }: ToasterProps) => {
	const { theme } = useTheme();

	return (
		<Sonner
			theme={theme}
			className="toaster group"
			closeButton
			icons={{
				success: <ToastGlyph tone="success" />,
				error: <ToastGlyph tone="error" />,
				warning: <ToastGlyph tone="warning" />,
				info: <ToastGlyph tone="info" />,
				loading: <Loader2 className="size-3.5 animate-spin text-brand" />,
				close: <X />,
				...icons,
			}}
			style={
				{
					"--width": "380px",
					"--normal-bg": "var(--ds-bg-surface)",
					"--normal-bg-hover": "var(--ds-bg-surface)",
					"--normal-border": "var(--ds-border-subtle)",
					"--normal-border-hover": "var(--ds-border-subtle)",
					"--normal-text": "var(--ds-text-primary)",
					"--success-bg": "var(--ds-bg-surface)",
					"--success-border": "var(--ds-status-success-solid)",
					"--success-text": "var(--ds-text-primary)",
					"--error-bg": "var(--ds-bg-surface)",
					"--error-border": "var(--ds-status-danger-solid)",
					"--error-text": "var(--ds-text-primary)",
					"--warning-bg": "var(--ds-bg-surface)",
					"--warning-border": "var(--ds-status-warning-solid)",
					"--warning-text": "var(--ds-text-primary)",
					"--info-bg": "var(--ds-bg-surface)",
					"--info-border": "var(--ds-status-info-solid)",
					"--info-text": "var(--ds-text-primary)",
					...style,
				} as React.CSSProperties
			}
			toastOptions={{
				closeButtonAriaLabel: "Cerrar aviso",
				...toastOptions,
				unstyled: true,
				classNames: { ...toastClassNames, ...toastOptions?.classNames },
			}}
			{...props}
		/>
	);
};

/**
 * Vista estática del Toast (misma apariencia que los de sonner), para mostrarlo fuera del
 * Toaster: catálogo, documentación o un aviso fijo en pantalla.
 */
function ToastView({
	type,
	title,
	description,
	onClose,
	className,
}: {
	type?: ToastTone;
	title: React.ReactNode;
	description?: React.ReactNode;
	/** Si se pasa, muestra la ✕. */
	onClose?: () => void;
	className?: string;
}) {
	return (
		<div
			data-slot="toast"
			data-type={type}
			className={cn(toastClassNames.toast, "w-95 max-w-full", className)}
		>
			{type ? (
				<div className={toastClassNames.icon}>
					<ToastGlyph tone={type} />
				</div>
			) : null}
			<div className={toastClassNames.content}>
				<div className={toastClassNames.title}>{title}</div>
				{description ? (
					<div className={toastClassNames.description}>{description}</div>
				) : null}
			</div>
			{onClose ? (
				<button
					type="button"
					aria-label="Cerrar aviso"
					onClick={onClose}
					className={toastClassNames.closeButton}
				>
					<X />
				</button>
			) : null}
		</div>
	);
}

export { Toaster, ToastView };
