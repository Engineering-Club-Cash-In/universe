import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface ReportCardProps {
	title: string;
	value: string | number;
	description?: string;
	icon?: LucideIcon;
	trend?: {
		value: number;
		label: string;
	};
	className?: string;
}

export function ReportCard({
	title,
	value,
	description,
	icon: Icon,
	trend,
	className,
}: ReportCardProps) {
	const trendIsPositive = trend && trend.value > 0;
	const trendIsNegative = trend && trend.value < 0;

	return (
		<Card className={cn("", className)}>
			<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle className="font-medium text-sm">{title}</CardTitle>
				{Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
			</CardHeader>
			<CardContent>
				<div className="font-bold text-2xl">{value}</div>
				{description && (
					<p className="text-muted-foreground text-xs">{description}</p>
				)}
				{trend && (
					<div className="mt-2 flex items-center gap-1 text-xs">
						<span
							className={cn(
								"font-medium",
								trendIsPositive && "text-green-600 dark:text-green-400",
								trendIsNegative && "text-red-600 dark:text-red-400",
								!trendIsPositive && !trendIsNegative && "text-gray-600",
							)}
						>
							{trendIsPositive && "+"}
							{trend.value}%
						</span>
						<span className="text-muted-foreground">{trend.label}</span>
					</div>
				)}
			</CardContent>
		</Card>
	);
}
