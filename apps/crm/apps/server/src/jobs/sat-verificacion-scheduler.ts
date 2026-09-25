import { and, desc, gte, isNull } from "drizzle-orm";
import { db } from "../db";
import { satVerificacionLotes } from "../db/schema";
import { verificarVehiculosEnSat } from "./sat-verificacion-vehiculos";

const ZONA_HORARIA_SAT = "America/Guatemala";
const HORA_EJECUCION_GT = 22;
const MAX_INTENTOS_AUTOMATICOS = 3;
const ESPERA_REINTENTO_MS = 30 * 60 * 1000;

let schedulerIniciado = false;
let proximoTimer: ReturnType<typeof setTimeout> | null = null;
let reintentoTimer: ReturnType<typeof setTimeout> | null = null;
let resolverReintento: ((activo: boolean) => void) | null = null;
let versionScheduler = 0;

type PartesFechaGuatemala = {
	year: number;
	month: number;
	day: number;
	hour: number;
};

function partesFechaGuatemala(fecha: Date): PartesFechaGuatemala {
	const partes = new Intl.DateTimeFormat("en-US", {
		timeZone: ZONA_HORARIA_SAT,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		hourCycle: "h23",
	}).formatToParts(fecha);

	const valor = (tipo: string) =>
		Number(partes.find((parte) => parte.type === tipo)?.value ?? 0);

	return {
		year: valor("year"),
		month: valor("month"),
		day: valor("day"),
		hour: valor("hour"),
	};
}

/** Guatemala permanece en UTC-6; la fecha se guarda como instante UTC. */
function objetivoDeHoyEnGuatemala(ahora: Date): Date {
	const partes = partesFechaGuatemala(ahora);
	return new Date(
		Date.UTC(
			partes.year,
			partes.month - 1,
			partes.day,
			HORA_EJECUCION_GT + 6,
			0,
			0,
		),
	);
}

function siguienteObjetivoEnGuatemala(ahora: Date): Date {
	const objetivo = objetivoDeHoyEnGuatemala(ahora);
	if (objetivo > ahora) return objetivo;

	const siguiente = new Date(objetivo);
	siguiente.setUTCDate(siguiente.getUTCDate() + 1);
	return siguiente;
}

async function ultimoLoteAutomaticoDesde(desde: Date) {
	const [lote] = await db
		.select({
			id: satVerificacionLotes.id,
			estado: satVerificacionLotes.estado,
			intento: satVerificacionLotes.intento,
		})
		.from(satVerificacionLotes)
		.where(
			and(
				isNull(satVerificacionLotes.usuarioId),
				gte(satVerificacionLotes.iniciadaAt, desde),
			),
		)
		.orderBy(desc(satVerificacionLotes.iniciadaAt))
		.limit(1);

	return lote ?? null;
}

function schedulerEstaActivo(version: number): boolean {
	return schedulerIniciado && version === versionScheduler;
}

function esperarReintento(version: number): Promise<boolean> {
	if (!schedulerEstaActivo(version)) return Promise.resolve(false);

	return new Promise((resolve) => {
		resolverReintento = resolve;
		reintentoTimer = setTimeout(() => {
			reintentoTimer = null;
			resolverReintento = null;
			resolve(schedulerEstaActivo(version));
		}, ESPERA_REINTENTO_MS);
	});
}

async function ejecutarConReintentos(
	intentoInicial: number,
	version: number,
): Promise<void> {
	let intento = intentoInicial;
	while (intento <= MAX_INTENTOS_AUTOMATICOS && schedulerEstaActivo(version)) {
		// Si otra instancia ya termino la corrida del dia mientras esperabamos
		// el candado, no iniciamos una segunda corrida automatica.
		const loteActual = await ultimoLoteAutomaticoDesde(
			objetivoDeHoyEnGuatemala(new Date()),
		);
		if (!schedulerEstaActivo(version) || loteActual?.estado === "ok") return;

		let estadoResultado: "ok" | "omitida" | "otro" = "otro";
		try {
			const resultado = await verificarVehiculosEnSat({
				// NULL indica que la corrida fue iniciada por el sistema.
				usuarioId: null,
				// El job debe correr diariamente aunque exista una corrida manual reciente.
				forzar: true,
				intento,
			});

			if (resultado.estado === "ok") {
				console.info(
					`[SAT] Verificacion automatica completada en el intento ${intento}.`,
				);
				return;
			}
			estadoResultado = resultado.estado === "omitida" ? "omitida" : "otro";

			console.warn(
				`[SAT] La verificacion automatica termino como ${resultado.estado} en el intento ${intento}.`,
			);
		} catch (error) {
			console.error(
				`[SAT] Fallo la verificacion automatica en el intento ${intento}:`,
				error,
			);
		}

		if (!schedulerEstaActivo(version)) return;

		// Una omision significa que otra instancia conserva el candado; no
		// consume uno de los intentos reales. Reintentamos el mismo intento.
		if (estadoResultado === "omitida") {
			console.info(
				`[SAT] Otra instancia mantiene el candado; se reintentara en ${ESPERA_REINTENTO_MS / 60000} minutos.`,
			);
			if (!(await esperarReintento(version))) return;
			continue;
		}

		intento += 1;
		if (intento <= MAX_INTENTOS_AUTOMATICOS) {
			console.info(
				`[SAT] Reintentando la verificacion automatica en ${ESPERA_REINTENTO_MS / 60000} minutos.`,
			);
			if (!(await esperarReintento(version))) return;
		}
	}

	if (schedulerEstaActivo(version)) {
		console.error(
			`[SAT] La verificacion automatica fallo despues de ${MAX_INTENTOS_AUTOMATICOS} intentos.`,
		);
	}
}


async function ejecutarVerificacionProgramada(version: number): Promise<void> {
	if (!schedulerEstaActivo(version)) return;
	const objetivo = objetivoDeHoyEnGuatemala(new Date());
	const ultimo = await ultimoLoteAutomaticoDesde(objetivo);

	if (ultimo?.estado === "ok") {
		console.info("[SAT] La verificacion automatica de hoy ya fue completada.");
		return;
	}

	const intentoInicial = ultimo ? ultimo.intento + 1 : 1;
	if (intentoInicial > MAX_INTENTOS_AUTOMATICOS) {
		console.error(
			"[SAT] La verificacion automatica de hoy ya agoto sus reintentos.",
		);
		return;
	}

	await ejecutarConReintentos(intentoInicial, version);
}

function programarSiguienteEjecucion(version: number): void {
	if (!schedulerEstaActivo(version)) return;
	const ahora = new Date();
	const objetivo = siguienteObjetivoEnGuatemala(ahora);
	const espera = Math.max(1000, objetivo.getTime() - ahora.getTime());

	proximoTimer = setTimeout(async () => {
		if (!schedulerEstaActivo(version)) return;
		try {
			await ejecutarVerificacionProgramada(version);
		} catch (error) {
			console.error("[SAT] Error inesperado del scheduler:", error);
		} finally {
			if (schedulerEstaActivo(version)) programarSiguienteEjecucion(version);
		}
	}, espera);

	console.info(
		`[SAT] Proxima verificacion automatica programada para ${objetivo.toISOString()}.`,
	);
}

/** Inicia el scheduler solo cuando el entorno lo habilita explicitamente. */
export function iniciarSchedulerVerificacionSat(): void {
	if (process.env.SAT_JOB_ENABLED !== "true") {
		console.info("[SAT] Scheduler automatico deshabilitado en este entorno.");
		return;
	}
	if (schedulerIniciado) return;

	schedulerIniciado = true;
	versionScheduler += 1;
	const version = versionScheduler;
	// Si el servidor reinicia despues de las 22:00, recupera la corrida del dia.
	void (async () => {
		try {
			const ahora = new Date();
			const objetivo = objetivoDeHoyEnGuatemala(ahora);
			if (ahora >= objetivo) {
				await ejecutarVerificacionProgramada(version);
			}
		} catch (error) {
			console.error("[SAT] Error al recuperar la corrida automatica:", error);
		} finally {
			if (schedulerEstaActivo(version)) programarSiguienteEjecucion(version);
		}
	})();
}

export function detenerSchedulerVerificacionSat(): void {
	if (proximoTimer) clearTimeout(proximoTimer);
	proximoTimer = null;
	schedulerIniciado = false;
	versionScheduler += 1;
	if (reintentoTimer) clearTimeout(reintentoTimer);
	reintentoTimer = null;
	const resolver = resolverReintento;
	resolverReintento = null;
	resolver?.(false);
}
