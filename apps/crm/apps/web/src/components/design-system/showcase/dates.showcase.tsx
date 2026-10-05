import * as React from "react";
import type { DateRange } from "react-day-picker";
import { FechaHoraPicker } from "@/components/fecha-hora-picker";
import { Calendar, calendarCardClassName } from "@/components/ui/calendar";
import {
	DatePicker,
	DatePickerTrigger,
	DateRangePicker,
	datePickerLabelClassName,
	formatearRango,
} from "@/components/ui/date-picker";
import { DatePicker as ReactDatePicker } from "@/components/ui/react-datepicker";
import { ShowcaseGroup, type ShowcaseMeta, ShowcaseRow } from "./_layout";

export const meta: ShowcaseMeta = {
	order: 75,
	title: "Calendario y date picker",
	figma: "02 · Componentes › Calendar · Date Picker",
	description:
		'Calendar mode="single" (Simple) | "range" (Rango), pie con showToday + onApply · DatePicker / DateRangePicker (cerrado = campo, abierto = popover con el Calendar) · ui/react-datepicker y FechaHoraPicker con el mismo aspecto.',
};

// Los mismos datos del Figma: julio 2026, hoy = 11, del 3 al 10 deshabilitados.
const HOY = new Date(2026, 6, 11);
const JULIO = new Date(2026, 6, 1);
const DESHABILITADOS = {
	from: new Date(2026, 6, 3),
	to: new Date(2026, 6, 10),
};
const DIA = new Date(2026, 6, 15);
const RANGO: DateRange = { from: DIA, to: new Date(2026, 6, 22) };

function CalendarioSimple() {
	const [dia, setDia] = React.useState<Date | undefined>(DIA);
	return (
		<Calendar
			className={calendarCardClassName}
			mode="single"
			today={HOY}
			defaultMonth={JULIO}
			selected={dia}
			onSelect={setDia}
			disabled={DESHABILITADOS}
			showToday
			onApply={() => {}}
		/>
	);
}

function CalendarioRango() {
	const [rango, setRango] = React.useState<DateRange | undefined>(RANGO);
	return (
		<Calendar
			className={calendarCardClassName}
			mode="range"
			today={HOY}
			defaultMonth={JULIO}
			selected={rango}
			onSelect={setRango}
			disabled={DESHABILITADOS}
			showToday
			onApply={() => {}}
		/>
	);
}

/** Estado "Abierto" fijo, para compararlo con Figma sin abrir el popover. */
function Abierto({
	label,
	valor,
	children,
}: {
	label: string;
	valor: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex w-78 flex-col gap-2">
			<span className={datePickerLabelClassName}>{label}</span>
			<DatePickerTrigger data-state="open" tabIndex={-1}>
				{valor}
			</DatePickerTrigger>
			{children}
		</div>
	);
}

export default function DatesShowcase() {
	const [fecha, setFecha] = React.useState<Date | undefined>(DIA);
	const [rango, setRango] = React.useState<DateRange | undefined>(RANGO);
	const [vacia, setVacia] = React.useState<Date | undefined>();
	const [legacy, setLegacy] = React.useState<Date | undefined>(DIA);
	const [fechaHora, setFechaHora] = React.useState<Date | undefined>(
		new Date(2026, 6, 15, 10, 30),
	);

	return (
		<div className="space-y-6">
			<ShowcaseGroup title="Calendar">
				<ShowcaseRow label="Simple · Rango" className="items-start gap-12">
					<CalendarioSimple />
					<CalendarioRango />
				</ShowcaseRow>
				<ShowcaseRow label="Estados de día">
					<span className="type-caption text-fg-tertiary">
						Default · Hoy (11, contorno) · Seleccionado (15) · En rango (16–21)
						· Deshabilitado (3–10) · Otro mes (29, 30, 1, 2)
					</span>
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="Date Picker">
				<ShowcaseRow label="Simple" className="items-start gap-12">
					<div className="w-78">
						<DatePicker
							label="Fecha de promesa"
							date={fecha}
							onDateChange={setFecha}
						/>
					</div>
					<Abierto label="Fecha de promesa" valor="15 / 07 / 2026">
						<Calendar
							className={calendarCardClassName}
							mode="single"
							today={HOY}
							defaultMonth={JULIO}
							selected={DIA}
							disabled={DESHABILITADOS}
							showToday
							onApply={() => {}}
						/>
					</Abierto>
				</ShowcaseRow>
				<ShowcaseRow label="Rango" className="items-start gap-12">
					<div className="w-78">
						<DateRangePicker
							label="Período"
							range={rango}
							onRangeChange={setRango}
						/>
					</div>
					<Abierto label="Período" valor={formatearRango(RANGO) ?? ""}>
						<Calendar
							className={calendarCardClassName}
							mode="range"
							today={HOY}
							defaultMonth={JULIO}
							selected={RANGO}
							disabled={DESHABILITADOS}
							showToday
							onApply={() => {}}
						/>
					</Abierto>
				</ShowcaseRow>
				<ShowcaseRow label="Campo" className="items-start">
					<div className="w-78">
						<DatePicker
							label="Sin fecha"
							date={vacia}
							onDateChange={setVacia}
						/>
					</div>
					<div className="w-78">
						<DatePicker label="Deshabilitado" date={DIA} disabled />
					</div>
					<div className="w-78">
						<DatePicker label="Con error" date={vacia} aria-invalid />
					</div>
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="Otros pickers con el mismo aspecto">
				<ShowcaseRow label="ui/react-datepicker" className="items-start">
					<div className="w-78">
						<ReactDatePicker date={legacy} onDateChange={setLegacy} />
					</div>
					<div className="w-78">
						<ReactDatePicker placeholder="Seleccionar fecha" />
					</div>
				</ShowcaseRow>
				<ShowcaseRow label="FechaHoraPicker" className="items-start">
					<div className="w-78">
						<FechaHoraPicker value={fechaHora} onChange={setFechaHora} />
					</div>
					<div className="w-78">
						<FechaHoraPicker
							value={undefined}
							onChange={() => {}}
							conHora={false}
						/>
					</div>
				</ShowcaseRow>
			</ShowcaseGroup>
		</div>
	);
}
