/**
 * CB-042 · Los dos envíos a recuperación de vehículo, y su formulario.
 *
 * Mandar un crédito a B4 por recuperación tiene dos orígenes muy distintos, y
 * al asesor de B4 le cambia todo saber cuál fue:
 *
 * | Tipo (`tipo_recuperacion`) | Qué pasó                                  | Qué se pide                     |
 * | -------------------------- | ----------------------------------------- | ------------------------------- |
 * | `tomado`                   | El asesor decide quitarle la unidad       | Motivos, dónde está, estado     |
 * | `entrega_voluntaria`       | El cliente la entrega por su cuenta       | + fecha, lugar, quién, documentos |
 *
 * Los dos terminan igual en cartera (B4 + `EN_RECUPERACION`); la diferencia
 * vive en el registro del CRM (`recuperaciones_vehiculo`), que es lo que ve el
 * asesor de B4 al abrir la ficha.
 *
 * Todo lo de acá es puro (sin DB ni red) para poder probarlo; el router y
 * `services/recuperacion-vehiculo.ts` hacen la parte con efectos.
 */

import { z } from "zod";

// ── Rangos de bucket ────────────────────────────────────────────────────────

/**
 * Rango de origen del TRASLADO a recuperación: B1 a B3 (plan 08). La misma
 * regla vive en tres lugares y tienen que coincidir: la ficha (deshabilita las
 * opciones), el CRM (la exige antes de "deshacer y mandar") y cartera
 * (`BUCKET_MINIMO/MAXIMO_RECUPERACION`, que manda bajo sus locks).
 */
export const BUCKET_MINIMO_RECUPERACION = 1;
export const BUCKET_MAXIMO_RECUPERACION = 3;

/**
 * La entrega voluntaria también se registra con el crédito YA en B4 (decisión
 * del 2026-09-28: un cliente de B4 también puede entregar la unidad). Ahí no
 * hay traslado —ya está donde lo pondría—, solo el formulario. Y la recepción
 * de la unidad se registra solo en B4.
 */
export const BUCKET_RECUPERACION = 4;

export const TIPOS_ENVIO_RECUPERACION = [
	"tomado",
	"entrega_voluntaria",
] as const;
export type TipoEnvioRecuperacion = (typeof TIPOS_ENVIO_RECUPERACION)[number];

export const TIPO_RECUPERACION_LABEL: Record<
	TipoEnvioRecuperacion | "orden_secuestro",
	string
> = {
	tomado: "Recuperación forzosa",
	entrega_voluntaria: "Entrega voluntaria",
	orden_secuestro: "Orden de secuestro",
};

/** Qué hace cada envío según el bucket de hoy: trasladar, solo registrar, o nada. */
export type OperacionRecuperacion = "trasladar" | "solo_registrar";

export function operacionRecuperacion(
	tipo: TipoEnvioRecuperacion,
	bucket: number | null,
): OperacionRecuperacion | null {
	if (bucket === null) return null;
	if (
		bucket >= BUCKET_MINIMO_RECUPERACION &&
		bucket <= BUCKET_MAXIMO_RECUPERACION
	) {
		return "trasladar";
	}
	if (tipo === "entrega_voluntaria" && bucket === BUCKET_RECUPERACION) {
		return "solo_registrar";
	}
	return null;
}

/** Por qué un envío no aplica en este bucket (null = sí aplica). Texto para el asesor. */
export function motivoBloqueoRecuperacion(
	tipo: TipoEnvioRecuperacion,
	bucket: number | null,
	prefijo?: string | null,
): string | null {
	if (bucket === null) {
		return "El crédito no tiene bucket: no se puede registrar la recuperación.";
	}
	if (operacionRecuperacion(tipo, bucket)) return null;
	const donde = prefijo ?? `B${bucket}`;
	return tipo === "entrega_voluntaria"
		? `Disponible de B${BUCKET_MINIMO_RECUPERACION} a B${BUCKET_RECUPERACION}. Este caso está en ${donde}.`
		: `Disponible de B${BUCKET_MINIMO_RECUPERACION} a B${BUCKET_MAXIMO_RECUPERACION}. Este caso está en ${donde}.`;
}

// ── Catálogos ───────────────────────────────────────────────────────────────
// Provisionales: van en text validado acá, no en enum de Postgres, para poder
// recortarlos sin migración. Una llave que deje de existir se sigue mostrando
// (el card cae al texto crudo), no rompe los registros viejos.

export const MOTIVOS_RECUPERACION_FORZOSA = {
	atrasos_constantes: "Se atrasa constantemente",
	promesas_incumplidas: "Incumple sus promesas de pago",
	convenio_incumplido: "Incumplió el convenio",
	ilocalizable: "No contesta o no se le localiza",
	se_niega_a_pagar: "Se niega a pagar",
	riesgo_ocultamiento: "Puede vender u ocultar el vehículo",
	gps_desconectado: "GPS desconectado o manipulado",
	inmovilizada_sin_pago: "Se inmovilizó la unidad y no pagó",
	otro: "Otro",
} as const;

export const MOTIVOS_ENTREGA_VOLUNTARIA = {
	no_puede_pagar: "Ya no puede pagar",
	bajaron_ingresos: "Perdió el empleo o bajaron sus ingresos",
	no_necesita_vehiculo: "Ya no necesita el vehículo",
	problemas_vehiculo: "Problemas con el vehículo",
	otro: "Otro",
} as const;

export function motivosDelTipo(
	tipo: TipoEnvioRecuperacion,
): Record<string, string> {
	return tipo === "entrega_voluntaria"
		? MOTIVOS_ENTREGA_VOLUNTARIA
		: MOTIVOS_RECUPERACION_FORZOSA;
}

/** Etiqueta de un motivo, sin importar el tipo (para leer registros). */
export function etiquetaMotivo(clave: string): string {
	return (
		(MOTIVOS_RECUPERACION_FORZOSA as Record<string, string>)[clave] ??
		(MOTIVOS_ENTREGA_VOLUNTARIA as Record<string, string>)[clave] ??
		clave
	);
}

export const ESTADOS_VEHICULO = {
	bueno: "Buen estado",
	regular: "Regular, detalles menores",
	malo: "Mal estado, con daños",
	no_arranca: "No arranca",
} as const;
export type EstadoVehiculo = keyof typeof ESTADOS_VEHICULO;
const CLAVES_ESTADO_VEHICULO = Object.keys(ESTADOS_VEHICULO) as [
	EstadoVehiculo,
	...EstadoVehiculo[],
];

export const DOCUMENTOS_VEHICULO = {
	llaves: "Llaves",
	llave_duplicada: "Duplicado de llaves",
	tarjeta_circulacion: "Tarjeta de circulación",
	titulo_propiedad: "Título de propiedad",
	poliza_seguro: "Póliza de seguro",
} as const;
export type DocumentoVehiculo = keyof typeof DOCUMENTOS_VEHICULO;
const CLAVES_DOCUMENTO = Object.keys(DOCUMENTOS_VEHICULO) as [
	DocumentoVehiculo,
	...DocumentoVehiculo[],
];

// ── Formulario ──────────────────────────────────────────────────────────────

const textoOpcional = (max: number) =>
	z
		.string()
		.trim()
		.max(max)
		.optional()
		.transform((v) => (v ? v : undefined));

// Solo http(s): el enlace se abre desde la ficha, y un `javascript:` ahí sería
// un XSS con un clic (mismo criterio que los hallazgos de CB-036).
const enlaceSeguro = textoOpcional(1000).refine(
	(v) => v === undefined || /^https?:\/\//i.test(v),
	"El enlace tiene que empezar con http:// o https://",
);

export const ubicacionRecuperacionSchema = z
	.object({
		direccion: textoOpcional(500),
		enlace: enlaceSeguro,
		lat: z.number().min(-90).max(90).optional(),
		lng: z.number().min(-180).max(180).optional(),
		fuente: z.enum(["manual", "gps"]).default("manual"),
		gpsUnidad: textoOpcional(200),
		gpsSenalAt: z.coerce.date().nullable().optional(),
	})
	.refine((u) => (u.lat === undefined) === (u.lng === undefined), {
		message: "Faltan las coordenadas completas (latitud y longitud).",
	});

export const entregaVoluntariaSchema = z.object({
	fecha: z.coerce.date(),
	lugar: z.string().trim().min(3, "Falta el lugar de la entrega").max(500),
	persona: textoOpcional(200),
	relacion: textoOpcional(100),
	documentos: z
		.array(z.enum(CLAVES_DOCUMENTO))
		.max(CLAVES_DOCUMENTO.length)
		.default([]),
	documentosOtros: textoOpcional(500),
});

export const detalleRecuperacionSchema = z.object({
	motivos: z
		.array(z.string().min(1).max(60))
		.min(1, "Elegí al menos un motivo")
		.max(12),
	// Opcional: los motivos marcados ya dicen el porqué. Solo se exige si se
	// marcó "Otro" (ver erroresDetalleRecuperacion), que sin texto no dice nada.
	motivoDetalle: textoOpcional(2000),
	ubicacion: ubicacionRecuperacionSchema.optional(),
	estadoVehiculo: z.enum(CLAVES_ESTADO_VEHICULO).optional(),
	estadoVehiculoDetalle: textoOpcional(1000),
	kilometraje: z.number().int().min(0).max(5_000_000).optional(),
	entrega: entregaVoluntariaSchema.optional(),
	observaciones: textoOpcional(2000),
});
export type DetalleRecuperacion = z.infer<typeof detalleRecuperacionSchema>;
export type DetalleRecuperacionInput = z.input<
	typeof detalleRecuperacionSchema
>;

/** Ventana válida de la fecha de entrega: acordada (futuro cercano) o ya hecha. */
const DIAS_ENTREGA_FUTURO = 90;
const DIAS_ENTREGA_PASADO = 365;

/**
 * Reglas que dependen del tipo y que zod por sí solo no ve. Devuelve el primer
 * problema en texto para el asesor, o null si el formulario está completo.
 */
export function erroresDetalleRecuperacion(
	tipo: TipoEnvioRecuperacion,
	detalle: DetalleRecuperacion,
	ahora: Date = new Date(),
): string | null {
	const catalogo = motivosDelTipo(tipo);
	const invalido = detalle.motivos.find((m) => !(m in catalogo));
	if (invalido)
		return `Motivo no válido para ${TIPO_RECUPERACION_LABEL[tipo].toLowerCase()}: ${invalido}`;
	if (new Set(detalle.motivos).size !== detalle.motivos.length) {
		return "Hay motivos repetidos.";
	}
	if (detalle.motivos.includes("otro") && !detalle.motivoDetalle) {
		return "Marcaste «Otro»: contá en el detalle cuál es el motivo.";
	}

	if (tipo === "tomado") {
		if (detalle.entrega) {
			return "Los datos de entrega son solo para la entrega voluntaria.";
		}
		return null;
	}

	// Entrega voluntaria: la historia pide fecha, lugar, estado y documentos.
	if (!detalle.entrega)
		return "Faltan los datos de la entrega (fecha y lugar).";
	if (!detalle.estadoVehiculo) return "Falta el estado del vehículo.";
	const dias = (detalle.entrega.fecha.getTime() - ahora.getTime()) / 86_400_000;
	if (dias > DIAS_ENTREGA_FUTURO) {
		return `La fecha de entrega no puede pasar de ${DIAS_ENTREGA_FUTURO} días adelante.`;
	}
	if (dias < -DIAS_ENTREGA_PASADO) {
		return "La fecha de entrega es de hace más de un año: revisala.";
	}
	return null;
}

/** El formulario completo, validado. Para usar dentro de un `superRefine`. */
export function validarDetalleRecuperacion(
	tipo: TipoEnvioRecuperacion,
	detalle: DetalleRecuperacion,
	ctx: z.RefinementCtx,
): void {
	const error = erroresDetalleRecuperacion(tipo, detalle);
	if (error)
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			message: error,
			path: ["detalle"],
		});
}

// ── Recepción de la unidad ──────────────────────────────────────────────────

/**
 * Lo que registra el asesor de B4 cuando la unidad ya está en manos de Club
 * Cash-In. Se guarda aparte de lo reportado al enviar (`recepcion_*`): el
 * estado y los documentos que el cliente dijo que iba a entregar pueden no ser
 * los que llegaron, y esa diferencia es justo lo que interesa ver.
 */
export const recepcionUnidadSchema = z.object({
	fechaRecepcion: z.coerce.date(),
	lugar: z.string().trim().min(3, "Falta dónde se recibió la unidad").max(500),
	estadoVehiculo: z.enum(CLAVES_ESTADO_VEHICULO),
	estadoVehiculoDetalle: textoOpcional(1000),
	kilometraje: z.number().int().min(0).max(5_000_000).optional(),
	documentos: z
		.array(z.enum(CLAVES_DOCUMENTO))
		.max(CLAVES_DOCUMENTO.length)
		.default([]),
	documentosOtros: textoOpcional(500),
	notas: textoOpcional(2000),
});
export type RecepcionUnidad = z.infer<typeof recepcionUnidadSchema>;

/** Unos minutos de gracia por relojes desfasados entre el navegador y el servidor. */
const TOLERANCIA_RELOJ_MS = 10 * 60_000;

export function erroresRecepcionUnidad(
	recepcion: RecepcionUnidad,
	ahora: Date = new Date(),
): string | null {
	const t = recepcion.fechaRecepcion.getTime();
	if (t > ahora.getTime() + TOLERANCIA_RELOJ_MS) {
		return "La recepción es algo que ya pasó: la fecha no puede ser futura.";
	}
	if (t < ahora.getTime() - DIAS_ENTREGA_PASADO * 86_400_000) {
		return "La fecha de recepción es de hace más de un año: revisala.";
	}
	return null;
}

// ── Lo que llega a cartera ──────────────────────────────────────────────────

const MAX_MOTIVO_CARTERA = 500;

/**
 * El motivo que se guarda en `buckets_historial` de cartera. Lleva el tipo al
 * principio para que la bitácora de buckets distinga los dos envíos sin tener
 * que cruzar con el CRM.
 */
export function textoMotivoCartera(
	tipo: TipoEnvioRecuperacion,
	detalle: Pick<DetalleRecuperacion, "motivos" | "motivoDetalle">,
): string {
	const motivos = detalle.motivos
		.filter((m) => m !== "otro")
		.map(etiquetaMotivo)
		.join(", ");
	const cuerpo = [motivos, detalle.motivoDetalle?.trim()]
		.filter(Boolean)
		.join(". ");
	const texto = `${TIPO_RECUPERACION_LABEL[tipo]}: ${cuerpo}`;
	return texto.length > MAX_MOTIVO_CARTERA
		? `${texto.slice(0, MAX_MOTIVO_CARTERA - 1)}…`
		: texto;
}

// ── Foto del saldo ──────────────────────────────────────────────────────────

export type FotoSaldo = {
	saldoPendiente: number;
	cuotasVencidas: number;
	montoVencido: number;
	montoMora: number;
	totalParaPonerseAlDia: number;
};

const redondear = (n: number) => Math.round(n * 100) / 100;
const numero = (v: unknown) => {
	const n = Number(v);
	return Number.isFinite(n) ? n : 0;
};

/**
 * Saldo del crédito al registrar, con las MISMAS definiciones que ya usa la
 * ficha: "saldo pendiente" = `deudatotal` de cartera, y lo vencido = cuotas
 * vencidas × cuota + mora (la regla Mora+Cuota del modal de promesa). Cartera
 * calcula; esto solo arma la foto con lo que cartera devolvió.
 */
export function calcularFotoSaldo(params: {
	deudaTotal: unknown;
	cuota: unknown;
	cuotasVencidas: unknown;
	mora: unknown;
}): FotoSaldo {
	const cuotasVencidas = Math.max(0, Math.trunc(numero(params.cuotasVencidas)));
	const montoVencido = redondear(cuotasVencidas * numero(params.cuota));
	const montoMora = redondear(numero(params.mora));
	return {
		saldoPendiente: redondear(numero(params.deudaTotal)),
		cuotasVencidas,
		montoVencido,
		montoMora,
		totalParaPonerseAlDia: redondear(montoVencido + montoMora),
	};
}

// ── Aviso al asesor de B4 y a los supervisores ──────────────────────────────

const formatoFecha = new Intl.DateTimeFormat("es-GT", {
	timeZone: "America/Guatemala",
	weekday: "short",
	day: "2-digit",
	month: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
});

export function textoAvisoRecuperacion(params: {
	tipo: TipoEnvioRecuperacion;
	trasladado: boolean;
	cliente: string | null;
	numeroSifco: string;
	registradoPor: string | null;
	detalle: Pick<DetalleRecuperacion, "motivos" | "motivoDetalle" | "entrega">;
}): { titulo: string; descripcion: string } {
	const quien = params.cliente?.trim()
		? `${params.cliente.trim()} (${params.numeroSifco})`
		: `Crédito ${params.numeroSifco}`;
	const por = params.registradoPor
		? ` Lo registró ${params.registradoPor}.`
		: "";

	if (params.tipo === "entrega_voluntaria") {
		const e = params.detalle.entrega;
		const cuando = e ? ` el ${formatoFecha.format(e.fecha)} en ${e.lugar}` : "";
		return {
			titulo: params.trasladado
				? "Entrega voluntaria: llegó a recuperación"
				: "Entrega voluntaria registrada",
			descripcion: `${quien} entrega la unidad${cuando}.${por}`,
		};
	}

	const motivos = params.detalle.motivos
		.filter((m) => m !== "otro")
		.map(etiquetaMotivo)
		.join(", ");
	return {
		titulo: "Crédito enviado a recuperación de vehículo",
		descripcion: `${quien}: ${motivos || params.detalle.motivoDetalle || "sin motivo indicado"}.${por}`,
	};
}
