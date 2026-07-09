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
}

export interface PlantillaMensaje {
	id: string;
	nombre: string;
	etapa: string;
	asunto: string;
	cuerpo: string;
}

export const COBROS_NO_REPLY_WARNING =
	"*NO RESPONDER EN ESTE CHAT, CONTESTAR AL NUMERO DE SU ASESOR DE COBROS*";

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
		.replace(/{nombreAsesor}/g, v(variables.nombreAsesor));
}

export const PLANTILLAS_MENSAJES: PlantillaMensaje[] = [
	{
		id: "bienvenida",
		nombre: "Bienvenida",
		etapa: "al_dia",
		asunto: "Bienvenido/a a su plan de financiamiento",
		// 5 bloques; SimpleTech colapsa a template `mensaje4parametros`.
		cuerpo: `Hola {clienteNombre}, Le saludamos cordialmente de Clubcashin.com para recordarle sobre el pago de su crédito, el cual debe realizarse el {fechaPago}. Sus cuotas son por un monto de Q{cuotaMensual}.

A continuación, le compartimos los números de cuenta para realizar su depósito o transferencia: - CUBE INVESTMENTS, S.A. (monetaria) No. 5520029876 BANCO INDUSTRIAL (BI) / CUBE INVESTMENTS, S.A. (monetaria) No. 3020123033 BANCO AGROMERCANTIL (BAM) / CUBE INVESTMENTS, S.A. (monetaria) No. 01300039945 BANCO GyT CONTINENTAL / CUBE INVESTMENTS, S.A. (monetaria) No. 3394002346 BANRURAL

Por favor, envíe su boleta o comprobante de pago al {telefonoAsesor} para aplicarlo a su cuenta. Si tiene alguna duda o consulta, estamos a su disposición.

${COBROS_NO_REPLY_WARNING}

Atentamente, {nombreAsesor} Tel: {telefonoAsesor}.`,
	},
	{
		id: "al_dia",
		nombre: "Recordatorio de pago",
		etapa: "al_dia",
		asunto: "Recordatorio de pago - Vehículo {placa}",
		// 3 bloques → template `mensaje3parametros`.
		cuerpo: `Estimado(a) {clienteNombre}, buen día, cordialmente le saludamos de Clubcashin para recordarle sobre el pago de su crédito el día de hoy, quedamos a la espera de su comprobante de pago.

${COBROS_NO_REPLY_WARNING}

Atentamente, {nombreAsesor} Tel: {telefonoAsesor}.`,
	},
	{
		id: "pre_mora",
		nombre: "Aviso de atraso",
		etapa: "pre_mora",
		asunto: "Aviso de atraso en pago - Vehículo {placa}",
		// 5 bloques; SimpleTech colapsa a template `mensaje4parametros`.
		cuerpo: `Hola {clienteNombre}, le saludamos de Clubcashin recordándole que su cuota esta próxima a vencer. Su día de pago es el {fechaPago}. Ponemos a su disposición nuestros medios de pago en Banco Industrial, BANRURAL, Banco Agromercantil (BAM) y GyT.

Si tiene alguna duda, por favor comuníquese al {telefonoAsesor}.

SI YA REALIZO SU PAGO POR FAVOR HACER CASO OMISO A ESTE MENSAJE.

${COBROS_NO_REPLY_WARNING}

Atentamente, {nombreAsesor} Tel: {telefonoAsesor}.`,
	},
	{
		id: "mora_30",
		nombre: "Mora 30 días",
		etapa: "mora_30",
		asunto: "URGENTE: Mora de 30 días - Vehículo {placa}",
		// 3 bloques → template `mensaje3parametros`.
		cuerpo: `Estimado(a) {clienteNombre}, buen día, el motivo de la notificación es porque tenemos 1 cuota en atraso, se solicita que su pago sea lo antes posible para poder solventar su situación, quedaremos a la espera de su boleta el día {fechaPago}.

${COBROS_NO_REPLY_WARNING}

Atentamente, {nombreAsesor} Tel: {telefonoAsesor}.`,
	},
	{
		id: "mora_60",
		nombre: "Mora 60 días",
		etapa: "mora_60",
		asunto: "AVISO IMPORTANTE: Mora de 60 días - Vehículo {placa}",
		// 4 bloques → template `mensaje4parametros`.
		cuerpo: `Estimado/a {clienteNombre}, Buen día. El motivo de la notificación es porque tenemos {cuotasAtraso} cuota(s) en atraso. Se solicita que su pago sea lo antes posible para poder solventar su situación. Quedaremos a la espera de su boleta el día {fechaPago}.

Si no recibimos el pago dentro del plazo establecido, nos veremos obligados a tomar medidas adicionales para recuperar la deuda, incluida la posible ejecución del vehículo y el apagado de la unidad en movimiento o estacionado.

${COBROS_NO_REPLY_WARNING}

Atentamente, {nombreAsesor} Tel: {telefonoAsesor}`,
	},
	{
		id: "aviso_juridico",
		nombre: "Aviso jurídico",
		etapa: "mora_90",
		asunto: "ÚLTIMO AVISO: Proceso jurídico - Vehículo {placa}",
		// 4 bloques → template `mensaje4parametros`.
		cuerpo: `Señor(a) {clienteNombre}, le informamos que su obligación adquirida por medio de la plataforma de inversión CLUB CASH IN por la compra del vehículo ({placa}) {marcaLineaModelo}, se encuentra con {cuotasAtraso} cuota(s) de atraso, por un monto de {montoAdeudado} incluyendo moras.

Por lo que le solicitamos ponerse en contacto con nosotros para entregar la unidad en un plazo no mayor de 24 horas para solventar su situación. De no obtener respuesta en el plazo establecido, procederemos a presentar DEMANDA en su contra por denuncia de robo.

${COBROS_NO_REPLY_WARNING}

Favor de comunicarse a los siguientes números: {telefonoAsesor} y 2234-1333. Nuestro horario de atención es de lunes a viernes en horario de 8:00 a 17:00 hrs.`,
	},
];
