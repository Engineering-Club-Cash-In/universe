import { AlertCircle, CheckCircle2, XCircle } from "lucide-react";

const INVESTOR_STATUS_CONFIG = {
	activo: {
		label: "Activo",
		icon: CheckCircle2,
		className:
			"border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
		dotClassName: "bg-emerald-500",
	},
	inactivo: {
		label: "Inactivo",
		icon: XCircle,
		className:
			"border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-300",
		dotClassName: "bg-rose-500",
	},
	pendiente_devolucion: {
		label: "Pendiente devolución",
		icon: AlertCircle,
		className:
			"border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300",
		dotClassName: "bg-amber-500",
	},
} as const;

type InvestorStatus = keyof typeof INVESTOR_STATUS_CONFIG;

export function InvestorStatusBadge({
	status,
	size = "md",
}: {
	status?: string | null;
	size?: "sm" | "md";
}) {
	const config = INVESTOR_STATUS_CONFIG[status as InvestorStatus] ?? null;
	if (!config) return null;
	const Icon = config.icon;
	const isSmall = size === "sm";
	return (
		<span
			className={`inline-flex items-center gap-1.5 rounded-full border font-semibold shadow-sm ${config.className} ${
				isSmall ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-0.5 text-xs"
			}`}
		>
			<span className={`relative flex ${isSmall ? "h-1.5 w-1.5" : "h-2 w-2"}`}>
				{status === "pendiente_devolucion" && (
					<span
						className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${config.dotClassName}`}
					/>
				)}
				<span
					className={`relative inline-flex rounded-full ${config.dotClassName} ${
						isSmall ? "h-1.5 w-1.5" : "h-2 w-2"
					}`}
				/>
			</span>
			<Icon className={isSmall ? "h-3 w-3" : "h-3.5 w-3.5"} />
			{config.label}
		</span>
	);
}
