import {
	AlertTriangle,
	CheckCircle2,
	Info,
	MinusCircle,
	XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Inspection360Item {
	area: string;
	checkpoint: string;
	status: "GOOD" | "REGULAR" | "BAD" | "NA" | "OK" | "LEGACY_BAD";
	comment?: string;
	metadata?: Record<string, any>;
}

interface Inspection360ViewProps {
	items: Inspection360Item[];
}

export function Inspection360View({ items }: Inspection360ViewProps) {
	if (!items || items.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed bg-muted/30 p-8 text-center">
				<Info className="mb-2 h-8 w-8 text-muted-foreground" />
				<p className="text-muted-foreground text-sm">
					No hay datos de inspección 360° disponibles
				</p>
			</div>
		);
	}

	// Group items by area
	const groupedItems = items.reduce(
		(acc, item) => {
			if (!acc[item.area]) {
				acc[item.area] = [];
			}
			acc[item.area].push(item);
			return acc;
		},
		{} as Record<string, Inspection360Item[]>,
	);

	const getStatusIcon = (status: string) => {
		switch (status) {
			case "GOOD":
			case "OK":
				return <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />;
			case "REGULAR":
				return <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
			case "BAD":
			case "LEGACY_BAD":
				return <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />;
			case "NA":
				return <MinusCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
			default:
				return null;
		}
	};

	const getStatusLabel = (status: string) => {
		switch (status) {
			case "GOOD":
			case "OK":
				return { label: "Bueno", cls: "text-green-600 bg-green-50" };
			case "REGULAR":
				return { label: "Regular", cls: "text-amber-600 bg-amber-50" };
			case "BAD":
			case "LEGACY_BAD":
				return { label: "Malo", cls: "text-red-600 bg-red-50" };
			case "NA":
				return { label: "N/A", cls: "text-muted-foreground bg-muted/40" };
			default:
				return { label: status, cls: "text-muted-foreground bg-muted/40" };
		}
	};

	return (
		<div className="space-y-4">
			{Object.entries(groupedItems).map(([area, areaItems]) => (
				<div key={area}>
					{/* Area subheader */}
					<div className="flex items-center gap-2 mb-1.5">
						<span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
							{area.replace(/_/g, " ")}
						</span>
						<div className="flex-1 h-px bg-border" />
					</div>

					{/* Items 2-col grid */}
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
						{areaItems.map((item, idx) => {
							const { label, cls } = getStatusLabel(item.status);
							const hasCompression =
								item.metadata &&
								item.checkpoint.toLowerCase().includes("compresiones");

							const psiEntries = hasCompression
								? Object.entries(item.metadata!)
										.filter(
											([key, value]) =>
												key.startsWith("cilindro_") &&
												value !== 0 &&
												value !== "0" &&
												value !== "" &&
												value !== null,
										)
										.sort(
											([a], [b]) =>
												parseInt(a.split("_")[1]) - parseInt(b.split("_")[1]),
										)
								: [];

							return (
								<div
									key={`${area}-${item.checkpoint}-${idx}`}
									className="flex items-start justify-between gap-2 rounded-lg border bg-muted/20 hover:bg-muted/40 transition-colors px-3 py-2"
								>
									{/* Left: icon + name + optional extras */}
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-1.5">
											{getStatusIcon(item.status)}
											<span className="font-medium text-xs truncate">{item.checkpoint}</span>
										</div>
										{item.comment && (
											<p className="text-muted-foreground text-[10px] mt-0.5 ml-5 leading-snug line-clamp-2">
												{item.comment}
											</p>
										)}
										{psiEntries.length > 0 && (
											<div className="mt-1 ml-5 flex flex-wrap gap-1">
												{psiEntries.map(([key, value]) => (
													<span
														key={key}
														className="inline-flex items-center gap-0.5 rounded bg-blue-50 border border-blue-100 px-1.5 py-0.5 font-mono text-[9px] text-blue-700"
													>
														<span className="font-semibold">C{key.split("_")[1]}</span>
														<span className="text-blue-400">·</span>
														{value} PSI
													</span>
												))}
											</div>
										)}
									</div>

									{/* Right: status badge */}
									<span
										className={cn(
											"mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap",
											cls,
										)}
									>
										{label}
									</span>
								</div>
							);
						})}
					</div>
				</div>
			))}
		</div>
	);
}
