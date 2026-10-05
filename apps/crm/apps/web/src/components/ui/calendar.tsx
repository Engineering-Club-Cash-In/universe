import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import type * as React from "react";
import {
	CalendarDay,
	type ChevronProps,
	type DayButtonProps,
	DayPicker,
	type DayPickerProps,
	useDayPicker,
} from "react-day-picker";
import { es } from "react-day-picker/locale";
import { cn } from "@/lib/utils";

/**
 * Calendar — Figma "02 · Componentes › Calendar" (126:1151). react-day-picker v9.
 *
 * Modo (Figma) → `mode` de DayPicker: Simple → "single" · Rango → "range".
 * Estados de día (todos por modifiers de DayPicker, ver CalendarDayButton):
 *   Default → text/primary 13/400 · Otro mes → text/tertiary · Deshabilitado → text/tertiary
 *   al 40% · Hoy → contorno brand 1.5px, texto brand 600 · Seleccionado (y extremos
 *   del rango) → píldora bg brand, texto on-primary 600 · En rango → bg brand-subtle,
 *   radio sm(8), texto brand 500.
 * Pie "Hoy" / "Aplicar" (opcional, agregado como props):
 *   `showToday` → botón "Hoy" (va al mes actual; en modo "single" además elige hoy).
 *   `onApply` → botón "Aplicar" (`applyLabel`, `applyDisabled`).
 * Medidas: padding 16, gap 12, celdas de 40px, día 36×16 (área de clic 40×20),
 * navegación 28×18 con radio sm(8) sobre bg/canvas.
 *
 * El marco de Figma (bg/surface, radio lg(20), Elevation/Dropdown) NO va en el
 * calendario: lo pone el contenedor (PopoverContent o `calendarCardClassName`), para no
 * duplicar fondo y borde dentro de los popovers que ya existen.
 * Por defecto usa el locale `es` (semana de lunes a domingo, "Julio 2026").
 */

/**
 * Marco de Figma del Calendar (bg/surface, radio lg 20, Elevation/Dropdown). Úselo en un
 * calendario suelto (`<Calendar className={calendarCardClassName} />`) o en el
 * PopoverContent que lo contiene (junto con "w-auto p-0").
 */
const calendarCardClassName =
	"rounded-2xl border-0 bg-surface text-fg shadow-dropdown";

/** Botón de navegación (‹ ›) del Calendar; también lo usa el DatePicker de react-datepicker. */
const calendarNavButtonClassName =
	"inline-flex h-4.5 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md bg-canvas text-fg-secondary outline-none transition-colors duration-150 hover:bg-muted hover:text-fg focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 aria-disabled:pointer-events-none aria-disabled:opacity-40 [&_svg]:size-3.5";

type CalendarProps = DayPickerProps & {
	/** Botón "Hoy" del pie: va al mes actual y, en modo "single", elige el día de hoy. */
	showToday?: boolean;
	/** Botón "Aplicar" del pie. */
	onApply?: () => void;
	applyLabel?: string;
	applyDisabled?: boolean;
};

function Calendar({
	className,
	classNames,
	showOutsideDays = true,
	locale = es,
	components,
	formatters,
	footer,
	showToday = false,
	onApply,
	applyLabel = "Aplicar",
	applyDisabled = false,
	...props
}: CalendarProps) {
	const conPie = showToday || !!onApply;

	return (
		<DayPicker
			data-slot="calendar"
			showOutsideDays={showOutsideDays}
			locale={locale}
			navLayout="around"
			className={cn("flex w-fit flex-col gap-3 p-4 text-fg", className)}
			classNames={{
				root: "",
				months: "relative flex flex-col gap-4 sm:flex-row sm:gap-6",
				month:
					"grid w-70 grid-cols-[28px_1fr_28px] items-center gap-x-2 gap-y-3",
				month_caption:
					"col-start-2 row-start-1 flex h-4.5 items-center justify-center",
				caption_label:
					"inline-flex items-center gap-1 font-semibold text-sm/4.5 capitalize",
				dropdowns:
					"flex items-center justify-center gap-1.5 font-semibold text-sm/4.5 capitalize",
				dropdown_root:
					"relative rounded-md px-1 hover:bg-muted has-focus-visible:ring-2 has-focus-visible:ring-ring",
				dropdown: "absolute inset-0 cursor-pointer opacity-0",
				button_previous: cn(
					calendarNavButtonClassName,
					"col-start-1 row-start-1",
				),
				button_next: cn(calendarNavButtonClassName, "col-start-3 row-start-1"),
				chevron: "",
				month_grid: "col-span-3 row-start-2 flex flex-col gap-3",
				weekdays: "flex",
				weekday:
					"w-10 text-center font-semibold text-[11px]/3.5 text-fg-tertiary uppercase",
				weeks: "flex flex-col gap-1",
				week: "flex",
				week_number:
					"flex w-10 items-center justify-center text-[11px] text-fg-tertiary",
				week_number_header: "w-10",
				day: "flex w-10 items-center justify-center p-0",
				day_button: "",
				hidden: "invisible",
				footer: "flex items-center justify-between gap-2",
				...classNames,
			}}
			formatters={{
				// L M M J V S D (Figma) en vez de "lu ma mi…".
				formatWeekdayName: (weekday, _options, dateLib) =>
					dateLib
						? dateLib.format(weekday, "ccccc")
						: weekday.toLocaleDateString("es", { weekday: "narrow" }),
				...formatters,
			}}
			components={{
				Chevron: CalendarChevron,
				DayButton: CalendarDayButton,
				...components,
			}}
			footer={
				conPie || footer ? (
					<>
						{footer}
						{conPie && (
							<CalendarFooterActions
								showToday={showToday}
								onApply={onApply}
								applyLabel={applyLabel}
								applyDisabled={applyDisabled}
							/>
						)}
					</>
				) : undefined
			}
			{...props}
		/>
	);
}
Calendar.displayName = "Calendar";

function CalendarChevron({ orientation, className }: ChevronProps) {
	const Icon =
		orientation === "left"
			? ChevronLeft
			: orientation === "right"
				? ChevronRight
				: ChevronDown;
	return <Icon aria-hidden className={cn("size-3.5", className)} />;
}

/** Día del calendario: los estados de Figma salen de los modifiers de DayPicker. */
function CalendarDayButton({
	className,
	day: _day,
	modifiers,
	...props
}: DayButtonProps) {
	// Seleccionado en modo simple, o extremo de un rango: píldora sólida.
	const solido = modifiers.selected && !modifiers.range_middle;

	return (
		<button
			data-slot="calendar-day"
			className={cn(
				"relative inline-flex h-4 w-9 cursor-pointer items-center justify-center rounded-full text-[13px]/4 text-fg outline-none transition-colors duration-150",
				// Área de clic de 40×20 sin cambiar la medida de Figma.
				"after:absolute after:-inset-x-0.5 after:-inset-y-0.5 after:content-['']",
				"hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none",
				modifiers.outside && "text-fg-tertiary",
				modifiers.today &&
					!modifiers.selected &&
					"inset-ring-[1.5px] inset-ring-brand font-semibold text-brand",
				modifiers.range_middle &&
					"rounded-md bg-brand-subtle font-medium text-brand hover:bg-brand-subtle",
				solido && "bg-brand font-semibold text-on-brand hover:bg-brand-hover",
				modifiers.disabled && "text-fg-tertiary opacity-40",
				className,
			)}
			{...props}
		/>
	);
}

function CalendarFooterActions({
	showToday,
	onApply,
	applyLabel,
	applyDisabled,
}: {
	showToday: boolean;
	onApply?: () => void;
	applyLabel: string;
	applyDisabled: boolean;
}) {
	// Tipado como "single": `select` solo se usa en ese modo (ver irAHoy).
	const { goToMonth, select, getModifiers, dayPickerProps } = useDayPicker<{
		mode: "single";
	}>();

	const irAHoy = (e: React.MouseEvent) => {
		const hoy = dayPickerProps.today ?? new Date();
		goToMonth(hoy);
		if (dayPickerProps.mode !== "single" || !select) return;
		const modifiers = getModifiers(new CalendarDay(hoy, hoy));
		if (modifiers.disabled) return;
		// `selected: false` para que "Hoy" nunca deseleccione el día ya elegido.
		select(hoy, { ...modifiers, selected: false }, e);
	};

	return (
		<>
			{showToday && (
				<button
					type="button"
					onClick={irAHoy}
					className="cursor-pointer rounded-sm font-semibold text-brand text-xs/3.75 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
				>
					Hoy
				</button>
			)}
			{onApply && (
				<button
					type="button"
					onClick={onApply}
					disabled={applyDisabled}
					className="ml-auto inline-flex h-5.75 cursor-pointer items-center rounded-md bg-brand px-3 font-semibold text-on-brand text-xs/3.75 outline-none transition-colors duration-150 hover:bg-brand-hover focus-visible:ring-2 focus-visible:ring-ring active:shadow-pressed disabled:pointer-events-none disabled:opacity-40"
				>
					{applyLabel}
				</button>
			)}
		</>
	);
}

export {
	Calendar,
	CalendarDayButton,
	calendarCardClassName,
	calendarNavButtonClassName,
	type CalendarProps,
};
