export const VEHICLE_BODY_TYPE_OPTIONS = [
	{ value: "Sedan", label: "Sedan" },
	{ value: "Hatchback", label: "Hatchback" },
	{ value: "SUV", label: "SUV" },
	{ value: "Pickup", label: "Pickup" },
	{ value: "Minivan", label: "Minivan" },
	{ value: "Deportivo", label: "Deportivo" },
	{ value: "Microbus", label: "Microbus" },
	{ value: "Bus hasta 20 pasajeros", label: "Bus hasta 20 pasajeros" },
	{ value: "Bus 21-35 pasajeros", label: "Bus 21-35 pasajeros" },
	{ value: "Bus más de 35 pasajeros", label: "Bus más de 35 pasajeros" },
	{ value: "Otro", label: "Otro" },
] as const;

export const QUOTER_VEHICLE_TYPE_OPTIONS = [
	{ value: "particular", label: "Particular" },
	{ value: "uber", label: "UBER" },
	{ value: "pickup", label: "Pick Up" },
	{ value: "nuevo", label: "Nuevo" },
	{ value: "panel", label: "Panel" },
	{ value: "camion", label: "Camión" },
	{ value: "microbus", label: "Microbus" },
	{ value: "microbus_20", label: "Bus hasta 20 pasajeros (RCDP)" },
	{ value: "microbus_35", label: "Bus 21-35 pasajeros (RCDP)" },
	{ value: "microbus_36plus", label: "Bus más de 35 pasajeros (RCDP)" },
] as const;

export const VEHICLE_PROVENANCE_OPTIONS = [
	{ value: "Nacional", label: "Nacional" },
	{ value: "Importado", label: "Importado" },
] as const;

export const VEHICLE_CONDITION_OPTIONS = [
	{ value: false, label: "Usado" },
	{ value: true, label: "Nuevo de agencia" },
] as const;

const NEW_AGENCY_BLOCKED_ORIGINS = new Set(["importado", "rodado"]);

export function isValidVehicleConditionOrigin(isNew: boolean, origin: string) {
	return !(isNew && NEW_AGENCY_BLOCKED_ORIGINS.has(origin.trim().toLowerCase()));
}

export const QUOTER_VEHICLE_ORIGIN_OPTIONS = [
	{ value: "agencia", label: "Agencia" },
	{ value: "rodado", label: "Rodado" },
	{ value: "importado", label: "Importado" },
	{ value: "subasta", label: "Subasta" },
	{ value: "otro", label: "Otro" },
] as const;

export const VEHICLE_USE_OPTIONS = [
	{ value: "Particular", label: "Particular" },
	{ value: "Comercial", label: "Comercial" },
] as const;
