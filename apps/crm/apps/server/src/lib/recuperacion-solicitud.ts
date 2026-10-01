/**
 * CB-043 · La recuperación forzosa pasa por el supervisor.
 *
 * Hasta CB-042 cualquier asesor dueño del caso mandaba el crédito a B4 con un
 * clic. CB-043 pedía un "B4 anticipado por gestión agotada, con checklist y
 * aprobación", y el PM lo unificó con la recuperación forzosa (2026-09-30): las
 * dos terminan igual (B4 + `EN_RECUPERACION`) y no tenía sentido que una fuera
 * directa y la otra no. Además: "¿qué pasa si un asesor dice 'no quiero este
 * caso, mandalo a B4'?". Así que:
 *
 *  · el asesor SOLICITA: motivos, justificación y el checklist de lo que ya se
 *    hizo, con la evidencia que el CRM tiene de cada paso;
 *  · el supervisor (o admin) APRUEBA —y ahí recién se traslada— o RECHAZA con
 *    motivo. Si el que pide es supervisor o admin, su solicitud ya va aprobada;
 *  · la entrega voluntaria sigue directa: es el cliente colaborando.
 *
 * El checklist es de EVIDENCIA, no de casillas: cada paso sale marcado con lo
 * que el CRM (o cartera) encontró —llamadas, visitas, referencias, convenio,
 * apagado…— y lo que no se hizo se justifica. No bloquea por pasos pendientes
 * —obligaría a inventar registros—, pero ninguno queda sin explicación. Solo
 * entran pasos que dependen de quien pide: la llamada del supervisor no está
 * porque el asesor no puede hacerla ni justificarla (decisión del 2026-09-30).
 *
 * Todo lo de acá es puro (sin DB ni red) para poder probarlo y usarlo en la web.
 */

import { z } from "zod";
import { operacionRecuperacion } from "./recuperacion-vehiculo";

// ── Estados de la solicitud ─────────────────────────────────────────────────

/**
 * `estado_solicitud` de `recuperaciones_vehiculo`. NULL = el registro no pasó
 * por aprobación (entrega voluntaria, o forzosa anterior a CB-043).
 */
export const ESTADOS_SOLICITUD_RECUPERACION = [
	"pendiente",
	"aprobada",
	"rechazada",
	"cancelada",
	"sin_efecto",
] as const;
export type EstadoSolicitudRecuperacion =
	(typeof ESTADOS_SOLICITUD_RECUPERACION)[number];

export const ESTADO_SOLICITUD_LABEL: Record<
	EstadoSolicitudRecuperacion,
	string
> = {
	pendiente: "Esperando aprobación",
	aprobada: "Aprobada",
	rechazada: "Rechazada",
	cancelada: "Cancelada",
	sin_efecto: "Sin efecto",
};

/**
 * ¿El registro describe una recuperación que de verdad ocurrió? Una solicitud
 * pendiente, rechazada, cancelada o sin efecto es un pedido, no un envío: no
 * cuenta en los reportes ni admite confirmar la recepción de la unidad.
 */
export function esRecuperacionEfectiva(
	estado: string | null | undefined,
): boolean {
	return estado == null || estado === "aprobada";
}

/**
 * Por qué una solicitud pendiente ya no se puede aprobar, según el bucket de
 * hoy (null = sigue vigente). Pasa cuando el cliente pagó y bajó, cuando llegó
 * solo a B4 por cuotas o cuando salió del funnel (convenio).
 */
export function motivoSolicitudSinEfecto(
	bucket: number | null,
	prefijo?: string | null,
): string | null {
	if (operacionRecuperacion("tomado", bucket) === "trasladar") return null;
	if (bucket === null) {
		return "El crédito ya no tiene bucket (salió del funnel): la solicitud quedó sin efecto.";
	}
	return `El crédito ya está en ${prefijo ?? `B${bucket}`}: la solicitud quedó sin efecto.`;
}

export const MIN_MOTIVO_RECHAZO = 10;

// ── Checklist ───────────────────────────────────────────────────────────────

type DefinicionPaso = {
	clave: string;
	titulo: string;
	/** Qué cuenta como hecho, para el que llena y para el que aprueba. */
	ayuda: string;
	/** Lo que se pregunta cuando el paso no se hizo. */
	pregunta: string;
};

/**
 * Los pasos de gestión que el supervisor quiere ver antes de aprobar. Salen de
 * la épica B3 · Rescate (CB-035 a CB-042) más lo básico de cualquier cobro, y
 * TODOS se detectan solos: no hay casillas que se marquen a mano.
 * Los pasos viven en TypeScript porque cada uno está atado al código que
 * detecta su evidencia; las razones para no haberlo hecho, en la base
 * (`cobros_checklist_justificaciones`, una lista por paso). El checklist se
 * guarda como jsonb con sus textos, así que recortar o agregar pasos o razones
 * no rompe los registros viejos.
 *
 * Recortado el 2026-09-30: sin "Llamada del supervisor" (no depende del
 * asesor, no la puede justificar) ni "Búsqueda en redes sociales" (CB-039 no
 * estaba hecho). Ya hay dónde registrarla (investigaciones_redes_cobros): falta
 * decidir si el paso vuelve al checklist.
 */
export const PASOS_CHECKLIST_RECUPERACION = [
	{
		clave: "llamadas_cliente",
		titulo: "Llamadas al cliente",
		ayuda: "Al menos una llamada registrada desde que entró en mora.",
		pregunta: "¿Por qué no hay llamadas al cliente?",
	},
	{
		clave: "mensajes",
		titulo: "WhatsApp, SMS o correo",
		ayuda: "Mensajes al cliente registrados desde que entró en mora.",
		pregunta: "¿Por qué no hay mensajes al cliente?",
	},
	{
		clave: "promesa_pago",
		titulo: "Promesa de pago",
		ayuda: "Se negoció al menos una promesa de pago.",
		pregunta: "¿Por qué no hay promesas de pago?",
	},
	{
		clave: "convenio_pago",
		titulo: "Convenio de pago",
		ayuda:
			"Se generó al menos un convenio, aunque después se haya rechazado o deshecho.",
		pregunta: "¿Por qué no hay convenios de pago?",
	},
	{
		clave: "referencias",
		titulo: "Referencias y contactos de emergencia",
		ayuda: "Se gestionaron todas las referencias del crédito.",
		pregunta: "¿Por qué no se gestionaron todas las referencias?",
	},
	{
		clave: "visita_residencia",
		titulo: "Visita a la residencia",
		ayuda: "Una visita realizada a la residencia (no solo programada).",
		pregunta: "¿Por qué no hay visita a la residencia?",
	},
	{
		clave: "visita_trabajo",
		titulo: "Visita al lugar de trabajo",
		ayuda: "Una visita realizada al lugar de trabajo.",
		pregunta: "¿Por qué no hay visita al lugar de trabajo?",
	},
	{
		clave: "ubicacion_gps",
		titulo: "Ubicación del vehículo por GPS",
		ayuda: "Se consultó dónde está la unidad.",
		pregunta: "¿Por qué no se consultó la ubicación por GPS?",
	},
	{
		clave: "apagado_unidad",
		titulo: "Apagado de la unidad",
		ayuda: "Se pidió y se ejecutó el apagado por falta de pago.",
		pregunta: "¿Por qué no se apagó la unidad?",
	},
] as const satisfies readonly DefinicionPaso[];

export type ClavePaso = (typeof PASOS_CHECKLIST_RECUPERACION)[number]["clave"];
const CLAVES_PASO = PASOS_CHECKLIST_RECUPERACION.map((p) => p.clave) as [
	ClavePaso,
	...ClavePaso[],
];

export function definicionPaso(clave: string): DefinicionPaso | undefined {
	return PASOS_CHECKLIST_RECUPERACION.find((p) => p.clave === clave);
}

/** Título de un paso guardado; si el catálogo ya no lo tiene, la clave cruda. */
export function tituloPaso(clave: string): string {
	return definicionPaso(clave)?.titulo ?? clave;
}

export type EstadoPaso = "hecho" | "parcial" | "pendiente";

/**
 * Por qué un paso no se hizo (o se hizo a medias): cada paso tiene su lista,
 * en la tabla `cobros_checklist_justificaciones` (migración 0074). Se agregan
 * o retiran razones sin deploy. Desde el 2026-10-01 no hay "No aplica" y la
 * nota es siempre opcional (pedido del PM).
 */
export type OpcionJustificacion = { clave: string; etiqueta: string };

/** Las razones ACTIVAS de cada paso, en orden. Lo arma el servicio desde la base. */
export type CatalogoJustificaciones = Partial<
	Record<string, readonly OpcionJustificacion[]>
>;

/**
 * El catálogo genérico de antes (uno solo para todos los pasos). Solo para
 * leer solicitudes guardadas antes de la 0074, que no traen la etiqueta.
 */
const ETIQUETAS_JUSTIFICACION_ANTERIORES: Record<string, string> = {
	no_aplica: "No aplica a este caso",
	sin_datos: "No hay datos para hacerlo (teléfono, dirección o referencias)",
	nadie_contesta: "Nadie contesta en ningún número",
	cliente_ilocalizable: "No se localiza al cliente en ninguna dirección",
	cliente_se_niega: "El cliente ya dijo que no va a pagar",
	riesgo_ocultamiento: "Alertaría al cliente y podría esconder el vehículo",
	urgencia: "No hay tiempo: riesgo de venta, traslado o salida del país",
	zona_riesgo: "Zona o situación de riesgo para el equipo",
	sin_gps: "La unidad no tiene GPS o no está reportando",
	hecho_fuera_del_crm: "Se hizo, pero no quedó registrado en el CRM",
	otro: "Otro",
};

// ── Evidencia → pasos evaluados ─────────────────────────────────────────────

type ConteoConFecha = { total: number; ultima: Date | null };

/** Lo que el CRM encontró desde que el crédito entró en mora. La arma el servicio. */
export type EvidenciaGestion = {
	desde: Date;
	llamadas: ConteoConFecha & { contestadas: number };
	mensajes: ConteoConFecha;
	promesas: ConteoConFecha & { incumplidas: number };
	/**
	 * Convenios generados en cartera (vigentes, completados, pendientes,
	 * deshechos o rechazados). `sinDatos` = cartera no respondió: no se sabe.
	 */
	convenios: ConteoConFecha & { sinDatos: boolean };
	referencias: { total: number; gestionadas: number; ultima: Date | null };
	visitaResidencia: ConteoConFecha & { sinContacto: number };
	visitaTrabajo: ConteoConFecha & { sinContacto: number };
	tieneDatosLaborales: boolean;
	gps: { vinculado: boolean; consultas: number; ultima: Date | null };
	apagado: {
		/** Estado de la última solicitud de apagado del periodo; null = ninguna. */
		estado:
			| "pendiente_aprobacion"
			| "aprobada"
			| "rechazada"
			| "ejecutada"
			| "cancelada"
			| null;
		fecha: Date | null;
	};
};

export type PasoEvaluado = {
	paso: ClavePaso;
	estado: EstadoPaso;
	/** Lo que se encontró, en una línea. Queda guardado tal cual en la solicitud. */
	evidencia: string;
	/**
	 * La clave de la razón que probablemente aplica (la UI la preselecciona si
	 * está en el catálogo del paso).
	 */
	sugerencia: string | null;
};

const formatoDia = new Intl.DateTimeFormat("es-GT", {
	timeZone: "America/Guatemala",
	day: "2-digit",
	month: "2-digit",
	year: "numeric",
});
const dia = (d: Date | null) => (d ? formatoDia.format(d) : "—");
const plural = (n: number, uno: string, varios: string) =>
	`${n} ${n === 1 ? uno : varios}`;

export function evaluarChecklist(e: EvidenciaGestion): PasoEvaluado[] {
	const desde = dia(e.desde);
	const pasos: Record<
		ClavePaso,
		Omit<PasoEvaluado, "paso" | "sugerencia"> & {
			sugerencia?: string | null;
		}
	> = {
		llamadas_cliente:
			e.llamadas.total === 0
				? {
						estado: "pendiente",
						evidencia: `Ninguna llamada registrada desde el ${desde}.`,
					}
				: {
						estado: "hecho",
						evidencia: `${plural(e.llamadas.total, "llamada", "llamadas")} (${plural(e.llamadas.contestadas, "contestada", "contestadas")}), la última el ${dia(e.llamadas.ultima)}.`,
					},
		mensajes:
			e.mensajes.total === 0
				? {
						estado: "pendiente",
						evidencia: `Ningún mensaje registrado desde el ${desde}.`,
					}
				: {
						estado: "hecho",
						evidencia: `${plural(e.mensajes.total, "mensaje", "mensajes")}, el último el ${dia(e.mensajes.ultima)}.`,
					},
		promesa_pago:
			e.promesas.total === 0
				? {
						estado: "pendiente",
						evidencia: `No hay promesas de pago desde el ${desde}.`,
					}
				: {
						estado: "hecho",
						evidencia: `${plural(e.promesas.total, "promesa", "promesas")} (${plural(e.promesas.incumplidas, "incumplida", "incumplidas")}), la última el ${dia(e.promesas.ultima)}.`,
					},
		referencias:
			e.referencias.total === 0
				? {
						estado: "pendiente",
						evidencia: "El crédito no tiene referencias cargadas.",
						sugerencia: "sin_referencias",
					}
				: e.referencias.gestionadas === 0
					? {
							estado: "pendiente",
							evidencia: `Ninguna de las ${e.referencias.total} referencias se gestionó.`,
						}
					: e.referencias.gestionadas < e.referencias.total
						? {
								estado: "parcial",
								evidencia: `${e.referencias.gestionadas} de ${e.referencias.total} referencias gestionadas, la última el ${dia(e.referencias.ultima)}.`,
							}
						: {
								estado: "hecho",
								evidencia: `Las ${e.referencias.total} referencias gestionadas, la última el ${dia(e.referencias.ultima)}.`,
							},
		convenio_pago:
			e.convenios.total > 0
				? {
						estado: "hecho",
						evidencia: `${plural(e.convenios.total, "convenio generado", "convenios generados")}, el último el ${dia(e.convenios.ultima)}.`,
					}
				: {
						estado: "pendiente",
						evidencia: e.convenios.sinDatos
							? "No se pudo consultar cartera: no se sabe si hubo convenio."
							: `No se generó ningún convenio desde el ${desde}.`,
					},
		visita_residencia: evaluarVisita(e.visitaResidencia, {
			destino: "a la residencia",
			dato: "dirección",
			hayDireccion: true,
			sugerenciaSinDato: "sin_direccion",
		}),
		visita_trabajo: evaluarVisita(e.visitaTrabajo, {
			destino: "al lugar de trabajo",
			dato: "lugar de trabajo",
			hayDireccion: e.tieneDatosLaborales,
			sugerenciaSinDato: "sin_datos_laborales",
		}),
		ubicacion_gps: !e.gps.vinculado
			? {
					estado: "pendiente",
					evidencia: "El vehículo no tiene GPS vinculado.",
					sugerencia: "sin_gps",
				}
			: e.gps.consultas === 0
				? {
						estado: "pendiente",
						evidencia: `No se consultó la ubicación desde el ${desde}.`,
					}
				: {
						estado: "hecho",
						evidencia: `Consultada ${plural(e.gps.consultas, "vez", "veces")}, la última el ${dia(e.gps.ultima)}.`,
					},
		apagado_unidad: evaluarApagado(e),
	};

	return PASOS_CHECKLIST_RECUPERACION.map((def) => {
		const p = pasos[def.clave];
		return {
			paso: def.clave,
			estado: p.estado,
			evidencia: p.evidencia,
			sugerencia: p.estado === "hecho" ? null : (p.sugerencia ?? null),
		};
	});
}

function evaluarVisita(
	v: ConteoConFecha & { sinContacto: number },
	lugar: {
		destino: string;
		dato: string;
		hayDireccion: boolean;
		sugerenciaSinDato: string;
	},
): { estado: EstadoPaso; evidencia: string; sugerencia?: string } {
	if (v.total === 0) {
		return lugar.hayDireccion
			? {
					estado: "pendiente",
					evidencia: `No hay visitas realizadas ${lugar.destino}.`,
				}
			: {
					estado: "pendiente",
					evidencia: `No hay visitas, y la solicitud de crédito no tiene ${lugar.dato}.`,
					sugerencia: lugar.sugerenciaSinDato,
				};
	}
	const sinContacto =
		v.sinContacto > 0 ? ` (${v.sinContacto} sin encontrar al cliente)` : "";
	return {
		estado: "hecho",
		evidencia: `${plural(v.total, "visita realizada", "visitas realizadas")}${sinContacto}, la última el ${dia(v.ultima)}.`,
	};
}

function evaluarApagado(e: EvidenciaGestion): {
	estado: EstadoPaso;
	evidencia: string;
	sugerencia?: string;
} {
	switch (e.apagado.estado) {
		case "ejecutada":
			return {
				estado: "hecho",
				evidencia: `Unidad apagada el ${dia(e.apagado.fecha)}.`,
			};
		case "pendiente_aprobacion":
		case "aprobada":
			return {
				estado: "parcial",
				evidencia: `Apagado solicitado el ${dia(e.apagado.fecha)}, todavía sin ejecutar.`,
				sugerencia: "apagado_pendiente",
			};
		case "rechazada":
			return {
				estado: "parcial",
				evidencia: `Se pidió el apagado el ${dia(e.apagado.fecha)} y se rechazó.`,
				sugerencia: "apagado_rechazado",
			};
		default:
			return e.gps.vinculado
				? { estado: "pendiente", evidencia: "No se pidió el apagado." }
				: {
						estado: "pendiente",
						evidencia: "Sin GPS vinculado: no se puede apagar.",
						sugerencia: "sin_gps",
					};
	}
}

// ── Lo que manda el formulario y lo que se guarda ───────────────────────────

const textoOpcional = (max: number) =>
	z
		.string()
		.trim()
		.max(max)
		.optional()
		.transform((v) => (v ? v : undefined));

export const respuestaPasoSchema = z.object({
	paso: z.enum(CLAVES_PASO),
	// Clave del catálogo del paso: se valida contra la base al combinar.
	justificacion: z.string().trim().min(1).max(64).optional(),
	nota: textoOpcional(500),
});
export type RespuestaPaso = z.infer<typeof respuestaPasoSchema>;
export type RespuestaPasoInput = z.input<typeof respuestaPasoSchema>;

export const respuestasChecklistSchema = z
	.array(respuestaPasoSchema)
	.max(PASOS_CHECKLIST_RECUPERACION.length)
	.refine((rs) => new Set(rs.map((r) => r.paso)).size === rs.length, {
		message: "Hay pasos repetidos en el checklist.",
	});

/** Un paso tal como queda guardado en `recuperaciones_vehiculo.checklist`. */
export type PasoChecklist = {
	paso: string;
	/** El título al momento de pedir: si el catálogo cambia, se sigue leyendo. */
	titulo: string;
	estado: EstadoPaso;
	evidencia: string;
	justificacion: string | null;
	/** La etiqueta al momento de pedir: si el catálogo cambia, se sigue leyendo. */
	justificacionEtiqueta: string | null;
	nota: string | null;
};

/**
 * Qué le falta a UN paso (null = está completo). Texto para quien solicita.
 * Con `opciones` (las razones activas del paso) también exige que la elegida
 * esté en el catálogo; la nota es siempre opcional.
 */
export function faltanteDePaso(
	evaluado: Pick<PasoEvaluado, "paso" | "estado">,
	respuesta: Pick<RespuestaPasoInput, "justificacion"> | undefined,
	opciones?: readonly OpcionJustificacion[],
): string | null {
	if (evaluado.estado === "hecho") return null;
	const titulo = tituloPaso(evaluado.paso);
	if (opciones && opciones.length === 0) {
		return `«${titulo}» no tiene justificaciones disponibles. Contacte a un administrador.`;
	}
	if (!respuesta?.justificacion) {
		return `Seleccione la justificación de «${titulo}».`;
	}
	if (opciones && !opciones.some((o) => o.clave === respuesta.justificacion)) {
		return `La justificación de «${titulo}» ya no está disponible. Seleccione otra.`;
	}
	return null;
}

/**
 * Junta lo que el CRM encontró (lo arma el servidor, no se le cree al cliente)
 * con lo que respondió quien solicita. Devuelve el checklist para guardar o el
 * primer problema.
 */
export function combinarChecklist(
	evaluados: readonly PasoEvaluado[],
	respuestas: readonly RespuestaPaso[],
	catalogo: CatalogoJustificaciones,
): { checklist: PasoChecklist[] } | { error: string } {
	const porPaso = new Map(respuestas.map((r) => [r.paso, r]));
	const checklist: PasoChecklist[] = [];
	for (const ev of evaluados) {
		const r = porPaso.get(ev.paso);
		const opciones = catalogo[ev.paso] ?? [];
		const falta = faltanteDePaso(ev, r, opciones);
		if (falta) return { error: falta };
		const hecho = ev.estado === "hecho";
		const elegida = hecho
			? undefined
			: opciones.find((o) => o.clave === r?.justificacion);
		checklist.push({
			paso: ev.paso,
			titulo: tituloPaso(ev.paso),
			estado: ev.estado,
			evidencia: ev.evidencia,
			justificacion: elegida?.clave ?? null,
			justificacionEtiqueta: elegida?.etiqueta ?? null,
			nota: hecho ? null : (r?.nota ?? null),
		});
	}
	return { checklist };
}

/** Lee el jsonb guardado sin confiar en su forma (registros viejos o editados). */
export function leerChecklistGuardado(valor: unknown): PasoChecklist[] | null {
	if (!Array.isArray(valor)) return null;
	const pasos: PasoChecklist[] = [];
	for (const item of valor) {
		if (!item || typeof item !== "object") continue;
		const p = item as Record<string, unknown>;
		if (typeof p.paso !== "string") continue;
		const estado =
			p.estado === "hecho" || p.estado === "parcial" ? p.estado : "pendiente";
		const justificacion =
			typeof p.justificacion === "string" && p.justificacion
				? p.justificacion
				: null;
		pasos.push({
			paso: p.paso,
			titulo: typeof p.titulo === "string" ? p.titulo : tituloPaso(p.paso),
			estado,
			evidencia: typeof p.evidencia === "string" ? p.evidencia : "",
			justificacion,
			justificacionEtiqueta: justificacion
				? typeof p.justificacionEtiqueta === "string"
					? p.justificacionEtiqueta
					: (ETIQUETAS_JUSTIFICACION_ANTERIORES[justificacion] ?? justificacion)
				: null,
			nota: typeof p.nota === "string" ? p.nota : null,
		});
	}
	return pasos;
}

export function resumenChecklist(
	checklist: readonly Pick<PasoChecklist, "estado">[],
): {
	total: number;
	hechos: number;
	justificados: number;
	texto: string;
} {
	const total = checklist.length;
	const hechos = checklist.filter((p) => p.estado === "hecho").length;
	return {
		total,
		hechos,
		justificados: total - hechos,
		texto: `${hechos} de ${total} pasos hechos`,
	};
}

// ── Desde cuándo se mira la gestión ─────────────────────────────────────────

/** Si el historial de buckets no alcanza, se miran los últimos 6 meses. */
export const DIAS_EPISODIO_POR_DEFECTO = 180;

/**
 * Inicio del episodio de mora ACTUAL: la fecha en que el crédito salió de B0
 * por última vez. Se recorre el historial de buckets del más nuevo al más viejo
 * mientras el crédito siga en mora; la gestión de un atraso anterior, ya
 * resuelto, no cuenta para este. Sin historial, los últimos 180 días.
 */
export function inicioEpisodioMora(
	eventos: readonly { fecha: string | Date; bucket_nuevo: number }[],
	ahora: Date = new Date(),
): Date {
	const ordenados = [...eventos].sort(
		(a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime(),
	);
	let inicio: Date | null = null;
	for (const e of ordenados) {
		if (e.bucket_nuevo < 1) break;
		inicio = new Date(e.fecha);
	}
	return (
		inicio ?? new Date(ahora.getTime() - DIAS_EPISODIO_POR_DEFECTO * 86_400_000)
	);
}

// ── Avisos ──────────────────────────────────────────────────────────────────

function quienEs(cliente: string | null, numeroSifco: string): string {
	return cliente?.trim()
		? `${cliente.trim()} (${numeroSifco})`
		: `El crédito ${numeroSifco}`;
}

export function textoAvisoSolicitudRecuperacion(params: {
	cliente: string | null;
	numeroSifco: string;
	bucket: number | null;
	solicitante: string | null;
	resumen: string;
}): { titulo: string; descripcion: string } {
	const donde = params.bucket !== null ? ` (B${params.bucket})` : "";
	return {
		titulo: "Solicitud de recuperación del vehículo",
		descripcion: `${quienEs(params.cliente, params.numeroSifco)}${donde}: ${params.solicitante ?? "Un asesor"} solicita enviarlo a B4 para recuperar el vehículo. Checklist: ${params.resumen}.`,
	};
}

export function textoAvisoDecisionRecuperacion(params: {
	decision: "aprobada" | "rechazada" | "sin_efecto";
	cliente: string | null;
	numeroSifco: string;
	decidioPor: string | null;
	motivo: string | null;
}): { titulo: string; descripcion: string } {
	const quien = quienEs(params.cliente, params.numeroSifco);
	const por = params.decidioPor ?? "El supervisor";
	switch (params.decision) {
		case "aprobada":
			return {
				titulo: "Recuperación aprobada",
				descripcion: `${por} aprobó la recuperación de ${quien}. Ya pasó a B4.`,
			};
		case "rechazada":
			return {
				titulo: "Recuperación rechazada",
				descripcion: `${por} rechazó la recuperación de ${quien}. Motivo: ${params.motivo ?? "sin indicar"}.`,
			};
		default:
			return {
				titulo: "Solicitud de recuperación sin efecto",
				descripcion:
					`La solicitud de recuperación de ${quien} ya no aplica. ${params.motivo ?? ""}`.trim(),
			};
	}
}
