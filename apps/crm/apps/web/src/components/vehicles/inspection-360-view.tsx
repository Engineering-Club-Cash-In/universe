import {
	AlertTriangle,
	CheckCircle2,
	Info,
	MinusCircle,
	XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
				return <CheckCircle2 className="h-4 w-4 text-green-500" />;
			case "REGULAR":
				return <AlertTriangle className="h-4 w-4 text-amber-500" />;
			case "BAD":
			case "LEGACY_BAD":
				return <XCircle className="h-4 w-4 text-red-500" />;
			case "NA":
				return <MinusCircle className="h-4 w-4 text-muted-foreground" />;
			default:
				return null;
		}
	};

	const getStatusLabel = (status: string) => {
		switch (status) {
			case "GOOD":
			case "OK":
				return "Bueno";
			case "REGULAR":
				return "Regular";
			case "BAD":
			case "LEGACY_BAD":
				return "Malo";
			case "NA":
				return "N/A";
			default:
				return status;
		}
	};

	return (
		<div className="space-y-6">
			{Object.entries(groupedItems).map(([area, areaItems]) => (
				<div key={area} className="space-y-3">
					<h5 className="font-semibold text-muted-foreground text-sm uppercase tracking-tight">
						{area}
					</h5>
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{areaItems.map((item, idx) => (
							<Card
								key={`${area}-${item.checkpoint}-${idx}`}
								className="overflow-hidden border-muted/60 transition-colors hover:border-muted-foreground/20"
							>
								<CardHeader className="bg-muted/20 p-3">
									<div className="flex items-start justify-between gap-2">
										<p className="font-medium text-sm leading-tight">
											{item.checkpoint}
										</p>
										<div className="shrink-0">{getStatusIcon(item.status)}</div>
									</div>
								</CardHeader>
								<CardContent className="space-y-2 p-3">
									<div className="flex items-center justify-between">
										<Badge
											variant="outline"
											className="py-0 font-normal text-[10px]"
										>
											{getStatusLabel(item.status)}
										</Badge>
										{item.metadata && Object.keys(item.metadata).length > 0 && (
											<span className="text-[10px] text-muted-foreground italic">
												Contiene datos técnicos
											</span>
										)}
									</div>

									{item.comment && (
										<p className="line-clamp-3 text-muted-foreground text-xs">
											{item.comment}
										</p>
									)}

									{/* Compression Data Special Display */}
									{item.metadata &&
										item.checkpoint.toLowerCase().includes("compresiones") && (
											<div className="mt-2 grid grid-cols-4 gap-1 border-t pt-2">
												{Object.entries(item.metadata)
													.filter(([key]) => key.startsWith("cilindro_"))
													.map(([key, value]) => (
														<div key={key} className="text-center">
															<p className="text-[8px] text-muted-foreground uppercase">
																C{key.split("_")[1]}
															</p>
															<p className="font-bold font-mono text-[10px]">
																{value}
															</p>
														</div>
													))}
											</div>
										)}
								</CardContent>
							</Card>
						))}
					</div>
				</div>
			))}
		</div>
	);
}
