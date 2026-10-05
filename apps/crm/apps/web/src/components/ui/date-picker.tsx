import { format } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import * as React from "react";
import type { DateRange, Matcher } from "react-day-picker";
import { Calendar, calendarCardClassName } from "@/components/ui/calendar";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Date Picker — Figma "02 · Componentes › Date Picker" (127:1171).
 *
 * Modo (Figma) → componente: Simple → <DatePicker> · Rango → <DateRangePicker>.
 * Estado (Figma): Cerrado → el campo · Abierto → campo con borde brand de 2px +
 *   Clay-Subtle y el Calendar desplegado 8px debajo (Popover de Radix).
 * Campo: 42px, padding 12/16, radio md(14), bg/surface, borde border/default, texto
 *   14/400, ícono lucide/calendar de 16px en text/tertiary (en la ficha de Figma es un
 *   marcador redondo; el Input "Tipo=Date" usa lucide/calendar).
 * Etiqueta opcional (`label`): 13/500 text/secondary, 8px arriba del campo.
 * Pie del calendario: "Hoy" + "Aplicar" como en Figma. La fecha se confirma con
 *   "Aplicar"; con `applyOnSelect` se aplica al elegir el día y no se muestra "Aplicar".
 *
 * <DatePicker> acepta las mismas props que el DatePicker de `ui/react-datepicker`
 * (date, onDateChange, placeholder, disabled, className) para poder cambiarlo sin tocar
 * la pantalla. <DatePickerTrigger> es solo el campo, para armar otros pickers
 * (lo usa FechaHoraPicker).
 */

/** Campo de fecha de Figma (también lo usa el input de `ui/react-datepicker`). */
const datePickerFieldClassName =
	"flex h-10.5 w-full min-w-0 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-left text-fg text-sm/4.5 outline-none transition-[background-color,border-color,box-shadow] duration-150 ease-out placeholder:text-fg-tertiary hover:bg-cci-neutral-50 focus-visible:border-brand focus-visible:shadow-clay-subtle focus-visible:inset-ring-1 focus-visible:inset-ring-brand disabled:pointer-events-none disabled:border-line-subtle disabled:bg-muted disabled:opacity-60 aria-invalid:border-danger-solid data-[state=open]:border-brand data-[state=open]:bg-surface data-[state=open]:shadow-clay-subtle data-[state=open]:inset-ring-1 data-[state=open]:inset-ring-brand dark:hover:bg-cci-carbon-800";

/** Etiqueta del Date Picker de Figma. */
const datePickerLabelClassName = "font-medium text-[13px]/4 text-fg-secondary";

function DatePickerTrigger({
	className,
	placeholder,
	children,
	...props
}: React.ComponentProps<"button"> & {
	/** Texto en text/tertiary cuando no hay valor (children vacío). */
	placeholder?: string;
}) {
	const vacio = children === undefined || children === null || children === "";
	return (
		<button
			type="button"
			data-slot="date-picker-trigger"
			className={cn(datePickerFieldClassName, "cursor-pointer", className)}
			{...props}
		>
			<span className={cn("flex-1 truncate", vacio && "text-fg-tertiary")}>
				{vacio ? placeholder : children}
			</span>
			<CalendarIcon aria-hidden className="size-4 shrink-0 text-fg-tertiary" />
		</button>
	);
}

type BaseProps = {
	id?: string;
	/** Etiqueta encima del campo (Figma: "Fecha de promesa", "Período"). */
	label?: React.ReactNode;
	placeholder?: string;
	disabled?: boolean;
	/** Clase del campo. */
	className?: string;
	/** Días que no se pueden elegir (Matcher de react-day-picker). */
	disabledDays?: Matcher | Matcher[];
	/** Con true, elegir un día lo aplica y cierra; sin botón "Aplicar". */
	applyOnSelect?: boolean;
	"aria-invalid"?: boolean;
};

function Campo({
	id,
	label,
	children,
}: {
	id: string;
	label?: React.ReactNode;
	children: React.ReactNode;
}) {
	if (!label) return <>{children}</>;
	return (
		<div data-slot="date-picker" className="flex w-full flex-col gap-2">
			<label htmlFor={id} className={datePickerLabelClassName}>
				{label}
			</label>
			{children}
		</div>
	);
}

function DatePicker({
	id,
	label,
	date,
	onDateChange,
	placeholder = "dd / mm / aaaa",
	disabled = false,
	className,
	disabledDays,
	applyOnSelect = false,
	dateFormat = "dd / MM / yyyy",
	"aria-invalid": ariaInvalid,
}: BaseProps & {
	date?: Date;
	onDateChange?: (date: Date | undefined) => void;
	/** Formato de date-fns para el campo. Figma: "15 / 07 / 2026". */
	dateFormat?: string;
}) {
	const autoId = React.useId();
	const campoId = id ?? autoId;
	const [abierto, setAbierto] = React.useState(false);
	const [pendiente, setPendiente] = React.useState<Date | undefined>(date);

	const cambiarAbierto = (open: boolean) => {
		if (open) setPendiente(date);
		setAbierto(open);
	};

	return (
		<Campo id={campoId} label={label}>
			<Popover open={abierto} onOpenChange={cambiarAbierto}>
				<PopoverTrigger asChild>
					<DatePickerTrigger
						id={campoId}
						disabled={disabled}
						placeholder={placeholder}
						aria-invalid={ariaInvalid}
						className={className}
					>
						{date ? format(date, dateFormat, { locale: es }) : undefined}
					</DatePickerTrigger>
				</PopoverTrigger>
				<PopoverContent
					align="start"
					sideOffset={8}
					className={cn("w-auto p-0", calendarCardClassName)}
				>
					<Calendar
						mode="single"
						selected={pendiente}
						defaultMonth={pendiente ?? date}
						onSelect={(dia) => {
							setPendiente(dia);
							if (applyOnSelect) {
								onDateChange?.(dia);
								setAbierto(false);
							}
						}}
						disabled={disabledDays}
						showToday
						onApply={
							applyOnSelect
								? undefined
								: () => {
										onDateChange?.(pendiente);
										setAbierto(false);
									}
						}
					/>
				</PopoverContent>
			</Popover>
		</Campo>
	);
}

/** "15 jul – 22 jul, 2026" (Figma); con años distintos, cada extremo lleva el suyo. */
function formatearRango(rango: DateRange | undefined): string | undefined {
	if (!rango?.from) return undefined;
	const { from, to } = rango;
	if (!to) return format(from, "d MMM, yyyy", { locale: es });
	const mismoAnio = from.getFullYear() === to.getFullYear();
	const desde = format(from, mismoAnio ? "d MMM" : "d MMM, yyyy", {
		locale: es,
	});
	return `${desde} – ${format(to, "d MMM, yyyy", { locale: es })}`;
}

function DateRangePicker({
	id,
	label,
	range,
	onRangeChange,
	placeholder = "Seleccione un período",
	disabled = false,
	className,
	disabledDays,
	applyOnSelect = false,
	numberOfMonths = 1,
	"aria-invalid": ariaInvalid,
}: BaseProps & {
	range?: DateRange;
	onRangeChange?: (range: DateRange | undefined) => void;
	/** Meses visibles en el calendario (Figma: 1). */
	numberOfMonths?: number;
}) {
	const autoId = React.useId();
	const campoId = id ?? autoId;
	const [abierto, setAbierto] = React.useState(false);
	const [pendiente, setPendiente] = React.useState<DateRange | undefined>(
		range,
	);

	const cambiarAbierto = (open: boolean) => {
		if (open) setPendiente(range);
		setAbierto(open);
	};

	return (
		<Campo id={campoId} label={label}>
			<Popover open={abierto} onOpenChange={cambiarAbierto}>
				<PopoverTrigger asChild>
					<DatePickerTrigger
						id={campoId}
						disabled={disabled}
						placeholder={placeholder}
						aria-invalid={ariaInvalid}
						className={className}
					>
						{formatearRango(range)}
					</DatePickerTrigger>
				</PopoverTrigger>
				<PopoverContent
					align="start"
					sideOffset={8}
					className={cn("w-auto p-0", calendarCardClassName)}
				>
					<Calendar
						mode="range"
						selected={pendiente}
						defaultMonth={pendiente?.from ?? range?.from}
						numberOfMonths={numberOfMonths}
						onSelect={(nuevo) => {
							setPendiente(nuevo);
							if (applyOnSelect && nuevo?.from && nuevo.to) {
								onRangeChange?.(nuevo);
								setAbierto(false);
							}
						}}
						disabled={disabledDays}
						showToday
						onApply={
							applyOnSelect
								? undefined
								: () => {
										onRangeChange?.(pendiente);
										setAbierto(false);
									}
						}
						applyDisabled={!!pendiente?.from && !pendiente.to}
					/>
				</PopoverContent>
			</Popover>
		</Campo>
	);
}

export {
	DatePicker,
	DatePickerTrigger,
	DateRangePicker,
	datePickerFieldClassName,
	datePickerLabelClassName,
	formatearRango,
};
