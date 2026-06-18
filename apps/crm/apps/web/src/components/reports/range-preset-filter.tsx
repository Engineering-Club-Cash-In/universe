import { subMonths } from "date-fns";
import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { DateRangeFilter } from "@/components/reports/date-range-filter";
import { Button } from "@/components/ui/button";

const GUATEMALA_TZ = "America/Guatemala";

export type PresetKey = "month" | "3m" | "6m" | "ytd" | "custom";

const RANGE_PRESETS: { key: PresetKey; label: string }[] = [
	{ key: "month", label: "Este mes" },
	{ key: "3m", label: "Últimos 3 meses" },
	{ key: "6m", label: "Últimos 6 meses" },
	{ key: "ytd", label: "Este año" },
	{ key: "custom", label: "Personalizado" },
];

export const DEFAULT_PRESET: PresetKey = "3m";

/** Rango [desde, hasta] correspondiente a un preset (hoy como fin). */
export function rangeForPreset(key: PresetKey): DateRange {
	const today = new Date();
	switch (key) {
		case "month":
			return {
				from: new Date(today.getFullYear(), today.getMonth(), 1),
				to: today,
			};
		case "6m":
			return { from: subMonths(today, 6), to: today };
		case "ytd":
			return { from: new Date(today.getFullYear(), 0, 1), to: today };
		default:
			// "3m"
			return { from: subMonths(today, 3), to: today };
	}
}

function formatRangeLabel(range: DateRange | undefined): string {
	if (!range?.from || !range?.to) return "";
	const fmt = (d: Date) =>
		new Intl.DateTimeFormat("es-GT", {
			timeZone: GUATEMALA_TZ,
			day: "2-digit",
			month: "short",
			year: "numeric",
		}).format(d);
	return `${fmt(range.from)} – ${fmt(range.to)}`;
}

/**
 * Filtro de fechas por presets (Este mes / Últimos 3-6 meses / Este año) más
 * una opción "Personalizado" que abre el calendario de rango libre. El rango
 * vive en el padre; este componente solo recuerda qué preset está activo.
 */
export function RangePresetFilter({
	dateRange,
	onDateRangeChange,
	defaultPreset = DEFAULT_PRESET,
}: {
	dateRange: DateRange | undefined;
	onDateRangeChange: (range: DateRange | undefined) => void;
	defaultPreset?: PresetKey;
}) {
	const [preset, setPreset] = useState<PresetKey>(defaultPreset);

	const handlePreset = (key: PresetKey) => {
		setPreset(key);
		if (key !== "custom") {
			onDateRangeChange(rangeForPreset(key));
		}
	};

	return (
		<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
			<div className="inline-flex flex-wrap items-center gap-1 rounded-lg border bg-muted/30 p-1">
				{RANGE_PRESETS.map((p) => (
					<Button
						key={p.key}
						type="button"
						size="sm"
						variant={preset === p.key ? "secondary" : "ghost"}
						className="h-8"
						onClick={() => handlePreset(p.key)}
					>
						{p.label}
					</Button>
				))}
			</div>
			{preset === "custom" ? (
				<DateRangeFilter
					dateRange={dateRange}
					onDateRangeChange={onDateRangeChange}
				/>
			) : (
				<span className="text-muted-foreground text-sm">
					{formatRangeLabel(dateRange)}
				</span>
			)}
		</div>
	);
}
