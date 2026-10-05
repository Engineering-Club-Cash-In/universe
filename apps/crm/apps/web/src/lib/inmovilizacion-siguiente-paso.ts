/**
 * Guía "qué sigue" del apagado/reactivación de la unidad: a partir del estado
 * de la solicitud, dice en qué paso del ciclo va el asesor y qué debe hacer.
 * Lógica pura (sin React) para que la tarjeta, la Ficha 360 y Mi día digan lo
 * mismo. Los textos siguen la guía de redacción de cobros (trato de usted).
 */

export type AccionInmovilizacion = "apagado" | "reactivacion";

export type PasoCiclo = "solicitud" | "aprobacion" | "legion" | "llamada";

export const PASOS_CICLO: { id: PasoCiclo; etiqueta: string }[] = [
	{ id: "solicitud", etiqueta: "Solicitud" },
	{ id: "aprobacion", etiqueta: "Aprobación" },
	// LEGION actúa fuera del CRM y el asesor registra su confirmación: en el
	// sistema es un solo estado (`aprobada`), por eso es un solo paso.
	{ id: "legion", etiqueta: "LEGION y confirmación" },
	{ id: "llamada", etiqueta: "Llamada" },
];

export type AccionSiguiente =
	| "registrar_ejecucion"
	| "registrar_llamada"
	| "decidir"
	| "volver_a_solicitar";

export interface SiguientePaso {
	accion: AccionInmovilizacion;
	/** Paso en el que va; los anteriores están hechos. */
	pasoActual: PasoCiclo;
	titulo: string;
	instruccion: string;
	/** Qué botón debe destacarse; null si solo toca esperar. */
	accionSugerida: AccionSiguiente | null;
	/** Quién debe actuar: sirve para el texto por rol y para los avisos. */
	actua: "asesor" | "supervisor" | "nadie";
}

export interface EntradaSiguientePaso {
	solicitudAbierta: {
		accion: AccionInmovilizacion;
		estado: string;
	} | null;
	pendienteLlamar: boolean;
	pendienteLlamarReactivacion: boolean;
	/** Última solicitud del caso si fue rechazada y no hay otra abierta. */
	rechazadaReciente: { accion: AccionInmovilizacion } | null;
	esSupervisor: boolean;
}

const VERBO: Record<AccionInmovilizacion, string> = {
	apagado: "el apagado",
	reactivacion: "la reactivación",
};

/** El trámite en curso (decidir, ejecutar o llamar), o null si no hay. */
function pasoPrincipal(e: EntradaSiguientePaso): SiguientePaso | null {
	const s = e.solicitudAbierta;

	if (s?.estado === "pendiente_aprobacion") {
		return e.esSupervisor
			? {
					accion: s.accion,
					pasoActual: "aprobacion",
					titulo: "Falta su decisión",
					instruccion: `Revise la solicitud de ${s.accion === "apagado" ? "apagado" : "reactivación"} y apruébela o recházela.`,
					accionSugerida: "decidir",
					actua: "supervisor",
				}
			: {
					accion: s.accion,
					pasoActual: "aprobacion",
					titulo: "Esperando la aprobación del supervisor",
					instruccion: `Su solicitud ya se envió. Cuando el supervisor la apruebe, recibirá un aviso para pedir a LEGION ${VERBO[s.accion]}.`,
					accionSugerida: null,
					actua: "supervisor",
				};
	}

	if (s?.estado === "aprobada") {
		return {
			accion: s.accion,
			pasoActual: "legion",
			titulo: "Solicitud aprobada: pida a LEGION que la aplique",
			instruccion: `Solicite a LEGION ${VERBO[s.accion]} de la unidad. Cuando lo confirme, registre aquí su confirmación (archivo o nota). Si ya no corresponde, cancele la solicitud.`,
			accionSugerida: "registrar_ejecucion",
			actua: "asesor",
		};
	}

	if (e.pendienteLlamar || e.pendienteLlamarReactivacion) {
		const accion: AccionInmovilizacion = e.pendienteLlamar
			? "apagado"
			: "reactivacion";
		return {
			accion,
			pasoActual: "llamada",
			titulo: "Falta llamar al cliente",
			instruccion:
				accion === "apagado"
					? "Se ejecutó el apagado. Llame al cliente para informarle y registre la llamada."
					: "Se ejecutó la reactivación. Llame al cliente para informarle que ya puede usar el vehículo y registre la llamada.",
			accionSugerida: "registrar_llamada",
			actua: "asesor",
		};
	}

	return null;
}

/**
 * El rechazo reciente es un trámite aparte, no un paso más del ciclo: puede
 * convivir con otro pendiente (p. ej. se pidió y se rechazó una reactivación
 * mientras falta llamar por el apagado), así que se calcula por separado.
 */
function pasoDeRechazo(e: EntradaSiguientePaso): SiguientePaso | null {
	if (!e.rechazadaReciente) return null;
	return {
		accion: e.rechazadaReciente.accion,
		pasoActual: "solicitud",
		titulo: "Solicitud rechazada",
		instruccion:
			"Revise el motivo del rechazo, corrija lo que haga falta y vuelva a solicitar.",
		accionSugerida: "volver_a_solicitar",
		actua: "asesor",
	};
}

/**
 * Todo lo que está pendiente, en orden de importancia: primero el trámite en
 * curso (decidir, ejecutar, llamar) y después el rechazo reciente, si lo hay.
 */
export function pasosPendientes(e: EntradaSiguientePaso): SiguientePaso[] {
	return [pasoPrincipal(e), pasoDeRechazo(e)].filter(
		(p): p is SiguientePaso => p !== null,
	);
}

/** El pendiente más importante, o null si no hay nada en curso. */
export function siguientePaso(e: EntradaSiguientePaso): SiguientePaso | null {
	return pasosPendientes(e)[0] ?? null;
}

/** Estado de cada paso para pintar el stepper: hecho, actual o pendiente. */
export function estadoPasos(pasoActual: PasoCiclo): {
	id: PasoCiclo;
	etiqueta: string;
	estado: "hecho" | "actual" | "pendiente";
}[] {
	const idx = PASOS_CICLO.findIndex((p) => p.id === pasoActual);
	return PASOS_CICLO.map((p, i) => ({
		...p,
		estado: i < idx ? "hecho" : i === idx ? "actual" : "pendiente",
	}));
}

/** Cuánto tiempo se sigue mostrando un rechazo: igual que "Mi día" en el servidor. */
export const DIAS_RECHAZADA_VISIBLE = 7;

const MS_DIA = 24 * 60 * 60 * 1000;

/**
 * La última solicitud del historial (más reciente primero) si fue rechazada
 * hace poco y nada la reemplazó: ni una solicitud abierta ni otra posterior de
 * cualquier estado, de modo que el banner se va solo al volver a solicitar, y
 * también a los `DIAS_RECHAZADA_VISIBLE` días (un rechazo viejo ya no es una
 * tarea).
 */
export function rechazadaReciente<
	T extends {
		accion: AccionInmovilizacion;
		estado: string;
		decididoAt?: Date | string | null;
	},
>(historial: T[], hayAbierta: boolean, ahora: Date = new Date()): T | null {
	if (hayAbierta) return null;
	const ultima = historial[0];
	if (ultima?.estado !== "rechazada") return null;
	if (ultima.decididoAt) {
		const antiguedad = ahora.getTime() - new Date(ultima.decididoAt).getTime();
		if (antiguedad > DIAS_RECHAZADA_VISIBLE * MS_DIA) return null;
	}
	return ultima;
}

/**
 * ¿Le toca actuar a este usuario? El aviso de la Ficha 360 solo debe pedirle lo
 * suyo: al asesor lo del asesor y al supervisor lo del supervisor.
 */
export function leTocaAlUsuario(
	paso: SiguientePaso | null,
	esSupervisor: boolean,
): paso is SiguientePaso {
	if (!paso?.accionSugerida) return false;
	return paso.actua === (esSupervisor ? "supervisor" : "asesor");
}

/**
 * Por qué hoy no hay botón de solicitar, para decírselo al asesor en vez de
 * esconderlo. Null si sí puede solicitar o si no hay nada que explicar.
 */
export function motivoSinSolicitud(p: {
	tieneGps: boolean;
	estadoUnidad: "activa" | "inmovilizada";
	hayAbierta: boolean;
	bucketNumero: number | null;
	bucketsApagado: readonly number[];
}): string | null {
	if (p.hayAbierta) return null;
	if (!p.tieneGps) {
		return "El vehículo no tiene una unidad GPS vinculada, por eso no se puede solicitar el apagado ni la reactivación.";
	}
	if (
		p.estadoUnidad === "activa" &&
		(p.bucketNumero === null || !p.bucketsApagado.includes(p.bucketNumero))
	) {
		return `Solo se puede solicitar el apagado cuando el crédito está en ${p.bucketsApagado.map((b) => `B${b}`).join(", ")}${p.bucketNumero !== null ? ` (hoy está en B${p.bucketNumero})` : ""}.`;
	}
	return null;
}
