import { format } from "date-fns";
import { es } from "date-fns/locale/es";
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import * as React from "react";
import ReactDatePicker, { registerLocale } from "react-datepicker";
import { createPortal } from "react-dom";
import { calendarNavButtonClassName } from "@/components/ui/calendar";
import { datePickerFieldClassName } from "@/components/ui/date-picker";
import { PopoverPortalContext } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * DatePicker con `react-datepicker` (se puede escribir la fecha a mano).
 * Aspecto: Figma "02 · Componentes › Date Picker" (127:1171) y "Calendar" (126:1151).
 *
 * Ya no se importa `react-datepicker.css`: todo el estilo sale de los tokens con las
 * clases de abajo, así el calendario se ve igual que <Calendar>:
 *   campo  → `datePickerFieldClassName` (42px, radio 14, borde brand 2px al enfocar)
 *   tarjeta → bg/surface, radio 20, padding 16, Elevation/Dropdown, sin flecha
 *   días   → píldora 36×16; seleccionado = bg brand; hoy = contorno brand; otro mes =
 *            text/tertiary; deshabilitado = 40%.
 * Los estados de día se leen de los atributos que pone react-datepicker
 * (aria-selected, aria-current="date", aria-disabled) y de la clase "--outside-month".
 * La API (date, onDateChange, placeholder, disabled, className) no cambia.
 */

// Registrar locale español
registerLocale("es", es);

interface DatePickerProps {
	date?: Date;
	onDateChange?: (date: Date | undefined) => void;
	placeholder?: string;
	disabled?: boolean;
	className?: string;
}

/** Tarjeta del calendario y piezas internas de react-datepicker (sin su CSS). */
const calendarioClassName = cn(
	"relative inline-flex flex-col rounded-2xl bg-surface p-4 font-sans text-fg shadow-dropdown",
	// Región aria-live: solo para lectores de pantalla.
	"[&_[aria-live]]:sr-only",
	// Encabezado (nuestro) + nombres de los días, separados 12px como en Figma.
	"[&_[class*=header--custom]]:flex [&_[class*=header--custom]]:flex-col [&_[class*=header--custom]]:gap-3",
	"[&_[class*=day-names]]:flex",
	// Mes (role=listbox) → semanas con 4px entre filas.
	"[&_[role=listbox]]:mt-3 [&_[role=listbox]]:flex [&_[role=listbox]]:flex-col [&_[role=listbox]]:gap-1",
	"[&_[role=listbox]>div]:flex",
	"[&_[class*=children-container]]:mt-3",
);

/** Cada día (se aplica con `dayClassName`). */
const diaClassName = cn(
	"relative mx-0.5 inline-flex h-4 w-9 cursor-pointer select-none items-center justify-center rounded-full text-[13px]/4 text-fg outline-none transition-colors duration-150",
	"after:absolute after:-inset-x-0.5 after:-inset-y-0.5 after:content-['']",
	"hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
	// Selector de clase exacta (no `class*=`: la propia utilidad contiene el texto).
	String.raw`[&.react-datepicker\_\_day--outside-month]:text-fg-tertiary`,
	"aria-[current=date]:not-aria-selected:inset-ring-[1.5px] aria-[current=date]:not-aria-selected:inset-ring-brand aria-[current=date]:not-aria-selected:font-semibold aria-[current=date]:not-aria-selected:text-brand",
	"aria-selected:bg-brand aria-selected:font-semibold aria-selected:text-on-brand aria-selected:hover:bg-brand-hover",
	"aria-disabled:pointer-events-none aria-disabled:text-fg-tertiary aria-disabled:opacity-40",
);

export function DatePicker({
	date,
	onDateChange,
	placeholder = "Seleccionar fecha",
	disabled = false,
	className,
}: DatePickerProps) {
	// Mismo criterio que los popovers: dentro del Workspace el calendario se
	// monta en la caja del modal (ver PopoverPortalContext).
	const contenedor = React.useContext(PopoverPortalContext);
	return (
		<div className="relative w-full">
			<ReactDatePicker
				popperContainer={
					contenedor
						? ({ children }) => createPortal(children, contenedor)
						: undefined
				}
				selected={date}
				onChange={(date) => onDateChange?.(date || undefined)}
				locale="es"
				dateFormat="dd/MM/yyyy"
				placeholderText={placeholder}
				disabled={disabled}
				wrapperClassName="block w-full [&_[aria-live]]:sr-only"
				className={cn(datePickerFieldClassName, "pr-10", className)}
				showPopperArrow={false}
				popperClassName="z-50"
				popperPlacement="bottom-start"
				calendarClassName={calendarioClassName}
				dayClassName={() => diaClassName}
				weekDayClassName={() =>
					"w-10 text-center font-semibold text-[11px]/3.5 text-fg-tertiary uppercase"
				}
				formatWeekDay={(nombre) => nombre.charAt(0)}
				renderCustomHeader={({
					monthDate,
					decreaseMonth,
					increaseMonth,
					prevMonthButtonDisabled,
					nextMonthButtonDisabled,
				}) => (
					<div className="flex h-4.5 items-center justify-between gap-2">
						<button
							type="button"
							onClick={decreaseMonth}
							disabled={prevMonthButtonDisabled}
							aria-label="Mes anterior"
							className={calendarNavButtonClassName}
						>
							<ChevronLeft aria-hidden />
						</button>
						<span className="font-semibold text-sm/4.5 capitalize">
							{format(monthDate, "LLLL yyyy", { locale: es })}
						</span>
						<button
							type="button"
							onClick={increaseMonth}
							disabled={nextMonthButtonDisabled}
							aria-label="Mes siguiente"
							className={calendarNavButtonClassName}
						>
							<ChevronRight aria-hidden />
						</button>
					</div>
				)}
			/>
			<CalendarIcon
				aria-hidden
				className="pointer-events-none absolute top-1/2 right-4 size-4 -translate-y-1/2 text-fg-tertiary"
			/>
		</div>
	);
}
