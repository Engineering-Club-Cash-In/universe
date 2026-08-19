/**
 * CB-128 — lógica pura del historial de agendas de cobros.
 *
 * Acá vive todo lo que se puede decidir sin tocar la DB: normalización del
 * rango de fechas, armado de las condiciones drizzle, y el scoping por rol.
 * El I/O queda en `routers/historial-agendas.ts`. Mismo reparto que
 * `cola-dia.ts`, `promesa-pago.ts` y `gestion-temprana-b1.ts`.
 *
 * ── Escala ────────────────────────────────────────────────────────────────
 *
 * El negocio proyecta 5× los créditos actuales a 5 años (~1,772 → ~8,900), lo
 * que lleva `contactos_cobros` a ~500k-800k filas. Dos decisiones de este
 * módulo salen de ahí:
 *
 *  - `normalizarRango()` impone una ventana por defecto (30 días) cuando el
 *    caller no manda fechas. Sin eso, la primera carga de la vista escanea la
 *    tabla entera.
 *  - `LIMITE_CONTEO` acota el COUNT(*): a ese volumen un count exacto con
 *    filtros cuesta lo mismo que la query, y nadie pagina hasta la página 200.
 */

import {
	and,
	desc,
	eq,
	gte,
	inArray,
	isNotNull,
	isNull,
	not,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import {
	agendaCobrosSnapshotItems,
	casosCobros,
	contactosCobros,
} from "../db/schema/cobros";
import {
	PREFIJO_CONVENIO_AUTO,
	PREFIJO_PREMORA_AUTO,
	PREFIJO_WSP_MASIVO,
} from "./gestion-temprana-b1";
import { gtDateStrToDate, toDateStrGT } from "./guatemala-month-window";

/**
 * Ventana por defecto cuando el caller no acota fechas. 30 días cubre el uso
 * real del supervisor (revisar la gestión del mes) sin escanear la historia.
 */
export const DIAS_VENTANA_DEFAULT = 30;

/**
 * Techo del COUNT(*). Si la query llega a este número, la UI muestra "10,000+"
 * en vez del total exacto. A 800k filas contar con filtros cuesta como la
 * query misma, y el número exacto en la página 200 no tiene valor operativo.
 */
export const LIMITE_CONTEO = 10_001;

/**
 * Techo de usuarios que devuelve el catálogo del desplegable de filtro.
 *
 * El universo real son los usuarios con rol de cobros (decenas), así que este
 * número no se alcanza en la práctica; existe para que la query tenga una cota
 * dura. Sin él, deduplicar los ejecutores obliga a recorrer todas las filas del
 * rango, y esa query se dispara en cada cambio de filtro.
 */
export const LIMITE_USUARIOS_CATALOGO = 500;

/**
 * Sentinela de "sin bucket registrado" en el filtro de buckets.
 *
 * `bucket_snapshot` es NULL en dos casos: gestiones anteriores a CB-128 (no
 * había columna) y créditos fuera del funnel (EN_CONVENIO/CANCELADO/…, que no
 * tienen bucket por diseño). Ese grupo es grande —toda la mensajería automática
 * de premora y convenio cae ahí— y la UI muestra su conteo, así que tiene que
 * poder aislarse como cualquier otro chip.
 *
 * Se usa -1 porque los buckets reales son 0-5 y NULL no viaja como valor en un
 * `IN`. El input lo valida con `min(-1)`, y `construirCondiciones` lo traduce a
 * `IS NULL`.
 */
export const BUCKET_SIN_ASIGNAR = -1;

/** Origen de la gestión: la registró una persona o la generó el sistema. */
export type OrigenGestion = "manual" | "premora" | "convenio" | "wsp_masivo";

export interface RangoNormalizado {
	/** Medianoche GT del primer día incluido. */
	desde: Date;
	/** Medianoche GT del día SIGUIENTE al último incluido (cota exclusiva). */
	hasta: Date;
	/** true si el rango lo puso el default y no el caller. */
	esDefault: boolean;
}

/**
 * Convierte el rango YYYY-MM-DD del input a instantes UTC, usando el día
 * calendario de Guatemala.
 *
 * La cota superior es EXCLUSIVA (medianoche del día siguiente) a propósito: con
 * `lte(fecha, gtDateStrToDate(hasta))` una gestión registrada a las 15:00 del
 * último día del rango quedaría FUERA, porque esa cota es la medianoche de ese
 * día. Es el mismo bug de zonificación que ya se corrigió varias veces en esta
 * rama (ver la nota de "día calendario GT" en los fix de CB-029/CB-030).
 *
 * Sin fechas del caller se aplica la ventana default hacia atrás desde hoy.
 */
export function normalizarRango(
	input: { desde?: string; hasta?: string },
	ahora: Date = new Date(),
): RangoNormalizado {
	const hoyStr = toDateStrGT(ahora);

	if (!input.desde && !input.hasta) {
		const finExclusivo = sumarDias(gtDateStrToDate(hoyStr), 1);
		return {
			desde: sumarDias(finExclusivo, -DIAS_VENTANA_DEFAULT),
			hasta: finExclusivo,
			esDefault: true,
		};
	}

	// Rango invertido (desde > hasta): se normaliza intercambiando en vez de
	// dejarlo pasar. Un WHERE contradictorio devuelve la tabla y los 6 KPIs en
	// cero, y el usuario lo lee como "el job no corrió" en vez de "el rango está
	// al revés". La UI no deja invertirlo, pero el procedure es la frontera real.
	// Mismo criterio que ya aplica cierre.tsx corrigiéndolo en la fuente.
	let desdeStr = input.desde;
	let hastaStr = input.hasta;
	if (desdeStr && hastaStr && desdeStr > hastaStr) {
		[desdeStr, hastaStr] = [hastaStr, desdeStr];
	}

	// Con solo una de las dos, la otra se ancla a la ventana default para no
	// caer en un rango abierto (que es justo lo que se quiere evitar).
	const finExclusivo = sumarDias(gtDateStrToDate(hastaStr ?? hoyStr), 1);
	const desde = desdeStr
		? gtDateStrToDate(desdeStr)
		: sumarDias(finExclusivo, -DIAS_VENTANA_DEFAULT);

	return { desde, hasta: finExclusivo, esDefault: false };
}

function sumarDias(fecha: Date, dias: number): Date {
	return new Date(fecha.getTime() + dias * 24 * 60 * 60 * 1000);
}

/**
 * SQL que marca las gestiones generadas por el sistema.
 *
 * No hay columna de origen en `contactos_cobros`: se deriva del prefijo del
 * comentario, mismo criterio que ya usan `getCierreDiarioPorRango` y el job de
 * cierre diario. Se centraliza acá para que los tres no diverjan.
 */
export function esGestionAutomatica(): SQL {
	return sql`COALESCE(${contactosCobros.comentarios} LIKE ${`${PREFIJO_PREMORA_AUTO}%`} OR ${contactosCobros.comentarios} LIKE ${`${PREFIJO_WSP_MASIVO}%`}, false)`;
}

/**
 * Clasifica el origen de una gestión a partir de su comentario.
 *
 * PREFIJO_CONVENIO_AUTO se prueba ANTES que PREFIJO_PREMORA_AUTO porque el
 * primero lo contiene ("Recordatorio automático Convenio..." empieza con
 * "Recordatorio automático"): en el orden inverso todo convenio se reporta
 * como premora.
 */
export function origenDeComentario(comentarios: string | null): OrigenGestion {
	if (!comentarios) return "manual";
	if (comentarios.startsWith(PREFIJO_CONVENIO_AUTO)) return "convenio";
	if (comentarios.startsWith(PREFIJO_PREMORA_AUTO)) return "premora";
	if (comentarios.startsWith(PREFIJO_WSP_MASIVO)) return "wsp_masivo";
	return "manual";
}

/** SQL que expone el origen como columna del SELECT. */
export function columnaOrigen(): SQL<OrigenGestion> {
	return sql<OrigenGestion>`CASE
		WHEN ${contactosCobros.comentarios} LIKE ${`${PREFIJO_CONVENIO_AUTO}%`} THEN 'convenio'
		WHEN ${contactosCobros.comentarios} LIKE ${`${PREFIJO_PREMORA_AUTO}%`} THEN 'premora'
		WHEN ${contactosCobros.comentarios} LIKE ${`${PREFIJO_WSP_MASIVO}%`} THEN 'wsp_masivo'
		ELSE 'manual'
	END`;
}

/**
 * Marca si el crédito de la gestión estaba en el snapshot de agenda del asesor.
 *
 * Compara por CRÉDITO (caso, con SIFCO de respaldo) y no por
 * `contacto_cobro_id`: ese último solo nombra el contacto que CERRÓ el item
 * del snapshot, así que una segunda gestión sobre el mismo crédito
 * planificado saldría "fuera de agenda" siendo falso. `caso_cobro_id` del
 * snapshot es nullable a propósito (los items D-0 nacen sin caso — ver
 * `agenda-cobros-source.ts`), de ahí el SIFCO de respaldo. No se compara solo
 * por SIFCO: `numero_credito_sifco` no es único en `casos_cobros` (un crédito
 * puede tener varios casos por reaperturas/migraciones) y eso marcaría una
 * gestión del caso B como "en agenda" porque el caso A sí lo estaba.
 *
 * Tres resultados posibles, no dos:
 *  - No se pidió `marcarEnAgenda` (`huboBusqueda=false`) → NULL: la pregunta
 *    ni se hizo.
 *  - Se pidió, hay agenda cerrada ese día (`snapshotId` presente) → el EXISTS
 *    decide caso por caso.
 *  - Se pidió, NO hay agenda cerrada para ese asesor/fecha (`huboBusqueda=true`,
 *    `snapshotId=null`) → FALSE para todas las filas: sin ningún item
 *    planificado, ninguna gestión de ese día pudo estar "en agenda" — no es
 *    incertidumbre, es un hecho conocido (hallazgo de code review, Codex).
 *    Antes esto también viajaba en NULL y el badge mostraba "—" para un
 *    asesor sin agenda planificada, cuando la respuesta correcta es "Fuera de
 *    agenda" con certeza.
 */
export function columnaEnAgenda(
	snapshotId: string | null,
	huboBusqueda: boolean,
): SQL<boolean | null> {
	if (!snapshotId) {
		return huboBusqueda
			? sql<boolean | null>`FALSE`
			: sql<boolean | null>`NULL::boolean`;
	}
	return sql<boolean | null>`EXISTS (
		SELECT 1 FROM ${agendaCobrosSnapshotItems} ai
		WHERE ai.snapshot_id = ${snapshotId}
		  AND (
		    ai.caso_cobro_id = ${contactosCobros.casoCobroId}
		    OR (
		      ai.caso_cobro_id IS NULL
		      AND ai.numero_credito_sifco = ${casosCobros.numeroCreditoSifco}
		    )
		  )
	)`;
}

/** Valores del enum `estado_contacto`, tomados del schema (no re-declarados). */
export type EstadoContacto =
	(typeof contactosCobros.estadoContacto.enumValues)[number];
/** Valores del enum `metodo_contacto`. */
export type MetodoContacto =
	(typeof contactosCobros.metodoContacto.enumValues)[number];

export interface FiltrosHistorial {
	desde?: string;
	hasta?: string;
	usuarioIds?: string[];
	buckets?: number[];
	// Tipados con los enums del schema, no como string[]: así un valor inválido
	// se rechaza al compilar en vez de producir un filtro que no matchea nada.
	estadoContacto?: EstadoContacto[];
	metodoContacto?: MetodoContacto[];
	estadoPromesa?: "pendiente" | "cumplida" | "incumplida";
	numeroCreditoSifco?: string;
	soloConProximaAccion?: boolean;
	/** Por defecto false: los envíos del sistema no son gestión del asesor. */
	incluirAutomaticos?: boolean;
}

export interface ContextoScoping {
	/** `user.id` del CRM de quien consulta. */
	userId: string;
	/** true para admin y cobros_supervisor. */
	puedeVerTodos: boolean;
}

/**
 * Arma el WHERE completo del historial.
 *
 * El scoping va PRIMERO y no es opcional: si `puedeVerTodos` es false, la
 * condición por `realizadoPor` se agrega pase lo que pase con el resto de los
 * filtros. Un asesor no puede ampliar su alcance mandando parámetros.
 *
 * Se filtra por `realizadoPor` (quién hizo la gestión) y no por
 * `responsableCobros` (quién lleva la cuenta): el historial es de gestión
 * REALIZADA. Si un asesor gestiona una cuenta que no es suya, esa gestión es
 * suya y debe verla; y si le reasignan una cuenta, no hereda las gestiones que
 * hizo otro.
 */
export function construirCondiciones(
	filtros: FiltrosHistorial,
	contexto: ContextoScoping,
	ahora: Date = new Date(),
): { condiciones: SQL[]; rango: RangoNormalizado } {
	const rango = normalizarRango(filtros, ahora);
	const condiciones: SQL[] = [];

	// AC-3 — scoping por rol. Innegociable, va antes que todo lo demás.
	if (!contexto.puedeVerTodos) {
		condiciones.push(eq(contactosCobros.realizadoPor, contexto.userId));
	}

	// Ventana de fechas: cota inferior inclusiva, superior exclusiva.
	condiciones.push(gte(contactosCobros.fechaContacto, rango.desde));
	condiciones.push(
		sql`${contactosCobros.fechaContacto} < ${rango.hasta}` as SQL,
	);

	if (filtros.usuarioIds?.length) {
		condiciones.push(inArray(contactosCobros.realizadoPor, filtros.usuarioIds));
	}

	if (filtros.buckets?.length) {
		// BUCKET_SIN_ASIGNAR (-1) es un sentinela, no un bucket: representa las
		// filas con `bucket_snapshot IS NULL` (gestiones previas a CB-128 y
		// créditos fuera del funnel). Se hace por sentinela y no por un flag
		// aparte para que el filtro sea UNA sola lista combinable: "B2 o sin
		// bucket" es una selección legítima, y `IN (...) OR IS NULL` la expresa
		// sin multiplicar parámetros en el input.
		const sinAsignar = filtros.buckets.includes(BUCKET_SIN_ASIGNAR);
		const numericos = filtros.buckets.filter((b) => b !== BUCKET_SIN_ASIGNAR);

		const alternativas: SQL[] = [];
		if (numericos.length) {
			alternativas.push(
				inArray(contactosCobros.bucketSnapshot, numericos) as SQL,
			);
		}
		if (sinAsignar) {
			alternativas.push(isNull(contactosCobros.bucketSnapshot) as SQL);
		}
		// `or` con un solo elemento devuelve ese elemento, así que no hace falta
		// distinguir los casos.
		const condicion =
			alternativas.length === 1 ? alternativas[0] : or(...alternativas);
		if (condicion) condiciones.push(condicion);
	}

	if (filtros.estadoContacto?.length) {
		condiciones.push(
			inArray(contactosCobros.estadoContacto, filtros.estadoContacto),
		);
	}

	if (filtros.metodoContacto?.length) {
		condiciones.push(
			inArray(contactosCobros.metodoContacto, filtros.metodoContacto),
		);
	}

	if (filtros.estadoPromesa) {
		condiciones.push(eq(contactosCobros.estadoPromesa, filtros.estadoPromesa));
	}

	if (filtros.numeroCreditoSifco?.trim()) {
		condiciones.push(
			eq(casosCobros.numeroCreditoSifco, filtros.numeroCreditoSifco.trim()),
		);
	}

	if (filtros.soloConProximaAccion) {
		condiciones.push(isNotNull(contactosCobros.fechaProximoContacto));
	}

	// Por defecto se excluyen los envíos que genera el sistema: no son gestión
	// del asesor y, sin filtrarlos, inflan los KPIs y ensucian el historial.
	if (!filtros.incluirAutomaticos) {
		condiciones.push(not(esGestionAutomatica()));
	}

	return { condiciones, rango };
}

/** WHERE ya combinado, listo para usar. */
export function whereHistorial(
	filtros: FiltrosHistorial,
	contexto: ContextoScoping,
	ahora: Date = new Date(),
): { where: SQL; rango: RangoNormalizado } {
	const { condiciones, rango } = construirCondiciones(filtros, contexto, ahora);
	return { where: and(...condiciones) as SQL, rango };
}

/** Orden canónico del listado: lo más reciente primero, `id` desempata. */
export function ordenHistorial() {
	return [desc(contactosCobros.fechaContacto), desc(contactosCobros.id)];
}

/**
 * Traduce el conteo acotado al par (total, esAproximado) que consume la UI.
 *
 * Ver `LIMITE_CONTEO`: la query cuenta hasta el techo, y si lo alcanza se
 * reporta el techo menos uno como piso ("10,000+") en vez de mentir con un
 * número exacto que no se calculó.
 */
export function interpretarConteo(filasContadas: number): {
	total: number;
	esAproximado: boolean;
} {
	if (filasContadas >= LIMITE_CONTEO) {
		return { total: LIMITE_CONTEO - 1, esAproximado: true };
	}
	return { total: filasContadas, esAproximado: false };
}

/** Total de páginas, con piso de 1 para que la UI no muestre "página 1 de 0". */
export function calcularTotalPaginas(total: number, pageSize: number): number {
	return Math.max(1, Math.ceil(total / pageSize));
}

/**
 * Condición de "contacto efectivo": el cliente contestó y fue gestión manual.
 *
 * Mismas categorías excluyentes que usa el cierre diario (CB-024): las promesas
 * se reportan aparte, y `no_contesta`/`numero_equivocado` no cuentan en
 * ninguna. Mantenerlo alineado con `cierre_diario_credito_cobros.es_efectivo_manual`
 * para que los dos reportes no den números distintos sobre lo mismo.
 */
export function esContactoEfectivo(): SQL {
	return and(
		inArray(contactosCobros.estadoContacto, [
			"contactado",
			"acuerdo_parcial",
			"rechaza_pagar",
		]),
		not(esGestionAutomatica()),
	) as SQL;
}

/** Condición de "no se logró contactar". */
export function esSinContacto(): SQL {
	return or(
		eq(contactosCobros.estadoContacto, "no_contesta"),
		eq(contactosCobros.estadoContacto, "numero_equivocado"),
	) as SQL;
}
