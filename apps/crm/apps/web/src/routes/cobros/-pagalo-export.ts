/**
 * CB-127 · Export XLSX/PDF de la bandeja de supervisión Págalo
 * (/cobros/pagalo). El archivo lo genera cartera-back (mismo diseño —logo,
 * KPIs, colores— que usa carteraFront), no este front: acá solo se pide vía
 * el server del CRM (que resuelve el scope de SIFCOs del usuario y reenvía el
 * binario) y se dispara la descarga. Prefijo `-`: archivo no-ruta, mismo
 * patrón que -pagalo-columnas.ts.
 */

/** Mismo tope que LIMITE_EXPORT_PAGALO en cartera-back/pagaloSupervisionReporte.ts —
 * el aviso previo a exportar necesita saberlo aunque el archivo lo arme cartera-back. */
export const LIMITE_EXPORT_PAGALO = 5_000;

export type FiltrosExportPagalo = {
	estados?: string[];
	soloProblematicos: boolean;
	numeroSifco?: string;
	asesorId?: number;
	fechaDesde?: string;
	fechaHasta?: string;
	sortBy: "totalAmount" | "createdAt" | "linksAmountCapital" | "linksAmountMora";
	sortDir: "asc" | "desc";
};

export type ResultadoExportPagalo = {
	cantidad: number;
	total: number;
	truncado: boolean;
};

function armarQuery(filtros: FiltrosExportPagalo): string {
	const params = new URLSearchParams();
	if (filtros.estados?.length) params.set("estados", filtros.estados.join(","));
	params.set("soloProblematicos", String(filtros.soloProblematicos));
	if (filtros.numeroSifco) params.set("numeroSifco", filtros.numeroSifco);
	if (filtros.asesorId !== undefined) params.set("asesorId", String(filtros.asesorId));
	if (filtros.fechaDesde) params.set("fechaDesde", filtros.fechaDesde);
	if (filtros.fechaHasta) params.set("fechaHasta", filtros.fechaHasta);
	params.set("sortBy", filtros.sortBy);
	params.set("sortDir", filtros.sortDir);
	return params.toString();
}

/**
 * Extrae el filename enviado por el backend en Content-Disposition, o genera el
 * fallback con la fecha y el sufijo "-parcial" si el dataset vino truncado.
 */
export function resolverNombreArchivoPagalo(
	disposition: string | null | undefined,
	formato: "excel" | "pdf",
	truncado: boolean,
): string {
	const filenameMatch =
		disposition?.match(/filename\*=UTF-8''([^;\s]+)/i) ||
		disposition?.match(/filename="([^"]+)"/i) ||
		disposition?.match(/filename=([^;\s]+)/i);
	if (filenameMatch?.[1]) {
		return decodeURIComponent(filenameMatch[1].trim());
	}
	const sufijo = truncado ? "-parcial" : "";
	const extension = formato === "excel" ? "xlsx" : "pdf";
	return `supervision-pagalo${sufijo}-${new Date().toISOString().slice(0, 10)}.${extension}`;
}

async function descargarPagaloArchivo(
	formato: "excel" | "pdf",
	filtros: FiltrosExportPagalo,
): Promise<ResultadoExportPagalo> {
	const url = `${import.meta.env.VITE_SERVER_URL}/api/pagalo/supervision/${formato}?${armarQuery(filtros)}`;
	const res = await fetch(url, { credentials: "include" });
	if (!res.ok) {
		const cuerpo = await res.json().catch(() => ({}));
		throw new Error(cuerpo.error || `No se pudo generar el reporte (HTTP ${res.status})`);
	}

	const truncado = res.headers.get("x-export-truncado") === "true";
	const total = Number(res.headers.get("x-export-total") ?? 0);
	const cantidad = Number(res.headers.get("x-export-cantidad") ?? 0);

	const filename = resolverNombreArchivoPagalo(
		res.headers.get("content-disposition"),
		formato,
		truncado,
	);

	const blob = await res.blob();
	const objectUrl = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = objectUrl;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(objectUrl);

	return {
		truncado,
		total,
		cantidad,
	};
}

export const exportarPagaloXLSX = (filtros: FiltrosExportPagalo) =>
	descargarPagaloArchivo("excel", filtros);

export const exportarPagaloPDF = (filtros: FiltrosExportPagalo) =>
	descargarPagaloArchivo("pdf", filtros);
