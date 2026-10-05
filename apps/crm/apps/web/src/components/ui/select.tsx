import * as SelectPrimitive from "@radix-ui/react-select";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Select — Figma "02 · Componentes › Dropdown" (120:975), Tipo=Single.
 *
 * Estados de Figma → cómo se ven en código:
 *   Cerrado  → trigger por defecto (bg-surface, border-line, placeholder text-fg-tertiary)
 *   Hover    → :hover (neutral/50; en oscuro carbon/800)
 *   Abierto  → data-[state=open]: borde brand de 2px (border + ring inset de 1px) y el menú
 *   Disabled → disabled: bg neutral/100 (bg-muted) y opacidad 50 %
 *   (Focus por teclado = mismo borde que Abierto; aria-invalid = borde danger.)
 * Tamaños de `SelectTrigger`: "full" (w-full) y "default" (w-fit) miden 42px como Figma;
 *   "sm" mide 32px para barras de filtros.
 * Menú: bg-surface-raised, border-line-subtle, radius/md (rounded-xl), Elevation/Dropdown y
 *   padding 8/4. Opción: 32px, padding 8/12, radius/sm, 13px; la resaltada (hover/teclado) va en
 *   brand/primary-subtle y la elegida lleva ✓ en brand/primary a la derecha.
 *
 * Los Tipo=Multi y Tipo=Searchable de Figma se arman con Popover + Command (ver combobox.tsx).
 * Para que su disparador sea idéntico a éste se exportan las clases `selectTriggerClassName`,
 * `selectContentClassName` y `selectItemClassName`.
 */

/** Clases del disparador del Dropdown (Figma "trigger"). Úselas en cualquier botón que abra un menú de selección. */
const selectTriggerClassName =
	"group/select flex h-10.5 cursor-pointer items-center justify-between gap-2 whitespace-nowrap rounded-xl border border-line bg-surface px-4 text-left text-fg text-sm outline-none ring-inset transition-[background-color,border-color,box-shadow] duration-150 ease-out enabled:hover:bg-cci-neutral-50 focus-visible:border-brand focus-visible:ring-1 focus-visible:ring-brand disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50 aria-invalid:border-danger-solid aria-invalid:ring-danger-solid data-[placeholder]:text-fg-tertiary data-[state=open]:border-brand data-[state=open]:ring-1 data-[state=open]:ring-brand dark:enabled:hover:bg-cci-carbon-800 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-fg-tertiary [&_svg]:pointer-events-none [&_svg]:shrink-0";

/** Clases del panel del Dropdown (Figma "menu"). */
const selectContentClassName =
	"overflow-y-auto overflow-x-hidden rounded-xl border border-line-subtle bg-surface-raised text-fg shadow-dropdown";

/** Clases de una opción del Dropdown (Figma "opt"). */
const selectItemClassName =
	"relative flex w-full cursor-pointer select-none items-center gap-2.5 rounded-md py-2 pr-8 pl-3 text-[13px] text-fg leading-4 outline-hidden transition-colors duration-150 focus:bg-brand-subtle data-[disabled]:pointer-events-none data-[highlighted]:bg-brand-subtle data-[disabled]:opacity-40 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-fg-secondary [&_svg]:pointer-events-none [&_svg]:shrink-0";

function Select({
	...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
	return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectGroup({
	...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
	return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

function SelectValue({
	...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
	return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
	className,
	size = "full",
	children,
	...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
	size?: "sm" | "default" | "full";
}) {
	return (
		<SelectPrimitive.Trigger
			data-slot="select-trigger"
			data-size={size}
			className={cn(
				size === "full" ? "w-full" : "w-fit",
				selectTriggerClassName,
				"data-[size=sm]:h-8 data-[size=sm]:px-3 data-[size=sm]:text-[13px] *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2",
				className,
			)}
			{...props}
		>
			{children}
			<SelectPrimitive.Icon asChild>
				<ChevronDownIcon className="size-4 text-fg-tertiary transition-transform duration-150 group-data-[state=open]/select:rotate-180" />
			</SelectPrimitive.Icon>
		</SelectPrimitive.Trigger>
	);
}

function SelectContent({
	className,
	children,
	position = "popper",
	align = "center",
	size = "full",
	...props
}: React.ComponentProps<typeof SelectPrimitive.Content> & {
	size?: "sm" | "default" | "full";
}) {
	return (
		<SelectPrimitive.Portal>
			<SelectPrimitive.Content
				data-slot="select-content"
				className={cn(
					"data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 relative z-50 max-h-(--radix-select-content-available-height) min-w-32 origin-(--radix-select-content-transform-origin) data-[state=closed]:animate-out data-[state=open]:animate-in",
					selectContentClassName,
					// Figma: 6px entre el disparador y el menú.
					position === "popper" &&
						"data-[side=left]:-translate-x-1.5 data-[side=right]:translate-x-1.5 data-[side=bottom]:translate-y-1.5 data-[side=top]:-translate-y-1.5",
					size === "full" && "right-0 left-0 w-full",
					className,
				)}
				position={position}
				align={align}
				{...props}
			>
				<SelectScrollUpButton />
				<SelectPrimitive.Viewport
					className={cn(
						"px-1 py-2",
						position === "popper" &&
							"h-(--radix-select-trigger-height) w-full min-w-(--radix-select-trigger-width) scroll-my-2",
						size === "full" && "min-w-full",
					)}
				>
					{children}
				</SelectPrimitive.Viewport>
				<SelectScrollDownButton />
			</SelectPrimitive.Content>
		</SelectPrimitive.Portal>
	);
}

function SelectLabel({
	className,
	...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
	return (
		<SelectPrimitive.Label
			data-slot="select-label"
			className={cn("type-label-sm px-3 py-1.5 text-fg-tertiary", className)}
			{...props}
		/>
	);
}

function SelectItem({
	className,
	children,
	...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
	return (
		<SelectPrimitive.Item
			data-slot="select-item"
			className={cn(
				selectItemClassName,
				"*:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
				className,
			)}
			{...props}
		>
			<span className="absolute right-3 flex size-4 items-center justify-center">
				<SelectPrimitive.ItemIndicator>
					<CheckIcon strokeWidth={3} className="size-3.5 text-brand" />
				</SelectPrimitive.ItemIndicator>
			</span>
			<SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
		</SelectPrimitive.Item>
	);
}

function SelectSeparator({
	className,
	...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
	return (
		<SelectPrimitive.Separator
			data-slot="select-separator"
			className={cn("pointer-events-none my-1 h-px bg-divider", className)}
			{...props}
		/>
	);
}

function SelectScrollUpButton({
	className,
	...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
	return (
		<SelectPrimitive.ScrollUpButton
			data-slot="select-scroll-up-button"
			className={cn(
				"flex cursor-default items-center justify-center py-1 text-fg-tertiary",
				className,
			)}
			{...props}
		>
			<ChevronUpIcon className="size-4" />
		</SelectPrimitive.ScrollUpButton>
	);
}

function SelectScrollDownButton({
	className,
	...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
	return (
		<SelectPrimitive.ScrollDownButton
			data-slot="select-scroll-down-button"
			className={cn(
				"flex cursor-default items-center justify-center py-1 text-fg-tertiary",
				className,
			)}
			{...props}
		>
			<ChevronDownIcon className="size-4" />
		</SelectPrimitive.ScrollDownButton>
	);
}

export {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectSeparator,
	SelectTrigger,
	SelectValue,
	selectContentClassName,
	selectItemClassName,
	selectTriggerClassName,
};
