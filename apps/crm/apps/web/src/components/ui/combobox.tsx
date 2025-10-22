"use client";

import { Check, ChevronDown } from "lucide-react";
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
}

export function Combobox({
	options,
	placeholder = "Selecciona una opción...",
	width = "min",
	popOverWidth = "auto",
	value,
	onChange,
}: ComboboxDemoProps) {
	const [open, setOpen] = React.useState(false);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					role="combobox"
					aria-expanded={open}
					className={`${
						width === "min" || width === "full" ? `w-${width}` : `w-[${width}]`
					} justify-between`}
				>
					{value
						? options.find((option) => option.value === value)?.label
						: placeholder}
					<ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
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
				<Command>
					<CommandInput placeholder={placeholder} />
					<CommandList>
						<CommandEmpty>No hay opciones</CommandEmpty>
						<CommandGroup>
							{options.map((option) => (
								<CommandItem
									key={option.value}
									value={option.label}
									onSelect={(selectedLabel) => {
										const selectedOption = options.find(
											(opt) => opt.label === selectedLabel,
										);
										const actualValue = selectedOption
											? selectedOption.value
											: "";
										onChange?.(actualValue === value ? "" : actualValue);
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
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
