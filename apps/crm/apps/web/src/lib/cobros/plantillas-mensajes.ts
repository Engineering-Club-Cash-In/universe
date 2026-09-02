/**
 * Plantillas de mensajes predefinidos para cobros (WhatsApp y Email).
 *
 * RFC: Migrar a tabla `plantillas_mensaje` en DB para permitir edición
 * en caliente desde UI admin sin necesidad de deploy.
 * Esquema propuesto:
 *   - id, nombre, etapa, asunto, cuerpo, activa, created_at, updated_at
 *   - Seed inicial con estas 6 plantillas
 *   - Endpoint ORPC: listPlantillasMensaje
 */

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
	/**
	 * Recargo de UNA cuota vencida más (capital × 1.12%), misma fórmula que el
	 * job `procesarMoras` de cartera-back. Viene ya formateado del server
	 * (getDetallesCreditoCarteraBack).
	 */
	expectativaMora: string;
	/** Año del impuesto de circulación. Default: año actual en Guatemala. */
	anioImpuesto?: string;
	/** Fecha límite del impuesto (dd/mm/año). Default: 31/07 del año actual. */
	fechaLimiteImpuesto?: string;
	/**
	 * Aseguradora y cabina de emergencia para el bloque del seguro de la
	 * bienvenida. Vienen del server (getDetallesCreditoCarteraBack) según
	 * `opportunities.insurance_provider`; default = Seguros Universales.
	 */
	aseguradora?: string;
	cabinaSeguro?: string;
}

const SEGURO_DEFAULT = {
	aseguradora: "Seguros Universales",
	cabinaSeguro: "2384-7400",
};

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

export interface PlantillaMensaje {
	id: string;
	nombre: string;
	etapa: string;
	asunto: string;
	cuerpo: string;
	cuerpoWhastapp?: string;
}

export const COBROS_NO_REPLY_WARNING =
	"⚠️ Este número es únicamente para el envío de notificaciones automáticas. Por favor, no respondas a este número.";
export const COBROS_MOTIVO_SIN_TELEFONO_ASESOR = "sin teléfono de asesor";

/**
 * Una plantilla que usa {expectativaMora} no se puede enviar si el server no
 * pudo calcularla (crédito sin capital válido: insolutos y similares no
 * generan mora) — el mensaje saldría roto ("recargo por mora de Q.").
 */
export function plantillaRequiereExpectativaMora(
	plantilla: PlantillaMensaje,
): boolean {
	return (
		plantilla.cuerpo.includes("{expectativaMora}") ||
		(plantilla.cuerpoWhastapp?.includes("{expectativaMora}") ?? false)
	);
}

/**
 * Una plantilla que usa las variables del impuesto no debería enviarse después
 * de la fecha límite del año: pediría el comprobante "antes de la hora límite"
 * de una fecha ya vencida. Pasado el corte, los asesores contactan
 * personalmente.
 */
export function plantillaUsaFechaLimiteImpuesto(
	plantilla: PlantillaMensaje,
): boolean {
	const usa = (cuerpo: string) =>
		cuerpo.includes("{fechaLimiteImpuesto}") ||
		cuerpo.includes("{anioImpuesto}");
	return usa(plantilla.cuerpo) || usa(plantilla.cuerpoWhastapp ?? "");
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

export function crearUrlWhatsappManual(
	telefonoLimpio: string,
	mensajeWhatsapp: string,
	mensajeFallback = "",
): string {
	const mensaje = mensajeWhatsapp || mensajeFallback;
	return mensaje
		? `https://wa.me/${telefonoLimpio}?text=${encodeURIComponent(mensaje)}`
		: `https://wa.me/${telefonoLimpio}`;
}

export function mensajePlantillaEditable(
	metodoContacto: string,
	mensajeEditado: string,
	mensajeWhatsappEditado: string,
): string {
	return metodoContacto === "whatsapp"
		? mensajeWhatsappEditado
		: mensajeEditado;
}

export function mensajeSmsEditable(
	metodoInicial: string,
	mensajeEditado: string,
	mensajeWhatsappEditado: string,
): string {
	return mensajePlantillaEditable(
		metodoInicial,
		mensajeEditado,
		mensajeWhatsappEditado,
	);
}

export function mensajeEmailEditable(
	metodoInicial: string,
	mensajeEditado: string,
	mensajeWhatsappEditado: string,
): string {
	return mensajePlantillaEditable(
		metodoInicial,
		mensajeEditado,
		mensajeWhatsappEditado,
	);
}

export function accionUsaCuerpoNoReply(metodo: string): boolean {
	return (
		metodo === "whatsapp-link" ||
		metodo === "whatsapp-api" ||
		metodo === "sms-api" ||
		metodo === "email-link" ||
		metodo === "email-api"
	);
}

export function cuerpoParaValidarNoReply(
	metodo: string,
	mensajeWhatsapp: string,
	mensajeSms: string,
	mensajeEmail = mensajeWhatsapp,
): string {
	if (metodo === "email-link" || metodo === "email-api") return mensajeEmail;
	return metodo === "sms-api" ? mensajeSms : mensajeWhatsapp;
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
	const v = (val: string | number, _placeholder: string) =>
		val !== undefined && val !== null && val !== "" && val !== 0
			? String(val)
			: "";

	const nombre = variables.clienteNombre
		? toCapitalCase(variables.clienteNombre)
		: "";

	return texto
		.replace(/{clienteNombre}/g, v(nombre, "nombre cliente"))
		.replace(/{fechaPago}/g, v(variables.fechaPago, "fecha pago"))
		.replace(/{cuotaMensual}/g, v(variables.cuotaMensual, "cuota mensual"))
		.replace(/{placa}/g, v(variables.placa, "placa"))
		.replace(
			/{marcaLineaModelo}/g,
			v(variables.marcaLineaModelo, "marca/modelo"),
		)
		.replace(/{montoAdeudado}/g, v(variables.montoAdeudado, "monto adeudado"))
		.replace(/{cuotasAtraso}/g, v(variables.cuotasAtraso, "cuotas en atraso"))
		.replace(
			/{telefonoAsesor}/g,
			v(variables.telefonoAsesor, "teléfono asesor"),
		)
		.replace(/{nombreAsesor}/g, v(variables.nombreAsesor, "nombre asesor"))
		.replace(
			/{expectativaMora}/g,
			v(variables.expectativaMora, "expectativa de mora"),
		)
		.replace(
			/{anioImpuesto}/g,
			v(variables.anioImpuesto ?? anioImpuestoCirculacion(), "año impuesto"),
		)
		.replace(
			/{aseguradora}/g,
			v(variables.aseguradora ?? SEGURO_DEFAULT.aseguradora, "aseguradora"),
		)
		.replace(
			/{cabinaSeguro}/g,
			v(
				variables.cabinaSeguro ?? SEGURO_DEFAULT.cabinaSeguro,
				"cabina del seguro",
			),
		)
		.replace(
			/{fechaLimiteImpuesto}/g,
			v(
				variables.fechaLimiteImpuesto ?? fechaLimiteImpuestoCirculacion(),
				"fecha límite impuesto",
			),
		);
}

export const PLANTILLAS_MENSAJES: PlantillaMensaje[] = [
	{
		id: "bienvenida",
		nombre: "Bienvenida",
		etapa: "al_dia",
		asunto: "Bienvenido/a a su plan de financiamiento",
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
		cuerpoWhastapp: `Hola {clienteNombre} 👋
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
		cuerpo: `Hola {clienteNombre} 👋
Te recordamos que hoy es la fecha de pago de tu cuota, por un monto de Q{cuotaMensual}. Agradeceremos realizar tu pago y compartir tu comprobante para aplicarlo a tu cuenta.

🛑 Si no realizas tu pago hoy, se agregará un recargo por mora de Q{expectativaMora}.

📞 Si necesitas apoyo, comunícate con tu asesor:
{nombreAsesor} - Asesor de Cobros
{telefonoAsesor}

🚗 Si ya realizó su pago, agradecemos hacer caso omiso a este recordatorio.
CashIn`,
		cuerpoWhastapp: `Hola {clienteNombre} 👋
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
		cuerpo: `Hola 👋
Te recordamos realizar el pago de tu Impuesto de Circulación {anioImpuesto}.
⏰ Fecha límite: {fechaLimiteImpuesto} a las 5:00 p.m.

🛑 En caso de no realizar el pago, CashIn lo realizará y te cobrará las multas y gastos administrativos adicionales.

✅ Al realizar el pago, comparte el comprobante con tu asesor antes de la hora límite:
{nombreAsesor} - Asesor de Cobros
{telefonoAsesor}

CashIn`,
		cuerpoWhastapp: `Hola 👋
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
		cuerpo: `Hola {clienteNombre} 👋
Te saludamos de CashIn para recordarte que tu próxima cuota tiene fecha de pago el {fechaPago}.

📞 Para consultas o apoyo con tu cuenta, comunícate directamente con tu asesor de cobros:
{nombreAsesor} - Asesor de Cobros
{telefonoAsesor}

🚗 Si ya realizó su pago, agradecemos hacer caso omiso a este recordatorio.
CashIn`,
		cuerpoWhastapp: `Hola {clienteNombre} 👋
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
		cuerpo: `Hola {clienteNombre} 👋
Tienes 1 cuota con atraso por un monto de Q{montoAdeudado}.

Es importante que realices tu pago lo antes posible para evitar mayores recargos en tu cuenta.

📲 Al realizar el pago, comparte el comprobante con tu asesor:
{nombreAsesor} - Asesor de Cobros
{telefonoAsesor}

CashIn`,
		cuerpoWhastapp: `Hola {clienteNombre} 👋
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
		cuerpo: `Hola {clienteNombre},
Te informamos que actualmente tienes {cuotasAtraso} cuotas en atraso, por un monto total de Q{montoAdeudado}.

⚠️ En caso de no recibir el pago, CashIn podrá aplicar las medidas de recuperación contempladas en tu contrato y la ejecución de garantía.

✅ Al realizar el pago, comparte el comprobante con tu asesor:
{nombreAsesor} - Asesor de Cobros
{telefonoAsesor}

CashIn`,
		cuerpoWhastapp: `Hola {clienteNombre},
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
		cuerpo: `Señor(a) {clienteNombre}, por este medio hacemos de su conocimiento que su obligación adquirida por medio de la plataforma de inversión CLUB CASH IN por la compra del vehículo ({placa}) {marcaLineaModelo}, se encuentra con {cuotasAtraso} cuota(s) de atraso, por un monto de {montoAdeudado} incluyendo moras.

Por lo que le solicitamos ponerse en contacto con nosotros para entregar la unidad en un plazo no mayor de 24 horas para solventar su situación. De no obtener respuesta en el plazo establecido, procederemos a presentar DEMANDA en su contra por denuncia de robo.

Favor de comunicarse a los siguientes números: {telefonoAsesor} y 2234-1333. Nuestro horario de atención es de lunes a viernes en horario de 8:00 a 17:00 hrs.`,
		cuerpoWhastapp: `Señor(a) {clienteNombre}, le informamos que su obligación adquirida por medio de la plataforma de inversión CLUB CASH IN por la compra del vehículo ({placa}) {marcaLineaModelo}, se encuentra con {cuotasAtraso} cuota(s) de atraso, por un monto de {montoAdeudado} incluyendo moras.

Por lo que le solicitamos ponerse en contacto con nosotros para entregar la unidad en un plazo no mayor de 24 horas para solventar su situación. De no obtener respuesta en el plazo establecido, procederemos a presentar DEMANDA en su contra por denuncia de robo.

${COBROS_NO_REPLY_WARNING}

Favor de comunicarse a los siguientes números: {telefonoAsesor} y 2234-1333. Nuestro horario de atención es de lunes a viernes en horario de 8:00 a 17:00 hrs.`,
	},
];

/** Sugiere una plantilla según el estado de mora y antigüedad del caso */
export function sugerirPlantilla(
	estadoMora: string | undefined,
	fechaInicio?: string | Date | null,
): string {
	const mapaMora: Record<string, string> = {
		pre_mora: "pre_mora",
		mora_30: "mora_30",
		mora_60: "mora_60",
		mora_90: "aviso_juridico",
		incobrable: "aviso_juridico",
	};

	// Si tiene mora, usar plantilla correspondiente
	if (estadoMora && mapaMora[estadoMora]) {
		return mapaMora[estadoMora];
	}

	// Si es cliente reciente (menos de 30 días), bienvenida
	if (fechaInicio) {
		const inicio = new Date(fechaInicio);
		const diasDesdeInicio =
			(Date.now() - inicio.getTime()) / (1000 * 60 * 60 * 24);
		if (diasDesdeInicio <= 30) {
			return "bienvenida";
		}
	}

	// Fallback: recordatorio de pago
	return "al_dia";
}
