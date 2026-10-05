"use client";

import { CheckIcon, ChevronRightIcon } from "lucide-react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * DropdownMenu — Figma "02 · Componentes › Context Menu" (497:8482) y "Context Menu / Item" (497:8411).
 *
 * Estado de Figma → Radix:
 *   Cerrado → solo el disparador (⋮ `EllipsisVertical`, p. ej. <Button variant="ghost" size="icon-sm">)
 *   Abierto → `DropdownMenuContent`: panel bg-surface-raised, border-line-subtle, padding 6, gap 2,
 *             sombra Elevation/Dropdown, radius/md.
 * Context Menu / Item → `DropdownMenuItem` (32px, padding 8/12, gap 10, radius/sm, 13px 500):
 *   Tono=Default → variant="default"     (ícono 16px text-fg-secondary, texto text-fg)
 *   Tono=Peligro → variant="destructive" (ícono status/danger, texto status/danger/text)
 *   Hover/teclado: brand/primary-subtle (Peligro: status/danger/subtle), igual que el Dropdown.
 * Separador (Divider horizontal) → `DropdownMenuSeparator` (1px border/divider, sin margen extra).
 */
const menuItemBase =
	"relative flex cursor-pointer select-none items-center gap-2.5 rounded-md px-3 py-2 font-medium text-[13px] text-fg leading-4 outline-hidden transition-colors duration-150 focus:bg-brand-subtle data-[disabled]:pointer-events-none data-[disabled]:opacity-40 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-fg-secondary [&_svg]:pointer-events-none [&_svg]:shrink-0";

const menuPanelBase =
	"z-50 flex min-w-32 flex-col gap-0.5 overflow-y-auto overflow-x-hidden rounded-xl border border-line-subtle bg-surface-raised p-1.5 text-fg shadow-dropdown data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2";

function DropdownMenu({
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
	return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuPortal({
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
	return (
		<DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
	);
}

function DropdownMenuTrigger({
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
	return (
		<DropdownMenuPrimitive.Trigger
			data-slot="dropdown-menu-trigger"
			{...props}
		/>
	);
}

function DropdownMenuContent({
	className,
	sideOffset = 4,
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
	return (
		<DropdownMenuPrimitive.Portal>
			<DropdownMenuPrimitive.Content
				data-slot="dropdown-menu-content"
				sideOffset={sideOffset}
				className={cn(
					menuPanelBase,
					"max-h-(--radix-dropdown-menu-content-available-height) origin-(--radix-dropdown-menu-content-transform-origin)",
					className,
				)}
				{...props}
			/>
		</DropdownMenuPrimitive.Portal>
	);
}

function DropdownMenuGroup({
	className,
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
	return (
		<DropdownMenuPrimitive.Group
			data-slot="dropdown-menu-group"
			className={cn("flex flex-col gap-0.5", className)}
			{...props}
		/>
	);
}

function DropdownMenuItem({
	className,
	inset,
	variant = "default",
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
	inset?: boolean;
	variant?: "default" | "destructive";
}) {
	return (
		<DropdownMenuPrimitive.Item
			data-slot="dropdown-menu-item"
			data-inset={inset}
			data-variant={variant}
			className={cn(
				menuItemBase,
				"data-inset:pl-9.5 data-[variant=destructive]:text-danger-text data-[variant=destructive]:focus:bg-danger-subtle data-[variant=destructive]:*:[svg]:text-danger-solid!",
				className,
			)}
			{...props}
		/>
	);
}

function DropdownMenuCheckboxItem({
	className,
	children,
	checked,
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
	return (
		<DropdownMenuPrimitive.CheckboxItem
			data-slot="dropdown-menu-checkbox-item"
			className={cn(menuItemBase, "pl-9.5", className)}
			checked={checked}
			{...props}
		>
			<span className="pointer-events-none absolute left-3 flex size-4 items-center justify-center">
				<DropdownMenuPrimitive.ItemIndicator>
					<CheckIcon strokeWidth={3} className="size-3.5 text-brand" />
				</DropdownMenuPrimitive.ItemIndicator>
			</span>
			{children}
		</DropdownMenuPrimitive.CheckboxItem>
	);
}

function DropdownMenuRadioGroup({
	className,
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
	return (
		<DropdownMenuPrimitive.RadioGroup
			data-slot="dropdown-menu-radio-group"
			className={cn("flex flex-col gap-0.5", className)}
			{...props}
		/>
	);
}

function DropdownMenuRadioItem({
	className,
	children,
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
	return (
		<DropdownMenuPrimitive.RadioItem
			data-slot="dropdown-menu-radio-item"
			className={cn(menuItemBase, "pl-9.5", className)}
			{...props}
		>
			<span className="pointer-events-none absolute left-3 flex size-4 items-center justify-center">
				<DropdownMenuPrimitive.ItemIndicator>
					<span className="block size-2 rounded-full bg-brand" />
				</DropdownMenuPrimitive.ItemIndicator>
			</span>
			{children}
		</DropdownMenuPrimitive.RadioItem>
	);
}

function DropdownMenuLabel({
	className,
	inset,
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & {
	inset?: boolean;
}) {
	return (
		<DropdownMenuPrimitive.Label
			data-slot="dropdown-menu-label"
			data-inset={inset}
			className={cn(
				"px-3 py-1.5 font-semibold text-[13px] text-fg leading-4 data-inset:pl-9.5",
				className,
			)}
			{...props}
		/>
	);
}

function DropdownMenuSeparator({
	className,
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
	return (
		<DropdownMenuPrimitive.Separator
			data-slot="dropdown-menu-separator"
			className={cn("h-px shrink-0 bg-divider", className)}
			{...props}
		/>
	);
}

function DropdownMenuShortcut({
	className,
	...props
}: React.ComponentProps<"span">) {
	return (
		<span
			data-slot="dropdown-menu-shortcut"
			className={cn(
				"type-caption ml-auto text-fg-tertiary tracking-widest",
				className,
			)}
			{...props}
		/>
	);
}

function DropdownMenuSub({
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
	return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />;
}

function DropdownMenuSubTrigger({
	className,
	inset,
	children,
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
	inset?: boolean;
}) {
	return (
		<DropdownMenuPrimitive.SubTrigger
			data-slot="dropdown-menu-sub-trigger"
			data-inset={inset}
			className={cn(
				menuItemBase,
				"data-[state=open]:bg-brand-subtle data-inset:pl-9.5",
				className,
			)}
			{...props}
		>
			{children}
			<ChevronRightIcon className="ml-auto size-4 text-fg-tertiary" />
		</DropdownMenuPrimitive.SubTrigger>
	);
}

function DropdownMenuSubContent({
	className,
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
	return (
		<DropdownMenuPrimitive.SubContent
			data-slot="dropdown-menu-sub-content"
			className={cn(
				menuPanelBase,
				"origin-(--radix-dropdown-menu-content-transform-origin)",
				className,
			)}
			{...props}
		/>
	);
}

export {
	DropdownMenu,
	DropdownMenuPortal,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuLabel,
	DropdownMenuItem,
	DropdownMenuCheckboxItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuSub,
	DropdownMenuSubTrigger,
	DropdownMenuSubContent,
};
