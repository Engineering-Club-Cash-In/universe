import { CalendarIcon } from "lucide-react";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

type Periodo = "anio" | "trimestre" | "mes" | "semana" | "dia";

interface PeriodDatePickerProps {
	periodo: Periodo;
	fechaInicio: string;
	fechaFin: string;
	onChange: (fechaInicio: string, fechaFin: string) => void;
}

function pad(n: number) {
	return String(n).padStart(2, "0");
}

function lastDayOfMonth(year: number, month: number) {
	return new Date(year, month, 0).getDate();
}

function quarterStartEnd(year: number, q: number) {
	const startMonth = (q - 1) * 3 + 1;
	const endMonth = startMonth + 2;
	return {
		start: `${year}-${pad(startMonth)}-01`,
		end: `${year}-${pad(endMonth)}-${pad(lastDayOfMonth(year, endMonth))}`,
	};
}

function monthStartEnd(year: number, month: number) {
	return {
		start: `${year}-${pad(month)}-01`,
		end: `${year}-${pad(month)}-${pad(lastDayOfMonth(year, month))}`,
	};
}

function parseYear(s: string) {
	return new Date(`${s}T12:00:00`).getFullYear();
}
function parseMonth(s: string) {
	return new Date(`${s}T12:00:00`).getMonth() + 1;
}
function parseQuarter(s: string) {
	return Math.ceil(parseMonth(s) / 3) || 1;
}

const MONTHS = [
	"Enero",
	"Febrero",
	"Marzo",
	"Abril",
	"Mayo",
	"Junio",
	"Julio",
	"Agosto",
	"Septiembre",
	"Octubre",
	"Noviembre",
	"Diciembre",
];

function YearSelect({
	value,
	onChange,
}: {
	value: number;
	onChange: (y: number) => void;
}) {
	const currentYear = new Date().getFullYear();
	const years = Array.from({ length: 11 }, (_, i) => currentYear - 5 + i);
	return (
		<Select
			value={String(value)}
			onValueChange={(v) => onChange(Number(v))}
		>
			<SelectTrigger className="w-[90px]">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{years.map((y) => (
					<SelectItem key={y} value={String(y)}>
						{y}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

function QuarterSelect({
	value,
	onChange,
}: {
	value: number;
	onChange: (q: number) => void;
}) {
	return (
		<Select
			value={String(value)}
			onValueChange={(v) => onChange(Number(v))}
		>
			<SelectTrigger className="w-[70px]">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="1">T1</SelectItem>
				<SelectItem value="2">T2</SelectItem>
				<SelectItem value="3">T3</SelectItem>
				<SelectItem value="4">T4</SelectItem>
			</SelectContent>
		</Select>
	);
}

function MonthSelect({
	value,
	onChange,
}: {
	value: number;
	onChange: (m: number) => void;
}) {
	return (
		<Select
			value={String(value)}
			onValueChange={(v) => onChange(Number(v))}
		>
			<SelectTrigger className="w-[120px]">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{MONTHS.map((name, i) => (
					<SelectItem key={i + 1} value={String(i + 1)}>
						{name}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

export function PeriodDatePicker({
	periodo,
	fechaInicio,
	fechaFin,
	onChange,
}: PeriodDatePickerProps) {
	if (periodo === "anio") {
		const fromYear = parseYear(fechaInicio);
		const toYear = parseYear(fechaFin);
		return (
			<div className="flex items-center gap-1.5">
				<CalendarIcon className="h-4 w-4 text-muted-foreground shrink-0" />
				<YearSelect
					value={fromYear}
					onChange={(y) => {
						const clampedTo = Math.max(y, toYear);
						onChange(`${y}-01-01`, `${clampedTo}-12-31`);
					}}
				/>
				<span className="text-muted-foreground text-sm">–</span>
				<YearSelect
					value={toYear}
					onChange={(y) => {
						const clampedFrom = Math.min(fromYear, y);
						onChange(`${clampedFrom}-01-01`, `${y}-12-31`);
					}}
				/>
			</div>
		);
	}

	if (periodo === "trimestre") {
		const year = parseYear(fechaInicio);
		const fromQ = parseQuarter(fechaInicio);
		const toQ = parseQuarter(fechaFin);
		return (
			<div className="flex items-center gap-1.5">
				<CalendarIcon className="h-4 w-4 text-muted-foreground shrink-0" />
				<YearSelect
					value={year}
					onChange={(y) => {
						onChange(
							quarterStartEnd(y, fromQ).start,
							quarterStartEnd(y, toQ).end,
						);
					}}
				/>
				<QuarterSelect
					value={fromQ}
					onChange={(q) => {
						const clampedTo = Math.max(q, toQ);
						onChange(
							quarterStartEnd(year, q).start,
							quarterStartEnd(year, clampedTo).end,
						);
					}}
				/>
				<span className="text-muted-foreground text-sm">–</span>
				<QuarterSelect
					value={toQ}
					onChange={(q) => {
						const clampedFrom = Math.min(fromQ, q);
						onChange(
							quarterStartEnd(year, clampedFrom).start,
							quarterStartEnd(year, q).end,
						);
					}}
				/>
			</div>
		);
	}

	if (periodo === "mes") {
		const year = parseYear(fechaInicio);
		const fromMonth = parseMonth(fechaInicio);
		const toMonth = parseMonth(fechaFin);
		return (
			<div className="flex items-center gap-1.5">
				<CalendarIcon className="h-4 w-4 text-muted-foreground shrink-0" />
				<YearSelect
					value={year}
					onChange={(y) => {
						onChange(
							monthStartEnd(y, fromMonth).start,
							monthStartEnd(y, toMonth).end,
						);
					}}
				/>
				<MonthSelect
					value={fromMonth}
					onChange={(m) => {
						const clampedTo = Math.max(m, toMonth);
						onChange(
							monthStartEnd(year, m).start,
							monthStartEnd(year, clampedTo).end,
						);
					}}
				/>
				<span className="text-muted-foreground text-sm">–</span>
				<MonthSelect
					value={toMonth}
					onChange={(m) => {
						const clampedFrom = Math.min(fromMonth, m);
						onChange(
							monthStartEnd(year, clampedFrom).start,
							monthStartEnd(year, m).end,
						);
					}}
				/>
			</div>
		);
	}

	// semana / dia — single year + month
	const year = parseYear(fechaInicio);
	const month = parseMonth(fechaInicio);
	return (
		<div className="flex items-center gap-1.5">
			<CalendarIcon className="h-4 w-4 text-muted-foreground shrink-0" />
			<YearSelect
				value={year}
				onChange={(y) => {
					const r = monthStartEnd(y, month);
					onChange(r.start, r.end);
				}}
			/>
			<MonthSelect
				value={month}
				onChange={(m) => {
					const r = monthStartEnd(year, m);
					onChange(r.start, r.end);
				}}
			/>
		</div>
	);
}
