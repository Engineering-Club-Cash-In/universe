"use client";

import { Command as CommandPrimitive } from "cmdk";
import { SearchIcon } from "lucide-react";
import type * as React from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Command (cmdk) — lista filtrable de los menús de selección. Toma el menú del
 * "02 · Componentes › Dropdown" (120:975) en sus Tipos Multi y Searchable:
 *   menu   → `Command`: padding 8/4 sobre bg-surface-raised (el borde y la sombra los pone el Popover)
 *   search → `CommandInput`: caja de 32px, bg/canvas, radius/sm, ícono lucide/search 14px y 13px
 *   opt    → `CommandItem`: 32px, padding 8/12, gap 10, radius/sm, 13px; resaltado (hover/teclado)
 *            en brand/primary-subtle. El elegido se marca con ✓ brand a la derecha (Single /
 *            Searchable, ver combobox.tsx) o con un `<Checkbox size="sm">` a la izquierda (Multi).
 */
function Command({
	className,
	...props
}: React.ComponentProps<typeof CommandPrimitive>) {
	return (
		<CommandPrimitive
			data-slot="command"
			className={cn(
				"flex h-full w-full flex-col overflow-hidden rounded-xl bg-surface-raised px-1 py-2 text-fg",
				className,
			)}
			{...props}
		/>
	);
}

function CommandDialog({
	title = "Command Palette",
	description = "Search for a command to run...",
	children,
	className,
	showCloseButton = true,
	...props
}: React.ComponentProps<typeof Dialog> & {
	title?: string;
	description?: string;
	className?: string;
	showCloseButton?: boolean;
}) {
	return (
		<Dialog {...props}>
			<DialogHeader className="sr-only">
				<DialogTitle>{title}</DialogTitle>
				<DialogDescription>{description}</DialogDescription>
			</DialogHeader>
			<DialogContent
				className={cn("overflow-hidden p-0", className)}
				showCloseButton={showCloseButton}
			>
				<Command className="**:data-[slot=command-input-wrapper]:h-12 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-tertiary [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-3 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5">
					{children}
				</Command>
			</DialogContent>
		</Dialog>
	);
}

function CommandInput({
	className,
	...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
	return (
		<div
			data-slot="command-input-wrapper"
			className="flex h-8 shrink-0 items-center gap-2 rounded-md bg-canvas px-3"
		>
			<SearchIcon className="size-3.5 shrink-0 text-fg-tertiary" />
			<CommandPrimitive.Input
				data-slot="command-input"
				className={cn(
					"flex h-full w-full bg-transparent text-[13px] text-fg leading-4 outline-hidden placeholder:text-fg-tertiary disabled:cursor-not-allowed disabled:opacity-40",
					className,
				)}
				{...props}
			/>
		</div>
	);
}

function CommandList({
	className,
	...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
	return (
		<CommandPrimitive.List
			data-slot="command-list"
			className={cn(
				"max-h-[300px] scroll-py-1 overflow-y-auto overflow-x-hidden",
				className,
			)}
			{...props}
		/>
	);
}

function CommandEmpty({
	...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
	return (
		<CommandPrimitive.Empty
			data-slot="command-empty"
			className="type-body-sm py-6 text-center text-fg-tertiary"
			{...props}
		/>
	);
}

function CommandGroup({
	className,
	...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
	return (
		<CommandPrimitive.Group
			data-slot="command-group"
			className={cn(
				"[&_[cmdk-group-heading]]:type-label-sm overflow-hidden text-fg [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-fg-tertiary",
				className,
			)}
			{...props}
		/>
	);
}

function CommandSeparator({
	className,
	...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
	return (
		<CommandPrimitive.Separator
			data-slot="command-separator"
			className={cn("my-1 h-px bg-divider", className)}
			{...props}
		/>
	);
}

function CommandItem({
	className,
	...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
	return (
		<CommandPrimitive.Item
			data-slot="command-item"
			className={cn(
				"relative flex cursor-pointer select-none items-center gap-2.5 rounded-md px-3 py-2 text-[13px] text-fg leading-4 outline-hidden transition-colors duration-150 aria-disabled:pointer-events-none aria-disabled:opacity-40 data-[selected=true]:bg-brand-subtle [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-fg-secondary [&_svg]:pointer-events-none [&_svg]:shrink-0",
				className,
			)}
			{...props}
		/>
	);
}

function CommandShortcut({
	className,
	...props
}: React.ComponentProps<"span">) {
	return (
		<span
			data-slot="command-shortcut"
			className={cn(
				"type-caption ml-auto text-fg-tertiary tracking-widest",
				className,
			)}
			{...props}
		/>
	);
}

export {
	Command,
	CommandDialog,
	CommandInput,
	CommandList,
	CommandEmpty,
	CommandGroup,
	CommandItem,
	CommandSeparator,
	CommandShortcut,
};
