import { sql } from "drizzle-orm";
import { inicioDiaGTComoTimestampUTC } from "../utils/functions/diaGuatemala";
import { creditosElegiblesMoraSql } from "./moraCapitalCartera";
import { snapCte } from "./moraSnapshotSql";

/**
 * Un evento de `moras_historial` reducido a lo que el nivel de referencia
 * necesita: qué pasó y entre qué montos.
 */
export type MoraLevelEvent = {
	tipoEvento: string;
	montoAnterior: number;
	montoNuevo: number;
	/**
	 * El evento ocurrió ANTES del inicio del ciclo. Solo SIEMBRA el nivel de
	 * referencia; nada de lo que traiga cuenta como mora generada en el ciclo.
	 */
	previo?: boolean;
};

/**
 * Días de historial ANTERIORES al ciclo que se traen para sembrar el nivel.
 *
 * La foto inicial no alcanza como nivel de arranque: la condonación masiva corre
 * casi a diario y el cron repone la mora a la mañana siguiente, así que el corte
 * del ciclo (día 6) cae con frecuencia ENTRE una condonación y su rebote. Ahí la
 * foto dice cero, el nivel arrancaba en cero y el rebote de adentro se contaba
 * entero: el doble conteo que el nivel de referencia existe para evitar, metido
 * por el borde.
 *
 * El estado que hace falta es el de la víspera —entre la condonación y el rebote
 * pasan horas, no días—, así que con UNO bastaría. Se toman 3 para absorber un
 * fin de semana, un feriado o una noche en que el cron no corrió, sin volverse
 * "plegá todo el historial": con el RECALCULO diario son ~3 eventos por crédito
 * contra los ~31 del ciclo, un 10% más de filas, y el costo queda ACOTADO por el
 * número de días, no por la edad del crédito.
 */
export const DIAS_SIEMBRA_NIVEL = 3;

/**
 * Mora GENERADA dentro del ciclo = lo que el asesor tuvo oportunidad de cobrar
 * por ENCIMA de la foto inicial, contando cada deuda UNA sola vez.
 *
 * El recorrido lleva un NIVEL DE REFERENCIA: el techo de mora que ya se contó
 * como oportunidad para ese crédito. Solo suma lo que lo supera.
 *
 *   * `CONDONACION` (individual o masiva): el nivel NO baja. La empresa perdonó
 *     la deuda, pero esa deuda ya se contó cuando nació; que el cron la reponga
 *     a la mañana siguiente es correcto —el cliente la sigue debiendo— pero no
 *     es una oportunidad de cobro NUEVA. Sin esta regla, un crédito con
 *     condonaciones masivas mensuales aportaba su mora entera en cada rebote y
 *     el esperado del reporte se multiplicaba.
 *   * Una BAJA REAL (`DECREMENTO`, o cualquier evento cuyo monto baja respecto
 *     del anterior, que es como quedan registrados los pagos): el nivel SÍ baja
 *     a `monto_nuevo`. El cliente pagó y saldó, así que la mora que se genere
 *     después es deuda nueva y sí es oportunidad nueva. Este matiz es el que
 *     evita que a un cliente que pagó su mora y volvió a atrasarse no se le
 *     cuente la mora nueva.
 *   * `DESACTIVACION`: el nivel vuelve a 0 —el crédito se puso al día o salió
 *     del universo de mora—; si vuelve a entrar, empieza de cero.
 *   * Un evento que sube pero NO supera el nivel (el rebote del `RECALCULO` de
 *     la mañana siguiente a una condonación) no suma y tampoco mueve el nivel:
 *     si lo bajara, el siguiente rebote volvería a cobrar lo ya contado.
 *
 * El nivel NO arranca en la foto a secas: los eventos marcados `previo` —los de
 * los días anteriores al ciclo— lo SIEMBRAN antes de empezar a contar, para que
 * una condonación que quedó del lado de afuera del corte no haga que su rebote
 * de adentro parezca mora nueva. Ver `nivelDeArranque`.
 */
export function moraGeneradaEnPeriodo(
	foto: number,
	eventos: MoraLevelEvent[],
): number {
	const previos = eventos.filter((evento) => evento.previo);
	const delCiclo = eventos.filter((evento) => !evento.previo);
	return plegarNivel(nivelDeArranque(foto, previos), delCiclo).generado;
}

/**
 * Nivel con el que entra el ciclo, sembrado con el historial de la víspera.
 *
 * Sin eventos previos es la foto, que es como se comportaba antes. Con ellos se
 * pliega el tramo anterior con las MISMAS reglas y el resultado se compara con
 * la foto:
 *
 *   * La semilla del plegado previo es el `montoAnterior` del PRIMER evento de
 *     la ventana, o sea el monto que el crédito tenía justo antes: es el estado
 *     anterior a la ventana sin necesidad de una segunda foto en la base.
 *   * `Math.max` con la foto es una red: el nivel de arranque nunca puede quedar
 *     POR DEBAJO de la foto, porque la foto ya se cuenta aparte en el esperado y
 *     un nivel más bajo haría que el primer RECALCULO del ciclo la sumara otra vez.
 *
 * El plegado previo respeta el matiz del pago: si lo último antes del corte fue
 * una baja real, el nivel baja y la mora que nazca adentro sí se cuenta.
 */
export function nivelDeArranque(
	foto: number,
	previos: MoraLevelEvent[],
): number {
	const primero = previos[0];
	if (!primero) return foto;
	return Math.max(foto, plegarNivel(primero.montoAnterior, previos).nivel);
}

/**
 * El recorrido en sí. Devuelve el nivel con el que queda y lo generado, para
 * que sembrar (quedarse con el nivel) y medir (quedarse con lo generado) sean
 * literalmente el mismo código y no dos reglas que puedan separarse.
 */
function plegarNivel(
	nivelInicial: number,
	eventos: MoraLevelEvent[],
): { nivel: number; generado: number } {
	let nivel = nivelInicial;
	let generado = 0;
	for (const evento of eventos) {
		if (evento.tipoEvento === "DESACTIVACION") {
			nivel = 0;
			continue;
		}
		if (evento.tipoEvento === "CONDONACION") continue;
		if (evento.montoNuevo > nivel) {
			generado += evento.montoNuevo - nivel;
			nivel = evento.montoNuevo;
		} else if (evento.montoNuevo < evento.montoAnterior) {
			nivel = evento.montoNuevo;
		}
	}
	return { nivel, generado };
}

export type MoraRecoverySourceRow = {
	asesorId: number | null;
	nombre: string;
	/** Foto de la mora al INICIO del ciclo (día 6). Es el nivel de arranque. */
	esperado: string;
	/**
	 * Eventos de `moras_historial` del crédito DENTRO del ciclo, en orden de
	 * `fecha`, precedidos por los de la ventana de siembra (`previo: true`). Con
	 * la mora proporcional el monto crece todos los días, así que la foto inicial
	 * ya no es todo lo que el asesor tuvo oportunidad de cobrar: lo generado sale
	 * de plegar estos eventos con `moraGeneradaEnPeriodo`.
	 */
	eventos: MoraLevelEvent[];
	/** Mora cobrada dentro del ciclo. El alcance se decide aquí, no en SQL. */
	cobrado: string;
};

export type MoraRecoveryMetric = {
	esperado: string;
	cobradoEnSnapshot: string;
	cobradoFueraSnapshot: string;
	excedenteEnSnapshot: string;
	pendiente: string;
};

export type MoraRecoveryRow = MoraRecoveryMetric & {
	asesorId: number | null;
	nombre: string;
};

type MoraRecoveryReport = {
	periodo: { inicio: string; fin: string };
	metadata: {
		alcance: "live" | "historico";
		atribucionAsesor: "actual";
	};
	totales: MoraRecoveryMetric;
	porAsesor: MoraRecoveryRow[];
};

export type MoraRecoveryPeriod = {
	inicio: string;
	fin: string;
	fechaSnapshot: string;
	alcance: "live" | "historico";
};

export class MoraRecoveryFuturePeriodError extends Error {
	constructor() {
		super("No se puede consultar un ciclo futuro");
		this.name = "MoraRecoveryFuturePeriodError";
	}
}

export function getMoraRecoveryPeriod({
	mes,
	anio,
	hoy,
}: {
	mes: number;
	anio: number;
	hoy: string;
}): MoraRecoveryPeriod {
	const [anioActual, mesActual] = hoy.split("-").map(Number);
	if (anio > anioActual || (anio === anioActual && mes > mesActual)) {
		throw new MoraRecoveryFuturePeriodError();
	}
	const inicio = `${anio}-${String(mes).padStart(2, "0")}-06`;
	const finMes = mes === 12 ? 1 : mes + 1;
	const finAnio = mes === 12 ? anio + 1 : anio;
	const fin = `${finAnio}-${String(finMes).padStart(2, "0")}-06`;
	const fechaSnapshot = inicio > hoy ? hoy : inicio;
	return {
		inicio,
		fin,
		fechaSnapshot,
		alcance: inicio <= hoy ? "historico" : "live",
	};
}

export function buildMoraRecoveryQuery({
	inicio,
	fin,
	fechaSnapshot,
	alcance,
	asesores,
	emailCobrador,
}: MoraRecoveryPeriod & {
	asesores?: number[];
	emailCobrador?: string;
}) {
	const emailFilter = emailCobrador
		? sql`AND LOWER(a.email_cash_in) = LOWER(TRIM(${emailCobrador}))`
		: sql``;
	const asesoresFilter = asesores?.length
		? sql`AND a.asesor_id IN (${sql.join(
				asesores.map((id) => sql`${id}`),
				sql`, `,
			)})`
		: sql``;
	const snapshotCte =
		alcance === "historico"
			? sql`${snapCte(fechaSnapshot, false)}, snapshot_por_credito AS (
      SELECT s.credito_id, s.monto::numeric AS esperado
      FROM snap s
      WHERE s.tipo_evento <> 'DESACTIVACION' AND s.monto > 0 AND s.cuotas > 0
    )`
			: sql`mora_activa AS (
      SELECT DISTINCT ON (credito_id) credito_id, monto_mora::numeric AS esperado
      FROM cartera.moras_credito
      WHERE activa = true AND cuotas_atrasadas > 0
      ORDER BY credito_id, mora_id DESC
    ), snapshot_por_credito AS (
      SELECT m.credito_id, m.esperado
      FROM mora_activa m
    )`;

	// `moras_historial.fecha` es `timestamp` SIN zona con el instante en UTC. Para
	// filtrar por día de Guatemala se convierten los LÍMITES a instantes UTC y se
	// compara contra la columna CRUDA: envolverla en `AT TIME ZONE` (como hace
	// `snapCte`, que corta por día y no por rango) mataría `moras_historial_fecha_idx`.
	const inicioUtc = inicioDiaGTComoTimestampUTC(inicio);
	const finUtc = inicioDiaGTComoTimestampUTC(fin);
	// Arranque de la VENTANA DE SIEMBRA: unos días antes del ciclo. Lo que caiga
	// entre este instante y el inicio no cuenta como mora generada; solo deja el
	// nivel de referencia donde estaba al cruzar el corte.
	const siembraUtc = inicioDiaGTComoTimestampUTC(inicio, -DIAS_SIEMBRA_NIVEL);
	if (!inicioUtc || !finUtc || !siembraUtc) {
		throw new RangeError(
			`Período de recuperación de mora inválido: ${inicio} → ${fin}`,
		);
	}

	return sql`
    WITH ${snapshotCte},
    creditos_con_asesor AS (
      SELECT c.credito_id, c.asesor_id, a.nombre
      FROM cartera.creditos c
      LEFT JOIN cartera.asesores a ON a.asesor_id = c.asesor_id
      WHERE c."statusCredit" IN (${creditosElegiblesMoraSql})
        ${emailFilter}
        ${asesoresFilter}
    ),
    pagos_por_credito AS (
      SELECT pc.credito_id, COALESCE(SUM(pc.mora::numeric), 0) AS cobrado
      FROM cartera.pagos_credito pc
      JOIN creditos_con_asesor ca ON ca.credito_id = pc.credito_id
      WHERE pc.fecha_pago >= ${inicio}::timestamp
        AND pc.fecha_pago < ${fin}::timestamp
        AND COALESCE(pc."paymentFalse", false) = false
      GROUP BY pc.credito_id
    ),
    -- Eventos crudos del ciclo MÁS los de la ventana de siembra (marcados
    -- \`previo\`), en orden, SIN agregar: lo generado no es una
    -- suma de deltas sino un recorrido con estado (el "nivel de referencia" de
    -- \`moraGeneradaEnPeriodo\`), porque una condonación y el rebote que la
    -- repone no son deuda nueva mientras que una baja por pago sí reabre la
    -- oportunidad. Esa regla vive en TypeScript, donde se prueba sin base.
    -- Se traen TODOS los tipos: el nivel depende tanto de lo que sube como de
    -- lo que baja y de por qué bajó.
    -- LIMITACIÓN: el RECALCULO diario solo existe desde el despliegue de la mora
    -- proporcional. Antes el monto casi no cambiaba y el cron escribía \`sinCambios\`,
    -- así que para ciclos viejos el historial es escaso y el esperado queda
    -- APROXIMADO POR LO BAJO. No es un defecto del cálculo: el dato no existe hacia atrás.
    -- La ventana de siembra existe porque el nivel de referencia no puede arrancar
    -- en la foto a secas: si lo último antes del corte fue una CONDONACION, la foto
    -- dice cero y el rebote del cron de adentro se contaría entero. Ver
    -- \`DIAS_SIEMBRA_NIVEL\`.
    eventos_por_credito AS (
      SELECT h.credito_id,
             JSON_AGG(
               JSON_BUILD_OBJECT(
                 'tipoEvento', h.tipo_evento,
                 'montoAnterior', h.monto_anterior::numeric::text,
                 'montoNuevo', h.monto_nuevo::numeric::text,
                 'previo', h.fecha < ${inicioUtc}::timestamp
               )
               ORDER BY h.fecha, h.historial_id
             ) AS eventos
      FROM cartera.moras_historial h
      JOIN creditos_con_asesor ca ON ca.credito_id = h.credito_id
      WHERE h.fecha >= ${siembraUtc}::timestamp
        AND h.fecha < ${finUtc}::timestamp
      GROUP BY h.credito_id
      -- Un crédito cuyos ÚNICOS eventos son de la siembra no participó del
      -- ciclo: dejarlo entrar agregaría filas en cero (y asesores enteros en
      -- cero) que hoy no existen. La siembra acompaña, no amplía el universo.
      HAVING BOOL_OR(h.fecha >= ${inicioUtc}::timestamp)
    )
    SELECT
      ca.asesor_id,
      COALESCE(ca.nombre, 'Sin asignar') AS nombre,
      COALESCE(s.esperado, 0)::text AS esperado,
      COALESCE(e.eventos, '[]'::json) AS eventos,
      COALESCE(p.cobrado, 0)::text AS cobrado
    FROM snapshot_por_credito s
    FULL JOIN pagos_por_credito p ON p.credito_id = s.credito_id
    FULL JOIN eventos_por_credito e ON e.credito_id = COALESCE(s.credito_id, p.credito_id)
    JOIN creditos_con_asesor ca ON ca.credito_id = COALESCE(s.credito_id, p.credito_id, e.credito_id)
  `;
}

function metricFrom(
	row: Omit<MoraRecoverySourceRow, "asesorId" | "nombre">,
): MoraRecoveryMetric {
	// El esperado del reporte = foto inicial + lo generado dentro del ciclo, que es
	// exactamente lo que el asesor tuvo oportunidad de cobrar.
	const foto = Number(row.esperado);
	const esperado = foto + moraGeneradaEnPeriodo(foto, row.eventos);
	// "En alcance" = el crédito aporta esperado (foto inicial O mora generada
	// adentro). Un crédito que entró al ciclo sin mora, la generó y la pagó tiene
	// esperado > 0: contar su pago como "fuera" dejaría el pendiente inflado por
	// el monto completo.
	const cobrado = Number(row.cobrado);
	const cobradoEnSnapshot = esperado > 0 ? cobrado : 0;
	const cobradoFueraSnapshot = esperado > 0 ? 0 : cobrado;
	return {
		esperado: esperado.toFixed(2),
		cobradoEnSnapshot: cobradoEnSnapshot.toFixed(2),
		cobradoFueraSnapshot: cobradoFueraSnapshot.toFixed(2),
		excedenteEnSnapshot: Math.max(0, cobradoEnSnapshot - esperado).toFixed(2),
		pendiente: Math.max(0, esperado - cobradoEnSnapshot).toFixed(2),
	};
}

export function buildMoraRecoveryReport(
	rows: MoraRecoverySourceRow[],
	periodo: { inicio: string; fin: string; alcance: "live" | "historico" },
): MoraRecoveryReport {
	const byAsesor = new Map<string, MoraRecoveryRow>();
	for (const source of rows) {
		const key = String(source.asesorId);
		const current = byAsesor.get(key) ?? {
			asesorId: source.asesorId,
			nombre: source.nombre,
			...metricFrom({ esperado: "0", eventos: [], cobrado: "0" }),
		};
		const metric = metricFrom(source);
		byAsesor.set(key, {
			asesorId: current.asesorId,
			nombre: current.nombre,
			esperado: (Number(current.esperado) + Number(metric.esperado)).toFixed(2),
			cobradoEnSnapshot: (
				Number(current.cobradoEnSnapshot) + Number(metric.cobradoEnSnapshot)
			).toFixed(2),
			cobradoFueraSnapshot: (
				Number(current.cobradoFueraSnapshot) +
				Number(metric.cobradoFueraSnapshot)
			).toFixed(2),
			excedenteEnSnapshot: (
				Number(current.excedenteEnSnapshot) + Number(metric.excedenteEnSnapshot)
			).toFixed(2),
			pendiente: (Number(current.pendiente) + Number(metric.pendiente)).toFixed(
				2,
			),
		});
	}
	const porAsesor = [...byAsesor.values()];
	const sum = (field: keyof MoraRecoveryMetric) =>
		porAsesor.reduce((total, row) => total + Number(row[field]), 0).toFixed(2);

	return {
		periodo: { inicio: periodo.inicio, fin: periodo.fin },
		metadata: { alcance: periodo.alcance, atribucionAsesor: "actual" },
		totales: {
			esperado: sum("esperado"),
			cobradoEnSnapshot: sum("cobradoEnSnapshot"),
			cobradoFueraSnapshot: sum("cobradoFueraSnapshot"),
			excedenteEnSnapshot: sum("excedenteEnSnapshot"),
			pendiente: sum("pendiente"),
		},
		porAsesor,
	};
}
