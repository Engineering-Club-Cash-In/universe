export const PASOS_TRACKER = [
	{ paso: 1, etiqueta: "Solicitud recibida", desde: 0, hasta: 20 },
	{ paso: 2, etiqueta: "Documentos y análisis", desde: 30, hasta: 40 },
	{ paso: 3, etiqueta: "Aprobado", desde: 50, hasta: 80 },
	{ paso: 4, etiqueta: "Firma de contratos", desde: 85, hasta: 90 },
	{ paso: 5, etiqueta: "Desembolsado", desde: 100, hasta: 100 },
] as const;

export type PasoTracker = 1 | 2 | 3 | 4 | 5;

// Las 10 etapas de sales_stages colapsadas a los 5 pasos que ve el socio.
export function pasoDesdeCierre(closurePercentage: number): PasoTracker {
	if (closurePercentage >= 100) return 5;
	if (closurePercentage >= 85) return 4;
	if (closurePercentage >= 50) return 3;
	if (closurePercentage >= 30) return 2;
	return 1;
}

export function etiquetaDePaso(paso: PasoTracker): string {
	return PASOS_TRACKER[paso - 1].etiqueta;
}
