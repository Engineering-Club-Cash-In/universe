/**
 * CB-127 · Export XLSX/PDF de la bandeja de supervisión Págalo
 * (/cobros/pagalo). Pagina contra el server con los mismos filtros y orden
 * que la pantalla, trayendo el dataset COMPLETO filtrado (no solo la página
 * visible). Prefijo `-`: archivo no-ruta, mismo patrón que -pagalo-columnas.ts.
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { client } from "@/utils/orpc";

/**
 * Bandeja de supervisión operativa, no un histórico de años: el volumen
 * esperado es muchísimo menor que el de historial-agendas.tsx (que usa
 * 20,000). 5,000 es margen amplio de sobra para el uso real.
 */
const LIMITE_EXPORT_PAGALO = 5_000;
const PAGE_SIZE_EXPORT_PAGALO = 100;

export type FiltrosExportPagalo = {
	estados?: string[];
	soloProblematicos: boolean;
	numeroSifco?: string;
	asesorId?: number;
	fechaDesde?: string;
	fechaHasta?: string;
	sortBy: "totalAmount" | "createdAt";
	sortDir: "asc" | "desc";
};

type GrupoSupervisionExport = {
	id: string;
	status: string;
	origen: string;
	numeroCreditoSifco: string;
	totalAmount: string;
	createdAt: string | Date;
	clienteNombre: string | null;
	asesoresNombres: string[];
};

async function traerDatasetCompletoPagalo(
	filtros: FiltrosExportPagalo,
): Promise<GrupoSupervisionExport[]> {
	const filas: GrupoSupervisionExport[] = [];
	const idsVistos = new Set<string>();
	let offset = 0;
	let hayMas = true;

	while (hayMas && filas.length < LIMITE_EXPORT_PAGALO) {
		const respuesta = await client.getPagaloSupervision({
			...filtros,
			limit: PAGE_SIZE_EXPORT_PAGALO,
			offset,
		});
		for (const grupo of respuesta.grupos as GrupoSupervisionExport[]) {
			if (idsVistos.has(grupo.id)) continue;
			idsVistos.add(grupo.id);
			filas.push(grupo);
		}
		hayMas = respuesta.grupos.length === PAGE_SIZE_EXPORT_PAGALO;
		offset += PAGE_SIZE_EXPORT_PAGALO;
	}
	return filas.slice(0, LIMITE_EXPORT_PAGALO);
}

const ENCABEZADOS_EXPORT_PAGALO = [
	"SIFCO",
	"Cliente",
	"Asesor",
	"Estado",
	"Total",
	"Origen",
	"Fecha de creación",
];

function filaExportComoTexto(grupo: GrupoSupervisionExport) {
	return [
		grupo.numeroCreditoSifco,
		grupo.clienteNombre ?? "—",
		grupo.asesoresNombres.join(", ") || "—",
		grupo.status,
		`Q${Number(grupo.totalAmount).toLocaleString("es-GT", { minimumFractionDigits: 2 })}`,
		grupo.origen,
		new Date(grupo.createdAt).toLocaleDateString("es-GT", {
			timeZone: "America/Guatemala",
		}),
	];
}

/** Devuelve la cantidad de filas exportadas. */
export async function exportarPagaloXLSX(
	filtros: FiltrosExportPagalo,
): Promise<number> {
	const filas = await traerDatasetCompletoPagalo(filtros);
	const cuerpo = filas.map((g) => [
		g.numeroCreditoSifco,
		g.clienteNombre ?? "—",
		g.asesoresNombres.join(", ") || "—",
		g.status,
		Number(g.totalAmount),
		g.origen,
		new Date(g.createdAt).toLocaleString("es-GT", {
			timeZone: "America/Guatemala",
		}),
	]);
	const hoja = XLSX.utils.aoa_to_sheet([ENCABEZADOS_EXPORT_PAGALO, ...cuerpo]);
	const libro = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(libro, hoja, "Supervisión Págalo");
	XLSX.writeFile(
		libro,
		`supervision-pagalo-${new Date().toISOString().slice(0, 10)}.xlsx`,
	);
	return filas.length;
}

/** Devuelve la cantidad de filas exportadas. */
export async function exportarPagaloPDF(
	filtros: FiltrosExportPagalo,
): Promise<number> {
	const filas = await traerDatasetCompletoPagalo(filtros);
	const doc = new jsPDF({ orientation: "landscape" });
	doc.setFontSize(14);
	doc.text("Supervisión Págalo", 14, 15);
	autoTable(doc, {
		startY: 20,
		head: [ENCABEZADOS_EXPORT_PAGALO],
		body: filas.map(filaExportComoTexto),
		styles: { fontSize: 8 },
		headStyles: { fillColor: [124, 58, 237] },
	});
	doc.save(`supervision-pagalo-${new Date().toISOString().slice(0, 10)}.pdf`);
	return filas.length;
}
