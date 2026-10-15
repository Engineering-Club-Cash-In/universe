/**
 * Historial unificado del crédito (Ficha 360 › Historial y Workspace).
 *
 * Antes la pestaña tenía una tarjeta por fuente: gestiones, links de pago,
 * promesas, recordatorios, bot de WhatsApp y vida del crédito. Ahora todo va en
 * UNA línea de tiempo con chips de filtro. Este módulo es la parte pura:
 *
 * 1. Normaliza cada fuente a un `EventoHistorial` (mismo texto, badges y
 *    detalles que mostraba su tarjeta).
 * 2. Los mezcla en orden cronológico descendente.
 * 3. Separa «Historial actual» (desde que el crédito entró a su bucket actual)
 *    de «Histórico» (todo lo anterior).
 * 4. Corta en el «horizonte de carga»: si una fuente viene con tope (gestiones
 *    de 200 en 200, Págalo de 50 en 50), lo más viejo que se cargó de ella es
 *    hasta donde la lista es completa. Lo anterior se oculta hasta «Cargar más»,
 *    para no mostrar un tramo al que le faltan gestiones.
 *
 * Sin React: el contenido especial (acciones de Págalo, detalle del bot) lo
 * agrega quien arma los datos en `contenido`.
 */
import type * as React from "react";
import {
	etiquetaMotivo,
	getEstadoGrupoInfo,
} from "@/components/cobros/pagalo/formato-pagalo";
import {
	contactoDeGestion,
	type DatosContactoGestion,
	etiquetaCanalGestion,
	textoProximoContacto,
} from "./gestion-contacto";
import { fechaLargaGT } from "./reglas-caso";

/* ── Tipos ──────────────────────────────────────────────────────────────────── */

/** De qué fuente sale el evento. */
export type TipoEvento =
	| "gestion"
	| "promesa"
	| "pago"
	| "link_pago"
	| "recordatorio"
	| "bot"
	| "vida";

/** Chips de filtro de la línea de tiempo. */
export type FiltroHistorial =
	| "todo"
	| "gestiones"
	| "efectivas"
	| "promesas"
	| "pagos"
	| "links"
	| "recordatorios"
	| "bot"
	| "vida";

export type PeriodoHistorial = "actual" | "historico";

/** Igual a `TonoGestion` de la línea de tiempo (punto de color). */
export type TonoEvento = "logrado" | "sin-contacto" | "fallido" | "neutro";

/** Igual a `CrmTone` del DS. */
export type TonoBadge =
	| "success"
	| "warning"
	| "danger"
	| "info"
	| "neutral"
	| "brand";

export type BadgeEvento = {
	etiqueta: string;
	tono: TonoBadge;
	/** Badge secundario con borde (Variante mora, Prueba, Desde cartera…). */
	contorno?: boolean;
	/** Tooltip. */
	ayuda?: string;
};

/** Ícono de la fila; la vista lo traduce a lucide. */
export type IconoEvento =
	| "llamada"
	| "llamada_entrante"
	| "whatsapp"
	| "sms"
	| "email"
	| "visita_domicilio"
	| "visita_trabajo"
	| "carta_notarial"
	| "pago_gestion"
	| "promesa"
	| "pago"
	| "link_pago"
	| "recordatorio"
	| "bot"
	| "bucket"
	| "convenio"
	| "otro";

/** Lo que agrega la capa de datos para los tipos con render propio. */
export type ContenidoEvento = {
	/** Siempre visible bajo el subtítulo (acciones, avisos). */
	extra?: React.ReactNode;
	/** Detalle plegable propio (links, interacciones del bot…). */
	detalleNodo?: React.ReactNode;
	detalleEtiqueta?: string;
};

export type EventoHistorial = {
	/** Único entre fuentes (lleva el prefijo de la fuente). */
	id: string;
	/** Instante en ms; null = sin fecha (va al final y al Histórico). */
	fecha: number | null;
	tipo: TipoEvento;
	/** Chips en los que aparece, además de «Todo». */
	filtros: FiltroHistorial[];
	icono: IconoEvento;
	/** "15 oct 2026 · 10:30". */
	cuando: string;
	titulo: string;
	/** Título en gris e itálica (promesa anterior a la validación de rango). */
	tituloAtenuado?: boolean;
	tituloAyuda?: string;
	badges: BadgeEvento[];
	subtitulo?: string;
	/** W1: con quién se habló y a qué teléfono. */
	contacto?: { participante: string | null; telefono: string | null } | null;
	/** Monto a la derecha del título. */
	derecha?: string;
	tono: TonoEvento;
	nota?: string | null;
	detalles: Array<{ label: string; valor: string }>;
	/** Avisos de una línea bajo el subtítulo (motivo de revisión, aplicado…). */
	avisos?: Array<{ texto: string; tono: "success" | "danger" }>;
	detalleEtiqueta?: string;
	/** Datos crudos de las fuentes con render propio. */
	datos?: DatosEvento;
	contenido?: ContenidoEvento;
};

export type DatosEvento =
	| { tipo: "link_pago"; grupo: GrupoPagaloFuente }
	| { tipo: "bot_sesion"; sesion: SesionBotFuente }
	| { tipo: "bot_accesos"; interacciones: InteraccionBotFuente[] };

/* ── Fuentes (lo mínimo que se lee de cada endpoint) ────────────────────────── */

/** Una fila de `getHistorialContactos` (gestión o promesa). */
export type GestionFuente = DatosContactoGestion & {
	id: string;
	fechaContacto?: string | Date | null;
	duracionLlamada?: number | null;
	comentarios?: string | null;
	acuerdosAlcanzados?: string | null;
	compromisosPago?: string | null;
	proximoPaso?: string | null;
	realizadoPor?: string | null;
	cuotaInicio?: number | null;
	cuotaFin?: number | null;
	incluyeMora?: boolean | null;
	estadoPromesa?: string | null;
	montoComprometido?: string | number | null;
};

export type EstadoPromesa = "pendiente" | "cumplida" | "incumplida";

/** Un recordatorio de `getRecordatoriosPremora`. */
export type RecordatorioFuente = {
	id: string;
	tipo: string | null;
	telefono: string | null;
	enviado: boolean;
	error: string | null;
	modoPrueba: boolean;
	fecha: string | Date;
};

/** Una cuota de `getHistorialPagos` con sus pagos. */
export type CuotaPagosFuente = {
	numeroCuota?: number | null;
	pagos?: Array<{
		pagoId?: number;
		montoBoleta?: string | number | null;
		montoAplicado?: string | number | null;
		/** Hora de Guatemala SIN zona (así la manda cartera). */
		fechaPago?: string | null;
		validationStatus?: string | null;
		/** "validado" | "en_validacion" | "parcial". */
		estado?: string | null;
	}> | null;
};

/** Un grupo de `getPagaloHistorial`. */
export type GrupoPagaloFuente = {
	id: string;
	status: string;
	origen: "ASESOR" | "BOT";
	totalAmount: string;
	carteraImportId: number | null;
	lastDispatchError: string | null;
	createdAt: string;
	creadoPor: string | null;
	links: Array<unknown>;
};

export type InteraccionBotFuente = {
	id: string;
	accion: string;
	exito: boolean;
	codigo: string | null;
	numeroSifco: string | null;
	detalle: Record<string, unknown>;
	creadoEn: string | Date;
};

export type SesionBotFuente = {
	numero: number;
	referenciaSufijo: string;
	inicio: string | Date;
	operadoPor: "titular" | "codeudor";
	codeudorNombre: string | null;
	interacciones: InteraccionBotFuente[];
};

/** Un hito de «Vida del crédito» (`getFichaComplementos().historico`). */
export type HitoFuente = {
	id: string;
	descripcion: string;
	fecha: string;
	tipo?: string;
};

/** Una decisión de `getDecisionesConvenio`. */
export type DecisionConvenioFuente = {
	decisionId: number;
	decision: "aprobado" | "rechazado";
	motivo: string | null;
	origen: "crm" | "cartera_front";
	decididoPorEmail: string;
	decididoEn: string;
	snapshot?: {
		monto_total_convenio?: string;
		numero_meses?: number;
	} | null;
};

/* ── Filtros ────────────────────────────────────────────────────────────────── */

export const FILTROS_HISTORIAL: ReadonlyArray<{
	clave: FiltroHistorial;
	etiqueta: string;
	descripcion: string;
}> = [
	{
		clave: "todo",
		etiqueta: "Todo",
		descripcion: "Todo lo que ha pasado con el crédito.",
	},
	{
		clave: "gestiones",
		etiqueta: "Gestiones",
		descripcion:
			"Llamadas, mensajes y visitas registradas por el equipo, incluidas las promesas de pago.",
	},
	{
		clave: "efectivas",
		etiqueta: "Contactos efectivos",
		descripcion:
			"Gestiones en las que se habló con el cliente: contactado, acuerdo parcial, rechaza pagar o promesa de pago.",
	},
	{
		clave: "promesas",
		etiqueta: "Promesas de pago",
		descripcion:
			"Promesas de pago registradas, con su estado, y el momento en que se cumplieron.",
	},
	{
		clave: "pagos",
		etiqueta: "Pagos",
		descripcion: "Pagos recibidos y aplicados al crédito en cartera.",
	},
	{
		clave: "links",
		etiqueta: "Links de pago",
		descripcion: "Links de Págalo generados por el asesor o por el bot.",
	},
	{
		clave: "recordatorios",
		etiqueta: "Recordatorios",
		descripcion:
			"Recordatorios automáticos de pago (D-5, D-3, D-1 y D-0) enviados por WhatsApp.",
	},
	{
		clave: "bot",
		etiqueta: "Bot de WhatsApp",
		descripcion:
			"Lo que hizo el cliente en el bot de WhatsApp, incluidos los links que generó.",
	},
	{
		clave: "vida",
		etiqueta: "Vida del crédito",
		descripcion:
			"Entradas y salidas de bucket, convenios de pago y sus aprobaciones.",
	},
];

export function etiquetaFiltro(filtro: FiltroHistorial): string {
	return FILTROS_HISTORIAL.find((f) => f.clave === filtro)?.etiqueta ?? filtro;
}

/* ── Formato ────────────────────────────────────────────────────────────────── */

const HORA_GT = new Intl.DateTimeFormat("en-GB", {
	timeZone: "America/Guatemala",
	hour: "2-digit",
	minute: "2-digit",
	hour12: false,
});

/** Milisegundos de un valor de fecha; null si no es una fecha válida. */
function aMs(valor: string | Date | null | undefined): number | null {
	if (!valor) return null;
	const ms = (valor instanceof Date ? valor : new Date(valor)).getTime();
	return Number.isNaN(ms) ? null : ms;
}

/** "15 oct 2026 · 10:30" en hora de Guatemala; sin hora si `conHora` es false. */
export function cuandoGT(ms: number | null, conHora = true): string {
	if (ms === null) return "Sin fecha";
	const fecha = fechaLargaGT(new Date(ms));
	return conHora ? `${fecha} · ${HORA_GT.format(new Date(ms))}` : fecha;
}

/** "Q1,234.50". */
export function quetzales(valor: string | number | null | undefined): string {
	return `Q${Number(valor ?? 0).toLocaleString("es-GT", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`;
}

/** GT es UTC-6 todo el año (sin horario de verano). */
const DESFASE_GT_MS = 6 * 60 * 60 * 1000;

/**
 * Instante de una fecha que cartera manda en hora de Guatemala SIN zona
 * (`fecha_pago`): se leen la fecha y la hora tal cual, se descarta una «Z» o
 * un desfase (no son reales) y se ubica en UTC-6. `conHora` es false si no
 * trae hora o si es medianoche (cartera guarda muchos pagos sin hora).
 */
export function instanteHoraGT(
	valor: string | null | undefined,
): { ms: number; conHora: boolean } | null {
	const m = valor?.match(
		/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/,
	);
	if (!m) return null;
	const [, y, mes, d, h, mi, s] = m;
	const ms =
		Date.UTC(
			Number(y),
			Number(mes) - 1,
			Number(d),
			Number(h ?? 0),
			Number(mi ?? 0),
			Number(s ?? 0),
		) + DESFASE_GT_MS;
	if (Number.isNaN(ms)) return null;
	return { ms, conHora: h !== undefined && !(h === "00" && mi === "00") };
}

/** "#5", "#5 y #6", "#5, #6 y #7". */
function listaCuotas(numeros: number[]): string {
	const t = numeros.map((n) => `#${n}`);
	if (t.length <= 1) return t.join("");
	return `${t.slice(0, -1).join(", ")} y ${t.at(-1)}`;
}

/* ── Gestiones y promesas ───────────────────────────────────────────────────── */

/** Resultado de la gestión → etiqueta y tono (tokens del DS). */
export const ESTADO_GESTION: Record<
	string,
	{ etiqueta: string; tono: TonoBadge }
> = {
	contactado: { etiqueta: "Contactado", tono: "success" },
	promesa_pago: { etiqueta: "Promesa de pago", tono: "brand" },
	no_contesta: { etiqueta: "No contesta", tono: "warning" },
	mensaje_enviado: { etiqueta: "Mensaje enviado", tono: "info" },
	acuerdo_parcial: { etiqueta: "Acuerdo parcial", tono: "brand" },
	rechaza_pagar: { etiqueta: "Rechaza pagar", tono: "danger" },
	numero_equivocado: { etiqueta: "Número equivocado", tono: "neutral" },
	link_pago_generado: { etiqueta: "Link de pago generado", tono: "brand" },
	pago_registrado: { etiqueta: "Pago registrado", tono: "success" },
};

/**
 * Se habló con el cliente: mismas categorías que «contacto efectivo» del
 * cierre diario (`esContactoEfectivo`), más la promesa de pago, que también es
 * una conversación con resultado.
 */
const ESTADOS_EFECTIVOS = [
	"contactado",
	"acuerdo_parcial",
	"rechaza_pagar",
	"promesa_pago",
];

function tonoDeGestion(estado: string | null | undefined): TonoEvento {
	if (
		["contactado", "acuerdo_parcial", "pago_registrado"].includes(estado ?? "")
	)
		return "logrado";
	if (
		["no_contesta", "numero_equivocado", "mensaje_enviado"].includes(
			estado ?? "",
		)
	)
		return "sin-contacto";
	if (estado === "rechaza_pagar") return "fallido";
	return "neutro";
}

function iconoDeMetodo(g: DatosContactoGestion): IconoEvento {
	switch (g.metodoContacto) {
		case "llamada":
			return g.direccionContacto === "entrante"
				? "llamada_entrante"
				: "llamada";
		case "whatsapp":
		case "sms":
		case "email":
		case "visita_domicilio":
		case "visita_trabajo":
		case "carta_notarial":
			return g.metodoContacto;
		case "pago":
			return "pago_gestion";
		default:
			return "llamada";
	}
}

function duracion(segundos: number | null | undefined): string | null {
	if (!segundos) return null;
	return `${Math.floor(segundos / 60)}:${(segundos % 60).toString().padStart(2, "0")} min`;
}

/** Una gestión del equipo (no promesa). */
export function eventoDeGestion(g: GestionFuente): EventoHistorial {
	const fecha = aMs(g.fechaContacto);
	const estado = ESTADO_GESTION[g.estadoContacto ?? ""] ?? {
		etiqueta: g.estadoContacto ?? "—",
		tono: "neutral" as const,
	};
	const detalles = [
		g.acuerdosAlcanzados && {
			label: "Acuerdos",
			valor: g.acuerdosAlcanzados,
		},
		g.compromisosPago && { label: "Compromisos", valor: g.compromisosPago },
		(g.fechaProximoContacto || g.horaProximoContacto) && {
			label: "Seguimiento programado",
			// W1: con hora y medio («15 oct 2026 · 10:30 · por WhatsApp»).
			valor: textoProximoContacto(g) ?? "",
		},
		g.proximoPaso && { label: "Próximo paso", valor: g.proximoPaso },
		duracion(g.duracionLlamada) && {
			label: "Duración",
			valor: duracion(g.duracionLlamada) as string,
		},
	].filter(Boolean) as Array<{ label: string; valor: string }>;
	const filtros: FiltroHistorial[] = ["gestiones"];
	if (ESTADOS_EFECTIVOS.includes(g.estadoContacto ?? ""))
		filtros.push("efectivas");
	return {
		id: `gestion-${g.id}`,
		fecha,
		tipo: "gestion",
		filtros,
		icono: iconoDeMetodo(g),
		cuando: cuandoGT(fecha),
		titulo: etiquetaCanalGestion(g),
		badges: [{ etiqueta: estado.etiqueta, tono: estado.tono }],
		subtitulo: `Por: ${g.realizadoPor || "Sin asignar"}`,
		contacto: contactoDeGestion(g),
		tono: tonoDeGestion(g.estadoContacto),
		nota: g.comentarios,
		detalles,
	};
}

const ESTADO_PROMESA: Record<
	EstadoPromesa,
	{ etiqueta: string; tono: TonoBadge }
> = {
	cumplida: { etiqueta: "Cumplida", tono: "success" },
	incumplida: { etiqueta: "Incumplida", tono: "danger" },
	pendiente: { etiqueta: "Pendiente", tono: "info" },
};

/**
 * Una promesa de pago (CB-020). El estado recién calculado (`estados`, en
 * memoria) manda sobre la columna de la DB, que puede ir un ciclo atrás.
 * «Vencida» usa la misma gracia de un día que el backend (`finDeGraciaGT`).
 */
export function eventoDePromesa(
	p: GestionFuente,
	estados: Record<string, EstadoPromesa> | undefined,
	ahora: Date = new Date(),
): EventoHistorial {
	const fecha = aMs(p.fechaContacto);
	const prometida = aMs(p.fechaProximoContacto);
	const estado: EstadoPromesa =
		estados?.[p.id] ?? (p.estadoPromesa as EstadoPromesa | null) ?? "pendiente";
	const vencida =
		prometida !== null &&
		prometida + 24 * 60 * 60 * 1000 <= ahora.getTime() &&
		estado !== "cumplida";
	const tieneRango = p.cuotaInicio != null && p.cuotaFin != null;
	// Fila anterior a CB-020: puede no tener rango ni mora; no se inventa lo
	// que prometió (Codex, PR #1147).
	const rango = tieneRango
		? p.cuotaInicio === p.cuotaFin
			? `Cuota #${p.cuotaInicio}`
			: `Cuotas #${p.cuotaInicio} a #${p.cuotaFin}`
		: p.incluyeMora
			? "Mora del crédito"
			: "Sin rango ni mora especificados";
	const legacy = !tieneRango && !p.incluyeMora;
	const badgeEstado = ESTADO_PROMESA[estado] ?? ESTADO_PROMESA.pendiente;
	const badges: BadgeEvento[] = [badgeEstado];
	if (vencida) badges.push({ etiqueta: "Vencida", tono: "danger" });
	const detalles = [
		p.compromisosPago && { label: "Compromiso", valor: p.compromisosPago },
		p.acuerdosAlcanzados && { label: "Acuerdos", valor: p.acuerdosAlcanzados },
		p.proximoPaso && { label: "Próximo paso", valor: p.proximoPaso },
		p.metodoContacto && {
			label: "Canal",
			valor: etiquetaCanalGestion(p),
		},
	].filter(Boolean) as Array<{ label: string; valor: string }>;
	return {
		id: `promesa-${p.id}`,
		fecha,
		tipo: "promesa",
		filtros: ["gestiones", "efectivas", "promesas"],
		icono: "promesa",
		cuando: cuandoGT(fecha),
		titulo: `Promesa de pago · ${rango}${tieneRango && p.incluyeMora ? " + mora" : ""}`,
		tituloAtenuado: legacy,
		tituloAyuda: legacy
			? "Registro anterior a la validación obligatoria de rango o mora. Revise los comentarios para conocer lo que prometió el cliente."
			: undefined,
		badges,
		subtitulo: `Para el ${prometida !== null ? fechaLargaGT(new Date(prometida)) : "—"} · Por: ${p.realizadoPor || "Sin asignar"}`,
		contacto: contactoDeGestion(p),
		derecha:
			p.montoComprometido != null ? quetzales(p.montoComprometido) : undefined,
		tono:
			estado === "cumplida"
				? "logrado"
				: estado === "incumplida" || vencida
					? "fallido"
					: "sin-contacto",
		nota: p.comentarios,
		detalles,
	};
}

/** Gestiones y promesas de `getHistorialContactos`. */
export function eventosDeContactos(
	contactos: readonly GestionFuente[],
	estados?: Record<string, EstadoPromesa>,
	ahora?: Date,
): EventoHistorial[] {
	return contactos.map((c) =>
		c.estadoContacto === "promesa_pago"
			? eventoDePromesa(c, estados, ahora)
			: eventoDeGestion(c),
	);
}

/* ── Recordatorios ──────────────────────────────────────────────────────────── */

export function eventoDeRecordatorio(r: RecordatorioFuente): EventoHistorial {
	const fecha = aMs(r.fecha);
	const tipo = r.tipo ?? "";
	const badges: BadgeEvento[] = [
		r.enviado
			? { etiqueta: "Enviado", tono: "success" }
			: { etiqueta: "Falló", tono: "danger" },
	];
	if (tipo.endsWith("_mora"))
		badges.push({ etiqueta: "Variante mora", tono: "danger", contorno: true });
	if (r.modoPrueba)
		badges.push({ etiqueta: "Prueba", tono: "warning", contorno: true });
	return {
		id: `recordatorio-${r.id}`,
		fecha,
		tipo: "recordatorio",
		filtros: ["recordatorios"],
		icono: "recordatorio",
		cuando: cuandoGT(fecha),
		titulo:
			`Recordatorio de pago ${tipo.replace("premora_", "D-").replace("_mora", "")}`.trim(),
		badges,
		subtitulo: r.telefono ? `Al ${r.telefono}` : "Sin teléfono",
		tono: r.enviado ? "logrado" : "fallido",
		nota: r.error,
		detalles: [],
	};
}

/* ── Pagos ──────────────────────────────────────────────────────────────────── */

/**
 * Un evento por pago de cartera. Un pago repartido en varias cuotas viene una
 * vez por cuota en `getHistorialPagos`: se junta por `pagoId`.
 */
export function eventosDePagos(
	cuotas: readonly CuotaPagosFuente[],
): EventoHistorial[] {
	const porPago = new Map<
		number,
		{
			boleta: number;
			aplicado: number;
			fechaPago: string | null;
			validacion: string | null;
			parcial: boolean;
			cuotas: Array<{ numero: number; aplicado: number }>;
		}
	>();
	for (const cuota of cuotas) {
		for (const p of cuota.pagos ?? []) {
			if (p.pagoId === undefined) continue;
			const actual = porPago.get(p.pagoId) ?? {
				boleta: 0,
				aplicado: 0,
				fechaPago: p.fechaPago ?? null,
				validacion: p.validationStatus ?? null,
				parcial: false,
				cuotas: [],
			};
			const aplicado = Number(p.montoAplicado ?? 0) || 0;
			actual.boleta = Math.max(actual.boleta, Number(p.montoBoleta ?? 0) || 0);
			actual.aplicado += aplicado;
			actual.fechaPago ??= p.fechaPago ?? null;
			actual.validacion ??= p.validationStatus ?? null;
			if (p.estado === "parcial") actual.parcial = true;
			if (cuota.numeroCuota != null) {
				actual.cuotas.push({ numero: cuota.numeroCuota, aplicado });
			}
			porPago.set(p.pagoId, actual);
		}
	}
	return [...porPago.entries()].map(([pagoId, p]) => {
		const instante = instanteHoraGT(p.fechaPago);
		const fecha = instante?.ms ?? null;
		const cuotasOrden = [...p.cuotas].sort((a, b) => a.numero - b.numero);
		const numeros = cuotasOrden.map((c) => c.numero);
		const pendiente = p.validacion === "pending";
		const validado =
			p.validacion === "validated" || p.validacion === "capital_validated";
		const badges: BadgeEvento[] = [];
		if (pendiente)
			badges.push({ etiqueta: "Pendiente de validar", tono: "warning" });
		else if (validado) badges.push({ etiqueta: "Validado", tono: "success" });
		if (p.parcial) badges.push({ etiqueta: "Pago parcial", tono: "info" });
		const detalles: Array<{ label: string; valor: string }> = [];
		if (p.boleta > 0 && Math.abs(p.boleta - p.aplicado) >= 0.01) {
			detalles.push({
				label: "Monto de la boleta",
				valor: quetzales(p.boleta),
			});
		}
		for (const c of cuotasOrden) {
			detalles.push({
				label: `Aplicado a la cuota #${c.numero}`,
				valor: quetzales(c.aplicado),
			});
		}
		return {
			id: `pago-${pagoId}`,
			fecha,
			tipo: "pago" as const,
			filtros: ["pagos"] as FiltroHistorial[],
			icono: "pago" as const,
			cuando: cuandoGT(fecha, instante?.conHora ?? false),
			titulo: "Pago recibido",
			badges,
			subtitulo:
				numeros.length === 0
					? `Pago #${pagoId}`
					: `Pago #${pagoId} · ${numeros.length === 1 ? "Cuota" : "Cuotas"} ${listaCuotas(numeros)}`,
			derecha: quetzales(p.boleta > 0 ? p.boleta : p.aplicado),
			tono: pendiente ? ("sin-contacto" as const) : ("logrado" as const),
			detalles,
			detalleEtiqueta: "Ver cómo se aplicó el pago",
		};
	});
}

/* ── Links de pago (Págalo) ─────────────────────────────────────────────────── */

const TONO_ESTADO_GRUPO: Record<string, TonoBadge> = {
	DRAFT: "neutral",
	LINKS_PENDING: "info",
	PENDING_PAYMENT: "warning",
	PARTIALLY_PAID: "warning",
	READY_TO_APPLY: "info",
	APPLYING: "info",
	COMPLETED: "success",
	APPLICATION_FAILED: "danger",
	REVIEW_REQUIRED: "danger",
	CANCELLED: "neutral",
};

/** Punto de la línea de tiempo según el estado del grupo. */
function tonoGrupo(status: string): TonoEvento {
	if (status === "COMPLETED") return "logrado";
	if (status === "APPLICATION_FAILED" || status === "REVIEW_REQUIRED")
		return "fallido";
	if (status === "CANCELLED") return "neutro";
	return "sin-contacto";
}

export function eventoDeGrupoPagalo(grupo: GrupoPagaloFuente): EventoHistorial {
	const fecha = aMs(grupo.createdAt);
	const motivo = etiquetaMotivo(grupo.lastDispatchError);
	const avisos: EventoHistorial["avisos"] = [];
	if (grupo.carteraImportId && grupo.status === "COMPLETED") {
		avisos.push({
			tono: "success",
			texto: `Pago validado y aplicado en cartera (importación #${grupo.carteraImportId}); la factura se emite después`,
		});
	}
	if (motivo && grupo.status !== "COMPLETED") {
		avisos.push({ tono: "danger", texto: motivo });
	}
	const n = grupo.links.length;
	return {
		id: `link-${grupo.id}`,
		fecha,
		tipo: "link_pago",
		// Un link que generó el cliente en el bot también es actividad del bot.
		filtros: grupo.origen === "BOT" ? ["links", "bot"] : ["links"],
		icono: "link_pago",
		cuando: cuandoGT(fecha),
		titulo: "Links de pago",
		badges: [
			{
				etiqueta: getEstadoGrupoInfo(grupo.status).label,
				tono: TONO_ESTADO_GRUPO[grupo.status] ?? "neutral",
			},
		],
		// Los grupos del bot no tienen persona detrás: el servidor manda
		// `creadoPor` en null y se nombra al bot.
		subtitulo:
			grupo.origen === "BOT"
				? "Por: Bot de WhatsApp"
				: `Por: ${grupo.creadoPor ?? "—"}`,
		derecha: quetzales(grupo.totalAmount),
		tono: tonoGrupo(grupo.status),
		detalles: [],
		avisos,
		detalleEtiqueta: `Ver ${n === 1 ? "el link" : `los ${n} links`}, cuotas y bitácora`,
		datos: { tipo: "link_pago", grupo },
	};
}

/* ── Bot de WhatsApp ────────────────────────────────────────────────────────── */

/**
 * Una sesión del bot por evento; los intentos de acceso sin sesión se juntan
 * por día de Guatemala (antes iban todos en una sola fila, que no se podía
 * ubicar en un rango de fechas).
 */
export function eventosDeBot(actividad: {
	sesiones?: readonly SesionBotFuente[] | null;
	accesosFallidos?: readonly InteraccionBotFuente[] | null;
}): EventoHistorial[] {
	const eventos: EventoHistorial[] = (actividad.sesiones ?? []).map(
		(sesion) => {
			const fecha = aMs(sesion.inicio);
			const total = sesion.interacciones.length;
			const fallidas = sesion.interacciones.filter((i) => !i.exito).length;
			const operador =
				sesion.operadoPor === "codeudor"
					? `Codeudor${sesion.codeudorNombre ? `: ${sesion.codeudorNombre}` : ""}`
					: "Titular";
			return {
				id: `bot-${sesion.numero}-${sesion.referenciaSufijo}`,
				fecha,
				tipo: "bot" as const,
				filtros: ["bot"] as FiltroHistorial[],
				icono: "bot" as const,
				cuando: cuandoGT(fecha),
				titulo: `Bot de WhatsApp · Referencia ${sesion.numero}`,
				tituloAyuda: `Referencia …${sesion.referenciaSufijo}`,
				badges: [
					{ etiqueta: operador, tono: "neutral" as const, contorno: true },
				],
				subtitulo: `${total} ${total === 1 ? "interacción" : "interacciones"}${fallidas > 0 ? ` · ${fallidas} con error` : ""}`,
				tono: fallidas > 0 ? ("sin-contacto" as const) : ("logrado" as const),
				detalles: [],
				detalleEtiqueta: "Ver lo que hizo en el bot",
				datos: { tipo: "bot_sesion" as const, sesion },
			};
		},
	);
	const porDia = new Map<string, InteraccionBotFuente[]>();
	for (const i of actividad.accesosFallidos ?? []) {
		const ms = aMs(i.creadoEn);
		const dia = ms === null ? "sin-fecha" : fechaLargaGT(new Date(ms));
		const lista = porDia.get(dia) ?? [];
		lista.push(i);
		porDia.set(dia, lista);
	}
	for (const [dia, interacciones] of porDia) {
		const fechas = interacciones
			.map((i) => aMs(i.creadoEn))
			.filter((ms): ms is number => ms !== null);
		const fecha = fechas.length > 0 ? Math.max(...fechas) : null;
		const n = interacciones.length;
		eventos.push({
			id: `bot-accesos-${dia}`,
			fecha,
			tipo: "bot",
			filtros: ["bot"],
			icono: "bot",
			cuando: cuandoGT(fecha),
			titulo: "Intentos de acceso al bot sin sesión",
			badges: [],
			subtitulo: `${n} ${n === 1 ? "intento" : "intentos"}`,
			tono: "fallido",
			detalles: [],
			detalleEtiqueta: "Ver los intentos",
			datos: { tipo: "bot_accesos", interacciones },
		});
	}
	return eventos;
}

/* ── Vida del crédito ───────────────────────────────────────────────────────── */

export function eventoDeHito(h: HitoFuente): EventoHistorial {
	const fecha = aMs(h.fecha);
	const tipo = h.tipo ?? "otro";
	return {
		id: `hito-${h.id}`,
		fecha,
		tipo: "vida",
		filtros: tipo === "promesa" ? ["vida", "promesas"] : ["vida"],
		icono:
			tipo === "bucket"
				? "bucket"
				: tipo === "convenio" || tipo === "reestructura"
					? "convenio"
					: tipo === "promesa"
						? "promesa"
						: "otro",
		cuando: cuandoGT(fecha, false),
		titulo: h.descripcion,
		badges: [],
		tono: tipo === "promesa" ? "logrado" : "neutro",
		detalles: [],
	};
}

/** CB-033: aprobaciones y rechazos de convenio (sobreviven al rechazo). */
export function eventoDeDecisionConvenio(
	d: DecisionConvenioFuente,
): EventoHistorial {
	const fecha = aMs(d.decididoEn);
	const rechazado = d.decision === "rechazado";
	const monto = d.snapshot?.monto_total_convenio
		? quetzales(d.snapshot.monto_total_convenio)
		: null;
	const badges: BadgeEvento[] = [
		rechazado
			? { etiqueta: "Rechazado", tono: "danger" }
			: { etiqueta: "Aprobado", tono: "success" },
	];
	if (d.origen === "cartera_front")
		badges.push({ etiqueta: "Desde cartera", tono: "neutral", contorno: true });
	return {
		id: `decision-${d.decisionId}`,
		fecha,
		tipo: "vida",
		filtros: ["vida"],
		icono: "convenio",
		cuando: cuandoGT(fecha),
		titulo: monto
			? `Convenio de pago por ${monto}${d.snapshot?.numero_meses ? ` · ${d.snapshot.numero_meses} meses` : ""}`
			: "Convenio de pago",
		badges,
		subtitulo: `Por: ${d.decididoPorEmail}`,
		tono: rechazado ? "fallido" : "logrado",
		nota: d.motivo ? `Motivo: ${d.motivo}` : null,
		detalles: [],
	};
}

/* ── Mezcla, periodo y horizonte ────────────────────────────────────────────── */

/** Lo más reciente primero; lo que no tiene fecha, al final. */
export function mezclarEventos(
	...listas: ReadonlyArray<readonly EventoHistorial[]>
): EventoHistorial[] {
	return listas
		.flat()
		.sort(
			(a, b) =>
				(b.fecha ?? Number.NEGATIVE_INFINITY) -
				(a.fecha ?? Number.NEGATIVE_INFINITY),
		);
}

/** Desde cuándo cuenta el «Historial actual». */
export type CortePeriodo = {
	fecha: number;
	/** "B2 · Gestión activa"; null si no se sabe. */
	bucket: string | null;
	/** De dónde salió: el motor (fecha de entrada) o el último hito de bucket. */
	origen: "bucket_actual" | "ultimo_hito";
};

/**
 * La fecha en que el crédito entró a su bucket actual (`fecha_entrada_bucket`
 * del motor). Sin ella (fuera del funnel, bucket derivado por fallback), el
 * último hito de bucket de la vida del crédito. Sin ninguno, null: todo es
 * «actual».
 */
export function cortePeriodoActual({
	fechaEntradaBucket,
	bucket,
	hitos,
}: {
	fechaEntradaBucket: string | null | undefined;
	bucket?: string | null;
	hitos?: readonly HitoFuente[] | null;
}): CortePeriodo | null {
	const entrada = aMs(fechaEntradaBucket);
	if (entrada !== null) {
		return { fecha: entrada, bucket: bucket ?? null, origen: "bucket_actual" };
	}
	const ultimo = (hitos ?? [])
		.filter((h) => h.tipo === "bucket")
		.map((h) => ({ h, ms: aMs(h.fecha) }))
		.filter((x): x is { h: HitoFuente; ms: number } => x.ms !== null)
		.sort((a, b) => b.ms - a.ms)[0];
	if (!ultimo) return null;
	return { fecha: ultimo.ms, bucket: null, origen: "ultimo_hito" };
}

/** ¿El evento va en el periodo? Sin corte, todo es «actual». */
export function enPeriodo(
	evento: Pick<EventoHistorial, "fecha">,
	periodo: PeriodoHistorial,
	corte: CortePeriodo | null,
): boolean {
	if (!corte) return periodo === "actual";
	const esActual = evento.fecha !== null && evento.fecha >= corte.fecha;
	return periodo === "actual" ? esActual : !esActual;
}

/** Una fuente con tope: si vino llena, lo más viejo que trajo. */
export type CargaFuente = {
	/** true si la fuente tiene más registros que los cargados. */
	truncada: boolean;
	/** Fecha (ms) del registro más viejo cargado. */
	masAntiguo: number | null;
};

/**
 * Hasta dónde la lista mezclada es completa: lo más viejo cargado de la fuente
 * truncada más «corta». null = todas las fuentes vinieron completas.
 */
export function horizonteDeCarga(
	fuentes: readonly CargaFuente[],
): number | null {
	let horizonte: number | null = null;
	for (const f of fuentes) {
		if (!f.truncada || f.masAntiguo === null) continue;
		horizonte =
			horizonte === null ? f.masAntiguo : Math.max(horizonte, f.masAntiguo);
	}
	return horizonte;
}

/** Fecha más vieja de una lista de eventos. */
export function masAntiguo(eventos: readonly EventoHistorial[]): number | null {
	let min: number | null = null;
	for (const e of eventos) {
		if (e.fecha !== null && (min === null || e.fecha < min)) min = e.fecha;
	}
	return min;
}

/** Los eventos del periodo que caen dentro de lo ya cargado. */
export function eventosDelPeriodo(
	eventos: readonly EventoHistorial[],
	{
		periodo,
		corte,
		horizonte,
	}: {
		periodo: PeriodoHistorial;
		corte: CortePeriodo | null;
		horizonte: number | null;
	},
): EventoHistorial[] {
	return eventos.filter(
		(e) =>
			enPeriodo(e, periodo, corte) &&
			(horizonte === null || (e.fecha !== null && e.fecha >= horizonte)),
	);
}

export function filtrarEventos(
	eventos: readonly EventoHistorial[],
	filtro: FiltroHistorial,
): EventoHistorial[] {
	return filtro === "todo"
		? [...eventos]
		: eventos.filter((e) => e.filtros.includes(filtro));
}

export function contarPorFiltro(
	eventos: readonly EventoHistorial[],
): Record<FiltroHistorial, number> {
	const conteo = Object.fromEntries(
		FILTROS_HISTORIAL.map((f) => [f.clave, 0]),
	) as Record<FiltroHistorial, number>;
	conteo.todo = eventos.length;
	for (const e of eventos) {
		for (const f of new Set(e.filtros)) conteo[f] += 1;
	}
	return conteo;
}
