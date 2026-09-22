/**
 * Plantillas de mensajes de cobros — versión SERVER usada por el envío masivo
 * de WhatsApp (cobros.ts → enviarWhatsappMasivoCobros).
 *
 * Cada `cuerpo` tiene que coincidir EXACTAMENTE con la plantilla aprobada en
 * Meta (WhatsApp Business). En particular, los párrafos separados por línea
 * en blanco (`\n\n`) son lo que `splitTemplateParams` (simpletech.ts) usa
 * para decidir cuántos parámetros tiene el template — ese conteo determina
 * qué plantilla se selecciona vía `resolveTemplateNameByParamCount`.
 *
 * Por eso esta versión coincide con el `cuerpoWhastapp` del archivo del front
 * (`apps/web/src/lib/cobros/plantillas-mensajes.ts`), no con el `cuerpo`
 * largo orientado a email. Si tocás los párrafos, podés romper el match con
 * la plantilla aprobada y SimpleTech rechazará el envío.
 *
 * Eventualmente ambas versiones deberían leer desde una tabla
 * `plantillas_mensaje` en la BD (ver RFC en el archivo del front).
 */

import Big from "big.js";

export interface VariablesPlantilla {
	clienteNombre: string;
	fechaPago: string;
	cuotaMensual: string;
	placa: string;
	marcaLineaModelo: string;
	/**
	 * Lo que el cliente debe HOY para ponerse al día: saldo real de cada cuota
	 * vencida (recibo menos lo ya abonado) + mora. Lo usan "Notificación 1 cuota
	 * atrasada", "2-3 cuotas atrasadas" y el aviso jurídico; sale de
	 * calcularMontoAdeudadoDesdeCuotas sobre el detalle de cartera.
	 */
	montoAdeudado: string;
	cuotasAtraso: number;
	telefonoAsesor: string;
	nombreAsesor: string;
	/**
	 * Tope de mora de UNA cuota: su cargo mensual completo (capital × 1.12%).
	 * Es lo máximo que puede llegar a cobrar esa cuota por más días que pasen.
	 */
	expectativaMora: string;
	/**
	 * Recargo por cada día de atraso de una cuota: 1/30 del cargo mensual. Es
	 * lo que el cron sumará mañana si el cliente no paga hoy.
	 */
	expectativaMoraDiaria?: string;
	/**
	 * Lo que sube POR DÍA el crédito que YA está en mora — no confundir con
	 * `expectativaMoraDiaria`:
	 *  - expectativaMoraDiaria es el recargo de UNA cuota (1/30 de su cargo
	 *    mensual). Se le dice a un cliente AL DÍA: "si no pagás hoy, empieza a
	 *    correr esto".
	 *  - incrementoDiarioMora es lo que crece el crédito COMPLETO: 1/30 por
	 *    CADA cuota vencida que todavía no llegó a su techo de 30 días. Tres
	 *    cuotas frescas crecen 3/30 por día; una cuota abandonada hace 200 días
	 *    ya está congelada y aporta 0, así que un crédito viejo puede traer
	 *    "0.00" aunque deba mucho.
	 * Lo calcula cartera-back (`incrementoDiarioMora` en latefee.ts), que es el
	 * único que conoce los días de cada cuota. Lo usan las plantillas de mora
	 * (1 cuota, 2-3 cuotas, jurídico) para que el cliente pueda calcular lo que
	 * debe el día que pague, en vez de pagar el monto de hoy dos días después y
	 * dejar residuo.
	 */
	incrementoDiarioMora?: string;
	/** Año del impuesto de circulación. Default: año actual en Guatemala. */
	anioImpuesto?: string;
	/** Fecha límite del impuesto (dd/mm/año). Default: 31/07 del año actual. */
	fechaLimiteImpuesto?: string;
	/** Nombre de la aseguradora para la bienvenida. Default: Seguros Universales. */
	aseguradora?: string;
	/** Cabina de emergencia de la aseguradora. Default: la de Universales. */
	cabinaSeguro?: string;
}

/**
 * Fila de `cuotasAtrasadas` tal como la devuelve `getCredito` de cartera: una
 * por par cuota-pago (leftJoin), así que una misma cuota puede venir repetida
 * si tiene varias filas de pago. Los `abono_*` son los rubros con que cartera
 * decide cobertura (`sumarAplicadoACuota` en registerPaymentPolicy.ts) y los
 * `*_restante` son lo que el RECIBO de esa fila dice que aún falta (los seis
 * que lee `esReciboSaldado`).
 */
export interface FilaCuotaAtrasada {
	numero_cuota: number | null;
	paymentFalse?: boolean | null;
	validationStatus?: string | null;
	abono_capital?: string | number | null;
	abono_interes?: string | number | null;
	abono_iva_12?: string | number | null;
	abono_seguro?: string | number | null;
	abono_gps?: string | number | null;
	membresias_pago?: string | number | null;
	// Buckets que solo se usan para decidir si una fila `no_required` lleva
	// plata real (ver filaCuentaComoViva). `pago_mora`/`pago_otros` son los
	// alias con que la query de cuotas atrasadas devuelve `mora` y `otros`.
	monto_aplicado?: string | number | null;
	abono_interes_ci?: string | number | null;
	abono_iva_ci?: string | number | null;
	pago_mora?: string | number | null;
	pago_otros?: string | number | null;
	capital_restante?: string | number | null;
	interes_restante?: string | number | null;
	iva_12_restante?: string | number | null;
	seguro_restante?: string | number | null;
	gps_restante?: string | number | null;
	membresias_restante?: string | number | null;
}

/** Cuotas atrasadas ÚNICAS (por numero_cuota) en las filas del leftJoin. */
export function contarCuotasAtrasadasUnicas(
	filas: ReadonlyArray<Pick<FilaCuotaAtrasada, "numero_cuota">>,
): number {
	return new Set(filas.map((fila) => fila.numero_cuota)).size;
}

/** Rubros de cuota que un pago vivo aplica (misma suma que sumarAplicadoACuota). */
const RUBROS_APLICADOS = [
	"abono_capital",
	"abono_interes",
	"abono_iva_12",
	"abono_seguro",
	"abono_gps",
	"membresias_pago",
] as const;

/** Saldos del recibo (los seis que lee esReciboSaldado en cartera). */
const RUBROS_RESTANTES = [
	"capital_restante",
	"interes_restante",
	"iva_12_restante",
	"seguro_restante",
	"gps_restante",
	"membresias_restante",
] as const;

function aBig(valor: string | number | null | undefined): Big | null {
	if (valor === null || valor === undefined || valor === "") return null;
	try {
		return new Big(valor);
	} catch {
		return null;
	}
}

/** Σ rubros de cuota que esta fila aplicó (null o no numérico cuenta como 0). */
function aplicadoDeFila(fila: FilaCuotaAtrasada): Big {
	let total = new Big(0);
	for (const rubro of RUBROS_APLICADOS) {
		total = total.plus(aBig(fila[rubro]) ?? 0);
	}
	return total;
}

/** Tolerancia con que cartera decide si una fila lleva plata real. */
const TOLERANCIA_PLATA = "0.01";

/**
 * ¿Esta fila cuenta como pago vivo al netear la cuota? Réplica de
 * `cuentaComoHermanoVivo` (registerPaymentPolicy.ts): además de
 * validated/pending, una fila `no_required` cuenta cuando NO está vacía.
 *
 * El `no_required` es un estado inicial que nadie vuelve a tocar, así que una
 * semilla puede acumular plata real (Caja la llena con /editPayment, la aplica
 * y hasta la factura) sin cambiar de status — y sus `*_restante` pueden quedar
 * viejos, así que el recibo no compensa. Sin esto, esa plata no se restaba y
 * el mensaje cobraba de más. La decisión mira la PLATA, no el status, con los
 * mismos buckets que `esDestinoSobrescribible`.
 */
function filaCuentaComoViva(fila: FilaCuotaAtrasada): boolean {
	if (fila.paymentFalse !== false) return false;
	if (
		fila.validationStatus === "validated" ||
		fila.validationStatus === "pending"
	) {
		return true;
	}
	if (fila.validationStatus !== "no_required") return false;

	const tolerancia = new Big(TOLERANCIA_PLATA);
	return [
		fila.monto_aplicado,
		fila.abono_capital,
		fila.abono_interes,
		fila.abono_iva_12,
		fila.abono_seguro,
		fila.abono_gps,
		fila.membresias_pago,
		fila.abono_interes_ci,
		fila.abono_iva_ci,
		fila.pago_mora,
		fila.pago_otros,
	].some((bucket) => (aBig(bucket)?.abs() ?? new Big(0)).gte(tolerancia));
}

/**
 * Saldo que el RECIBO de esta fila dice que aún falta (Σ `*_restante`), o
 * null si no es confiable:
 *  - fila anulada, o de un pago que no es el recibo de la cuota ni plata viva
 *    (solo cuentan no_required = recibo sembrado, validated y pending);
 *  - algún restante sin informar — un NULL no es un cero (mismo criterio que
 *    esReciboSaldado en cartera);
 *  - restantes en 0: dentro de una cuota que cartera sigue listando como
 *    atrasada, una fila así es la fila de CIERRE de una cuota partida cuyo
 *    hermano se anuló (residuo), no un recibo saldado; su deuda la da el valor
 *    contractual menos lo aplicado.
 */
function saldoReciboDeFila(fila: FilaCuotaAtrasada): Big | null {
	if (fila.paymentFalse !== false) return null;
	if (
		fila.validationStatus !== "no_required" &&
		fila.validationStatus !== "validated" &&
		fila.validationStatus !== "pending"
	) {
		return null;
	}
	let total = new Big(0);
	for (const rubro of RUBROS_RESTANTES) {
		const valor = aBig(fila[rubro]);
		if (valor === null) return null;
		total = total.plus(valor);
	}
	return total.gt(0.01) ? total : null;
}

/**
 * Monto adeudado real ({montoAdeudado}) a partir de las filas de
 * `cuotasAtrasadas` del detalle: por cada cuota ÚNICA, su saldo, y al final se
 * suma la mora. El saldo de una cuota es el MENOR entre:
 *
 *  1. Valor contractual − lo ya cubierto por pagos vivos. "Cubierto" replica
 *     `calcularCoberturaCuota` de cartera (pagos con paymentFalse=false en
 *     validated o pending; Σ abono_capital + abono_interes + abono_iva_12 +
 *     abono_seguro + abono_gps + membresias_pago; nunca monto_aplicado ni
 *     mora/otros). Así un abono parcial de Q600 a una cuota de Q1,000 deja
 *     Q400 y una cuota con dos filas de pago se cuenta una sola vez.
 *  2. Lo que el recibo dice que falta (Σ `*_restante` de la fila confiable
 *     más baja, ver saldoReciboDeFila). Cubre los recibos RECORTADOS: tras un
 *     abono grande el recálculo topa el capital del último recibo y los de
 *     cola quedan solo con seguro/GPS, así que su total real es menor a
 *     `credito.cuota` (mismo criterio con que cartera los da por saldados en
 *     esReciboSaldado y los cobra en calcularSaldoNetoCuota). Los restantes
 *     solo bajan al aplicar pagos, por eso ante hermanos desincronizados
 *     manda el menor, y el tope contractual evita que un recibo stale infle.
 *
 * INCOBRABLE: al castigar, cartera conserva las cuotas históricas no pagadas
 * (con sus recibos anulados y los restantes en 0), pone `credito.cuota` = TODO
 * el capital castigado y crea UNA cuota nueva con el recibo base
 * SISTEMA-INCOBRABLE (capital_restante = capital). Ahí la deuda vive solo en
 * ese recibo activo, así que los grupos sin recibo confiable se OMITEN en vez
 * de caer al contractual (sumarían el capital completo por cada cuota
 * histórica). Mismo criterio que shouldIncobrableInstallmentBePaid en cartera:
 * "queda una sola cuota que representa el capital incobrable". Si NINGÚN grupo
 * trae recibo activo (el del castigo vence hoy y la query pide vencidas antes
 * de hoy) se devuelve "" en vez de un total con solo la mora.
 *
 * Devuelve "" si no hay cuotas o el total no es positivo.
 */
export function calcularMontoAdeudadoDesdeCuotas(
	filas: ReadonlyArray<FilaCuotaAtrasada>,
	cuota: string | number | null | undefined,
	montoMora: string | number | null | undefined,
	statusCredit?: string | null,
): string {
	if (filas.length === 0) return "";
	const cuotaBig = aBig(cuota ?? 0);
	const moraBig = aBig(montoMora ?? 0);
	if (!cuotaBig || !moraBig) return "";
	// En INCOBRABLE solo cuentan los grupos con recibo confiable (ver doc).
	const soloRecibosActivos = statusCredit === "INCOBRABLE";

	const porCuota = new Map<
		number | null,
		{ aplicado: Big; saldoRecibo: Big | null }
	>();
	for (const fila of filas) {
		const grupo = porCuota.get(fila.numero_cuota) ?? {
			aplicado: new Big(0),
			saldoRecibo: null,
		};
		if (filaCuentaComoViva(fila)) {
			grupo.aplicado = grupo.aplicado.plus(aplicadoDeFila(fila));
		}
		const saldoRecibo = saldoReciboDeFila(fila);
		if (
			saldoRecibo !== null &&
			(grupo.saldoRecibo === null || saldoRecibo.lt(grupo.saldoRecibo))
		) {
			grupo.saldoRecibo = saldoRecibo;
		}
		porCuota.set(fila.numero_cuota, grupo);
	}

	let total = moraBig;
	let aportoAlgunGrupo = false;
	for (const { aplicado, saldoRecibo } of porCuota.values()) {
		if (soloRecibosActivos && saldoRecibo === null) continue;
		aportoAlgunGrupo = true;
		let saldo = cuotaBig.minus(aplicado);
		if (saldoRecibo !== null && saldoRecibo.lt(saldo)) saldo = saldoRecibo;
		if (saldo.gt(0)) total = total.plus(saldo);
	}
	// En INCOBRABLE, ningún grupo con recibo activo = el capital castigado no
	// entró en la cuenta: la cuota del castigo vence HOY y la query de cuotas
	// atrasadas pide `fecha_vencimiento < hoy`, así que buena parte del día del
	// castigo el recibo base no viene en `filas`. Devolver solo la mora diría un
	// monto muchísimo menor al real, así que no se devuelve nada y el envío se
	// descarta (el modal y el masivo ya tratan "" como "sin monto").
	if (soloRecibosActivos && !aportoAlgunGrupo) return "";
	if (total.lte(0)) return "";
	return Number(total.toFixed(2)).toLocaleString("es-GT", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
}

/**
 * Bloque del seguro de la bienvenida según la aseguradora de la oportunidad
 * (`opportunities.insurance_provider`: "universales" | "gyt", ver
 * lib/insurance-selection.ts). Default Universales: la columna nace con ese
 * default y cualquier valor desconocido cae ahí.
 */
export function seguroPorAseguradora(
	insuranceProvider: string | null | undefined,
): { aseguradora: string; cabinaSeguro: string } {
	if (insuranceProvider?.trim().toLowerCase() === "gyt") {
		return { aseguradora: "Seguro GYT", cabinaSeguro: "1778" };
	}
	return { aseguradora: "Seguros Universales", cabinaSeguro: "2384-7400" };
}

/**
 * Fecha límite del impuesto de circulación (SAT): 31 de julio, 5:00 p.m., de
 * CADA año. El año se calcula al momento de interpolar para que la plantilla
 * no quede vencida de un año al otro; si SAT moviera el día/mes, se ajusta
 * esta constante. Después de la fecha límite los asesores editan el mensaje o
 * contactan personalmente.
 */
const DIA_MES_LIMITE_IMPUESTO = "31/07";
/** Hora local (Guatemala, 0-23) del corte: las 5:00 p.m. que dice el mensaje. */
const HORA_LIMITE_IMPUESTO = 17;

export function anioImpuestoCirculacion(ahora = new Date()): string {
	// Año calendario en Guatemala (evita el desfase de UTC en el cambio de año).
	return new Intl.DateTimeFormat("es-GT", {
		timeZone: "America/Guatemala",
		year: "numeric",
	}).format(ahora);
}

export function fechaLimiteImpuestoCirculacion(ahora = new Date()): string {
	return `${DIA_MES_LIMITE_IMPUESTO}/${anioImpuestoCirculacion(ahora)}`;
}

/**
 * true si en Guatemala ya pasó la fecha límite del impuesto del año: después
 * del 31/07, o el mismo 31/07 a partir de las 17:00 (el mensaje pide el
 * comprobante "antes de las 5:00 p.m.", así que a esa hora ya venció).
 */
export function fechaLimiteImpuestoVencida(ahora = new Date()): boolean {
	const partes = new Intl.DateTimeFormat("en-CA", {
		timeZone: "America/Guatemala",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		hourCycle: "h23",
	}).formatToParts(ahora);
	const parte = (tipo: string) =>
		partes.find((p) => p.type === tipo)?.value ?? "";
	const mmdd = `${parte("month")}${parte("day")}`;
	const [diaLimite, mesLimite] = DIA_MES_LIMITE_IMPUESTO.split("/");
	const limite = `${mesLimite}${diaLimite}`;
	if (mmdd !== limite) return mmdd > limite;
	return Number(parte("hour")) >= HORA_LIMITE_IMPUESTO;
}

/**
 * Un cuerpo que todavía trae {fechaLimiteImpuesto} no debería enviarse después
 * de la fecha límite del año: pediría el comprobante "antes de la hora límite"
 * de una fecha ya vencida. Pasado el corte, el asesor reemplaza la variable por
 * la fecha nueva (o borra la línea) y el envío se habilita. El año
 * ({anioImpuesto}) por sí solo no bloquea: mencionarlo no es lo que vence.
 */
export function cuerpoUsaFechaLimiteImpuesto(cuerpo: string): boolean {
	return cuerpo.includes("{fechaLimiteImpuesto}");
}

/**
 * Mora PROPORCIONAL a los días de atraso. MISMA fórmula que el job nocturno
 * `procesarMoras` de cartera-back (`calcularMoraProporcional` en
 * apps/cartera-back/src/controllers/latefee.ts):
 *
 *   mora = Σ capital × 1.12% × min(1, días_i / 30)   (por cada cuota vencida)
 *
 * Una cuota suma 1/30 de su cargo mensual por cada día de atraso y se congela
 * al llegar al cargo completo (día 30). Base FIJA de 30 días, no los del mes.
 * El día del vencimiento no cuenta: al día siguiente ya corre 1/30.
 */
const PORCENTAJE_MORA_POR_CUOTA = "0.0112";
const BASE_DIAS_MORA = 30;

/**
 * Estados que el job `procesarMoras` excluye de mora (STATUS_EXCLUIDOS_MORA
 * en apps/cartera-back/src/controllers/latefee.ts) — a un crédito en estos
 * estados el job jamás le asigna recargo, así que tampoco hay expectativa
 * que anunciarle al cliente.
 */
const STATUS_EXCLUIDOS_MORA = new Set([
	"EN_CONVENIO",
	"INCOBRABLE",
	"CANCELADO",
	"PENDIENTE_CANCELACION",
	"CAIDO",
]);

/**
 * Mora de UNA cuota con `dias` de atraso, con el mismo orden de operaciones
 * que `calcularMoraProporcional` del cron (cargo mensual × factor, factor =
 * min(1, días/30)) para que el redondeo coincida al centavo. Devuelve el monto
 * formateado es-GT ("1,382.72"), o "" si el job no cobraría nada: estado
 * excluido de mora, sin capital, o un monto que redondea a Q0.00 (el cron,
 * `decidirMoraDelCron`, tampoco crea mora en ese caso).
 */
function moraDeUnaCuota(
	capital: string | number | null | undefined,
	statusCredit: string | null | undefined,
	dias: number,
): string {
	if (statusCredit && STATUS_EXCLUIDOS_MORA.has(statusCredit)) return "";
	if (capital === null || capital === undefined || capital === "") return "";
	let monto: Big;
	try {
		const cargoMensual = new Big(capital).times(PORCENTAJE_MORA_POR_CUOTA);
		if (cargoMensual.lte(0)) return "";
		const factor =
			dias >= BASE_DIAS_MORA ? new Big(1) : new Big(dias).div(BASE_DIAS_MORA);
		monto = cargoMensual.times(factor);
	} catch {
		return "";
	}
	// Redondeo half-up a 2 decimales, idéntico al toFixed(2) de Big en el job.
	const redondeado = monto.toFixed(2);
	if (!(Number(redondeado) > 0)) return "";
	return Number(redondeado).toLocaleString("es-GT", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
}

/**
 * Tope de mora de una cuota ({expectativaMora}): su cargo mensual completo,
 * capital × 1.12%. Es lo que llega a cobrar esa cuota al cumplir 30 días de
 * atraso, y ahí se congela. "" si el crédito no genera mora.
 */
export function calcularExpectativaMora(
	capital: string | number | null | undefined,
	statusCredit?: string | null,
): string {
	return moraDeUnaCuota(capital, statusCredit, BASE_DIAS_MORA);
}

/**
 * Recargo por cada día de atraso ({expectativaMoraDiaria}): 1/30 del cargo
 * mensual. Es lo que el cron sumará mañana si el cliente no paga hoy. "" si el
 * crédito no genera mora — incluido un capital tan chico que un día redondea a
 * Q0.00, porque en ese caso el cron tampoco cobra al día siguiente.
 */
export function calcularExpectativaMoraDiaria(
	capital: string | number | null | undefined,
	statusCredit?: string | null,
): string {
	return moraDeUnaCuota(capital, statusCredit, 1);
}

/**
 * Oración que anuncia cuánto sube el saldo por día en las plantillas de mora.
 * Vive en una constante porque `interpolar` la borra ENTERA cuando no hay
 * aumento que anunciar: un crédito con todas sus cuotas ya en el techo crece
 * Q0.00 por día, y "aumenta Q0.00 por cada día que pase" no se le dice a
 * nadie. Tiene que ser idéntica a la del archivo del front
 * (apps/web/src/lib/cobros/plantillas-mensajes.ts) — ver la nota de cabecera.
 *
 * Va DENTRO del párrafo del monto adeudado, así que no cambia el conteo de
 * bloques (`\n\n`) del que depende la selección de template en Meta.
 */
export const CLAUSULA_INCREMENTO_DIARIO_MORA =
	", y aumenta Q{incrementoDiarioMora} por cada día que pase";

/**
 * true si hay un aumento diario REAL que anunciar. "" (cartera no lo mandó,
 * versión vieja del back) y "0.00" son lo mismo para el mensaje: no hay frase.
 * El valor viene formateado es-GT, así que se le quitan los separadores de
 * miles antes de compararlo.
 */
export function hayIncrementoDiarioMora(
	valor: string | null | undefined,
): boolean {
	if (!valor) return false;
	return Number(valor.replace(/,/g, "")) > 0;
}

/**
 * Formatea a es-GT el incremento diario que manda cartera-back (un
 * `Big.toFixed(2)`, p. ej. "1120.00" → "1,120.00"). "" cuando no hay nada que
 * anunciar: cartera no lo mandó, no es un número, o es 0 (todas las cuotas ya
 * topadas). El "" hace que la oración desaparezca sola en `interpolar`.
 */
export function formatearIncrementoDiarioMora(
	valor: string | number | null | undefined,
): string {
	if (valor === null || valor === undefined || valor === "") return "";
	const numero = Number(valor);
	if (!Number.isFinite(numero) || numero <= 0) return "";
	return numero.toLocaleString("es-GT", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
}

export interface PlantillaMensaje {
	id: string;
	nombre: string;
	etapa: string;
	asunto: string;
	cuerpo: string;
}

export const COBROS_NO_REPLY_WARNING =
	"⚠️ Este número es únicamente para el envío de notificaciones automáticas. Por favor, no respondas a este número.";
export const COBROS_MOTIVO_SIN_TELEFONO_ASESOR = "sin teléfono de asesor";
export const COBROS_MOTIVO_SIN_EXPECTATIVA_MORA =
	"el crédito no genera mora (estado excluido o sin capital suficiente)";

/** true si el cuerpo menciona el recargo diario o su tope mensual. */
export function cuerpoUsaExpectativaMora(cuerpo: string): boolean {
	return (
		cuerpo.includes("{expectativaMora}") ||
		cuerpo.includes("{expectativaMoraDiaria}")
	);
}

/**
 * Un cuerpo que usa {expectativaMoraDiaria} o {expectativaMora} no se puede
 * enviar si el crédito no genera mora: sin capital válido (p. ej. insolutos),
 * en un estado que el job excluye (EN_CONVENIO, INCOBRABLE, etc.) o con un
 * capital tan chico que un día redondea a Q0.00. El mensaje anunciaría un
 * recargo que jamás se va a asignar. Se exigen LOS DOS montos porque la
 * oración los dice juntos ("Q… por cada día, hasta un máximo de Q…"). Mismo
 * patrón de gate que prepararTelefonoAsesorParaEnvio.
 */
export function prepararExpectativaMoraParaEnvio(
	cuerpo: string,
	capital: string | number | null | undefined,
	statusCredit?: string | null,
):
	| { enviar: true; expectativaMora: string; expectativaMoraDiaria: string }
	| { enviar: false; motivo: string } {
	const expectativaMora = calcularExpectativaMora(capital, statusCredit);
	const expectativaMoraDiaria = calcularExpectativaMoraDiaria(
		capital,
		statusCredit,
	);

	if (
		cuerpoUsaExpectativaMora(cuerpo) &&
		(!expectativaMora || !expectativaMoraDiaria)
	) {
		return { enviar: false, motivo: COBROS_MOTIVO_SIN_EXPECTATIVA_MORA };
	}

	return { enviar: true, expectativaMora, expectativaMoraDiaria };
}

export const COBROS_MOTIVO_SIN_MONTO_ADEUDADO =
	"no se pudo calcular el monto adeudado (sin cuotas atrasadas o sin detalle de cartera)";

/**
 * Un cuerpo que usa {montoAdeudado} no se puede enviar sin ese monto: el
 * mensaje diría "por un monto de Q." roto o, peor, un monto inventado. El
 * monto sale de calcularMontoAdeudadoDesdeCuotas sobre el detalle del
 * crédito; si el detalle no se pudo traer o no hay cuotas atrasadas, se
 * descarta (mismo patrón que los otros gates). `null` = no se pudo obtener el
 * detalle; "" = detalle sin cuotas atrasadas.
 */
export function prepararMontoAdeudadoParaEnvio(
	cuerpo: string,
	montoAdeudado: string | null | undefined,
): { enviar: true; montoAdeudado: string } | { enviar: false; motivo: string } {
	if (!cuerpo.includes("{montoAdeudado}")) {
		return { enviar: true, montoAdeudado: montoAdeudado ?? "" };
	}
	if (!montoAdeudado) {
		return { enviar: false, motivo: COBROS_MOTIVO_SIN_MONTO_ADEUDADO };
	}
	return { enviar: true, montoAdeudado };
}

export function prepararTelefonoAsesorParaEnvio(
	cuerpo: string,
	telefono: string | null | undefined,
):
	| { enviar: true; telefonoAsesor: string }
	| { enviar: false; motivo: string } {
	const telefonoAsesor = telefono?.trim() ?? "";

	if (cuerpo.includes(COBROS_NO_REPLY_WARNING) && !telefonoAsesor) {
		return { enviar: false, motivo: COBROS_MOTIVO_SIN_TELEFONO_ASESOR };
	}

	return { enviar: true, telefonoAsesor };
}

function toCapitalCase(str: string): string {
	return str
		.toLowerCase()
		.split(" ")
		.map((word) => (word ? word[0].toUpperCase() + word.slice(1) : ""))
		.join(" ");
}

export function interpolar(
	texto: string,
	variables: VariablesPlantilla,
): string {
	const v = (val: string | number) =>
		val !== undefined && val !== null && val !== "" && val !== 0
			? String(val)
			: "";

	const nombre = variables.clienteNombre
		? toCapitalCase(variables.clienteNombre)
		: "";

	// Sin aumento que anunciar (crédito con todas las cuotas ya en el techo, o
	// cartera que no mandó el dato) la oración se borra entera: dejar
	// "aumenta Q0.00 por cada día que pase" sería ruido, y dejar "aumenta Q."
	// sería un mensaje roto.
	const incrementoDiarioMora = variables.incrementoDiarioMora ?? "";
	const base = hayIncrementoDiarioMora(incrementoDiarioMora)
		? texto
		: texto.split(CLAUSULA_INCREMENTO_DIARIO_MORA).join("");

	return base
		.replace(/{incrementoDiarioMora}/g, v(incrementoDiarioMora))
		.replace(/{clienteNombre}/g, v(nombre))
		.replace(/{fechaPago}/g, v(variables.fechaPago))
		.replace(/{cuotaMensual}/g, v(variables.cuotaMensual))
		.replace(/{placa}/g, v(variables.placa))
		.replace(/{marcaLineaModelo}/g, v(variables.marcaLineaModelo))
		.replace(/{montoAdeudado}/g, v(variables.montoAdeudado))
		.replace(/{cuotasAtraso}/g, v(variables.cuotasAtraso))
		.replace(/{telefonoAsesor}/g, v(variables.telefonoAsesor))
		.replace(/{nombreAsesor}/g, v(variables.nombreAsesor))
		.replace(/{expectativaMora}/g, v(variables.expectativaMora))
		.replace(
			/{expectativaMoraDiaria}/g,
			v(variables.expectativaMoraDiaria ?? ""),
		)
		.replace(
			/{anioImpuesto}/g,
			v(variables.anioImpuesto ?? anioImpuestoCirculacion()),
		)
		.replace(
			/{fechaLimiteImpuesto}/g,
			v(variables.fechaLimiteImpuesto ?? fechaLimiteImpuestoCirculacion()),
		)
		.replace(
			/{aseguradora}/g,
			v(variables.aseguradora ?? seguroPorAseguradora(null).aseguradora),
		)
		.replace(
			/{cabinaSeguro}/g,
			v(variables.cabinaSeguro ?? seguroPorAseguradora(null).cabinaSeguro),
		);
}

export const PLANTILLAS_MENSAJES: PlantillaMensaje[] = [
	{
		id: "bienvenida",
		nombre: "Bienvenida",
		etapa: "al_dia",
		asunto: "Bienvenido/a a su plan de financiamiento",
		// 5 bloques → template `mensaje5parametro`.
		cuerpo: `Hola {clienteNombre} 👋
¡Bienvenido(a) a *CashIn*! Nos alegra acompañarte en el financiamiento de tu vehículo.

📅 *Información de tu cuota*
Día de pago mensual: *{fechaPago}*
Monto de cuota: *Q{cuotaMensual}*

💳 *Cuentas para realizar tus pagos*
Tipo: *Monetaria*
A nombre de: *CUBE INVESTMENTS, S.A.*
* BI: 5520029876
* BAM: 3020123033
* GyT: 01300039945
* Banrural: 3394002346

🚗 *Tu vehículo cuenta con seguro completo a través de {aseguradora}.*
*En caso de accidente o cualquier inconveniente con tu vehículo, llama a la cabina de emergencia al {cabinaSeguro}*, identificándote únicamente con el número de placa.
Para seguimiento de trámites con el seguro:
✅ Luis Escobar: 4388-7300
✅ Maylin Barrios: 4770-7074

Si tienes alguna consulta, con gusto estamos para apoyarte. Agradeceremos confirmar la recepción de este mensaje.
*{nombreAsesor} - Asesor de Cobros*
*CashIn*`,
	},
	{
		id: "al_dia",
		nombre: "Recordatorio el día de pago",
		etapa: "al_dia",
		asunto: "Recordatorio de pago - Vehículo {placa}",
		// 4 bloques → template `mensaje4parametro`.
		cuerpo: `Hola {clienteNombre} 👋
Te recordamos que *hoy es la fecha de pago de tu cuota, por un monto de Q{cuotaMensual}*. Agradeceremos realizar tu pago y compartir tu comprobante para aplicarlo a tu cuenta.

🛑 *Si no realizas tu pago hoy, se agregará un recargo por mora de Q{expectativaMoraDiaria} por cada día de atraso, hasta un máximo de Q{expectativaMora} al mes.*

📞 Si necesitas apoyo, comunícate con tu asesor:
*{nombreAsesor} - Asesor de Cobros*
{telefonoAsesor}

🚗 Si ya realizó su pago, agradecemos hacer caso omiso a este recordatorio.
*${COBROS_NO_REPLY_WARNING}*
*CashIn*`,
	},
	{
		id: "impuesto_circulacion_2026",
		nombre: "Impuesto de circulación",
		etapa: "al_dia",
		asunto: "Recordatorio de pago - Impuesto de circulación {anioImpuesto}",
		// 4 bloques → template `mensaje4parametro`.
		cuerpo: `Hola 👋
Te recordamos realizar el pago de tu *Impuesto de Circulación {anioImpuesto}*.
⏰ Fecha límite: *{fechaLimiteImpuesto} a las 5:00 p.m.*

🛑 *En caso de no realizar el pago, CashIn lo realizará y te cobrará las multas y gastos administrativos adicionales.*

✅ Al realizar el pago, comparte el comprobante con tu asesor antes de la hora límite:
*{nombreAsesor} - Asesor de Cobros*
{telefonoAsesor}

*${COBROS_NO_REPLY_WARNING}*
*CashIn*`,
	},
	{
		id: "pre_mora",
		nombre: "Recordatorio 5 días antes",
		etapa: "pre_mora",
		asunto: "Recordatorio de pago próximo - Vehículo {placa}",
		// 3 bloques → template `mensaje3parametro`.
		cuerpo: `Hola {clienteNombre} 👋
Te saludamos de *CashIn* para recordarte que tu próxima cuota tiene fecha de pago el *{fechaPago}*.

📞 Para consultas o apoyo con tu cuenta, comunícate directamente con tu asesor de cobros:
*{nombreAsesor} - Asesor de Cobros*
{telefonoAsesor}

🚗 Si ya realizó su pago, agradecemos hacer caso omiso a este recordatorio.
${COBROS_NO_REPLY_WARNING}
*CashIn*`,
	},
	{
		id: "mora_30",
		nombre: "Notificación 1 cuota atrasada",
		etapa: "mora_30",
		asunto: "URGENTE: Mora de 30 días - Vehículo {placa}",
		// 4 bloques → template `mensaje4parametro`.
		cuerpo: `Hola {clienteNombre} 👋
Tienes *1 cuota con atraso por un monto de Q{montoAdeudado}* al día de hoy${CLAUSULA_INCREMENTO_DIARIO_MORA}.

Es importante que realices tu pago lo antes posible para evitar mayores recargos en tu cuenta.

📲 Al realizar el pago, comparte el comprobante con tu asesor:
*{nombreAsesor} - Asesor de Cobros*
{telefonoAsesor}

*${COBROS_NO_REPLY_WARNING}*
*CashIn*`,
	},
	{
		id: "mora_60",
		nombre: "Notificación 2-3 cuotas atrasadas",
		etapa: "mora_60",
		asunto: "AVISO IMPORTANTE: Mora de 60 días - Vehículo {placa}",
		// 4 bloques → template `mensaje4parametro`.
		cuerpo: `Hola {clienteNombre},
Te informamos que actualmente tienes *{cuotasAtraso} cuotas en atraso, por un monto total de Q{montoAdeudado}* al día de hoy${CLAUSULA_INCREMENTO_DIARIO_MORA}.

⚠️ *En caso de no recibir el pago, CashIn podrá aplicar las medidas de recuperación contempladas en tu contrato y la ejecución de garantía.*

✅ Al realizar el pago, comparte el comprobante con tu asesor:
*{nombreAsesor} - Asesor de Cobros*
{telefonoAsesor}

*${COBROS_NO_REPLY_WARNING}*
*CashIn*`,
	},
	{
		id: "aviso_juridico",
		nombre: "Aviso jurídico",
		etapa: "mora_90",
		asunto: "ÚLTIMO AVISO: Proceso jurídico - Vehículo {placa}",
		// 4 bloques → template `mensaje4parametro`.
		cuerpo: `Señor(a) {clienteNombre}, le informamos que su obligación adquirida por medio de la plataforma de inversión CLUB CASH IN por la compra del vehículo ({placa}) {marcaLineaModelo}, se encuentra con {cuotasAtraso} cuota(s) de atraso, por un monto de {montoAdeudado} incluyendo moras al día de hoy${CLAUSULA_INCREMENTO_DIARIO_MORA}.

Por lo que le solicitamos ponerse en contacto con nosotros para entregar la unidad en un plazo no mayor de 24 horas para solventar su situación. De no obtener respuesta en el plazo establecido, procederemos a presentar DEMANDA en su contra por denuncia de robo.

${COBROS_NO_REPLY_WARNING}

Favor de comunicarse a los siguientes números: {telefonoAsesor} y 2234-1333. Nuestro horario de atención es de lunes a viernes en horario de 8:00 a 17:00 hrs.`,
	},
];
