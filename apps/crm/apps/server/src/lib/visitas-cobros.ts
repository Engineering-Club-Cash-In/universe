/**
 * CB-037 / CB-038 · Visitas de cobros: a la residencia y al lugar de trabajo.
 *
 * Una visita es una TAREA con dos momentos:
 *
 * | Estado       | Qué pasó                                   | Qué se pide                                  |
 * | ------------ | ------------------------------------------ | -------------------------------------------- |
 * | `programada` | Alguien la agenda                          | Dirección, responsable, fecha                |
 * | `realizada`  | Se fue (programada o no)                   | + resultado, evidencia, próximo paso         |
 * | `cancelada`  | La programada no se hizo                   | Motivo                                       |
 *
 * El resultado no se queda en la visita: cada uno sigue por el flujo que YA
 * existe para eso, y la visita solo lo dispara (ver `siguientesPasos`):
 *  · pago              → "Registrar Pago" (link de Págalo o boleta);
 *  · promesa           → el modal de promesa (congela en cartera, mide cumplimiento);
 *  · pago parcial + promesa → las dos cosas: el pago recibido (un porcentaje
 *    de lo vencido) y la promesa por el resto;
 *  · convenio          → el modal de convenio de pago (CB-032);
 *  · entrega voluntaria → el formulario de CB-042, que traslada a B4 (o solo
 *    registra si ya está en B4);
 *  · sin contacto      → nada más: queda el motivo y el próximo paso.
 *
 * Todo lo de acá es puro (sin DB ni red): lo importan el servidor y la ficha,
 * así el botón se habilita con lo mismo que el servidor va a aceptar.
 */

import { z } from "zod";

// ── Buckets ─────────────────────────────────────────────────────────────────

/**
 * Las visitas se programan y registran de B2 a B4. El ticket es de B3 ·
 * Rescate, pero en B4 también se sale a buscar al cliente (decisión del
 * 2026-09-29) y desde B2 ya se puede visitar: no hay motivo para esperar a la
 * tercera cuota (decisión del 2026-09-30, junto con CB-043).
 * Registrar el resultado de una visita YA programada no mira el bucket: la
 * visita ocurrió aunque el crédito se haya movido después.
 */
export const BUCKET_MINIMO_VISITA = 2;
export const BUCKET_MAXIMO_VISITA = 4;

export function visitaPermitidaEnBucket(bucket: number | null): boolean {
	return (
		bucket !== null &&
		bucket >= BUCKET_MINIMO_VISITA &&
		bucket <= BUCKET_MAXIMO_VISITA
	);
}

/** Por qué no se puede agendar ni registrar una visita nueva (null = sí se puede). */
export function motivoBloqueoVisita(
	bucket: number | null,
	prefijo?: string | null,
): string | null {
	if (visitaPermitidaEnBucket(bucket)) return null;
	const donde = prefijo ?? (bucket === null ? null : `B${bucket}`);
	return donde
		? `Disponible de B${BUCKET_MINIMO_VISITA} a B${BUCKET_MAXIMO_VISITA}. Este caso está en ${donde}.`
		: `Disponible de B${BUCKET_MINIMO_VISITA} a B${BUCKET_MAXIMO_VISITA}. El crédito no tiene bucket.`;
}

// ── Tipos, estados y resultados ─────────────────────────────────────────────

export const TIPOS_VISITA = ["residencia", "trabajo"] as const;
export type TipoVisita = (typeof TIPOS_VISITA)[number];

export const TIPO_VISITA_LABEL: Record<TipoVisita, string> = {
	residencia: "Visita a residencia",
	trabajo: "Visita al lugar de trabajo",
};

/** El canal con que la visita queda en el historial de contactos. */
export function metodoContactoDeVisita(
	tipo: TipoVisita,
): "visita_domicilio" | "visita_trabajo" {
	return tipo === "trabajo" ? "visita_trabajo" : "visita_domicilio";
}

export const ESTADOS_VISITA = ["programada", "realizada", "cancelada"] as const;
export type EstadoVisita = (typeof ESTADOS_VISITA)[number];

// `resultado` es text validado acá (no enum de la DB): agregar uno no pide
// migración. El valor `pago_parcial_promesa` se conserva aunque ya no sea un
// 50% fijo, para no reescribir las visitas viejas.
export const RESULTADOS_VISITA = [
	"pago",
	"promesa",
	"pago_parcial_promesa",
	"convenio",
	"entrega_voluntaria",
	"sin_contacto",
] as const;
export type ResultadoVisita = (typeof RESULTADOS_VISITA)[number];

export const RESULTADO_VISITA_LABEL: Record<ResultadoVisita, string> = {
	pago: "Pago total",
	promesa: "Promesa de pago",
	pago_parcial_promesa: "Pago parcial + promesa",
	convenio: "Convenio de pago",
	entrega_voluntaria: "Entrega voluntaria",
	sin_contacto: "Sin contacto",
};

export const RESULTADO_VISITA_DESCRIPCION: Record<ResultadoVisita, string> = {
	pago: "El cliente pagó la totalidad de lo vencido (cuotas vencidas y mora).",
	promesa: "El cliente se compromete a pagar en una fecha determinada.",
	pago_parcial_promesa:
		"El cliente pagó un porcentaje de lo vencido y se compromete a pagar el resto.",
	convenio:
		"El cliente acepta un convenio de pago. Al guardar se abre el formulario del convenio.",
	entrega_voluntaria:
		"El cliente entrega la unidad. Al guardar se abre el formulario de entrega voluntaria.",
	sin_contacto: "No fue posible hablar con el cliente.",
};

/** Catálogo provisional: text validado acá, no enum, para cambiarlo sin migración. */
export const MOTIVOS_SIN_CONTACTO = {
	no_estaba: "No estaba",
	ya_no_vive_o_trabaja: "Ya no vive o trabaja ahí",
	direccion_no_existe: "La dirección no existe o no se encontró",
	no_atendieron: "No abrieron o no dejaron pasar",
	otro: "Otro",
} as const;
export type MotivoSinContacto = keyof typeof MOTIVOS_SIN_CONTACTO;
const CLAVES_MOTIVO_SIN_CONTACTO = Object.keys(MOTIVOS_SIN_CONTACTO) as [
	MotivoSinContacto,
	...MotivoSinContacto[],
];

export function etiquetaMotivoSinContacto(clave: string | null): string | null {
	if (!clave) return null;
	return (MOTIVOS_SIN_CONTACTO as Record<string, string>)[clave] ?? clave;
}

/**
 * El `estado_contacto` de la gestión que deja la visita. La promesa NO se
 * marca `promesa_pago` acá: esa fila la crea el modal de promesa, con su rango
 * de cuotas y su fecha (lo único que la hace verificable).
 */
export function estadoContactoDeResultado(
	resultado: ResultadoVisita,
): "contactado" | "acuerdo_parcial" | "no_contesta" {
	switch (resultado) {
		case "pago_parcial_promesa":
			return "acuerdo_parcial";
		case "sin_contacto":
			return "no_contesta";
		default:
			return "contactado";
	}
}

/** Qué flujo existente sigue después de guardar la visita. */
export function siguientesPasos(resultado: ResultadoVisita): {
	pago: boolean;
	promesa: boolean;
	convenio: boolean;
	entrega: boolean;
} {
	return {
		pago: resultado === "pago" || resultado === "pago_parcial_promesa",
		promesa: resultado === "promesa" || resultado === "pago_parcial_promesa",
		convenio: resultado === "convenio",
		entrega: resultado === "entrega_voluntaria",
	};
}

// ── Pago total y pago parcial + promesa ─────────────────────────────────────

/**
 * La base del pago es la deuda vencida: cuotas vencidas × cuota + mora
 * (decisión del 2026-09-29; la misma regla Mora+Cuota del modal de promesa y
 * de la foto del saldo de CB-042). Desde el 2026-10-01 el monto no se teclea:
 * «Pago total» es el 100% de lo vencido, y en «Pago parcial + promesa» el
 * asesor pone el PORCENTAJE que pagó (antes era un 50% fijo) y el resto va a
 * la promesa.
 */
export const PORCENTAJE_PAGO_PARCIAL_MIN = 1;
export const PORCENTAJE_PAGO_PARCIAL_MAX = 99;

export function deudaVencida(params: {
	cuotasVencidas: unknown;
	cuota: unknown;
	mora: unknown;
}): number {
	const n = (v: unknown) => {
		const x = Number(v);
		return Number.isFinite(x) && x > 0 ? x : 0;
	};
	const cuotas = Math.trunc(n(params.cuotasVencidas));
	return Math.round((cuotas * n(params.cuota) + n(params.mora)) * 100) / 100;
}

/** Lo que pagó quien pagó `porcentaje` de la deuda vencida. */
export function montoPagoParcial(deuda: number, porcentaje: number): number {
	return Math.round(deuda * porcentaje) / 100;
}

// ── Formularios ─────────────────────────────────────────────────────────────

const textoOpcional = (max: number) =>
	z
		.string()
		.trim()
		.max(max)
		.optional()
		.transform((v) => (v ? v : undefined));

/** Largo mínimo de los comentarios de una visita registrada. */
export const MIN_COMENTARIOS_VISITA = 10;

/** Fotos por visita. Suficiente para fachada, número de casa y alrededores. */
export const MAX_EVIDENCIAS_VISITA = 5;

/** Solo imágenes: la evidencia se ve en la ficha, sin descargar nada. */
export const MIME_EVIDENCIA_VISITA = [
	"image/jpeg",
	"image/png",
	"image/webp",
] as const;

export const evidenciaVisitaSchema = z.object({
	key: z.string().min(1).max(500),
	nombreArchivo: z.string().trim().min(1).max(255),
});

export const ubicacionVisitaSchema = z.object({
	lat: z.number().min(-90).max(90),
	lng: z.number().min(-180).max(180),
	precisionM: z.number().int().min(0).max(100_000).optional(),
});

const baseVisita = {
	casoCobroId: z.string().uuid(),
	tipo: z.enum(TIPOS_VISITA),
	direccion: z
		.string()
		.trim()
		.min(5, "Falta la dirección de la visita")
		.max(500),
	referencia: textoOpcional(500),
	empresa: textoOpcional(200),
	responsableId: z
		.string()
		.min(1, "Falta el responsable de la visita")
		.max(100),
};

export const programarVisitaSchema = z.object({
	...baseVisita,
	fechaProgramada: z.coerce.date(),
	notas: textoOpcional(1000),
});
export type ProgramarVisita = z.infer<typeof programarVisitaSchema>;

export const registrarVisitaSchema = z.object({
	...baseVisita,
	/** Si viene, se completa esa visita programada en vez de crear otra. */
	visitaId: z.string().uuid().optional(),
	fechaVisita: z.coerce.date(),
	resultado: z.enum(RESULTADOS_VISITA),
	motivoSinContacto: z.enum(CLAVES_MOTIVO_SIN_CONTACTO).optional(),
	montoRecibido: z.number().positive().max(10_000_000).optional(),
	/** Solo en «Pago parcial + promesa»: qué porcentaje de lo vencido pagó. */
	porcentajePagado: z
		.number()
		.int()
		.min(PORCENTAJE_PAGO_PARCIAL_MIN)
		.max(PORCENTAJE_PAGO_PARCIAL_MAX)
		.optional(),
	// Obligatorio desde el 2026-10-01 (pedido del PM): el resultado solo no
	// dice con quién se habló ni qué se acordó.
	comentarios: z
		.string()
		.trim()
		.min(
			MIN_COMENTARIOS_VISITA,
			`Los comentarios deben tener al menos ${MIN_COMENTARIOS_VISITA} caracteres`,
		)
		.max(3000),
	proximoPaso: textoOpcional(1000),
	ubicacion: ubicacionVisitaSchema.optional(),
	evidencias: z
		.array(evidenciaVisitaSchema)
		.max(
			MAX_EVIDENCIAS_VISITA,
			`Hasta ${MAX_EVIDENCIAS_VISITA} fotos por visita`,
		)
		.default([]),
});
export type RegistrarVisita = z.infer<typeof registrarVisitaSchema>;
export type RegistrarVisitaInput = z.input<typeof registrarVisitaSchema>;

/** Unos minutos de gracia por relojes desfasados entre el navegador y el servidor. */
const TOLERANCIA_RELOJ_MS = 10 * 60_000;
const DIA_MS = 86_400_000;
/** Una visita se registra el mismo día o poco después, no un mes más tarde. */
export const DIAS_MAXIMOS_REGISTRO_TARDIO = 30;
export const DIAS_MAXIMOS_PROGRAMACION = 60;

/**
 * Reglas que zod por sí solo no ve. Devuelve el primer problema en texto para
 * el asesor, o null si el formulario está completo.
 */
export function erroresRegistroVisita(
	v: RegistrarVisita,
	ahora: Date = new Date(),
): string | null {
	const t = v.fechaVisita.getTime();
	if (Number.isNaN(t)) return "Falta la fecha de la visita.";
	if (t > ahora.getTime() + TOLERANCIA_RELOJ_MS) {
		return "La fecha de la visita no puede ser futura.";
	}
	if (t < ahora.getTime() - DIAS_MAXIMOS_REGISTRO_TARDIO * DIA_MS) {
		return `La visita tiene más de ${DIAS_MAXIMOS_REGISTRO_TARDIO} días. Verifique la fecha.`;
	}

	if (v.resultado === "sin_contacto") {
		if (!v.motivoSinContacto) {
			return "Seleccione el motivo por el que no hubo contacto.";
		}
	} else if (v.motivoSinContacto) {
		return "El motivo de «Sin contacto» no aplica a este resultado.";
	}
	const pago = siguientesPasos(v.resultado).pago;
	if (pago && v.montoRecibido === undefined) {
		return "Falta el monto que pagó el cliente.";
	}
	if (!pago && v.montoRecibido !== undefined) {
		return "El monto pagado solo aplica a «Pago total» o «Pago parcial + promesa».";
	}
	if (v.resultado === "pago_parcial_promesa") {
		if (v.porcentajePagado === undefined) {
			return "Indique qué porcentaje de lo vencido pagó el cliente.";
		}
	} else if (v.porcentajePagado !== undefined) {
		return "El porcentaje pagado solo aplica a «Pago parcial + promesa».";
	}

	const keys = v.evidencias.map((e) => e.key);
	if (new Set(keys).size !== keys.length) return "Hay fotos repetidas.";
	return null;
}

export function erroresProgramacionVisita(
	v: ProgramarVisita,
	ahora: Date = new Date(),
): string | null {
	const t = v.fechaProgramada.getTime();
	if (Number.isNaN(t)) return "Falta la fecha de la visita.";
	if (t < ahora.getTime() - TOLERANCIA_RELOJ_MS) {
		return "La fecha de la visita ya pasó. Si la visita ya se realizó, registre el resultado.";
	}
	if (t > ahora.getTime() + DIAS_MAXIMOS_PROGRAMACION * DIA_MS) {
		return `No se puede programar a más de ${DIAS_MAXIMOS_PROGRAMACION} días.`;
	}
	return null;
}

// ── Textos ──────────────────────────────────────────────────────────────────

const quetzales = (n: number) =>
	`Q${n.toLocaleString("es-GT", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`;

/**
 * El comentario de la gestión en `contactos_cobros`. El historial de
 * contactos lo muestra tal cual, así que tiene que explicar la visita solo:
 * adónde se fue, qué pasó y lo que anotó el asesor.
 */
export function textoGestionVisita(
	v: Pick<
		RegistrarVisita,
		| "tipo"
		| "resultado"
		| "motivoSinContacto"
		| "direccion"
		| "montoRecibido"
		| "porcentajePagado"
		| "comentarios"
	>,
): string {
	const motivo =
		v.resultado === "sin_contacto" && v.motivoSinContacto
			? `: ${etiquetaMotivoSinContacto(v.motivoSinContacto)}`
			: "";
	const monto =
		v.montoRecibido === undefined
			? ""
			: v.porcentajePagado !== undefined
				? ` (pagó el ${v.porcentajePagado}% de lo vencido: ${quetzales(v.montoRecibido)})`
				: ` (pagó ${quetzales(v.montoRecibido)})`;
	const partes = [
		`${TIPO_VISITA_LABEL[v.tipo]} — ${RESULTADO_VISITA_LABEL[v.resultado]}${motivo}${monto}.`,
		`Dirección: ${v.direccion}.`,
		v.comentarios,
	];
	return partes.filter(Boolean).join(" ");
}

const formatoFechaAviso = new Intl.DateTimeFormat("es-GT", {
	timeZone: "America/Guatemala",
	weekday: "short",
	day: "2-digit",
	month: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
});

export function textoAvisoVisitaProgramada(params: {
	tipo: TipoVisita;
	cliente: string | null;
	numeroSifco: string | null;
	fechaProgramada: Date;
	direccion: string;
	programadaPor: string | null;
	/** true = aviso de la mañana del día; false = aviso al programarla. */
	esHoy: boolean;
	/**
	 * Aviso de la mañana redirigido: el responsable ya no lleva el crédito
	 * (cartera lo reasignó). Es su nombre, para decir de quién era la visita.
	 */
	reasignadaDe?: string | null;
}): { titulo: string; descripcion: string } {
	const quien = params.cliente?.trim()
		? `${params.cliente.trim()}${params.numeroSifco ? ` (${params.numeroSifco})` : ""}`
		: params.numeroSifco
			? `Crédito ${params.numeroSifco}`
			: "Un cliente";
	const tipo = TIPO_VISITA_LABEL[params.tipo].toLowerCase();
	const cuando = formatoFechaAviso.format(params.fechaProgramada);
	const por = params.programadaPor
		? ` La programó ${params.programadaPor}.`
		: "";
	if (params.esHoy && params.reasignadaDe !== undefined) {
		const deQuien = params.reasignadaDe ?? "otra persona";
		return {
			titulo: `Hoy hay una ${tipo} pendiente`,
			descripcion: `${quien}: ${cuando} en ${params.direccion}. La tenía ${deQuien}, que ya no lleva el crédito: decidí quién va o cancelala.`,
		};
	}
	return params.esHoy
		? {
				titulo: `Hoy tenés una ${tipo}`,
				descripcion: `${quien}: ${cuando} en ${params.direccion}.${por}`,
			}
		: {
				titulo: `Te programaron una ${tipo}`,
				descripcion: `${quien}: ${cuando} en ${params.direccion}.${por}`,
			};
}
