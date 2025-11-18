import { AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/**
 * Renderiza un badge para el estado de inspección de un vehículo
 */
export function renderInspectionStatusBadge(status: string) {
	const statusConfig = {
		approved: {
			label: "Aprobada",
			className: "bg-green-100 text-green-800 border-green-300",
			icon: CheckCircle,
		},
		pending: {
			label: "Pendiente",
			className: "bg-yellow-100 text-yellow-800 border-yellow-300",
			icon: AlertTriangle,
		},
		rejected: {
			label: "Rechazada",
			className: "bg-red-100 text-red-800 border-red-300",
			icon: XCircle,
		},
	};

	const config =
		statusConfig[status as keyof typeof statusConfig] || statusConfig.pending;
	const Icon = config.icon;

	return (
		<Badge variant="outline" className={config.className}>
			<Icon className="mr-1 h-3 w-3" />
			{config.label}
		</Badge>
	);
}
