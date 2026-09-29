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
 *  · 50% + promesa     → las dos cosas: el pago recibido y la promesa por el resto;
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
 * Las visitas se programan y registran en B3 y B4 (decisión del 2026-09-29: el
 * ticket es de B3 · Rescate, y en B4 también se sale a buscar al cliente).
 * Registrar el resultado de una visita YA programada no mira el bucket: la
 * visita ocurrió aunque el crédito se haya movido después.
 */
export const BUCKET_MINIMO_VISITA = 3;
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
		? `Disponible en B${BUCKET_MINIMO_VISITA} y B${BUCKET_MAXIMO_VISITA}. Este caso está en ${donde}.`
		: `Disponible en B${BUCKET_MINIMO_VISITA} y B${BUCKET_MAXIMO_VISITA}. El crédito no tiene bucket.`;
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

export const RESULTADOS_VISITA = [
	"pago",
	"promesa",
	"pago_parcial_promesa",
	"entrega_voluntaria",
	"sin_contacto",
] as const;
export type ResultadoVisita = (typeof RESULTADOS_VISITA)[number];

export const RESULTADO_VISITA_LABEL: Record<ResultadoVisita, string> = {
	pago: "Pago",
	promesa: "Promesa de pago",
	pago_parcial_promesa: "50% + promesa",
	entrega_voluntaria: "Entrega voluntaria",
	sin_contacto: "Sin contacto",
};

export const RESULTADO_VISITA_DESCRIPCION: Record<ResultadoVisita, string> = {
	pago: "Pagó lo vencido. El pago se registra con link o boleta.",
	promesa: "Se compromete a pagar en una fecha. Se registra la promesa.",
	pago_parcial_promesa:
		"Paga la mitad de lo vencido ahora y promete el resto en una fecha.",
	entrega_voluntaria:
		"Entrega la unidad. Sigue el formulario de entrega voluntaria.",
	sin_contacto: "No se habló con el cliente.",
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
	entrega: boolean;
} {
	return {
		pago: resultado === "pago" || resultado === "pago_parcial_promesa",
		promesa: resultado === "promesa" || resultado === "pago_parcial_promesa",
		entrega: resultado === "entrega_voluntaria",
	};
}

// ── 50% + promesa ───────────────────────────────────────────────────────────

/**
 * La base del 50% es la deuda vencida: cuotas vencidas × cuota + mora
 * (decisión del 2026-09-29; la misma regla Mora+Cuota del modal de promesa y
 * de la foto del saldo de CB-042). Es una REFERENCIA para el asesor: no
 * bloquea si el cliente paga otro monto.
 */
export const PORCENTAJE_PAGO_PARCIAL = 0.5;

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

export function montoReferenciaPagoParcial(deuda: number): number {
	return Math.round(deuda * PORCENTAJE_PAGO_PARCIAL * 100) / 100;
}

// ── Formularios ─────────────────────────────────────────────────────────────

const textoOpcional = (max: number) =>
	z
		.string()
		.trim()
		.max(max)
		.optional()
		.transform((v) => (v ? v : undefined));

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
	responsableId: z.string().min(1, "Falta quién va a la visita").max(100),
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
	// Opcional: el resultado y el motivo ya dicen qué pasó. Solo se exige si el
	// motivo es "Otro" (ver erroresRegistroVisita), que sin texto no dice nada.
	comentarios: textoOpcional(3000),
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
		return "La visita es algo que ya pasó: la fecha no puede ser futura.";
	}
	if (t < ahora.getTime() - DIAS_MAXIMOS_REGISTRO_TARDIO * DIA_MS) {
		return `La visita es de hace más de ${DIAS_MAXIMOS_REGISTRO_TARDIO} días: revisá la fecha.`;
	}

	if (v.resultado === "sin_contacto") {
		if (!v.motivoSinContacto) return "Elegí por qué no hubo contacto.";
		if (v.motivoSinContacto === "otro" && !v.comentarios) {
			return "Marcaste «Otro»: contá en los comentarios qué pasó.";
		}
	} else if (v.motivoSinContacto) {
		return "El motivo de «sin contacto» no aplica a este resultado.";
	}
	if (v.montoRecibido !== undefined && !siguientesPasos(v.resultado).pago) {
		return "El monto recibido es solo para «Pago» o «50% + promesa».";
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
		return "La fecha de la visita ya pasó. Si ya fuiste, registrá el resultado.";
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
		| "comentarios"
	>,
): string {
	const motivo =
		v.resultado === "sin_contacto" && v.motivoSinContacto
			? `: ${etiquetaMotivoSinContacto(v.motivoSinContacto)}`
			: "";
	const monto =
		v.montoRecibido !== undefined
			? ` (recibió ${quetzales(v.montoRecibido)})`
			: "";
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
