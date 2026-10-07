"use client";

import { Check, ChevronDown, Loader2 } from "lucide-react";
import * as React from "react";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import {
	Popover,
	PopoverContent,
	PopoverPortalContext,
	PopoverTrigger,
} from "@/components/ui/popover";
import { selectTriggerClassName } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * Combobox — Figma "02 · Componentes › Dropdown" (120:975), Tipo=Searchable.
 *
 * Estados de Figma → cómo se ven en código:
 *   Cerrado/Hover/Disabled → el mismo disparador del Select (`selectTriggerClassName`): 42px,
 *     radius/md, placeholder en text-fg-tertiary, chevron 16px terciario.
 *   Abierto → borde brand de 2px (data-state=open del PopoverTrigger) y el menú: Popover
 *     (bg-surface-raised, border-line-subtle, Elevation/Dropdown) + Command con la caja
 *     "Buscar…" (bg/canvas) y opciones de 32px; la resaltada va en brand/primary-subtle.
 * Desvío: la opción elegida además lleva ✓ a la derecha, como el Tipo=Single.
 * Props sin cambios: `placeholder` sirve para el disparador y para la caja de búsqueda
 * (o `searchPlaceholder`, si se pasa). `id` va al disparador, para enlazarlo con su <Label>.
 */

export interface ComboboxOption {
	value: string;
	label: string;
}

interface ComboboxDemoProps {
	/** Id del disparador (para `<Label htmlFor>`). */
	id?: string;
	options: ComboboxOption[];
	placeholder?: string;
	/** Texto de la caja de búsqueda; por defecto, `placeholder`. */
	searchPlaceholder?: string;
	width?: string;
	popOverWidth?: string;
	value: string | null;
	onChange: (value: string) => void;
	onSearchChange?: (search: string) => void;
	isLoading?: boolean;
	isInModal?: boolean;
	maxListHeight?: string;
	disabled?: boolean;
}

export function Combobox({
	id,
	options,
	placeholder = "Selecciona una opción...",
	searchPlaceholder,
	width = "min",
	popOverWidth = "auto",
	value,
	onChange,
	onSearchChange,
	isLoading,
	isInModal = false,
	maxListHeight,
	disabled = false,
}: ComboboxDemoProps) {
	const [open, setOpen] = React.useState(false);
	const [searchValue, setSearchValue] = React.useState("");
	// Dentro de la caja de un modal (PopoverPortalContext) el menú siempre evita
	// colisiones contra esa caja, aunque el llamador no pase `isInModal`: si no,
	// cerca del borde quedaba cortado por el overflow del modal.
	const enCajaDeModal = React.useContext(PopoverPortalContext) !== null;
	const triggerRef = React.useRef<HTMLButtonElement>(null);
	const listboxId = React.useId();

	// Mantener la posición del scroll cuando se abre el popover en un modal
	const handleOpenChange = React.useCallback(
		(newOpen: boolean) => {
			if (isInModal && newOpen) {
				// Guardar la posición del scroll del contenedor padre (DialogContent)
				const scrollContainer = triggerRef.current?.closest(
					'[data-radix-scroll-area-viewport], [class*="overflow-y-auto"], [class*="overflow-auto"]',
				);
				const scrollTop = scrollContainer?.scrollTop ?? 0;

				setOpen(newOpen);

				// Restaurar la posición después de que React actualice el DOM
				requestAnimationFrame(() => {
					if (scrollContainer) {
						scrollContainer.scrollTop = scrollTop;
					}
				});
			} else {
				setOpen(newOpen);
			}
		},
		[isInModal],
	);

	return (
		<Popover open={open} onOpenChange={handleOpenChange}>
			<PopoverTrigger asChild>
				<button
					ref={triggerRef}
					id={id}
					type="button"
					role="combobox"
					aria-expanded={open}
					aria-controls={listboxId}
					disabled={disabled}
					data-placeholder={value ? undefined : ""}
					className={cn(
						selectTriggerClassName,
						"overflow-hidden",
						width === "min" || width === "full" ? `w-${width}` : `w-[${width}]`,
					)}
				>
					<span className="truncate">
						{value
							? options.find((option) => option.value === value)?.label
							: placeholder}
					</span>
					<ChevronDown className="size-4 text-fg-tertiary transition-transform duration-150 group-data-[state=open]/select:rotate-180" />
				</button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				onOpenAutoFocus={isInModal ? (e) => e.preventDefault() : undefined}
				onCloseAutoFocus={isInModal ? (e) => e.preventDefault() : undefined}
				sideOffset={4}
				avoidCollisions={isInModal || enCajaDeModal}
				className={cn(
					"min-w-[300px] p-0",
					popOverWidth === "full"
						? "w-[var(--radix-popover-trigger-width)]"
						: popOverWidth === "auto"
							? "w-auto"
							: popOverWidth === "min"
								? "w-min"
								: `w-[${popOverWidth}]`,
				)}
			>
				<Command shouldFilter={!onSearchChange} id={listboxId}>
					<CommandInput
						placeholder={searchPlaceholder ?? placeholder}
						value={searchValue}
						onValueChange={(value) => {
							setSearchValue(value);
							onSearchChange?.(value);
						}}
					/>
					<CommandList
						style={
							maxListHeight
								? { maxHeight: maxListHeight, overflowY: "auto" }
								: undefined
						}
					>
						{isLoading ? (
							<div className="type-body-sm flex items-center justify-center gap-2 py-6 text-fg-tertiary">
								<Loader2 className="size-4 animate-spin" />
								Buscando...
							</div>
						) : (
							<>
								<CommandEmpty>No hay opciones</CommandEmpty>
								<CommandGroup>
									{options.map((option) => (
										<CommandItem
											key={option.value}
											value={option.label}
											onSelect={() => {
												onChange?.(option.value === value ? "" : option.value);
												setSearchValue("");
												setOpen(false);
											}}
										>
											<span className="truncate">{option.label}</span>
											<Check
												strokeWidth={3}
												className={cn(
													"ml-auto size-3.5 text-brand",
													value === option.value ? "opacity-100" : "opacity-0",
												)}
											/>
										</CommandItem>
									))}
								</CommandGroup>
							</>
						)}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
