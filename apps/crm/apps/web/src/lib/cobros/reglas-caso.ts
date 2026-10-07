/**
 * Reglas y derivados de un caso de cobros, sin React.
 *
 * Antes vivían inline en `routes/cobros/$id.tsx` (la Ficha 360). El Workspace
 * de cobros (panel de contexto y panel de gestión) necesita las MISMAS
 * decisiones —qué promesa está activa, si se puede proponer un convenio, si se
 * puede pedir la recuperación del vehículo, qué variables lleva una
 * plantilla…—, así que se movieron acá para que las dos pantallas digan lo
 * mismo. Todas son funciones puras: reciben datos ya cargados y devuelven el
 * resultado; las queries las hace quien llama.
 *
 * Las reglas de bucket viven en las librerías compartidas con el servidor
 * (`server/src/lib/visitas-cobros`, `recuperacion-vehiculo`,
 * `investigaciones-redes-cobros`); acá solo se les agrega lo que depende de la
 * pantalla (permiso del usuario, query en vuelo, caso sin crédito de cartera).
 */
import {
	investigacionPermitidaEnBucket,
	motivoBloqueoInvestigacion,
} from "server/src/lib/investigaciones-redes-cobros";
import { esRecuperacionEfectiva } from "server/src/lib/recuperacion-solicitud";
import {
	motivoBloqueoRecuperacion,
	type OperacionRecuperacion,
	operacionRecuperacion,
	type TipoEnvioRecuperacion,
} from "server/src/lib/recuperacion-vehiculo";
import {
	deudaVencida,
	motivoBloqueoVisita,
} from "server/src/lib/visitas-cobros";
import {
	type BucketsCatalogoQueryData,
	type BucketUI,
	bucketDeNumero,
	catalogoDeNumero,
	esBucketDesdeB2,
} from "@/lib/cobros/buckets-catalogo";
import {
	type CuotaConvenio,
	cuotasElegiblesParaConvenio,
	type FilaHistorialCuota,
} from "@/lib/cobros/convenio-cuotas";
import {
	debeAnunciarCrecimientoMora,
	hayIncrementoMora,
} from "@/lib/cobros/plantillas-mensajes";
import {
	type EstadoPromesaUI,
	inicioDelDiaGT,
} from "@/lib/cobros/promesa-activa";
import {
	BUCKETS_CON_CARD_INMOVILIZACION,
	debeMostrarCardInmovilizacion,
} from "@/lib/inmovilizacion-card-gate";
import { motivoSinSolicitud } from "@/lib/inmovilizacion-siguiente-paso";
import { PERMISSIONS } from "@/lib/roles";

/* ── Tipos de entrada ───────────────────────────────────────────────────────── */

/**
 * Forma real de `getDetallesCreditoCarteraBack` (ver routers/cobros.ts). El
 * cliente ORPC infiere `{}` para esta query — sin este tipo, cada `caso.campo`
 * de la ficha era un error de tsc (≈290 en este archivo). Mantener alineado con
 * el select del endpoint.
 */
export interface CasoDetalle {
	id?: string | null;
	carteraCreditoId?: number | null;
	contratoId?: string | null;
	estadoMora?: string | null;
	montoEnMora?: string | number | null;
	diasMoraMaximo?: number | null;
	cuotasVencidas?: number | null;
	/** Mora ya pagada / condonada de las cuotas en atraso (ledger de mora). */
	moraPagada?: string | null;
	moraCondonada?: string | null;
	/** Saldo real de las cuotas vencidas + mora, ya formateado por el server. */
	montoAdeudado?: string | null;
	/** Mora proporcional (ver VariablesPlantilla en plantillas-mensajes). */
	expectativaMora?: string | null;
	expectativaMoraDiaria?: string | null;
	incrementoDiarioMora?: string | null;
	incrementoMaximoMensualMora?: string | null;
	aseguradora?: string | null;
	cabinaSeguro?: string | null;
	cuotaConvenio?: string | number | null;
	convenioActivo?: {
		convenioId?: string | number | null;
		montoTotalConvenio?: string | number | null;
		cuotaMensual?: string | number | null;
		numeroMeses?: number | null;
		montoPagado?: string | number | null;
		montoPendiente?: string | number | null;
		pagosRealizados?: number | null;
		pagosPendientes?: number | null;
		activo?: boolean | null;
		completado?: boolean | null;
		fechaConvenio?: string | null;
		motivo?: string | null;
		observaciones?: string | null;
	} | null;
	convenioCuotas?: Array<{
		numeroCuota: number;
		fechaVencimiento: string | null;
		fechaPago: string | null;
	}> | null;
	telefonoPrincipal?: string | null;
	telefonoAlternativo?: string | null;
	emailContacto?: string | null;
	direccionContacto?: string | null;
	proximoContacto?: string | null;
	metodoContactoProximo?: string | null;
	etiquetas?: string[] | null;
	montoFinanciado?: string | number | null;
	cuotaMensual?: string | number | null;
	cuotaMensualHistorica?: string | number | null;
	numeroCuotas?: number | null;
	fechaInicio?: string | null;
	diaPagoMensual?: number | null;
	estadoContrato?: string | null;
	/** statusCredit crudo de cartera (ACTIVO, MOROSO, EN_CONVENIO, …). */
	statusCredit?: string | null;
	clienteNombre?: string | null;
	clienteNit?: string | null;
	vehicleId?: string | null;
	vehiculoMarca?: string | null;
	vehiculoModelo?: string | null;
	vehiculoYear?: number | null;
	vehiculoPlaca?: string | null;
	vehiculoTipo?: string | null;
	vehiculoMotor?: string | null;
	vehiculoChasis?: string | null;
	vehiculoAsientos?: number | null;
	vehiculoUso?: string | null;
	vehiculoNumeroPoliza?: string | null;
	vehiculoFechaInicioSeguro?: string | null;
	vehiculoFechaVencimientoSeguro?: string | null;
	vehiculoMontoAsegurado?: string | number | null;
	numeroCreditoSifco?: string | null;
	deudaTotal?: string | number | null;
	asesor?: {
		asesor_id?: number | null;
		nombre?: string | null;
		telefono?: string | null;
		activo?: boolean | null;
		emailCashIn?: string | null;
	} | null;
	oportunidadNotes?: string | null;
	creditType?: string | null;
	fechaInicioCuota0?: string | null;
	cuotasRestantes?: number | null;
}

/** Una fila de `getHistorialContactos` (lo que leen estas reglas). */
export interface ContactoHistorialFila {
	id: string;
	estadoContacto?: string | null;
	estadoPromesa?: EstadoPromesaUI | null;
	fechaProximoContacto?: string | Date | null;
	fechaContacto?: string | Date | null;
	fechaAlerta?: string | Date | null;
	comentarios?: string | null;
	acuerdosAlcanzados?: string | null;
	cuotaInicio?: number | null;
	cuotaFin?: number | null;
	incluyeMora?: boolean | null;
	montoComprometido?: string | null;
	proximoPaso?: string | null;
	realizadoPor?: string | null;
}

/** Una cuota de `getHistorialPagos` (lo que leen estas reglas). */
export interface CuotaHistorialFila extends FilaHistorialCuota {
	fechaPago?: string | null;
	montoMora?: string | number | null;
	montoPagado?: string | number | null;
	diasMora?: number | null;
}

/* ── Formato ────────────────────────────────────────────────────────────────── */

/** "Q1,850.00" (mismo formato que la ficha). */
export function formatoQuetzales(v: string | number | null | undefined) {
	return `Q${Number(v ?? 0).toLocaleString("es-GT", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`;
}

/** Fecha corta en hora de Guatemala ("11/8/2026"), sin importar dónde esté el asesor. */
export function fechaCortaGT(date: Date): string {
	return date.toLocaleDateString("es-GT", { timeZone: "America/Guatemala" });
}

/**
 * Número de crédito para mostrar: los originados en el CRM traen
 * "CRM-<uuid>" y se acortan a "CRM-74e1985e" (como la fila de Mi Cartera).
 * Los SIFCO quedan igual.
 */
export function creditoCorto(numero: string): string {
	return numero.replace(/^(CRM-[0-9a-f]{8})-[0-9a-f-]{27}$/i, "$1");
}

/** Acorta cada "CRM-<uuid>" dentro de un texto ("… el caso CRM-b95db82d lleva …"). */
export function abreviarCreditosCrm(texto: string): string {
	return texto.replace(
		/\b(CRM-[0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
		"$1",
	);
}

/** Abreviaturas de mes de la ficha (date-fns `es`: «sep», no el «sept» de Intl). */
const MESES_CORTOS = [
	"ene",
	"feb",
	"mar",
	"abr",
	"may",
	"jun",
	"jul",
	"ago",
	"sep",
	"oct",
	"nov",
	"dic",
] as const;

/**
 * Fecha larga en hora de Guatemala («15 ago 2026»); "" si no hay fecha válida.
 *
 * Una fecha de solo día ("YYYY-MM-DD", como `fechaVencimiento` de cartera) es
 * un día calendario: se toma tal cual. Con `new Date("2026-08-15")` sería la
 * medianoche UTC, y en Guatemala (UTC-6) se mostraría el 14. Un timestamp se
 * pasa al día calendario de Guatemala, sin importar dónde esté el asesor.
 */
export function fechaLargaGT(valor: Date | string | null | undefined): string {
	if (!valor) return "";
	let ymd: string;
	if (typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor)) {
		ymd = valor;
	} else {
		const d = valor instanceof Date ? valor : new Date(valor);
		if (Number.isNaN(d.getTime())) return "";
		// en-CA da "YYYY-MM-DD".
		ymd = new Intl.DateTimeFormat("en-CA", {
			timeZone: "America/Guatemala",
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
		}).format(d);
	}
	const [anio, mes, dia] = ymd.split("-").map(Number);
	const nombreMes = MESES_CORTOS[(mes ?? 0) - 1];
	if (!anio || !dia || !nombreMes) return "";
	return `${dia} ${nombreMes} ${anio}`;
}

/* ── Bucket y mora ──────────────────────────────────────────────────────────── */

export type BucketDelCaso = {
	/** Bucket del MOTOR (cartera-back); null fuera del funnel o sin respuesta. */
	numero: number | null;
	/** "B2" (del motor, del catálogo o armado con el número). */
	prefijo: string | null;
	/** Label y color del catálogo dinámico; null sin bucket. */
	ui: BucketUI | null;
	/** Fila del catálogo dinámico, si la hay. */
	catalogo: ReturnType<typeof catalogoDeNumero>;
	/** Último bucket antes de salir del funnel (CB-027). */
	previo: number | null;
};

/**
 * El bucket que se muestra: siempre el del motor (pool de asesores y SLA
 * salen de ahí). Si el motor no respondió, todo queda en null y la pantalla
 * cae al `estadoMora` del caso; nunca se inventa un bucket.
 */
export function bucketDelCaso(
	motor:
		| {
				bucket?: number | null;
				prefijo?: string | null;
				bucket_previo?: number | null;
		  }
		| null
		| undefined,
	catalogo: BucketsCatalogoQueryData | undefined,
): BucketDelCaso {
	const numero = motor?.bucket ?? null;
	const fila = numero !== null ? catalogoDeNumero(numero, catalogo) : undefined;
	return {
		numero,
		prefijo:
			motor?.prefijo ||
			fila?.prefijo ||
			(numero !== null ? `B${numero}` : null),
		ui: numero !== null ? bucketDeNumero(numero, catalogo) : null,
		catalogo: fila,
		previo: motor?.bucket_previo ?? null,
	};
}

/** Días en mora que se muestran (0 si no hay atraso). */
export function diasMoraDelCaso(caso: Pick<CasoDetalle, "diasMoraMaximo">) {
	return caso.diasMoraMaximo && caso.diasMoraMaximo > 0
		? caso.diasMoraMaximo
		: 0;
}

/* ── Cobro de hoy ───────────────────────────────────────────────────────────── */

export type CobroDeHoy = {
	/** Cuotas vencidas del caso. */
	cuotasVencidas: number;
	/** Cuotas vencidas × cuota mensual. */
	montoCuotas: number;
	/** Mora acumulada. */
	mora: number;
	/** «Total a pagar hoy»: mora + cuotas vencidas × cuota. */
	totalMoraCuotas: number;
	/** «Total parcial»: cuota del convenio + cuota, o mora + cuota. */
	totalParcial: number;
	/** "Sube alrededor de Q… por día…" si la mora va a seguir creciendo. */
	avisoCrecimientoMora: string | null;
};

/** "Cobro de hoy" (mismas cuentas que el «Total a cobrar» de antes). */
export function cobroDeHoy(
	caso: Pick<
		CasoDetalle,
		| "montoEnMora"
		| "cuotasVencidas"
		| "cuotaMensual"
		| "cuotaConvenio"
		| "incrementoDiarioMora"
		| "incrementoMaximoMensualMora"
	>,
): CobroDeHoy {
	const montoCuotas =
		Number(caso.cuotasVencidas || 0) * Number(caso.cuotaMensual || 0);
	const totalMoraCuotas = Number(caso.montoEnMora || 0) + montoCuotas;
	const totalParcial =
		caso.cuotaConvenio != null
			? Number(caso.cuotaConvenio) + Number(caso.cuotaMensual || 0)
			: Number(caso.montoEnMora || 0) + Number(caso.cuotaMensual || 0);
	const avisoCrecimientoMora =
		caso.cuotaConvenio == null &&
		debeAnunciarCrecimientoMora({
			montoEnMora: caso.montoEnMora,
			incrementoDiarioMora: caso.incrementoDiarioMora,
			incrementoMaximoMensualMora: caso.incrementoMaximoMensualMora,
		})
			? `${
					hayIncrementoMora(caso.incrementoDiarioMora)
						? `Sube alrededor de Q${caso.incrementoDiarioMora} por día`
						: "Va a seguir subiendo"
				}${
					hayIncrementoMora(caso.incrementoMaximoMensualMora)
						? `, y puede aumentar hasta Q${caso.incrementoMaximoMensualMora} más en los próximos 30 días`
						: ""
				}.`
			: null;
	return {
		cuotasVencidas: Number(caso.cuotasVencidas || 0),
		montoCuotas,
		mora: Number(caso.montoEnMora || 0),
		totalMoraCuotas,
		totalParcial,
		avisoCrecimientoMora,
	};
}

/**
 * El incremento diario de la mora que se anuncia en la visita (y en las
 * plantillas): solo sin convenio y si la mora va a seguir creciendo.
 */
export function incrementoDiarioMoraAnunciable(
	caso: Pick<
		CasoDetalle,
		| "cuotaConvenio"
		| "montoEnMora"
		| "incrementoDiarioMora"
		| "incrementoMaximoMensualMora"
	>,
): string | null {
	return caso.cuotaConvenio == null &&
		debeAnunciarCrecimientoMora({
			montoEnMora: caso.montoEnMora,
			incrementoDiarioMora: caso.incrementoDiarioMora,
			incrementoMaximoMensualMora: caso.incrementoMaximoMensualMora,
		})
		? (caso.incrementoDiarioMora ?? null)
		: null;
}

/* ── Plan de cuotas ─────────────────────────────────────────────────────────── */

export type ResumenCuotas<T extends CuotaHistorialFila> = {
	/** Cuotas con estado de cuota "pagado" (sin la cuota 0). */
	pagadas: T[];
	/** La pagada de número más alto (para «Último mes pagado»). */
	ultimaPagada: T | undefined;
	/** La próxima cuota sin pagar que todavía no vence. */
	proxima: T | undefined;
	/** Cuotas del crédito (de la cabecera; si falta, las del plan). */
	total: number;
};

/**
 * La cuota 0 (enganche/desembolso de cartera) no es una cuota del plan: no
 * cuenta en «Cuotas pagadas» ni en «Último mes pagado». Cartera tampoco la
 * cuenta en `cuotasRestantes`; contarla daba «1 / 60» pagadas con «60 de 60»
 * restantes.
 */
export function esCuotaDelPlan(c: { numeroCuota?: unknown }): boolean {
	return Number(c.numeroCuota) > 0;
}

/** Cuotas del plan: pagadas, último mes pagado y próximo pago. */
export function resumenCuotas<T extends CuotaHistorialFila>(
	todas: readonly T[],
	numeroCuotas: number | null | undefined,
	hoyInicio: Date = inicioDelDiaGT(),
): ResumenCuotas<T> {
	const cuotas = todas.filter(esCuotaDelPlan);
	const pagadas = cuotas.filter((c) => c.estadoMora === "pagado");
	const ultimaPagada = [...pagadas].sort(
		(a, b) => Number(b.numeroCuota) - Number(a.numeroCuota),
	)[0];
	const proxima = [...cuotas]
		.filter(
			(c) =>
				c.estadoMora !== "pagado" &&
				c.fechaVencimiento &&
				new Date(c.fechaVencimiento) >= hoyInicio,
		)
		.sort((a, b) => Number(a.numeroCuota) - Number(b.numeroCuota))[0];
	return {
		pagadas,
		ultimaPagada,
		proxima,
		total: numeroCuotas ?? cuotas.length,
	};
}

/* ── Promesa de pago ────────────────────────────────────────────────────────── */

/** CB-020: las promesas de pago registradas en el historial. */
export function promesasDePago<T extends ContactoHistorialFila>(
	historial: readonly T[] | null | undefined,
): T[] {
	return (historial || []).filter((c) => c.estadoContacto === "promesa_pago");
}

/**
 * Los ids que se mandan a `getEstadoPromesasPago`. El server los recalcula
 * (no confía en el cliente) y acepta como máximo 100: se ordenan por fecha
 * prometida más reciente y se cortan las primeras 100. Las más viejas
 * conservan su estado ya persistido (Codex, PR #1148).
 */
export function idsPromesasParaRecalcular(
	promesas: readonly ContactoHistorialFila[],
): string[] {
	return promesas
		.filter((p) => p.fechaProximoContacto)
		.sort(
			(a, b) =>
				new Date(b.fechaProximoContacto as string | Date).getTime() -
				new Date(a.fechaProximoContacto as string | Date).getTime(),
		)
		.slice(0, 100)
		.map((p) => p.id);
}

/** La promesa que el modal de promesa EDITA en vez de crear otra. */
export type PromesaActivaCaso = {
	id: string;
	comentarios?: string | null;
	acuerdosAlcanzados?: string | null;
	cuotaInicio?: number | null;
	cuotaFin?: number | null;
	incluyeMora?: boolean | null;
	montoComprometido?: string | null;
	fechaProximoContacto?: string | Date | null;
	fechaAlerta?: string | Date | null;
	proximoPaso?: string | null;
	/** Quién la registró — lo pinta la card de Promesa en el Resumen. */
	realizadoPor?: string | null;
};

/**
 * CB-029: promesa ACTIVA del caso = pendiente (estado recalculado) cuya fecha
 * prometida no pasó. A lo sumo una; si abre el modal, se EDITA esa (no se crea
 * otra que se sobreponga). El backend igual valida "una sola activa".
 *
 * `estados` es el resultado fresco de `getEstadoPromesasPago`: gana sobre la
 * columna `estadoPromesa`, que puede ir un ciclo atrás.
 */
export function promesaActivaDelCaso(
	promesas: readonly ContactoHistorialFila[],
	estados: Record<string, EstadoPromesaUI> | undefined,
	// Medianoche GT de hoy — mismo corte que el backend
	// (condicionesPromesaVigente) y que el badge del header. Codex PR #1232:
	// una promesa VENCIDA (aún pendiente/null porque el recálculo no corrió)
	// NO es activa; sin este chequeo, abrir el modal editaría/sobrescribiría
	// una promesa histórica.
	inicioHoyGt: Date = inicioDelDiaGT(),
): PromesaActivaCaso | null {
	const candidatas = promesas
		.filter((p) => {
			const estado = estados?.[p.id] ?? p.estadoPromesa ?? "pendiente";
			return (
				estado === "pendiente" &&
				!!p.fechaProximoContacto &&
				new Date(p.fechaProximoContacto) >= inicioHoyGt
			);
		})
		.sort(
			(a, b) =>
				new Date(b.fechaProximoContacto as string | Date).getTime() -
				new Date(a.fechaProximoContacto as string | Date).getTime(),
		);
	const p = candidatas[0];
	if (!p) return null;
	return {
		id: p.id,
		comentarios: p.comentarios,
		acuerdosAlcanzados: p.acuerdosAlcanzados,
		cuotaInicio: p.cuotaInicio,
		cuotaFin: p.cuotaFin,
		incluyeMora: p.incluyeMora,
		montoComprometido: p.montoComprometido,
		fechaProximoContacto: p.fechaProximoContacto,
		fechaAlerta: p.fechaAlerta,
		proximoPaso: p.proximoPaso,
		realizadoPor: p.realizadoPor,
	};
}

export type CuotaDisponiblePromesa = {
	numeroCuota: number;
	fechaVencimiento?: string | null;
	monto?: number;
};

/**
 * Las cuotas que se pueden prometer: no pagadas y ya vencidas (las casillas de
 * «Conceptos a pagar» del modal de promesa).
 */
export function cuotasDisponiblesParaPromesa(
	cuotas: readonly CuotaHistorialFila[],
	cuotaMensual: string | number | null | undefined,
	ahora: Date = new Date(),
): CuotaDisponiblePromesa[] {
	return cuotas
		.filter(
			(c) =>
				c.estadoMora !== "pagado" &&
				c.fechaVencimiento &&
				new Date(c.fechaVencimiento) < ahora,
		)
		.map((c) => ({
			numeroCuota: c.numeroCuota as number,
			fechaVencimiento: c.fechaVencimiento,
			monto: Number(c.montoCuota ?? cuotaMensual ?? 0),
		}));
}

/**
 * Monto que propone el modal de promesa: con convenio activo, la cuota del
 * convenio + la cuota (la mora se reemplaza, no se suma; Codex, PR #1191);
 * sin convenio, mora + vencidas × cuota. En "pago parcial + promesa" se resta
 * lo que el cliente ya pagó en la visita.
 */
export function montoSugeridoPromesa(
	caso: Pick<
		CasoDetalle,
		"cuotaConvenio" | "cuotaMensual" | "montoEnMora" | "cuotasVencidas"
	>,
	montoYaPagado = 0,
): number {
	return Math.max(
		0,
		(caso.cuotaConvenio != null
			? Number(caso.cuotaConvenio) + Number(caso.cuotaMensual || 0)
			: Number(caso.montoEnMora || 0) +
				Number(caso.cuotasVencidas || 0) * Number(caso.cuotaMensual || 0)) -
			montoYaPagado,
	);
}

/* ── Convenio de pago ───────────────────────────────────────────────────────── */

/**
 * CB-032: ¿se puede registrar un CONVENIO? Reglas del ticket: a partir de B2 y
 * sin convenio vigente. Devuelve el motivo del bloqueo (se muestra en la
 * opción, que no se esconde) o null si se puede. El server re-valida todo.
 *
 * `statusCredit` (crudo de cartera) es la señal que manda, no
 * `convenioActivo`: cartera solo devuelve ese objeto cuando el convenio tiene
 * activo=true, y uno recién creado nace en false hasta que conta lo activa
 * (hallazgo de Codex, PR #1570).
 */
export function motivoBloqueoConvenio(p: {
	statusCredit: string | null | undefined;
	convenioActivo: CasoDetalle["convenioActivo"];
	/** La query del bucket sigue en vuelo. */
	bucketCargando: boolean;
	bucketNumero: number | null;
	bucketPrefijo: string | null;
	catalogo: BucketsCatalogoQueryData | undefined;
}): string | null {
	const convenioPendienteActivacion =
		p.statusCredit === "EN_CONVENIO" && !p.convenioActivo;
	const tieneConvenioVigente =
		!!p.convenioActivo || p.statusCredit === "EN_CONVENIO";
	return convenioPendienteActivacion
		? "Este crédito ya tiene un convenio pendiente de activación en cartera."
		: tieneConvenioVigente
			? "Este crédito ya tiene un convenio de pago vigente."
			: p.bucketCargando
				? "Cargando el bucket del crédito…"
				: !esBucketDesdeB2(p.bucketNumero, p.catalogo)
					? `Disponible a partir de B2. Este caso está en ${p.bucketPrefijo ?? "un bucket sin definir"}; registre una promesa de pago.`
					: null;
}

/**
 * Las cuotas que se ofrecen en el convenio: solo PENDIENTES de verdad (ni
 * pagadas ni en validación), lo mismo que cartera considera elegible.
 */
export function cuotasParaConvenio(
	cuotas: readonly CuotaHistorialFila[],
	cuotaMensual: string | number | null | undefined,
): CuotaConvenio[] {
	return cuotasElegiblesParaConvenio([...cuotas], Number(cuotaMensual || 0));
}

/** Tope de meses del convenio (env del server, default 6). */
export function maxMesesDeConvenio(config: unknown): number {
	// El cliente ORPC infiere `{}` para esta query (mismo caso que CasoDetalle).
	return (config as { maxMeses?: number } | undefined)?.maxMeses ?? 6;
}

/* ── Permisos ───────────────────────────────────────────────────────────────── */

export function permisosCobros(rol: string | null | undefined) {
	return {
		/**
		 * La pide el asesor que lleva la cuenta, no solo el supervisor: es quien
		 * sabe que la unidad ya no se recupera por teléfono. Desde CB-043 la
		 * forzosa de un asesor es una solicitud que aprueba un supervisor.
		 */
		puedeRecuperarVehiculo: PERMISSIONS.canAccessCobros(rol ?? ""),
		/**
		 * CB-118: enlaces públicos de rastreo, vínculo de la unidad GPS y
		 * decisiones de apagado/recuperación son de supervisor.
		 */
		esSupervisorCobros: PERMISSIONS.canAssignCobros(rol ?? ""),
	};
}

/* ── Recuperación del vehículo (CB-042 / CB-043) ────────────────────────────── */

export type ContextoReglasCaso = {
	puedeRecuperarVehiculo: boolean;
	casoCobroId: string | null | undefined;
	numeroCreditoSifco: string | null | undefined;
	/** La query del bucket sigue en vuelo. */
	bucketCargando: boolean;
	bucketNumero: number | null;
	bucketPrefijo: string | null;
};

/**
 * Por qué no se puede enviar a recuperación (null = sí se puede). La
 * forzosa, de B2 a B3; la entrega voluntaria, de B2 a B4 (en B4 solo se
 * registra). Las opciones NO se esconden: el asesor tiene que saber que
 * existen y por qué hoy no aplican.
 */
export function motivoBloqueoEnvioRecuperacion(
	tipo: TipoEnvioRecuperacion,
	ctx: ContextoReglasCaso,
): string | null {
	const base: string | null = !ctx.puedeRecuperarVehiculo
		? "Solo el equipo de cobros puede enviar una cuenta a recuperación."
		: !ctx.casoCobroId || !ctx.numeroCreditoSifco
			? "Este caso todavía no tiene crédito de cartera asociado."
			: ctx.bucketCargando
				? "Cargando el bucket del crédito…"
				: null;
	return (
		base ?? motivoBloqueoRecuperacion(tipo, ctx.bucketNumero, ctx.bucketPrefijo)
	);
}

/** Un registro de `getRecuperacionesVehiculoCaso` (lo que leen estas reglas). */
export type RecuperacionFila = {
	estadoSolicitud?: string | null;
	completada?: boolean | null;
};

/** CB-043: una solicitud pendiente a la vez. */
export function haySolicitudRecuperacionPendiente(
	recuperaciones: readonly RecuperacionFila[] | null | undefined,
): boolean {
	return (
		recuperaciones?.some((r) => r.estadoSolicitud === "pendiente") ?? false
	);
}

/**
 * La forzosa además se bloquea si ya hay una solicitud esperando al
 * supervisor: se decide (o se cancela) en la tarjeta, no pidiendo otra.
 */
export function motivoBloqueoRecuperacionForzosa(
	ctx: ContextoReglasCaso,
	solicitudPendiente: boolean,
): string | null {
	return (
		motivoBloqueoEnvioRecuperacion("tomado", ctx) ??
		(solicitudPendiente
			? "Ya hay una solicitud de recuperación pendiente de aprobación. Se resuelve en la tarjeta de recuperación del vehículo."
			: null)
	);
}

/** Qué hace el envío elegido hoy: trasladar (B2–B3) o solo registrar (entrega en B4). */
export function operacionEnvioRecuperacion(
	tipo: TipoEnvioRecuperacion | null,
	bucketNumero: number | null,
): OperacionRecuperacion | null {
	return tipo ? operacionRecuperacion(tipo, bucketNumero) : null;
}

/**
 * El envío vigente al que le falta confirmar la recepción de la unidad (el
 * efectivo más reciente, sin completar). Misma regla que
 * `recuperacionPorRecibir` de la tarjeta de recuperación.
 */
export function recuperacionPorRecibirDelCaso<T extends RecuperacionFila>(
	recuperaciones: readonly T[] | null | undefined,
): T | null {
	const vigente =
		(recuperaciones ?? []).find((r) =>
			esRecuperacionEfectiva(r.estadoSolicitud),
		) ?? null;
	return vigente && !vigente.completada ? vigente : null;
}

/* ── Visitas (CB-037/038) ───────────────────────────────────────────────────── */

/**
 * Las visitas nuevas, de B2 a B4 (la regla vive en la librería compartida con
 * el servidor). Registrar el resultado de una ya programada no pasa por acá.
 */
export function motivoBloqueoVisitaCaso(
	ctx: Omit<ContextoReglasCaso, "casoCobroId">,
): string | null {
	return !ctx.puedeRecuperarVehiculo
		? "Solo el equipo de cobros puede registrar visitas."
		: !ctx.numeroCreditoSifco
			? "Este caso todavía no tiene crédito de cartera asociado."
			: ctx.bucketCargando
				? "Cargando el bucket del crédito…"
				: motivoBloqueoVisita(ctx.bucketNumero, ctx.bucketPrefijo);
}

/**
 * Lo vencido: el «Pago total» de una visita y la base del porcentaje del
 * «Pago parcial + promesa». Manda el saldo real del server (`montoAdeudado`:
 * recibos de las cuotas vencidas con los abonos parciales descontados, + la
 * mora de hoy); la fórmula cuotas × cuota + mora queda de respaldo.
 */
export function deudaVencidaDelCaso(
	caso: Pick<
		CasoDetalle,
		"montoAdeudado" | "cuotasVencidas" | "cuotaMensual" | "montoEnMora"
	>,
): number {
	const montoAdeudadoReal = Number(
		String(caso.montoAdeudado ?? "").replace(/,/g, ""),
	);
	return Number.isFinite(montoAdeudadoReal) && montoAdeudadoReal > 0
		? montoAdeudadoReal
		: deudaVencida({
				cuotasVencidas: caso.cuotasVencidas,
				cuota: caso.cuotaMensual,
				mora: caso.montoEnMora,
			});
}

export type DatosLaboralesCaso = {
	empresa?: string | null;
	puesto?: string | null;
	direccion?: string | null;
	telefono?: string | null;
	horario?: string | null;
};

export type DireccionesCliente = {
	residencia: string | null;
	trabajo: {
		direccion: string | null;
		empresa: string | null;
		horario: string | null;
	} | null;
};

/** Las direcciones que precarga la visita: residencia del caso y trabajo de la solicitud. */
export function direccionesDelCliente(
	direccionContacto: string | null | undefined,
	datosLaborales: DatosLaboralesCaso | null | undefined,
): DireccionesCliente {
	return {
		residencia: direccionContacto?.trim() || null,
		trabajo: datosLaborales
			? {
					direccion: datosLaborales.direccion ?? null,
					empresa: datosLaborales.empresa ?? null,
					horario: datosLaborales.horario ?? null,
				}
			: null,
	};
}

/* ── Investigación en redes y apagado de la unidad ──────────────────────────── */

/** CB-039: la investigación nueva se registra en B2 y B3. */
export function reglasInvestigacion(
	bucketNumero: number | null,
	bucketPrefijo: string | null,
) {
	return {
		permitida: investigacionPermitidaEnBucket(bucketNumero),
		motivoBloqueo: motivoBloqueoInvestigacion(bucketNumero, bucketPrefijo),
	};
}

/** Lo que leen estas reglas de `getInmovilizacionesCaso`. */
export type InmovilizacionesCasoDatos = {
	estadoUnidad: "activa" | "inmovilizada";
	solicitudAbierta: unknown | null;
	pendienteLlamar?: unknown;
	pendienteLlamarReactivacion?: unknown;
	tieneGps: boolean;
	historial: readonly unknown[];
};

export type ReglasApagado = {
	/** Se puede solicitar el apagado ahora (GPS, unidad activa, B2–B4, sin otra abierta). */
	permitido: boolean;
	/** Por qué no (null si se puede o si hay una solicitud abierta que explica sola). */
	motivoBloqueo: string | null;
	/** La tarjeta de inmovilización aporta algo (gate de `inmovilizacion-card-gate`). */
	mostrarTarjeta: boolean;
};

/**
 * CB-041: apagado de la unidad. Mismo criterio que `InmovilizacionCard`
 * (y que el server, lib/inmovilizacion-unidad.ts): bucket B2/B3/B4 y unidad
 * GPS vinculada. Sin datos (cargando o error) no se permite.
 */
export function reglasApagado(
	datos: InmovilizacionesCasoDatos | null | undefined,
	bucketNumero: number | null,
): ReglasApagado {
	if (!datos) {
		return {
			permitido: false,
			motivoBloqueo: "Cargando el estado de la unidad…",
			mostrarTarjeta: false,
		};
	}
	const permitido =
		datos.tieneGps &&
		datos.estadoUnidad === "activa" &&
		!datos.solicitudAbierta &&
		bucketNumero !== null &&
		BUCKETS_CON_CARD_INMOVILIZACION.includes(bucketNumero);
	return {
		permitido,
		motivoBloqueo: permitido
			? null
			: datos.solicitudAbierta
				? "Ya hay una solicitud de apagado o reactivación abierta."
				: (motivoSinSolicitud({
						tieneGps: datos.tieneGps,
						estadoUnidad: datos.estadoUnidad,
						hayAbierta: !!datos.solicitudAbierta,
						bucketNumero,
						bucketsApagado: BUCKETS_CON_CARD_INMOVILIZACION,
					}) ??
					(datos.estadoUnidad === "inmovilizada"
						? "La unidad ya está apagada."
						: null)),
		mostrarTarjeta: debeMostrarCardInmovilizacion({
			bucketNumero,
			haySolicitudAbierta: !!datos.solicitudAbierta,
			hayPendienteLlamar:
				!!datos.pendienteLlamar || !!datos.pendienteLlamarReactivacion,
			historialLength: datos.historial.length,
			unidadInmovilizada: datos.estadoUnidad === "inmovilizada",
			tieneGps: datos.tieneGps,
		}),
	};
}

/* ── Teléfonos del caso (CB-036) ────────────────────────────────────────────── */

/** Los últimos 8 dígitos: así se comparan dos teléfonos escritos distinto. */
export function ultimos8Digitos(t: string): string {
	return t.replace(/\D/g, "").slice(-8);
}

/** Un campo de teléfono puede traer varios números separados por coma. */
export function telefonosDe(v: string | number | null | undefined): string[] {
	return String(v || "")
		.split(",")
		.map((t) => t.trim())
		.filter(Boolean);
}

/** Enlace `tel:` (solo dígitos y +). */
export function hrefTelefono(t: string): string {
	return `tel:${t.replace(/[^0-9+]/g, "")}`;
}

export type HallazgoTelefonoFila = {
	tipo: string;
	valor: string;
	enTelefonosDelCaso?: boolean;
};

/**
 * Teléfonos del cliente que se consiguieron (de una referencia o sueltos) y
 * que todavía no están entre los del caso, sin repetir.
 */
export function telefonosNuevosDelCliente<T extends HallazgoTelefonoFila>(
	caso: Pick<CasoDetalle, "telefonoPrincipal" | "telefonoAlternativo">,
	hallazgos: readonly T[],
): T[] {
	const telefonosDelCaso = new Set(
		[caso.telefonoPrincipal, caso.telefonoAlternativo]
			.flatMap((v) => String(v || "").split(","))
			.map((t) => ultimos8Digitos(t))
			.filter(Boolean),
	);
	return hallazgos.filter(
		(h, i, lista) =>
			h.tipo === "telefono" &&
			!h.enTelefonosDelCaso &&
			!telefonosDelCaso.has(ultimos8Digitos(h.valor)) &&
			lista.findIndex(
				(otro) =>
					otro.tipo === "telefono" &&
					ultimos8Digitos(otro.valor) === ultimos8Digitos(h.valor),
			) === i,
	);
}

/** "3 referencias con teléfono" / "4 referencias (2 con teléfono)". */
export function textoReferenciasConTelefono(
	referencias: ReadonlyArray<{ telefonos: readonly unknown[] }>,
): string {
	const total = referencias.length;
	const conTelefono = referencias.filter((r) => r.telefonos.length > 0).length;
	return conTelefono === total
		? total === 1
			? "1 referencia con teléfono"
			: `${total} referencias con teléfono`
		: `${total === 1 ? "1 referencia" : `${total} referencias`} (${conTelefono} con teléfono)`;
}

/* ── Props del modal de contacto ────────────────────────────────────────────── */

/**
 * Las props que comparten TODOS los modales de contacto (`ContactoModal`):
 * datos del cliente y las variables de las plantillas de mensaje.
 */
export type PropsContactoCaso = {
	casoCobroId: string;
	clienteNombre: string;
	telefonoPrincipal: string;
	telefonoAlternativo: string | undefined;
	emailCliente: string;
	fechaPago: string;
	cuotaMensual: string;
	placa: string;
	marcaLineaModelo: string;
	montoAdeudado: string;
	cuotasAtraso: number;
	estadoMora: string | undefined;
	fechaInicio: string | null;
	nombreAsesor: string;
	telefonoAsesor: string;
	expectativaMora: string;
	expectativaMoraDiaria: string;
	incrementoDiarioMora: string;
	incrementoMaximoMensualMora: string;
	aseguradora: string;
	cabinaSeguro: string;
};

export function propsContactoDelCaso(caso: CasoDetalle): PropsContactoCaso {
	return {
		// Los modales solo se montan con caso (caso.id), así que el "" no viaja
		// nunca — está solo para que el tipo cierre sin un cast.
		casoCobroId: caso.id ?? "",
		clienteNombre: caso.clienteNombre || "",
		telefonoPrincipal: caso.telefonoPrincipal || "",
		telefonoAlternativo: caso.telefonoAlternativo
			? String(caso.telefonoAlternativo)
			: undefined,
		emailCliente: caso.emailContacto || "",
		fechaPago: String(caso.diaPagoMensual || 15),
		cuotaMensual: Number(caso.cuotaMensual || 0).toLocaleString(),
		placa: caso.vehiculoPlaca || "",
		marcaLineaModelo:
			`${caso.vehiculoMarca || ""} ${caso.vehiculoModelo || ""} ${caso.vehiculoYear || ""}`.trim(),
		// Saldo real de las cuotas vencidas (parciales y recibos recortados) +
		// mora, calculado en el server (getDetallesCreditoCarteraBack). Vacío =
		// el modal bloquea las plantillas que lo anuncian.
		montoAdeudado: caso.montoAdeudado || "",
		cuotasAtraso: caso.cuotasVencidas ?? 0,
		estadoMora: caso.estadoMora || undefined,
		fechaInicio: caso.fechaInicio || null,
		nombreAsesor: caso.asesor?.nombre || "",
		telefonoAsesor: caso.asesor?.telefono || "",
		expectativaMora: caso.expectativaMora || "",
		expectativaMoraDiaria: caso.expectativaMoraDiaria || "",
		incrementoDiarioMora: caso.incrementoDiarioMora || "",
		incrementoMaximoMensualMora: caso.incrementoMaximoMensualMora || "",
		aseguradora: caso.aseguradora || "",
		cabinaSeguro: caso.cabinaSeguro || "",
	};
}

/* ── Próximo contacto ───────────────────────────────────────────────────────── */

export type ProximoContactoCaso = {
	estado: "Programado" | "Hoy" | "SinProgramar";
	/** Fecha ya formateada (solo con "Programado"). */
	valor?: string;
};

/**
 * El próximo contacto del caso: hoy, programado para otra fecha o sin
 * programar. La fecha se compara en día de Guatemala; `formatear` la pinta
 * (la ficha usa `fechaLarga`).
 */
export function proximoContactoDelCaso(
	fecha: string | Date | null | undefined,
	formatear: (d: Date) => string,
	ahora: Date = new Date(),
): ProximoContactoCaso {
	if (!fecha) return { estado: "SinProgramar" };
	const d = new Date(fecha);
	return fechaCortaGT(d) === fechaCortaGT(ahora)
		? { estado: "Hoy" }
		: { estado: "Programado", valor: formatear(d) };
}
