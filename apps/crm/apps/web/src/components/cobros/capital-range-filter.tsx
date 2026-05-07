import { DollarSign, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface CapitalRangeFilterProps {
	capitalMin: number | undefined;
	capitalMax: number | undefined;
	onCapitalRangeChange: (min: number | undefined, max: number | undefined) => void;
	className?: string;
}

function formatCapital(value: number) {
	return new Intl.NumberFormat("es-GT", {
		style: "currency",
		currency: "GTQ",
		minimumFractionDigits: 0,
		maximumFractionDigits: 0,
	}).format(value);
}

export function CapitalRangeFilter({
	capitalMin,
	capitalMax,
	onCapitalRangeChange,
	className,
}: CapitalRangeFilterProps) {
	const [minInput, setMinInput] = useState(capitalMin?.toString() ?? "");
	const [maxInput, setMaxInput] = useState(capitalMax?.toString() ?? "");

	const hasFilter = capitalMin !== undefined || capitalMax !== undefined;

	function handleApply() {
		const min = minInput !== "" ? Number(minInput) : undefined;
		const max = maxInput !== "" ? Number(maxInput) : undefined;
		onCapitalRangeChange(min, max);
	}

	function handleClear() {
		setMinInput("");
		setMaxInput("");
		onCapitalRangeChange(undefined, undefined);
	}

	return (
		<div className={cn("flex items-center gap-1", className)}>
			<Popover>
				<PopoverTrigger asChild>
					<Button
						variant="outline"
						className={cn(
							"w-[220px] justify-start text-left font-normal",
							!hasFilter && "text-muted-foreground",
						)}
					>
						<DollarSign className="mr-2 h-4 w-4" />
						{hasFilter ? (
							<span>
								{capitalMin !== undefined ? formatCapital(capitalMin) : "Sin mín."}{" "}
								—{" "}
								{capitalMax !== undefined ? formatCapital(capitalMax) : "Sin máx."}
							</span>
						) : (
							<span>Rango de Capital</span>
						)}
					</Button>
				</PopoverTrigger>
				<PopoverContent className="w-[220px] p-4" align="start">
					<div className="flex flex-col gap-3">
						<p className="font-semibold text-sm">Filtrar por Capital</p>
						<div className="flex flex-col gap-1">
							<Label htmlFor="capital-min" className="text-xs text-muted-foreground">
								Mínimo (Q)
							</Label>
							<Input
								id="capital-min"
								type="number"
								min={0}
								placeholder="Ej: 10000"
								value={minInput}
								onChange={(e) => setMinInput(e.target.value)}
							/>
						</div>
						<div className="flex flex-col gap-1">
							<Label htmlFor="capital-max" className="text-xs text-muted-foreground">
								Máximo (Q)
							</Label>
							<Input
								id="capital-max"
								type="number"
								min={0}
								placeholder="Ej: 100000"
								value={maxInput}
								onChange={(e) => setMaxInput(e.target.value)}
							/>
						</div>
						<Button size="sm" onClick={handleApply} className="w-full">
							Aplicar
						</Button>
					</div>
				</PopoverContent>
			</Popover>
			{hasFilter && (
				<Button
					variant="ghost"
					size="icon"
					className="h-8 w-8 shrink-0"
					onClick={handleClear}
				>
					<X className="h-4 w-4" />
				</Button>
			)}
		</div>
	);
}
