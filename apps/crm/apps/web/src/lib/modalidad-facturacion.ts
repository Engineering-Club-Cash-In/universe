// Tipos y etiquetas de Modalidad de Facturación para el front del CRM.
// La resolución de bracket (monto + modalidad -> spread/tasa) vive solo en el
// backend (orpc.resolverModalidadFacturacionSpread, SQL) — no se reimplementa
// aquí, para no tener dos fuentes de verdad de la misma regla de negocio.

export type ModalidadFacturacion =
	| "p2p_directa"
	| "factura_cube"
	| "factura_cube_pequeno";

export interface ModalidadFacturacionSpreadRow {
	id: number;
	monto_desde: string;
	monto_hasta: string | null; // null = sin límite superior
	modalidad: ModalidadFacturacion;
	spread: string; // % Inversionista de esa modalidad
	tasa: string; // tasa final que ve el cliente
}

// Etiquetas para el selector.
export const MODALIDAD_FACTURACION_LABELS: Record<ModalidadFacturacion, string> =
	{
		p2p_directa: "Facturación P2P Directa",
		factura_cube: "1 Factura a Cube",
		factura_cube_pequeno: "1 Factura a Cube · Pequeño Contribuyente",
	};
