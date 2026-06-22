export const VEHICLE_TYPE_OPTIONS = [
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

export const VEHICLE_ORIGIN_OPTIONS = [
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
