import { sql } from "drizzle-orm";
import { inicioDiaGTComoTimestampUTC } from "../utils/functions/diaGuatemala";
import {
	MARCA_DECREMENTO_ANULADO,
	MARCA_PAGO_DEL_DECREMENTO_PREFIJO,
	MOTIVOS_RESTITUCION_MORA_PREFIJOS,
} from "../utils/motivoReversaMora";
import { creditosElegiblesMoraSql } from "./moraCapitalCartera";
import { snapCte } from "./moraSnapshotSql";

/**
 * ¿Este `motivo` marca una RESTITUCIÓN de mora (reversa o anulación de pago)?
 *
 * La restitución entra a `moras_historial` como un `INCREMENTO` de origen
 * `API_MANUAL`, idéntico a un ajuste hecho a mano por un analista: el `motivo`
 * es la única marca que las separa. Los prefijos NO se enumeran acá sino en
 * `MOTIVOS_RESTITUCION_MORA_PREFIJOS`, junto a las constantes que los escriben,
 * para que no se pueda agregar un escritor nuevo sin que el lector lo reconozca.
 *
 * `COALESCE`: sin él, una fila con `motivo` NULL daría NULL en el LIKE, y NULL
 * no es `false` —en el `NOT (...)` del ancla la fila quedaría fuera—.
 */
function esRestitucionSql(columnaMotivo: ReturnType<typeof sql.raw>) {
	return sql`(${sql.join(
		MOTIVOS_RESTITUCION_MORA_PREFIJOS.map(
			(prefijo) => sql`COALESCE(${columnaMotivo}, '') LIKE ${`${prefijo}%`}`,
		),
		sql` OR `,
	)})`;
}

/**
 * ¿Este `motivo` declara que el `DECREMENTO` ya no vale porque su pago se cayó?
 *
 * La marca la escribe `marcarDecrementoAnulado` cuando se anula la boleta o se
 * revierte el pago, sobre el MISMO evento del decremento (no sobre uno nuevo):
 * es la única forma de que el reporte sepa que esa bajada dejó de valer incluso
 * cuando no hubo nada que restituir.
 */
function esDecrementoAnuladoSql(columnaMotivo: ReturnType<typeof sql.raw>) {
	return sql`(COALESCE(${columnaMotivo}, '') LIKE ${`%${MARCA_DECREMENTO_ANULADO}%`})`;
}

/** Lo que en una expresión regular POSIX hay que escapar para leerlo literal. */
const escaparRegex = (texto: string) =>
	texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * ¿De qué PAGO habla este evento? El id que deja la marca del decremento
 * (`[pago #N]`) o, si el evento es una restitución, el que dejan sus prefijos
 * (`Reversa de pago #N`, `Anulación de pago #N`). NULL si no lleva ninguno.
 *
 * Es lo que le permite al reporte ligar una restitución con SU bajada en vez de
 * con cualquiera; ver `pagoId` en `MoraLevelEvent`. Los patrones se ARMAN con
 * las mismas constantes que escriben las marcas, para que no se puedan separar
 * con un cambio de redacción. Sale como TEXTO: el id no se usa para aritmética,
 * solo como identidad.
 */
function pagoDelEventoSql(columnaMotivo: ReturnType<typeof sql.raw>) {
	const patrones = [
		MARCA_PAGO_DEL_DECREMENTO_PREFIJO,
		...MOTIVOS_RESTITUCION_MORA_PREFIJOS,
	];
	return sql`COALESCE(${sql.join(
		patrones.map(
			(prefijo) =>
				// `::text` explícito: sin él el parámetro llega sin tipo y
				// `substring(text, unknown)` tiene dos candidatas (la de posición y
				// la de expresión regular). Acá siempre es la de expresión regular.
				sql`SUBSTRING(${columnaMotivo} FROM ${`${escaparRegex(prefijo)}([0-9]+)`}::text)`,
		),
		sql`, `,
	)})`;
}

/**
 * Un evento de `moras_historial` reducido a lo que el nivel de referencia
 * necesita: qué pasó y entre qué montos.
 */
export type MoraLevelEvent = {
	tipoEvento: string;
	montoAnterior: number;
	montoNuevo: number;
	/**
	 * El evento ocurrió ANTES del inicio del ciclo: solo SIEMBRA el nivel de
	 * referencia y nada de lo que traiga cuenta como mora generada.
	 *
	 * La consulta ya NO manda estos eventos —la siembra llega agregada, como un
	 * número; ver `nivelSembrado`—. La marca se conserva porque el plegado fila
	 * por fila del tramo previo es la ESPECIFICACIÓN ejecutable contra la que el
	 * test prueba que el agregado da lo mismo.
	 */
	previo?: boolean;
	/**
	 * El evento es la RESTITUCIÓN de una reversa de pago, no mora nueva: el
	 * pago que había bajado la mora se anuló y `reversePayment` le devuelve al
	 * crédito el saldo que ese pago cubría. Lo mismo vale para una ANULACIÓN
	 * (`falsePayment`), que escribe su propio prefijo. Ver
	 * `MOTIVOS_RESTITUCION_MORA_PREFIJOS`.
	 */
	reverso?: boolean;
	/**
	 * El evento es un `DECREMENTO` cuyo pago SE CAYÓ (se anuló la boleta o se
	 * revirtió el pago), así que esa bajada NUNCA DEBIÓ EXISTIR.
	 *
	 * ── SOLO VALE DENTRO DEL CICLO ──────────────────────────────────────────
	 * La marca es un booleano estampado sobre la fila vieja del decremento:
	 * dice QUE se cayó, no CUÁNDO. Lo único que la fecha del propio decremento
	 * permite afirmar es de qué lado del corte ocurrió la BAJADA, y de ahí sale
	 * la única lectura honesta:
	 *
	 *   * decremento DENTRO del ciclo: la bajada la vio este mismo recorrido, y
	 *     saltarla es lo que impide que la reposición del cron que venga después
	 *     se cobre como mora NUEVA —una foto de Q100 terminaba en Q200 de
	 *     esperado— incluso cuando la reconciliación decidía, con razón, no
	 *     restituir nada porque el cron ya lo había hecho. El monto no
	 *     alcanzaba: hacía falta el HECHO.
	 *   * decremento ANTERIOR al ciclo: su bajada ya está descontada de la foto
	 *     inicial, y la marca no dice que la anulación haya caído adentro. Acá
	 *     la marca NO se honra —el tramo previo se pliega como si no existiera—,
	 *     porque suprimir esa bajada dejaba el techo sembrado arriba y la
	 *     reposición de adentro salía con `esperado 0.00` teniendo Q100 vivos y
	 *     cobrables: una oportunidad REAL borrada, y el cobro de esos Q100
	 *     cayendo en `cobradoFueraSnapshot`, o sea un cobro descontado al asesor.
	 *
	 * Quien la escribe es `marcarDecrementoAnulado`; ver
	 * `MARCA_DECREMENTO_ANULADO`.
	 */
	anulado?: boolean;
	/**
	 * El PAGO al que pertenece el evento, cuando se puede saber: el id que la
	 * marca `[pago #N]` deja sobre el `DECREMENTO` y el que los prefijos de
	 * restitución (`Reversa de pago #N`, `Anulación de pago #N`) dejan sobre el
	 * `INCREMENTO` que lo deshace. Es lo que liga una supresión con SU bajada.
	 *
	 * `null` = no se pudo saber. Pasa con las filas ANTERIORES a la marca, que
	 * son casi todo el historial viejo. Esas caen a una bolsa ANÓNIMA —el
	 * comportamiento de antes— porque la alternativa, no suprimir nada sin id,
	 * habría inflado el esperado de todos los ciclos pasados.
	 */
	pagoId?: string | null;
};

/**
 * ¿Este evento RESETEA el techo de mora, o sea, lo baja de verdad?
 *
 * Es la única frontera que le importa a la siembra: el techo vigente de un
 * crédito se estableció en su ÚLTIMO reseteo, y lo anterior ya no dice nada.
 *
 *   * `DESACTIVACION`: el crédito salió del universo de mora. Resetea a 0.
 *   * Cualquier otro evento que BAJE el monto (así quedan registrados los
 *     pagos): resetea al monto que quedó.
 *   * `CONDONACION`: NO resetea. La empresa perdonó la deuda, pero esa deuda ya
 *     se contó como oportunidad cuando nació; que el monto baje a 0 no vuelve a
 *     abrirla.
 *   * Una restitución de reversa de pago (`reverso`): NO resetea. Repone un
 *     techo que el pago anulado había bajado; nunca lo baja. Excluirla acá es lo
 *     que mantiene al ancla alineada con `plegarNivel`, que trata al reverso
 *     como "solo sube".
 */
export function esReseteoDeNivel(evento: MoraLevelEvent): boolean {
	// La marca de "decremento anulado" NO se mira acá, a propósito: esta función
	// solo recorre el tramo ANTERIOR al ciclo, donde la marca no dice si la
	// anulación cayó adentro del ciclo o en otro posterior. Un decremento de un
	// ciclo anterior SÍ bajó el techo —su bajada está descontada de la foto—, y
	// sacarlo del ancla dejaba la siembra arriba y borraba del esperado la
	// reposición de adentro, que es oportunidad real. Ver `anulado` en
	// `MoraLevelEvent`.
	if (evento.tipoEvento === "DESACTIVACION") return true;
	if (evento.tipoEvento === "CONDONACION") return false;
	if (evento.reverso) return false;
	return evento.montoNuevo < evento.montoAnterior;
}

/**
 * El NIVEL DE SIEMBRA: el techo de mora con el que el crédito llega al inicio
 * del ciclo, calculado sobre su historial ANTERIOR al ciclo.
 *
 * No hay ningún corte por días, y no lo necesita. El motivo es estructural:
 *
 *   1. El techo vigente nace en el ÚLTIMO RESETEO anterior al ciclo, que se
 *      encuentra con UNA sola fila (`esReseteoDeNivel`). Todo lo anterior a esa
 *      fila es irrelevante: el reseteo lo borró.
 *   2. Entre dos reseteos el nivel SOLO SUBE. Por definición: una `CONDONACION`
 *      no lo baja, un reverso solo lo sube, y cualquier baja real SERÍA un
 *      reseteo. Entonces el nivel al final del tramo es el MÁXIMO del tramo, que
 *      es un agregado y no un recorrido fila por fila.
 *
 * De ahí que el eje deje de ser el tiempo y pase a ser la fila: una búsqueda
 * (el ancla) más un agregado (el máximo). Un tope de días solo podía elegirse
 * "a ojo", y siempre existía una condonación un día más vieja que el tope cuyo
 * techo se perdía y cuyo rebote de adentro se cobraba como mora nueva.
 *
 * Qué techo deja en pie cada fila del tramo:
 *   * el ANCLA es la única que DERRIBA el techo, así que deja solo lo que quedó
 *     después: su `montoNuevo`, o 0 si es una `DESACTIVACION`.
 *   * una `CONDONACION` deja el techo con el que entró —su `montoAnterior`—:
 *     ESE es el que borró y el que el rebote posterior repone. Tomar su
 *     `montoNuevo` (normalmente 0) sería perderlo.
 *   * cualquier otra fila deja en pie lo más alto entre lo que debía antes y lo
 *     que debe después: no derribó nada, así que el techo no puede bajar.
 *
 * Es exactamente equivalente a plegar el tramo con `plegarNivel`; ver la prueba
 * de equivalencia en el test, que incluye historiales mezclados al azar. Con un
 * historial con huecos el agregado es, si acaso, más conservador —recupera el
 * techo condonado aunque falte la fila que lo había levantado—, que es el lado
 * seguro: nunca reporta como mora nueva una deuda que ya se había condonado.
 */
export function nivelSembrado(previos: MoraLevelEvent[]): number {
	let ancla = -1;
	for (let i = previos.length - 1; i >= 0; i--) {
		if (esReseteoDeNivel(previos[i] as MoraLevelEvent)) {
			ancla = i;
			break;
		}
	}
	let nivel = 0;
	for (let i = Math.max(ancla, 0); i < previos.length; i++) {
		const evento = previos[i] as MoraLevelEvent;
		const techo =
			i === ancla
				? evento.tipoEvento === "DESACTIVACION"
					? 0
					: evento.montoNuevo
				: evento.tipoEvento === "CONDONACION"
					? evento.montoAnterior
					: Math.max(evento.montoAnterior, evento.montoNuevo);
		if (techo > nivel) nivel = techo;
	}
	return nivel;
}

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
 *     del anterior, que es como quedan registrados los pagos): EL TECHO NO
 *     BAJA. Que el cliente pague no borra que esa deuda ya se contó como
 *     oportunidad, así que el rebote del cron que la repone no es oportunidad
 *     nueva: solo lo que SUPERE el máximo ya contado lo es. Bajar el techo al
 *     saldo vivo era el defecto: un pago de Q20 sobre una mora de Q120 dejaba
 *     el techo en Q40, el rebote a Q120 se cobraba como Q80 de mora nueva y el
 *     esperado terminaba en Q200 por una deuda de Q120. La bajada igual se
 *     ANOTA —por Q20, lo que el cliente pagó— porque es lo que su propia
 *     reversa podría reponer sin ser deuda nueva.
 *   * `DESACTIVACION`: el nivel vuelve a 0 —el crédito se puso al día o salió
 *     del universo de mora—; si vuelve a entrar, empieza de cero.
 *   * Una RESTITUCIÓN por pago caído (`reverso`: reversa o anulación): genera
 *     SOLO la parte que este ciclo no vio bajar POR ESE MISMO PAGO. Si el
 *     `DECREMENTO` de ese pago cayó DENTRO del ciclo, reponerlo es deshacer un
 *     paso del recorrido, no deuda nueva —sin esto, un crédito con Q100 de foto
 *     que pagó y se revirtió terminaba con Q200 de esperado—. Pero si el pago
 *     fue ANTES del corte, su decremento ya está descontado de la foto inicial:
 *     esa mora nunca se contó y el asesor la tiene viva hoy, así que suprimirla
 *     borraba una oportunidad REAL. Lo que liga las dos mitades es el id del
 *     pago (`pagoId`); con un contador común, el pago de OTRO que hubiera
 *     bajado adentro tapaba la restitución ajena y la oportunidad viva
 *     desaparecía del reporte. Lo que sí genera SUBE el techo, para que el
 *     `RECALCULO` de la mañana siguiente no cobre lo mismo otra vez.
 *   * Un evento que sube pero NO supera el nivel (el rebote del `RECALCULO` de
 *     la mañana siguiente a una condonación) no suma y tampoco mueve el nivel:
 *     si lo bajara, el siguiente rebote volvería a cobrar lo ya contado.
 *
 * El nivel NO arranca en la foto a secas: llega SEMBRADO con el historial
 * anterior al ciclo (`nivelDeSiembra`, que el SQL calcula como agregado — ver
 * `nivelSembrado`), para que una condonación que quedó del lado de afuera del
 * corte no haga que su rebote de adentro parezca mora nueva. La foto sigue
 * siendo un piso: `Math.max`, porque la foto ya se cuenta aparte en el esperado.
 *
 * Los eventos marcados `previo` son la forma ANTIGUA de sembrar: el tramo previo
 * viajaba fila por fila y se plegaba acá. La consulta ya no los manda —ahora
 * manda el número—, pero el camino se conserva porque es la ESPECIFICACIÓN
 * ejecutable de la regla: el test prueba que el agregado y este plegado dan lo
 * mismo, así que cualquier cambio a `plegarNivel` que el agregado no siga rompe
 * la prueba. Ver `nivelDeArranque`.
 */
export function moraGeneradaEnPeriodo(
	foto: number,
	eventos: MoraLevelEvent[],
	nivelDeSiembra = 0,
): number {
	const previos = eventos.filter((evento) => evento.previo);
	const delCiclo = eventos.filter((evento) => !evento.previo);
	const arranque = Math.max(nivelDeArranque(foto, previos), nivelDeSiembra);
	return plegarNivel(arranque, delCiclo).generado;
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
 *     anterior a la ventana sin necesidad de una segunda foto en la base. Como
 *     la ventana arranca en el último RESETEO, ese primer evento suele ser el
 *     pago mismo y el plegado lo baja a cero, igual que si estuviera adentro
 *     del ciclo.
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
	return Math.max(
		foto,
		// `tramoDelCiclo: false`: este plegado es el de la VÍSPERA. Un decremento
		// de antes del corte bajó el techo de verdad aunque su pago se haya caído
		// después; ver `anulado` en `MoraLevelEvent`.
		plegarNivel(primero.montoAnterior, previos, { tramoDelCiclo: false }).nivel,
	);
}

/**
 * El recorrido en sí. Devuelve el nivel con el que queda y lo generado, para
 * que sembrar (quedarse con el nivel) y medir (quedarse con lo generado) sean
 * literalmente el mismo código y no dos reglas que puedan separarse.
 */
export function plegarNivel(
	nivelInicial: number,
	eventos: MoraLevelEvent[],
	/**
	 * ¿Este recorrido MIDE oportunidad (el ciclo) o solo reconstruye el techo
	 * con el que el crédito LLEGA al ciclo (la víspera)? Son dos lecturas del
	 * mismo número y de ahí salen las tres diferencias:
	 *
	 *   * la marca de decremento anulado solo vale adentro, donde la bajada es
	 *     una que este mismo recorrido vio; afuera la marca no dice CUÁNDO se
	 *     anuló el pago. Ver `anulado` en `MoraLevelEvent`.
	 *   * adentro el nivel es DEUDA YA CONTADA y un pago no la descuenta;
	 *     afuera es el techo VIVO y un pago lo baja de verdad, porque esa
	 *     bajada ya está descontada de la foto inicial y lo que reviva adentro
	 *     es oportunidad que nunca se contó.
	 *   * adentro la restitución suma deuda contada; afuera solo sube el techo.
	 *
	 * Que afuera el pago siga bajando el techo es además lo que mantiene el
	 * plegado alineado con el agregado SQL de la siembra (`nivelSembrado`), que
	 * son equivalentes por prueba.
	 */
	{ tramoDelCiclo = true }: { tramoDelCiclo?: boolean } = {},
): { nivel: number; generado: number } {
	let nivel = nivelInicial;
	let generado = 0;
	// Cuánto bajó CADA PAGO dentro de este recorrido, por pago: el saldo de
	// "deuda ya contada que este ciclo vio desaparecer por ESE pago", que es
	// exactamente lo que la restitución de ESE pago puede reponer sin que sea
	// oportunidad nueva. Las bajadas sin id caen a la bolsa anónima
	// (`SIN_PAGO`), que es el comportamiento de antes. Ver la regla del reverso.
	const bajadoPorPago = new Map<string, number>();
	const anotarBajada = (evento: MoraLevelEvent) => {
		const bajada = evento.montoAnterior - evento.montoNuevo;
		if (bajada <= 0) return;
		const clave = evento.pagoId ?? SIN_PAGO;
		bajadoPorPago.set(clave, (bajadoPorPago.get(clave) ?? 0) + bajada);
	};
	for (const evento of eventos) {
		// Decremento anulado DENTRO del ciclo: ese pago se cayó, así que la
		// bajada no ocurrió y no puede generar nada por sí misma. Se ANOTA igual,
		// para que la restitución de ese mismo pago —si llega— encuentre su
		// bajada y no se cuente como deuda nueva. Fuera del ciclo la marca no se
		// honra: ver `tramoDelCiclo`.
		//
		// QUÉ QUEDA DE ESTA RAMA desde que el techo no baja por un pago: casi
		// nada. El trabajo que hacía —que la reposición del cron no se cobrara
		// como mora nueva— ahora lo hace el techo, con marca o sin ella. Sigue
		// acá porque es lo único correcto que se puede hacer con una bajada que
		// se declaró inexistente: no generar por ella. La marca se conserva
		// además como contrato con quien la escribe (`marcarDecrementoAnulado`).
		if (tramoDelCiclo && evento.anulado) {
			anotarBajada(evento);
			continue;
		}
		if (evento.tipoEvento === "DESACTIVACION") {
			nivel = 0;
			continue;
		}
		if (evento.tipoEvento === "CONDONACION") continue;
		if (evento.reverso) {
			if (!tramoDelCiclo) {
				// En la víspera el nivel es el TECHO VIVO con el que el crédito
				// llega al ciclo, no deuda contada: la restitución solo lo sube.
				if (evento.montoNuevo > nivel) nivel = evento.montoNuevo;
				continue;
			}
			// Restitución (reversa o anulación de pago): el cliente vuelve a deber
			// lo que ese pago había cubierto. Si la bajada de ESE pago la vio este
			// mismo ciclo, reponerla es deshacer un paso del recorrido y no es
			// oportunidad nueva. Si no —el pago fue ANTERIOR al ciclo y su
			// decremento ya está descontado de la foto—, esa deuda NUNCA se contó
			// y está viva hoy: genera, y el techo sube con ella para que el
			// RECALCULO de la mañana siguiente no la vuelva a cobrar.
			const restituido = Math.max(0, evento.montoNuevo - evento.montoAnterior);
			const suprimido = consumirBajada(
				bajadoPorPago,
				evento.pagoId ?? SIN_PAGO,
				restituido,
			);
			generado += restituido - suprimido;
			nivel += restituido - suprimido;
			continue;
		}
		if (evento.montoNuevo > nivel) {
			generado += evento.montoNuevo - nivel;
			nivel = evento.montoNuevo;
		} else if (evento.montoNuevo < evento.montoAnterior) {
			// EL TECHO NO BAJA POR UN PAGO (solo dentro del ciclo): lo ya contado
			// como oportunidad no se vuelve a contar cuando el cron repone la mora.
			// La bajada SÍ se anota —es lo que el cliente efectivamente pagó, y lo
			// que su propia reversa podría reponer—, pero el techo se queda donde
			// estaba. En la VÍSPERA la regla es la contraria: ahí el nivel es el
			// techo vivo y un pago lo baja de verdad, porque esa bajada ya está
			// descontada de la foto inicial y la deuda que reviva adentro nunca se
			// contó. Ver `tramoDelCiclo`.
			if (tramoDelCiclo) anotarBajada(evento);
			else nivel = evento.montoNuevo;
		}
	}
	return { nivel, generado };
}

/** La bolsa de bajadas sin pago identificable: las filas previas a la marca. */
const SIN_PAGO = "";

/**
 * Consume hasta `monto` del crédito de supresión de `clave`, y solo si no
 * alcanza recurre a la bolsa ANÓNIMA.
 *
 * El orden importa y es lo que arregla el defecto: con una sola bolsa común, el
 * pago de adentro del ciclo —ajeno a la reversa— tapaba entera la restitución
 * de un pago anterior al corte, y una oportunidad viva desaparecía del reporte.
 * Ligada al id, la bajada de un pago solo puede suprimir SU propia restitución.
 * La bolsa anónima queda como red para el historial viejo, que no lleva la
 * marca: ahí no hay identidad que ligar y quitarle la supresión habría inflado
 * el esperado de todos los ciclos pasados.
 */
function consumirBajada(
	bajadoPorPago: Map<string, number>,
	clave: string,
	monto: number,
): number {
	let restante = monto;
	let consumido = 0;
	for (const bolsa of clave === SIN_PAGO ? [SIN_PAGO] : [clave, SIN_PAGO]) {
		if (restante <= 0) break;
		const disponible = bajadoPorPago.get(bolsa) ?? 0;
		const toma = Math.min(restante, disponible);
		if (toma <= 0) continue;
		bajadoPorPago.set(bolsa, disponible - toma);
		restante -= toma;
		consumido += toma;
	}
	return consumido;
}

export type MoraRecoverySourceRow = {
	asesorId: number | null;
	nombre: string;
	/** Foto de la mora al INICIO del ciclo (día 6). Es el nivel de arranque. */
	esperado: string;
	/**
	 * Eventos de `moras_historial` del crédito DENTRO del ciclo, en orden de
	 * `fecha`. Con la mora proporcional el monto crece todos los días, así que la
	 * foto inicial ya no es todo lo que el asesor tuvo oportunidad de cobrar: lo
	 * generado sale de plegar estos eventos con `moraGeneradaEnPeriodo`.
	 */
	eventos: MoraLevelEvent[];
	/**
	 * Techo de mora con el que el crédito LLEGA al ciclo, calculado en SQL sobre
	 * su historial anterior (ver `nivelSembrado`). Es lo que impide que el rebote
	 * de una condonación anterior al corte parezca mora nueva. Ausente = 0, que
	 * es el comportamiento de antes de la siembra.
	 */
	nivelSembrado?: string;
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

/**
 * Créditos que se piden por lote al reporte de recuperación.
 *
 * El plegado del nivel de referencia necesita los eventos CRUDOS del ciclo, y
 * con el `RECALCULO` diario de la mora proporcional eso es ~31 eventos por
 * crédito por ciclo (más pagos y condonaciones: digamos ~40 como techo). Traer
 * el ciclo entero de una eran 7.977 eventos antes de la mora proporcional y
 * pasarían a ~45.000, creciendo con la cartera sin techo.
 *
 * Se parte por CRÉDITOS y no por página de respuesta —la respuesta ya es chica,
 * una fila por asesor— porque el plegado es por crédito: partir ahí no puede
 * cambiar el agregado. 500 créditos acotan cada lote a ~20.000 eventos sea cual
 * sea el tamaño de la cartera, y el NÚMERO de lotes depende solo de cuántos
 * créditos elegibles hay, nunca de cuántos eventos tenga cada uno.
 */
export const CREDITOS_POR_LOTE = 500;

/**
 * Parte una lista en trozos de `tamano`. Lista vacía → cero lotes (el reporte
 * sale vacío sin tocar la base).
 */
export function partirEnLotes<T>(
	items: T[],
	tamano: number = CREDITOS_POR_LOTE,
): T[][] {
	if (!Number.isInteger(tamano) || tamano < 1) {
		throw new RangeError(`Tamaño de lote inválido: ${tamano}`);
	}
	const lotes: T[][] = [];
	for (let i = 0; i < items.length; i += tamano) {
		lotes.push(items.slice(i, i + tamano));
	}
	return lotes;
}

/**
 * Universo de créditos del reporte: exactamente el mismo `creditos_con_asesor`
 * que usa `buildMoraRecoveryQuery`, para que la partición en lotes cubra todas
 * las filas que el reporte podría devolver y ni una más. Va ordenado por
 * `credito_id` para que los lotes sean estables entre llamadas.
 */
export function buildMoraRecoveryCreditosQuery({
	asesores,
	emailCobrador,
}: {
	asesores?: number[];
	emailCobrador?: string;
}) {
	return sql`
    SELECT c.credito_id
    FROM cartera.creditos c
    LEFT JOIN cartera.asesores a ON a.asesor_id = c.asesor_id
    WHERE c."statusCredit" IN (${creditosElegiblesMoraSql})
      ${filtroEmailAsesor(emailCobrador)}
      ${filtroAsesores(asesores)}
    ORDER BY c.credito_id
  `;
}

const filtroEmailAsesor = (emailCobrador?: string) =>
	emailCobrador
		? sql`AND LOWER(a.email_cash_in) = LOWER(TRIM(${emailCobrador}))`
		: sql``;

const filtroAsesores = (asesores?: number[]) =>
	asesores?.length
		? sql`AND a.asesor_id IN (${sql.join(
				asesores.map((id) => sql`${id}`),
				sql`, `,
			)})`
		: sql``;

export function buildMoraRecoveryQuery({
	inicio,
	fin,
	fechaSnapshot,
	alcance,
	asesores,
	emailCobrador,
	creditos,
}: MoraRecoveryPeriod & {
	asesores?: number[];
	emailCobrador?: string;
	/**
	 * Lote de créditos a procesar. Sin él la consulta abarca toda la cartera
	 * elegible (es lo que hacen los tests de forma de la consulta).
	 */
	creditos?: number[];
}) {
	const emailFilter = filtroEmailAsesor(emailCobrador);
	const asesoresFilter = filtroAsesores(asesores);
	// El lote acota `creditos_con_asesor`, que es de donde cuelgan los eventos,
	// los pagos y el JOIN final.
	const creditosFilter = creditos?.length
		? sql`AND c.credito_id IN (${sql.join(
				creditos.map((id) => sql`${id}`),
				sql`, `,
			)})`
		: sql``;
	// …pero la FOTO inicial va ANTES de `creditos_con_asesor` y no cuelga de
	// ella: sin este segundo filtro cada lote reconstruía la foto de la cartera
	// COMPLETA y recién descartaba los créditos ajenos en el JOIN final. Con N
	// lotes eso es N veces la foto entera: el batching dejaba de pagar. El lote
	// tiene que entrar TAMBIÉN acá —y en la rama `live`, que tiene su propia
	// foto— para que cada consulta reconstruya solo sus créditos.
	const moraActivaFiltro = creditos?.length
		? sql`AND credito_id = ANY (ARRAY[${sql.join(
				creditos.map((id) => sql`${id}`),
				sql`, `,
			)}]::int[])`
		: sql``;
	const snapshotCte =
		alcance === "historico"
			? sql`${snapCte(fechaSnapshot, false, creditos)}, snapshot_por_credito AS (
      SELECT s.credito_id, s.monto::numeric AS esperado
      FROM snap s
      WHERE s.tipo_evento <> 'DESACTIVACION' AND s.monto > 0 AND s.cuotas > 0
    )`
			: sql`mora_activa AS (
      SELECT DISTINCT ON (credito_id) credito_id, monto_mora::numeric AS esperado
      FROM cartera.moras_credito
      WHERE activa = true AND cuotas_atrasadas > 0
        ${moraActivaFiltro}
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
	// La siembra NO tiene un límite inferior de fecha: se acota por FILAS (el
	// último reseteo) y no por días. Ver `nivelSembrado`.
	if (!inicioUtc || !finUtc) {
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
        ${creditosFilter}
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
    -- Los eventos del CICLO, crudos y en orden, SIN agregar: lo generado no es
    -- una suma de deltas sino un recorrido con estado (el "nivel de referencia"
    -- de \`moraGeneradaEnPeriodo\`), porque una condonación y el rebote que la
    -- repone no son deuda nueva mientras que una baja por pago sí reabre la
    -- oportunidad. Esa regla vive en TypeScript, donde se prueba sin base.
    -- Se traen TODOS los tipos: el nivel depende tanto de lo que sube como de
    -- lo que baja y de por qué bajó.
    -- LIMITACIÓN: el RECALCULO diario solo existe desde el despliegue de la mora
    -- proporcional. Antes el monto casi no cambiaba y el cron escribía \`sinCambios\`,
    -- así que para ciclos viejos el historial es escaso y el esperado queda
    -- APROXIMADO POR LO BAJO. No es un defecto del cálculo: el dato no existe hacia atrás.
    eventos_crudos AS (
      SELECT h.credito_id, h.fecha, h.historial_id, h.tipo_evento,
             h.monto_anterior::numeric::text AS monto_anterior,
             h.monto_nuevo::numeric::text AS monto_nuevo,
             -- La restitución de una reversa de pago entra como INCREMENTO
             -- manual, idéntica a un ajuste a mano: el \`motivo\` es la única
             -- marca que las separa. Ver \`esRestitucionSql\`.
             (h.tipo_evento = 'INCREMENTO' AND ${esRestitucionSql(sql.raw("h.motivo"))}) AS reverso,
             -- El decremento de un pago que se cayó: la bajada no ocurrió. Ver
             -- \`esDecrementoAnuladoSql\`.
             ${esDecrementoAnuladoSql(sql.raw("h.motivo"))} AS anulado,
             -- El pago del que habla el evento, para ligar cada restitución
             -- con SU bajada y no con la de otro. Ver \`pagoDelEventoSql\`.
             ${pagoDelEventoSql(sql.raw("h.motivo"))} AS pago_id
      FROM cartera.moras_historial h
      JOIN creditos_con_asesor ca ON ca.credito_id = h.credito_id
      WHERE h.fecha >= ${inicioUtc}::timestamp
        AND h.fecha < ${finUtc}::timestamp
    ),
    eventos_por_credito AS (
      SELECT e.credito_id,
             JSON_AGG(
               JSON_BUILD_OBJECT(
                 'tipoEvento', e.tipo_evento,
                 'montoAnterior', e.monto_anterior,
                 'montoNuevo', e.monto_nuevo,
                 'reverso', e.reverso,
                 'anulado', e.anulado,
                 'pagoId', e.pago_id
               )
               ORDER BY e.fecha, e.historial_id
             ) AS eventos
      FROM eventos_crudos e
      GROUP BY e.credito_id
    ),
    -- SIEMBRA: el techo con el que el crédito llega al día 6. Sin ella el nivel
    -- arrancaría en la foto a secas, y si lo último antes del corte fue una
    -- CONDONACION la foto dice cero y el rebote del cron de adentro se contaría
    -- entero: el doble conteo que el nivel de referencia existe para evitar,
    -- metido por el borde.
    -- No se acota por DÍAS —cualquier número elegido a ojo deja afuera una
    -- condonación un día más vieja— sino por FILAS: una búsqueda (el ancla: el
    -- último evento anterior al ciclo que bajó el techo de verdad) más un
    -- agregado (el máximo desde el ancla), porque entre dos reseteos el nivel
    -- solo sube. La equivalencia con el plegado fila por fila está probada en el
    -- test; ver \`nivelSembrado\`.
    -- Se calcula SOLO para los créditos que tuvieron un evento DENTRO del ciclo
    -- (\`FROM eventos_por_credito\`): la siembra acompaña, no amplía el universo
    -- del reporte, que es lo que antes garantizaba el \`HAVING BOOL_OR(NOT previo)\`.
    nivel_sembrado AS (
      SELECT e.credito_id, COALESCE(techo.nivel, 0)::text AS nivel
      FROM eventos_por_credito e
      -- El ANCLA: UNA sola fila por crédito, sin ventana de tiempo. La
      -- CONDONACION queda fuera a propósito (perdonar no reabre la oportunidad)
      -- y la restitución de una reversa también (repone el techo, no lo baja).
      LEFT JOIN LATERAL (
        SELECT h.fecha, h.historial_id
        FROM cartera.moras_historial h
        WHERE h.credito_id = e.credito_id
          AND h.fecha < ${inicioUtc}::timestamp
          -- La marca de DECREMENTO ANULADO no se mira acá: todas estas filas son
          -- anteriores al ciclo y la marca no dice CUÁNDO se anuló el pago. Un
          -- decremento de un ciclo anterior sí bajó el techo —su bajada ya está
          -- descontada de la foto—, así que sacarlo del ancla dejaba la siembra
          -- arriba y la reposición de adentro salía con esperado 0 teniendo la
          -- mora viva. Espejo de \`esReseteoDeNivel\`.
          AND (h.tipo_evento = 'DESACTIVACION'
               OR (h.tipo_evento <> 'CONDONACION'
                   AND NOT (h.tipo_evento = 'INCREMENTO'
                            AND ${esRestitucionSql(sql.raw("h.motivo"))})
                   AND h.monto_nuevo < h.monto_anterior))
        ORDER BY h.fecha DESC, h.historial_id DESC
        LIMIT 1
      ) ancla ON TRUE
      -- El MÁXIMO desde el ancla (incluida), o sobre el historial entero si no
      -- hubo ninguna: si nunca hubo un reseteo, nada bajó nunca el techo.
      -- Cada fila deja un techo en pie: el ANCLA es la única que lo DERRIBA, así
      -- que deja solo lo que quedó; la CONDONACION deja el que borró
      -- (\`monto_anterior\`); el resto no derriba nada, así que deja lo más alto
      -- entre antes y después. Espejo exacto de \`nivelSembrado\`.
      LEFT JOIN LATERAL (
        SELECT MAX(CASE
                     WHEN h.historial_id = ancla.historial_id
                       THEN CASE WHEN h.tipo_evento = 'DESACTIVACION'
                                 THEN 0::numeric
                                 ELSE h.monto_nuevo::numeric END
                     WHEN h.tipo_evento = 'CONDONACION' THEN h.monto_anterior::numeric
                     ELSE GREATEST(h.monto_anterior, h.monto_nuevo)::numeric
                   END) AS nivel
        FROM cartera.moras_historial h
        WHERE h.credito_id = e.credito_id
          AND h.fecha < ${inicioUtc}::timestamp
          AND (ancla.fecha IS NULL
               OR (h.fecha, h.historial_id) >= (ancla.fecha, ancla.historial_id))
      ) techo ON TRUE
    )
    SELECT
      ca.asesor_id,
      COALESCE(ca.nombre, 'Sin asignar') AS nombre,
      COALESCE(s.esperado, 0)::text AS esperado,
      COALESCE(e.eventos, '[]'::json) AS eventos,
      COALESCE(n.nivel, '0') AS nivel_sembrado,
      COALESCE(p.cobrado, 0)::text AS cobrado
    FROM snapshot_por_credito s
    FULL JOIN pagos_por_credito p ON p.credito_id = s.credito_id
    FULL JOIN eventos_por_credito e ON e.credito_id = COALESCE(s.credito_id, p.credito_id)
    LEFT JOIN nivel_sembrado n ON n.credito_id = e.credito_id
    JOIN creditos_con_asesor ca ON ca.credito_id = COALESCE(s.credito_id, p.credito_id, e.credito_id)
  `;
}

/**
 * La forma CRUDA de un evento tal como lo emite el `JSON_BUILD_OBJECT` de
 * `buildMoraRecoveryQuery`. Los montos son texto a propósito: `numeric` →
 * número de JSON los haría pasar por el `double` del driver.
 *
 * Vive acá, pegado a la consulta que lo produce, y no en el llamador: quien
 * agregue una clave al `JSON_BUILD_OBJECT` la agrega también acá, y a partir
 * de ese momento el compilador exige traducirla (ver `TRADUCTORES_EVENTO`).
 */
export type MoraRecoveryEventoCrudo = {
	tipoEvento: string;
	montoAnterior: string;
	montoNuevo: string;
	reverso: boolean;
	anulado: boolean;
	/** El id del pago del evento, o NULL si el motivo no lo lleva. */
	pagoId: string | null;
};

/**
 * La fila CRUDA que devuelve el `SELECT` final de `buildMoraRecoveryQuery`,
 * con los nombres de columna tal cual salen de Postgres.
 */
export type MoraRecoveryFilaCruda = {
	asesor_id: number | null;
	nombre: string | null;
	esperado: string;
	eventos: MoraRecoveryEventoCrudo[] | null;
	nivel_sembrado: string;
	cobrado: string;
};

/**
 * A qué campo de `MoraRecoverySourceRow` corresponde cada columna cruda.
 *
 * Existe solo porque el SQL sale en `snake_case` y el plegado consume
 * `camelCase`. Es el primero de los dos candados: una columna nueva que no
 * figure acá hace fallar el tipo de `TRADUCTORES_FILA` (`CampoDestino[K]` no
 * existe), así que ni siquiera se llega a discutir si alguien "se acordó" de
 * mapearla.
 */
type CampoDestino = {
	asesor_id: "asesorId";
	nombre: "nombre";
	esperado: "esperado";
	eventos: "eventos";
	nivel_sembrado: "nivelSembrado";
	cobrado: "cobrado";
};

/**
 * POR QUÉ ESTA TABLA Y NO UN OBJETO A MANO.
 *
 * Tres veces seguidas se perdió un campo en este mismo punto —`nivel_sembrado`,
 * `reverso` y `anulado`—: la consulta lo emitía, el objeto literal del llamador
 * no lo copiaba, el campo llegaba `undefined` y el plegado lo ignoraba EN
 * SILENCIO. Compilaba, pasaba los tests, y el reporte decía otra cosa.
 *
 * El defecto no era el campo: era que se PUDIERA olvidar uno. Un objeto literal
 * que omite una propiedad opcional es código válido, así que ninguna revisión
 * ni ningún tipo lo detenía.
 *
 * Acá la traducción deja de ser un objeto literal y pasa a ser una tabla
 * INDEXADA POR LAS COLUMNAS DE LA CONSULTA: el tipo obliga a que haya una
 * entrada por cada clave de `MoraRecoveryFilaCruda`, ni una menos. Agregar una
 * columna a la consulta y no traducirla ya no compila.
 *
 * `Required<Pick<…>>` cierra el segundo agujero: sin él, la entrada de un campo
 * OPCIONAL del destino (como `nivelSembrado`) podía devolver `{}` y volvíamos al
 * mismo silencio, pero con más ceremonia.
 *
 * Los tests de "MUTACIÓN: perder X en el mapeo" siguen vivos y siguen haciendo
 * falta: el tipo obliga a ESCRIBIR la entrada, los tests obligan a que lo que
 * escribió sea lo correcto.
 */
const TRADUCTORES_FILA: {
	[K in keyof MoraRecoveryFilaCruda]-?: (
		fila: MoraRecoveryFilaCruda,
	) => Required<Pick<MoraRecoverySourceRow, CampoDestino[K]>>;
} = {
	asesor_id: (fila) => ({ asesorId: fila.asesor_id }),
	// Sin asesor asignado el reporte igual tiene que mostrar la fila: el crédito
	// generó mora aunque nadie la esté cobrando.
	nombre: (fila) => ({ nombre: fila.nombre ?? "Sin asignar" }),
	esperado: (fila) => ({ esperado: fila.esperado }),
	eventos: (fila) => ({
		eventos: (fila.eventos ?? []).map(traducirEventoMoraRecovery),
	}),
	nivel_sembrado: (fila) => ({ nivelSembrado: fila.nivel_sembrado }),
	cobrado: (fila) => ({ cobrado: fila.cobrado }),
};

/**
 * Igual que `TRADUCTORES_FILA` pero para cada evento del JSON. Acá los nombres
 * ya coinciden con los de `MoraLevelEvent`, así que el candado es más directo:
 * `Pick<MoraLevelEvent, K>` exige que la clave cruda EXISTA en el evento del
 * plegado, y una clave nueva que no exista ahí tampoco compila.
 */
const TRADUCTORES_EVENTO: {
	[K in keyof MoraRecoveryEventoCrudo]-?: (
		crudo: MoraRecoveryEventoCrudo,
	) => Required<Pick<MoraLevelEvent, K>>;
} = {
	tipoEvento: (crudo) => ({ tipoEvento: crudo.tipoEvento }),
	montoAnterior: (crudo) => ({ montoAnterior: Number(crudo.montoAnterior) }),
	montoNuevo: (crudo) => ({ montoNuevo: Number(crudo.montoNuevo) }),
	// `=== true` y no un cast: el driver puede devolver el booleano de Postgres
	// como texto dentro del JSON, y `"false"` es verdadero en JavaScript.
	reverso: (crudo) => ({ reverso: crudo.reverso === true }),
	anulado: (crudo) => ({ anulado: crudo.anulado === true }),
	// `?? null` y no el valor crudo: `undefined` haría que la clave existiera
	// con el valor de "no vino", y la bolsa anónima se elige por `null`.
	pagoId: (crudo) => ({ pagoId: crudo.pagoId ?? null }),
};

/**
 * Las claves de `MoraRecoveryEventoCrudo`, en tiempo de EJECUCIÓN.
 *
 * Sale de `TRADUCTORES_EVENTO` y no de una lista escrita a mano porque esa
 * tabla es un tipo mapeado `[K in keyof MoraRecoveryEventoCrudo]-?`: tiene
 * exactamente una entrada por campo del tipo, ni una más (una clave de sobra
 * no compila) ni una menos (`-?` las hace todas obligatorias). Así, la prueba
 * de contrato que compara estas claves contra el `JSON_BUILD_OBJECT` del SQL
 * no depende de una TERCERA lista que también habría que acordarse de tocar.
 */
export const CLAVES_EVENTO_MORA_RECOVERY_CRUDO: readonly (keyof MoraRecoveryEventoCrudo)[] =
	Object.keys(TRADUCTORES_EVENTO) as (keyof MoraRecoveryEventoCrudo)[];

/** Arma el evento del plegado aplicando TODAS las entradas de la tabla. */
export function traducirEventoMoraRecovery(
	crudo: MoraRecoveryEventoCrudo,
): MoraLevelEvent {
	const evento = {} as MoraLevelEvent;
	for (const traducir of Object.values(TRADUCTORES_EVENTO)) {
		Object.assign(evento, traducir(crudo));
	}
	return evento;
}

/**
 * Arma la fila que consume el acumulador aplicando TODAS las entradas de la
 * tabla. El llamador ya no copia campo por campo: le pasa la fila cruda.
 */
export function traducirFilaMoraRecovery(
	fila: MoraRecoveryFilaCruda,
): MoraRecoverySourceRow {
	const row = {} as MoraRecoverySourceRow;
	for (const traducir of Object.values(TRADUCTORES_FILA)) {
		Object.assign(row, traducir(fila));
	}
	return row;
}

function metricFrom(
	row: Omit<MoraRecoverySourceRow, "asesorId" | "nombre">,
): MoraRecoveryMetric {
	// El esperado del reporte = foto inicial + lo generado dentro del ciclo, que es
	// exactamente lo que el asesor tuvo oportunidad de cobrar.
	const foto = Number(row.esperado);
	const esperado =
		foto +
		moraGeneradaEnPeriodo(foto, row.eventos, Number(row.nivelSembrado ?? 0));
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

/**
 * Acumulador del reporte: un asesor por clave, ya plegado.
 *
 * Existe para que el reporte se pueda armar POR LOTES de créditos sin tener
 * nunca todos los eventos del ciclo en memoria: cada lote se pliega acá y los
 * eventos crudos se sueltan. Como el plegado del nivel de referencia es POR
 * CRÉDITO y la suma por asesor es asociativa, el resultado es el mismo que en
 * una sola pasada.
 */
export type MoraRecoveryAccumulator = Map<string, MoraRecoveryRow>;

export const nuevoMoraRecoveryAccumulator = (): MoraRecoveryAccumulator =>
	new Map();

export function acumularMoraRecoveryRows(
	byAsesor: MoraRecoveryAccumulator,
	rows: MoraRecoverySourceRow[],
): MoraRecoveryAccumulator {
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
	return byAsesor;
}

export function finalizarMoraRecoveryReport(
	byAsesor: MoraRecoveryAccumulator,
	periodo: { inicio: string; fin: string; alcance: "live" | "historico" },
): MoraRecoveryReport {
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

/**
 * Una sola pasada: sigue siendo la forma natural de probar el plegado sin base.
 * El endpoint usa el acumulador por lotes, que da lo mismo.
 */
export function buildMoraRecoveryReport(
	rows: MoraRecoverySourceRow[],
	periodo: { inicio: string; fin: string; alcance: "live" | "historico" },
): MoraRecoveryReport {
	return finalizarMoraRecoveryReport(
		acumularMoraRecoveryRows(nuevoMoraRecoveryAccumulator(), rows),
		periodo,
	);
}
