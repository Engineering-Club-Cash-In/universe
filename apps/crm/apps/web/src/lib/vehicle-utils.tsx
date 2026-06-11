import {
	AlertTriangle,
	CheckCircle,
	Clock,
	Sparkles,
	XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

type VehicleForValidation = {
	isNew?: boolean | null;
	vinNumber?: string | null;
	licensePlate?: string | null;
	origin?: string | null;
	fuelType?: string | null;
	transmission?: string | null;
};

/**
 * Obtiene la lista de campos faltantes para un vehículo nuevo
 */
export function getMissingFieldsForNewVehicle(
	vehicle: VehicleForValidation,
): string[] {
	if (!vehicle.isNew) return [];

	const fieldLabels: Record<string, string> = {
		vinNumber: "VIN",
		licensePlate: "Placa",
		origin: "Origen",
		fuelType: "Tipo de combustible",
		transmission: "Transmisión",
	};

	const missing: string[] = [];

	if (!vehicle.vinNumber) missing.push(fieldLabels.vinNumber);
	if (!vehicle.licensePlate) missing.push(fieldLabels.licensePlate);
	if (!vehicle.origin) missing.push(fieldLabels.origin);
	if (!vehicle.fuelType) missing.push(fieldLabels.fuelType);
	if (!vehicle.transmission) missing.push(fieldLabels.transmission);

	return missing;
}

/**
 * Renderiza un badge indicando si es vehículo nuevo
 */
function renderNewVehicleBadge(isNew: boolean | null | undefined) {
	if (!isNew) return null;

	return (
		<Badge
			variant="outline"
			className="border-blue-300 bg-blue-100 text-blue-800"
		>
			<Sparkles className="mr-1 h-3 w-3" />
			Nuevo
		</Badge>
	);
}

/**
 * Renderiza un badge indicando el estado de datos del vehículo nuevo
 */
function renderVehicleDataStatusBadge(vehicle: VehicleForValidation) {
	if (!vehicle.isNew) return null;

	const missingFields = getMissingFieldsForNewVehicle(vehicle);
	const isComplete = missingFields.length === 0;

	if (isComplete) {
		return (
			<Badge
				variant="outline"
				className="border-green-300 bg-green-100 text-green-800"
			>
				<CheckCircle className="mr-1 h-3 w-3" />
				Datos completos
			</Badge>
		);
	}

	return (
		<Badge
			variant="outline"
			className="border-amber-300 bg-amber-100 text-amber-800"
		>
			<Clock className="mr-1 h-3 w-3" />
			Pendiente de datos
		</Badge>
	);
}

/**
 * Renderiza badges combinados para vehículos nuevos
 */
export function renderNewVehicleBadges(vehicle: VehicleForValidation) {
	if (!vehicle.isNew) return null;

	return (
		<div className="flex flex-wrap gap-1">
			{renderNewVehicleBadge(vehicle.isNew)}
			{renderVehicleDataStatusBadge(vehicle)}
		</div>
	);
}

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
