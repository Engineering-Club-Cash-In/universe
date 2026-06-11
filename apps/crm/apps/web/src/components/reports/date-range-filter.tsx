import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Calendar as CalendarIcon, X } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface DateRangeFilterProps {
	dateRange: DateRange | undefined;
	onDateRangeChange: (range: DateRange | undefined) => void;
	className?: string;
	required?: boolean;
}

export function DateRangeFilter({
	dateRange,
	onDateRangeChange,
	className,
	required,
}: DateRangeFilterProps) {
	return (
		<div className={cn("grid gap-2", className)}>
			<Popover>
				<div className="flex items-center gap-1">
					<PopoverTrigger asChild>
						<Button
							id="date"
							variant={"outline"}
							className={cn(
								"w-[300px] justify-start text-left font-normal",
								!dateRange && "text-muted-foreground",
							)}
						>
							<CalendarIcon className="mr-2 h-4 w-4" />
							{dateRange?.from ? (
								dateRange.to ? (
									<>
										{format(dateRange.from, "dd MMM, yyyy", { locale: es })} -{" "}
										{format(dateRange.to, "dd MMM, yyyy", { locale: es })}
									</>
								) : (
									format(dateRange.from, "dd MMM, yyyy", { locale: es })
								)
							) : (
								<span>Seleccionar rango de fechas</span>
							)}
						</Button>
					</PopoverTrigger>
					{dateRange?.from && (
						<Button
							variant="ghost"
							size="icon"
							className="h-8 w-8 shrink-0"
							onClick={() => onDateRangeChange(undefined)}
						>
							<X className="h-4 w-4" />
						</Button>
					)}
				</div>
				<PopoverContent className="w-auto p-0" align="start">
					<Calendar
						initialFocus
						mode="range"
						required={required}
						defaultMonth={dateRange?.from}
						selected={dateRange}
						onSelect={onDateRangeChange}
						numberOfMonths={2}
						locale={es}
					/>
				</PopoverContent>
			</Popover>
		</div>
	);
}
