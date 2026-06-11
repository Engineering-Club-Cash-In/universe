"use client";

import { Check, ChevronDown, Loader2 } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
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
	PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface ComboboxOption {
	value: string;
	label: string;
}

interface ComboboxDemoProps {
	options: ComboboxOption[];
	placeholder?: string;
	width?: string;
	popOverWidth?: string;
	value: string | null;
	onChange: (value: string) => void;
	onSearchChange?: (search: string) => void;
	isLoading?: boolean;
	isInModal?: boolean;
	maxListHeight?: string;
}

export function Combobox({
	options,
	placeholder = "Selecciona una opción...",
	width = "min",
	popOverWidth = "auto",
	value,
	onChange,
	onSearchChange,
	isLoading,
	isInModal = false,
	maxListHeight,
}: ComboboxDemoProps) {
	const [open, setOpen] = React.useState(false);
	const [searchValue, setSearchValue] = React.useState("");
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
				<Button
					ref={triggerRef}
					variant="outline"
					role="combobox"
					aria-expanded={open}
					aria-controls={listboxId}
					className={`${
						width === "min" || width === "full" ? `w-${width}` : `w-[${width}]`
					} justify-between overflow-hidden`}
				>
					<span className="truncate">
						{value
							? options.find((option) => option.value === value)?.label
							: placeholder}
					</span>
					<ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				onOpenAutoFocus={isInModal ? (e) => e.preventDefault() : undefined}
				onCloseAutoFocus={isInModal ? (e) => e.preventDefault() : undefined}
				sideOffset={4}
				avoidCollisions={isInModal}
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
						placeholder={placeholder}
						value={searchValue}
						onValueChange={(value) => {
							setSearchValue(value);
							onSearchChange?.(value);
						}}
					/>
					<CommandList style={maxListHeight ? { maxHeight: maxListHeight, overflowY: "auto" } : undefined}>
						{isLoading ? (
							<div className="flex items-center justify-center py-6 text-muted-foreground text-sm">
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
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
											<Check
												className={cn(
													"mr-2 h-4 w-4",
													value === option.value ? "opacity-100" : "opacity-0",
												)}
											/>
											{option.label}
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
