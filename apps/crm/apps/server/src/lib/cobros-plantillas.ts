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
	/** SOLO el recargo por mora (no incluye las cuotas vencidas). Ver `cuotasAtraso`. */
	montoMora: string;
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
export const COBROS_MOTIVO_SIN_TELEFONO_ASESOR = "sin teléfono de asesor";

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
		.replace(/{montoMora}/g, v(variables.montoMora))
		.replace(/{cuotasAtraso}/g, v(variables.cuotasAtraso))
		.replace(/{telefonoAsesor}/g, v(variables.telefonoAsesor))
		.replace(/{nombreAsesor}/g, v(variables.nombreAsesor));
}

/**
 * Cuentas de pago (mismo texto que la bienvenida). Las plantillas premora las
 * incluyen porque el criterio de CC2-11 pide "link de pago o cuentas de pago";
 * cuando exista el link de pago se agrega como variable.
 */
export const COBROS_CUENTAS_PAGO =
	"A continuación, le compartimos los números de cuenta para realizar su depósito o transferencia: - CUBE INVESTMENTS, S.A. (monetaria) No. 5520029876 BANCO INDUSTRIAL (BI) / CUBE INVESTMENTS, S.A. (monetaria) No. 3020123033 BANCO AGROMERCANTIL (BAM) / CUBE INVESTMENTS, S.A. (monetaria) No. 01300039945 BANCO GyT CONTINENTAL / CUBE INVESTMENTS, S.A. (monetaria) No. 3394002346 BANRURAL";

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
		id: "impuesto_circulacion_2026",
		nombre: "Impuesto de circulación 2026",
		etapa: "al_dia",
		asunto: "Recordatorio de pago - Impuesto de circulación 2026",
		// 5 bloques; SimpleTech colapsa los dos últimos en `mensaje4parametro`.
		cuerpo: `Estimado(a) {clienteNombre}, buen día, cordialmente le saludamos de Clubcashin para recordarle sobre el pago del impuesto de circulación del año 2026.

Envíanos tu comprobante a tiempo para que podamos procesar y enviarte tus distintivos sin contratiempos.

¡No lo dejes para última hora!

${COBROS_NO_REPLY_WARNING}

Atentamente,
{nombreAsesor}
Tel: {telefonoAsesor}`,
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
	// ── Premora (CC2-11): recordatorios automáticos D-5/D-3/D-1/D-0 para
	// créditos AL DÍA. Los envía el job diario (send-premora-reminders.ts);
	// {fechaPago} aquí es la FECHA completa de vencimiento (dd/mm/aaaa).
	{
		id: "premora_5",
		nombre: "Premora — 5 días antes",
		etapa: "al_dia",
		asunto: "Recordatorio: su cuota vence en 5 días",
		// 5 bloques; SimpleTech colapsa a template `mensaje4parametros`.
		cuerpo: `Hola {clienteNombre}, le saludamos de Clubcashin.com. Le recordamos que la cuota de su crédito por Q{cuotaMensual} vence el {fechaPago} (en 5 días).

${COBROS_CUENTAS_PAGO}

Por favor, envíe su boleta o comprobante de pago al {telefonoAsesor}. SI YA REALIZÓ SU PAGO POR FAVOR HACER CASO OMISO A ESTE MENSAJE.

${COBROS_NO_REPLY_WARNING}

Atentamente, {nombreAsesor} Tel: {telefonoAsesor}.`,
	},
	{
		id: "premora_3",
		nombre: "Premora — 3 días antes",
		etapa: "al_dia",
		asunto: "Recordatorio: su cuota vence en 3 días",
		// 5 bloques; SimpleTech colapsa a template `mensaje4parametros`.
		cuerpo: `Hola {clienteNombre}, le saludamos de Clubcashin.com. Le recordamos que la cuota de su crédito por Q{cuotaMensual} vence el {fechaPago} (en 3 días).

${COBROS_CUENTAS_PAGO}

Por favor, envíe su boleta o comprobante de pago al {telefonoAsesor}. SI YA REALIZÓ SU PAGO POR FAVOR HACER CASO OMISO A ESTE MENSAJE.

${COBROS_NO_REPLY_WARNING}

Atentamente, {nombreAsesor} Tel: {telefonoAsesor}.`,
	},
	{
		id: "premora_1",
		nombre: "Premora — 1 día antes",
		etapa: "al_dia",
		asunto: "Recordatorio: su cuota vence mañana",
		// 5 bloques; SimpleTech colapsa a template `mensaje4parametros`.
		cuerpo: `Hola {clienteNombre}, le saludamos de Clubcashin.com. Le recordamos que la cuota de su crédito por Q{cuotaMensual} vence MAÑANA {fechaPago}.

${COBROS_CUENTAS_PAGO}

Por favor, envíe su boleta o comprobante de pago al {telefonoAsesor}. SI YA REALIZÓ SU PAGO POR FAVOR HACER CASO OMISO A ESTE MENSAJE.

${COBROS_NO_REPLY_WARNING}

Atentamente, {nombreAsesor} Tel: {telefonoAsesor}.`,
	},
	{
		id: "premora_0",
		nombre: "Premora — día de pago (D-0)",
		etapa: "al_dia",
		asunto: "Hoy es su día de pago",
		// 5 bloques; SimpleTech colapsa a template `mensaje4parametros`.
		cuerpo: `Estimado(a) {clienteNombre}, buen día. Le saludamos de Clubcashin.com para recordarle que HOY {fechaPago} vence la cuota de su crédito por Q{cuotaMensual}. Quedamos a la espera de su comprobante de pago.

${COBROS_CUENTAS_PAGO}

Por favor, envíe su boleta o comprobante de pago al {telefonoAsesor}. SI YA REALIZÓ SU PAGO POR FAVOR HACER CASO OMISO A ESTE MENSAJE.

${COBROS_NO_REPLY_WARNING}

Atentamente, {nombreAsesor} Tel: {telefonoAsesor}.`,
	},
	// ── Variantes premora para créditos EN MORA (B1-B4, PREMORA_BUCKETS) ──
	// Mismo esquema de 5 bloques (mensaje4parametros). El tono cambia: se
	// recuerda la cuota próxima Y el saldo vencido. COPY BORRADOR — afinar
	// con el equipo de cobros antes de encender el funnel.
	{
		id: "premora_5_mora",
		nombre: "Premora (en mora) — 5 días antes",
		etapa: "pre_mora",
		asunto: "Recordatorio: su cuota vence en 5 días",
		// 5 bloques; SimpleTech colapsa a template `mensaje4parametros`.
		cuerpo: `Hola {clienteNombre}, le saludamos de Clubcashin.com. Le recordamos que la próxima cuota de su crédito por Q{cuotaMensual} vence el {fechaPago} (en 5 días). Además su crédito registra {cuotasAtraso} cuota(s) vencida(s) y Q{montoMora} de mora.

${COBROS_CUENTAS_PAGO}

Por favor, envíe su boleta o comprobante de pago al {telefonoAsesor}. SI YA REGULARIZÓ SU CUENTA POR FAVOR HACER CASO OMISO A ESTE MENSAJE.

${COBROS_NO_REPLY_WARNING}

Atentamente, {nombreAsesor} Tel: {telefonoAsesor}.`,
	},
	{
		id: "premora_3_mora",
		nombre: "Premora (en mora) — 3 días antes",
		etapa: "pre_mora",
		asunto: "Recordatorio: su cuota vence en 3 días",
		// 5 bloques; SimpleTech colapsa a template `mensaje4parametros`.
		cuerpo: `Hola {clienteNombre}, le saludamos de Clubcashin.com. Le recordamos que la próxima cuota de su crédito por Q{cuotaMensual} vence el {fechaPago} (en 3 días). Además su crédito registra {cuotasAtraso} cuota(s) vencida(s) y Q{montoMora} de mora.

${COBROS_CUENTAS_PAGO}

Por favor, envíe su boleta o comprobante de pago al {telefonoAsesor}. SI YA REGULARIZÓ SU CUENTA POR FAVOR HACER CASO OMISO A ESTE MENSAJE.

${COBROS_NO_REPLY_WARNING}

Atentamente, {nombreAsesor} Tel: {telefonoAsesor}.`,
	},
	{
		id: "premora_1_mora",
		nombre: "Premora (en mora) — 1 día antes",
		etapa: "pre_mora",
		asunto: "Recordatorio: su cuota vence mañana",
		// 5 bloques; SimpleTech colapsa a template `mensaje4parametros`.
		cuerpo: `Hola {clienteNombre}, le saludamos de Clubcashin.com. Le recordamos que la próxima cuota de su crédito por Q{cuotaMensual} vence MAÑANA {fechaPago}. Además su crédito registra {cuotasAtraso} cuota(s) vencida(s) y Q{montoMora} de mora.

${COBROS_CUENTAS_PAGO}

Por favor, envíe su boleta o comprobante de pago al {telefonoAsesor}. SI YA REGULARIZÓ SU CUENTA POR FAVOR HACER CASO OMISO A ESTE MENSAJE.

${COBROS_NO_REPLY_WARNING}

Atentamente, {nombreAsesor} Tel: {telefonoAsesor}.`,
	},
	{
		id: "premora_0_mora",
		nombre: "Premora (en mora) — día de pago (D-0)",
		etapa: "pre_mora",
		asunto: "Hoy es su día de pago",
		// 5 bloques; SimpleTech colapsa a template `mensaje4parametros`.
		cuerpo: `Estimado(a) {clienteNombre}, buen día. Le saludamos de Clubcashin.com para recordarle que HOY {fechaPago} vence la cuota de su crédito por Q{cuotaMensual}. Además su crédito registra {cuotasAtraso} cuota(s) vencida(s) y Q{montoMora} de mora.

${COBROS_CUENTAS_PAGO}

Por favor, envíe su boleta o comprobante de pago al {telefonoAsesor}. SI YA REGULARIZÓ SU CUENTA POR FAVOR HACER CASO OMISO A ESTE MENSAJE.

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
