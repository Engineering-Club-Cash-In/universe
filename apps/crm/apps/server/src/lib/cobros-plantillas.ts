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
	montoAdeudado: string;
	cuotasAtraso: number;
	telefonoAsesor: string;
	nombreAsesor: string;
	expectativaMora: string;
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

/** true si hoy (en Guatemala) ya pasó la fecha límite del impuesto del año. */
export function fechaLimiteImpuestoVencida(ahora = new Date()): boolean {
	// "en-CA" con timeZone da YYYY-MM-DD; comparamos MM-DD contra el corte.
	const ymd = new Intl.DateTimeFormat("en-CA", {
		timeZone: "America/Guatemala",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(ahora);
	const [, mes, dia] = ymd.split("-");
	const [diaLimite, mesLimite] = DIA_MES_LIMITE_IMPUESTO.split("/");
	return `${mes}${dia}` > `${mesLimite}${diaLimite}`;
}

/**
 * Un cuerpo que usa las variables del impuesto no debería enviarse después de
 * la fecha límite del año: el mensaje pediría el comprobante "antes de la hora
 * límite" de una fecha ya vencida. Pasado el corte, los asesores editan el
 * mensaje (quitando estas variables) o contactan personalmente.
 */
export function cuerpoUsaFechaLimiteImpuesto(cuerpo: string): boolean {
	return (
		cuerpo.includes("{fechaLimiteImpuesto}") || cuerpo.includes("{anioImpuesto}")
	);
}

/**
 * Porcentaje de mora por cuota vencida. MISMA fórmula que el job nocturno
 * `procesarMoras` de cartera-back (apps/cartera-back/src/controllers/latefee.ts):
 * mora = capital × 1.12% × cuotas vencidas.
 */
const PORCENTAJE_MORA_POR_CUOTA = "0.0112";

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
 * "Expectativa de mora" del recordatorio del día de pago: el recargo de UNA
 * cuota adicional que el job de cartera asignaría si el cliente no paga hoy
 * (mora aún no asignada). Devuelve el monto formateado es-GT ("1,382.72") o
 * "" si no hay capital o el estado del crédito está excluido de mora (igual
 * que el job).
 */
export function calcularExpectativaMora(
	capital: string | number | null | undefined,
	statusCredit?: string | null,
): string {
	if (statusCredit && STATUS_EXCLUIDOS_MORA.has(statusCredit)) return "";
	if (capital === null || capital === undefined || capital === "") return "";
	let monto: Big;
	try {
		monto = new Big(capital).times(PORCENTAJE_MORA_POR_CUOTA);
	} catch {
		return "";
	}
	if (monto.lte(0)) return "";
	// Redondeo half-up a 2 decimales, idéntico al toFixed(2) de Big en el job.
	return Number(monto.toFixed(2)).toLocaleString("es-GT", {
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
	"el crédito no genera mora (estado excluido o sin capital)";

/**
 * Un cuerpo que usa {expectativaMora} no se puede enviar si el crédito no
 * genera mora: sin capital válido (p. ej. insolutos) o en un estado que el
 * job excluye (EN_CONVENIO, INCOBRABLE, etc.), el mensaje anunciaría un
 * recargo que jamás se va a asignar. Mismo patrón de gate que
 * prepararTelefonoAsesorParaEnvio.
 */
export function prepararExpectativaMoraParaEnvio(
	cuerpo: string,
	capital: string | number | null | undefined,
	statusCredit?: string | null,
):
	| { enviar: true; expectativaMora: string }
	| { enviar: false; motivo: string } {
	const expectativaMora = calcularExpectativaMora(capital, statusCredit);

	if (cuerpo.includes("{expectativaMora}") && !expectativaMora) {
		return { enviar: false, motivo: COBROS_MOTIVO_SIN_EXPECTATIVA_MORA };
	}

	return { enviar: true, expectativaMora };
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

	return texto
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
¡Bienvenido(a) a CashIn! Nos alegra acompañarte en el financiamiento de tu vehículo.

📅 Información de tu cuota
Día de pago mensual: {fechaPago}
Monto de cuota: Q{cuotaMensual}

💳 Cuentas para realizar tus pagos
Tipo: Monetaria
A nombre de: CUBE INVESTMENTS, S.A.
* BI: 5520029876
* BAM: 3020123033
* GyT: 01300039945
* Banrural: 3394002346

🚗 Tu vehículo cuenta con seguro completo a través de {aseguradora}.
En caso de accidente o cualquier inconveniente con tu vehículo, llama a la cabina de emergencia al {cabinaSeguro}, identificándote únicamente con el número de placa.
Para seguimiento de trámites con el seguro:
✅ Luis Escobar: 4388-7300
✅ Maylin Barrios: 4770-7074

Si tienes alguna consulta, con gusto estamos para apoyarte. Agradeceremos confirmar la recepción de este mensaje.
{nombreAsesor} - Asesor de Cobros
CashIn`,
	},
	{
		id: "al_dia",
		nombre: "Recordatorio el día de pago",
		etapa: "al_dia",
		asunto: "Recordatorio de pago - Vehículo {placa}",
		// 4 bloques → template `mensaje4parametro`.
		cuerpo: `Hola {clienteNombre} 👋
Te recordamos que hoy es la fecha de pago de tu cuota, por un monto de Q{cuotaMensual}. Agradeceremos realizar tu pago y compartir tu comprobante para aplicarlo a tu cuenta.

🛑 Si no realizas tu pago hoy, se agregará un recargo por mora de Q{expectativaMora}.

📞 Si necesitas apoyo, comunícate con tu asesor:
{nombreAsesor} - Asesor de Cobros
{telefonoAsesor}

🚗 Si ya realizó su pago, agradecemos hacer caso omiso a este recordatorio.
${COBROS_NO_REPLY_WARNING}
CashIn`,
	},
	{
		id: "impuesto_circulacion_2026",
		nombre: "Impuesto de circulación",
		etapa: "al_dia",
		asunto: "Recordatorio de pago - Impuesto de circulación {anioImpuesto}",
		// 4 bloques → template `mensaje4parametro`.
		cuerpo: `Hola 👋
Te recordamos realizar el pago de tu Impuesto de Circulación {anioImpuesto}.
⏰ Fecha límite: {fechaLimiteImpuesto} a las 5:00 p.m.

🛑 En caso de no realizar el pago, CashIn lo realizará y te cobrará las multas y gastos administrativos adicionales.

✅ Al realizar el pago, comparte el comprobante con tu asesor antes de la hora límite:
{nombreAsesor} - Asesor de Cobros
{telefonoAsesor}

${COBROS_NO_REPLY_WARNING}
CashIn`,
	},
	{
		id: "pre_mora",
		nombre: "Recordatorio 5 días antes",
		etapa: "pre_mora",
		asunto: "Recordatorio de pago próximo - Vehículo {placa}",
		// 3 bloques → template `mensaje3parametro`.
		cuerpo: `Hola {clienteNombre} 👋
Te saludamos de CashIn para recordarte que tu próxima cuota tiene fecha de pago el {fechaPago}.

📞 Para consultas o apoyo con tu cuenta, comunícate directamente con tu asesor de cobros:
{nombreAsesor} - Asesor de Cobros
{telefonoAsesor}

🚗 Si ya realizó su pago, agradecemos hacer caso omiso a este recordatorio.
${COBROS_NO_REPLY_WARNING}
CashIn`,
	},
	{
		id: "mora_30",
		nombre: "Notificación 1 cuota atrasada",
		etapa: "mora_30",
		asunto: "URGENTE: Mora de 30 días - Vehículo {placa}",
		// 4 bloques → template `mensaje4parametro`.
		cuerpo: `Hola {clienteNombre} 👋
Tienes 1 cuota con atraso por un monto de Q{montoAdeudado}.

Es importante que realices tu pago lo antes posible para evitar mayores recargos en tu cuenta.

📲 Al realizar el pago, comparte el comprobante con tu asesor:
{nombreAsesor} - Asesor de Cobros
{telefonoAsesor}

${COBROS_NO_REPLY_WARNING}
CashIn`,
	},
	{
		id: "mora_60",
		nombre: "Notificación 2-3 cuotas atrasadas",
		etapa: "mora_60",
		asunto: "AVISO IMPORTANTE: Mora de 60 días - Vehículo {placa}",
		// 4 bloques → template `mensaje4parametro`.
		cuerpo: `Hola {clienteNombre},
Te informamos que actualmente tienes {cuotasAtraso} cuotas en atraso, por un monto total de Q{montoAdeudado}.

⚠️ En caso de no recibir el pago, CashIn podrá aplicar las medidas de recuperación contempladas en tu contrato y la ejecución de garantía.

✅ Al realizar el pago, comparte el comprobante con tu asesor:
{nombreAsesor} - Asesor de Cobros
{telefonoAsesor}

${COBROS_NO_REPLY_WARNING}
CashIn`,
	},
	{
		id: "aviso_juridico",
		nombre: "Aviso jurídico",
		etapa: "mora_90",
		asunto: "ÚLTIMO AVISO: Proceso jurídico - Vehículo {placa}",
		// 4 bloques → template `mensaje4parametro`.
		cuerpo: `Señor(a) {clienteNombre}, le informamos que su obligación adquirida por medio de la plataforma de inversión CLUB CASH IN por la compra del vehículo ({placa}) {marcaLineaModelo}, se encuentra con {cuotasAtraso} cuota(s) de atraso, por un monto de {montoAdeudado} incluyendo moras.

Por lo que le solicitamos ponerse en contacto con nosotros para entregar la unidad en un plazo no mayor de 24 horas para solventar su situación. De no obtener respuesta en el plazo establecido, procederemos a presentar DEMANDA en su contra por denuncia de robo.

${COBROS_NO_REPLY_WARNING}

Favor de comunicarse a los siguientes números: {telefonoAsesor} y 2234-1333. Nuestro horario de atención es de lunes a viernes en horario de 8:00 a 17:00 hrs.`,
	},
];
