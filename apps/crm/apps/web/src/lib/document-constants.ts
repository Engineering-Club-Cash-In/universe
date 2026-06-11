export const VEHICLE_DOCUMENT_TYPES = [
	"tarjeta_circulacion",
	"titulo_propiedad",
	"dpi_dueno",
	"patente_comercio_vehiculo",
	"representacion_legal_vehiculo",
	"dpi_representante_legal_vehiculo",
	"pago_impuesto_circulacion",
	"consulta_sat",
	"consulta_garantias_mobiliarias",
	"datos_vehiculo_nuevo",
	"cotizacion_vehiculo_nuevo",
] as const;

export type VehicleDocumentType = (typeof VEHICLE_DOCUMENT_TYPES)[number];
