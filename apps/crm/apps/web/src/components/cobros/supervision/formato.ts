/**
 * Formatos y rangos de fecha del Dashboard del supervisor. Funciones puras: las
 * usan el contenedor, las piezas de presentación y el showcase.
 */

export type Periodo = "dia" | "semana" | "mes";

/** "Ana Lucía Díaz" → "A. Díaz" (columna Asesor del Figma: «L. Morales»). */
export function nombreCorto(nombre: string | null | undefined) {
	const partes = (nombre ?? "").trim().split(/\s+/).filter(Boolean);
	if (partes.length === 0) return "";
	if (partes.length === 1) return partes[0];
	// Con 4 palabras (dos nombres + dos apellidos) el apellido es la tercera.
	const apellido = partes.length >= 4 ? partes[2] : partes[1];
	return `${partes[0][0]}. ${apellido}`;
}

/** "hace 40 min" · "hace 5 h" · "ayer" · "hace 3 días" (antigüedad de una solicitud). */
export function haceCuanto(fecha: string | Date, ahora: Date = new Date()) {
	const d = typeof fecha === "string" ? new Date(fecha) : fecha;
	const ms = ahora.getTime() - d.getTime();
	if (Number.isNaN(ms)) return "—";
	const min = Math.max(0, Math.floor(ms / 60_000));
	if (min < 1) return "ahora";
	if (min < 60) return `hace ${min} min`;
	const horas = Math.floor(min / 60);
	const inicioHoy = new Date(ahora);
	inicioHoy.setHours(0, 0, 0, 0);
	if (horas < 24 && d >= inicioHoy) return `hace ${horas} h`;
	const inicioDia = new Date(d);
	inicioDia.setHours(0, 0, 0, 0);
	const dias = Math.round(
		(inicioHoy.getTime() - inicioDia.getTime()) / 86_400_000,
	);
	if (dias <= 1) return "ayer";
	return `hace ${dias} días`;
}

/** Hoy en Guatemala (YYYY-MM-DD): el backend calcula todo en hora GT. */
export function hoyGT(ahora: Date = new Date()) {
	return ahora.toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });
}

function sumarDias(fecha: string, dias: number) {
	const [y, m, d] = fecha.split("-").map(Number);
	const r = new Date(Date.UTC(y, m - 1, d + dias));
	return r.toISOString().slice(0, 10);
}

export type Rango = { desde: string; hasta: string };

/**
 * Rango del período y el anterior equivalente, con el mismo criterio que
 * `rangosDesempeno` del server (lib/desempeno-asesor.ts): Día = hoy vs ayer;
 * Semana = lunes a hoy vs los mismos días de la semana previa; Mes = del 1 a
 * hoy vs el mismo tramo del mes previo.
 */
export function rangosPeriodo(
	periodo: Periodo,
	ahora: Date = new Date(),
): { actual: Rango; anterior: Rango } {
	const hoy = hoyGT(ahora);
	if (periodo === "dia") {
		const ayer = sumarDias(hoy, -1);
		return {
			actual: { desde: hoy, hasta: hoy },
			anterior: { desde: ayer, hasta: ayer },
		};
	}
	const [y, m, d] = hoy.split("-").map(Number);
	if (periodo === "semana") {
		const diaSemana = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
		const lunes = sumarDias(hoy, -((diaSemana + 6) % 7));
		return {
			actual: { desde: lunes, hasta: hoy },
			anterior: { desde: sumarDias(lunes, -7), hasta: sumarDias(hoy, -7) },
		};
	}
	const mesAnt = m === 1 ? 12 : m - 1;
	const anioAnt = m === 1 ? y - 1 : y;
	const diasMesAnt = new Date(Date.UTC(anioAnt, mesAnt, 0)).getUTCDate();
	const mm = String(mesAnt).padStart(2, "0");
	const dd = String(Math.min(d, diasMesAnt)).padStart(2, "0");
	return {
		actual: { desde: `${hoy.slice(0, 8)}01`, hasta: hoy },
		anterior: { desde: `${anioAnt}-${mm}-01`, hasta: `${anioAnt}-${mm}-${dd}` },
	};
}

/** Texto de comparación de cada período («vs ayer»). */
export const COMPARACION: Record<Periodo, string> = {
	dia: "vs ayer",
	semana: "vs semana previa",
	mes: "vs mes previo",
};
