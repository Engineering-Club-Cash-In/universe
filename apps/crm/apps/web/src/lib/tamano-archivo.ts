/** Tamaño legible: "850 B", "12 KB", "3.4 MB" (sin "0.00 MB" para archivos chicos). */
export function formatearTamanoArchivo(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
