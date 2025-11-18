import { es } from "date-fns/locale/es";
import React from "react";
import ReactDatePicker, { registerLocale } from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { cn } from "@/lib/utils";

// Registrar locale español
registerLocale("es", es);

interface DatePickerProps {
	date?: Date;
	onDateChange?: (date: Date | undefined) => void;
	placeholder?: string;
	disabled?: boolean;
	className?: string;
}

export function DatePicker({
	date,
	onDateChange,
	placeholder = "Seleccionar fecha",
	disabled = false,
	className,
}: DatePickerProps) {
	return (
		<ReactDatePicker
			selected={date}
			onChange={(date) => onDateChange?.(date || undefined)}
			locale="es"
			dateFormat="dd/MM/yyyy"
			placeholderText={placeholder}
			disabled={disabled}
			className={cn(
				"flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:font-medium file:text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
				className,
			)}
		/>
	);
}
