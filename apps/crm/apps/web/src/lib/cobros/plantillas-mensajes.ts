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
	/**
	 * Lo que el cliente debe HOY para ponerse al día: saldo real de cada cuota
	 * vencida (recibo menos lo ya abonado) + mora, calculado en el server
	 * (getDetallesCreditoCarteraBack) con la misma regla de cobertura de
	 * cartera. Lo usan "Notificación 1 cuota atrasada", "2-3 cuotas atrasadas"
	 * y el aviso jurídico.
	 */
	montoAdeudado: string;
	cuotasAtraso: number;
	telefonoAsesor: string;
	nombreAsesor: string;
	/**
	 * Mora proporcional, misma fórmula que el job `procesarMoras` de
	 * cartera-back: cada cuota vencida suma 1/30 de su cargo mensual por día de
	 * atraso y se congela en el cargo completo al día 30. Ambos vienen ya
	 * formateados del server (getDetallesCreditoCarteraBack).
	 *  - expectativaMora: tope de la cuota = cargo mensual (capital × 1.12%).
	 *  - expectativaMoraDiaria: lo que suma cada día de atraso (1/30 del cargo).
	 */
	expectativaMora: string;
	expectativaMoraDiaria?: string;
	/**
	 * Lo que sube POR DÍA el crédito que YA está en mora. NO es lo mismo que
	 * `expectativaMoraDiaria`: esa es el recargo de UNA cuota (1/30 de su cargo
	 * mensual) y se le anuncia a un cliente AL DÍA; esta es lo que crece el
	 * crédito completo, 1/30 por CADA cuota vencida que todavía no llegó a su
	 * techo de 30 días (tres cuotas frescas crecen 3/30 por día; una cuota
	 * abandonada hace 200 días ya está congelada y aporta 0). Lo calcula
	 * cartera-back, que es el único que conoce los días de cada cuota, y llega
	 * ya formateado del server. Vacío o "0.00" = no hay aumento que anunciar y
	 * la oración desaparece sola.
	 */
	incrementoDiarioMora?: string;
	/**
	 * El TECHO de ese aumento: lo máximo que la mora del crédito puede subir en
	 * un mes. Va SIEMPRE junto a `incrementoDiarioMora`, porque el ritmo solo
	 * prometía un crecimiento que no dura para siempre (cada cuota deja de
	 * crecer al llegar a su cargo mensual); decir las dos cifras es el mismo
	 * estándar de la plantilla del día de pago. Lo calcula cartera-back de las
	 * MISMAS cuotas que el diario y llega ya formateado del server. Vacío o
	 * "0.00" = no hay techo que anunciar y la frase se queda solo con el ritmo.
	 */
	incrementoMaximoMensualMora?: string;
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
 * Fragmento fijo de la oración de mora del recordatorio del día de pago
 * ("…se agregará un recargo por mora de alrededor de Q{expectativaMoraDiaria}
 * por cada día de atraso, hasta un máximo de Q{expectativaMora} al mes.").
 * Corta ANTES del "alrededor de" a propósito, para que el detector no dependa
 * de esa palabra. Sirve para
 * detectar, en el mensaje YA interpolado que el asesor editó, si la oración
 * sigue presente: si la borró, no hay nada que bloquear.
 */
export const FRAGMENTO_EXPECTATIVA_MORA = "recargo por mora de";

/**
 * Fragmentos fijos de las oraciones que llevan {montoAdeudado}: una por cada
 * plantilla de mora. Son deliberadamente específicos porque "por un monto de"
 * a secas también aparece en el recordatorio del día de pago (con
 * {cuotaMensual}), y bloquearlo dejaría sin enviar la plantilla más usada.
 *  - "cuota con atraso por un monto de Q" → 1 cuota atrasada (al_dia dice
 *    "cuota, por un monto de Q", con coma, así que no colisiona).
 *  - "por un monto total de Q" → 2-3 cuotas atrasadas.
 *  - "incluyendo moras" → aviso jurídico (su monto va sin "Q" delante, y esta
 *    es la parte de la oración que sobrevive a la interpolación).
 */
export const FRAGMENTOS_MONTO_ADEUDADO = [
	"cuota con atraso por un monto de Q",
	"por un monto total de Q",
	"incluyendo moras",
] as const;

/**
 * Oración que anuncia cuánto va a subir el saldo en las plantillas de mora.
 * Son DOS fragmentos independientes, y el que manda es el TECHO:
 *
 *   "…al día de hoy, que sube alrededor de Q3.73 por día, y puede aumentar
 *    hasta Q108.27 más en los próximos 30 días."
 *
 * Por qué el techo manda y el ritmo es secundario: el ritmo diario es el delta
 * de UN solo día y el calendario lo rompe — la víspera del siguiente
 * vencimiento la cuota vieja ya tocó su techo y la nueva todavía no vence, así
 * que ese día el delta da Q0.00 aunque la mora sí vaya a crecer (pasa ~7 veces
 * al año, cada vez que el mes trae 31 días). El techo a 30 días nunca es cero
 * mientras haya mora devengándose. Por eso los fragmentos se borran por
 * SEPARADO: sin ritmo, el mensaje sigue anunciando el techo en vez de quedarse
 * mudo justo cuando el cliente está por pagar.
 *
 * Por qué "alrededor de" y "hasta": los dos números NO se multiplican entre sí
 * (30 × Q3.73 = Q111.90, no Q112.00) y el ritmo varía de un día para otro, así
 * que la redacción no promete exactitud ni un ritmo constante.
 *
 * Tienen que ser idénticas a las del archivo del server
 * (apps/server/src/lib/cobros-plantillas.ts).
 *
 * Van DENTRO del párrafo del monto adeudado, así que no cambian el conteo de
 * bloques (`\n\n`) del que depende la selección de template en Meta.
 */
export const FRAGMENTO_RITMO_INCREMENTO_MORA =
	", que sube alrededor de Q{incrementoDiarioMora} por día";

export const FRAGMENTO_TOPE_INCREMENTO_MORA =
	", y puede aumentar hasta Q{incrementoMaximoMensualMora} más en los próximos 30 días";

export const CLAUSULA_INCREMENTO_DIARIO_MORA =
	FRAGMENTO_RITMO_INCREMENTO_MORA + FRAGMENTO_TOPE_INCREMENTO_MORA;

/**
 * true si el mensaje que se va a mandar todavía anuncia el monto adeudado (con
 * la variable sin interpolar o ya interpolada). Se evalúa sobre el texto real
 * del canal, no sobre la plantilla, para que el asesor pueda quitar la oración
 * y enviar aunque el server no haya podido calcular el monto.
 */
export function mensajeAnunciaMontoAdeudado(mensaje: string): boolean {
	return (
		mensaje.includes("{montoAdeudado}") ||
		FRAGMENTOS_MONTO_ADEUDADO.some((fragmento) => mensaje.includes(fragmento))
	);
}

/**
 * true si el mensaje que se va a mandar todavía anuncia el recargo por mora
 * (con la variable sin interpolar o ya interpolada). Se evalúa sobre el texto
 * real del canal, no sobre la plantilla original, para que el asesor pueda
 * quitar la oración y enviar aunque el crédito no genere mora.
 */
export function mensajeAnunciaExpectativaMora(mensaje: string): boolean {
	return (
		mensaje.includes("{expectativaMora}") ||
		mensaje.includes("{expectativaMoraDiaria}") ||
		mensaje.includes(FRAGMENTO_EXPECTATIVA_MORA)
	);
}

/**
 * true si ya pasó el corte del impuesto y el mensaje que se va a mandar
 * todavía trae la fecha límite vencida (la variable sin interpolar o la fecha
 * ya resuelta, p. ej. "31/07/2026"). Si el asesor la reemplazó por otra fecha
 * o borró la línea, se puede enviar.
 */
export function mensajeTieneFechaLimiteImpuestoVencida(
	mensaje: string,
	ahora = new Date(),
): boolean {
	if (!fechaLimiteImpuestoVencida(ahora)) return false;
	return (
		mensaje.includes("{fechaLimiteImpuesto}") ||
		mensaje.includes(fechaLimiteImpuestoCirculacion(ahora))
	);
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

/**
 * Borra de la oración del aumento solo lo que ese día no se puede anunciar.
 * Cada fragmento se evalúa por su cuenta y los tres resultados son frases
 * sanas: sin ritmo pero con techo queda "…al día de hoy, y puede aumentar
 * hasta Q108.27 más en los próximos 30 días" (la víspera del próximo
 * vencimiento, cuando el delta de un día da Q0.00 y la mora igual va a
 * crecer); con ritmo pero sin techo queda "…, que sube alrededor de Q3.73 por
 * día"; y sin ninguno de los dos —crédito con TODAS las cuotas en su techo,
 * que ya no crece— se va la cláusula entera.
 *
 * El orden importa: la cláusula completa se busca ANTES que sus partes, porque
 * sacando primero un fragmento ya no coincidiría para poder borrarse.
 *
 * Idéntica a la del server (apps/server/src/lib/cobros-plantillas.ts): vive
 * aparte de `interpolar` porque el gate de envío pregunta lo mismo ANTES de
 * mandar, sobre lo que queda del cuerpo.
 */
export function quitarClausulaIncrementoMora(
	texto: string,
	incrementoDiarioMora: string,
	incrementoMaximoMensualMora: string,
): string {
	const hayRitmo = hayIncrementoMora(incrementoDiarioMora);
	const hayTecho = hayIncrementoMora(incrementoMaximoMensualMora);

	if (hayRitmo && hayTecho) return texto;
	if (!hayRitmo && !hayTecho) {
		return texto.split(CLAUSULA_INCREMENTO_DIARIO_MORA).join("");
	}
	if (!hayRitmo) {
		return texto.split(FRAGMENTO_RITMO_INCREMENTO_MORA).join("");
	}
	return texto.split(FRAGMENTO_TOPE_INCREMENTO_MORA).join("");
}

/**
 * true si el mensaje que se va a mandar TODAVÍA anuncia el aumento de la mora
 * con un placeholder suelto y sin valor: al cliente le llegaría "El saldo
 * aumenta Q diario".
 *
 * La cláusula incorporada desaparece sola al interpolar, pero el modal del
 * masivo ofrece las dos variables sueltas y el asesor puede escribir su propia
 * oración, que no coincide con `CLAUSULA_INCREMENTO_DIARIO_MORA` y sobrevive
 * al borrado. Mismo criterio que `mensajeAnunciaMontoAdeudado`: se evalúa
 * sobre el texto real del canal, así que si el asesor borra la oración el
 * envío se habilita.
 */
export function mensajeAnunciaIncrementoMoraSinDato(
	mensaje: string,
	incrementoDiarioMora: string,
	incrementoMaximoMensualMora: string,
): boolean {
	const restante = quitarClausulaIncrementoMora(
		mensaje,
		incrementoDiarioMora,
		incrementoMaximoMensualMora,
	);

	return (
		(restante.includes("{incrementoDiarioMora}") &&
			!hayIncrementoMora(incrementoDiarioMora)) ||
		(restante.includes("{incrementoMaximoMensualMora}") &&
			!hayIncrementoMora(incrementoMaximoMensualMora))
	);
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

	const incrementoDiarioMora = variables.incrementoDiarioMora ?? "";
	const incrementoMaximoMensualMora =
		variables.incrementoMaximoMensualMora ?? "";
	const base = quitarClausulaIncrementoMora(
		texto,
		incrementoDiarioMora,
		incrementoMaximoMensualMora,
	);

	return base
		.replace(
			/{incrementoDiarioMora}/g,
			v(incrementoDiarioMora, "aumento diario de la mora"),
		)
		.replace(
			/{incrementoMaximoMensualMora}/g,
			v(incrementoMaximoMensualMora, "techo mensual de la mora"),
		)
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
			/{expectativaMoraDiaria}/g,
			v(variables.expectativaMoraDiaria ?? "", "mora por día de atraso"),
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
		cuerpo: `Hola {clienteNombre} 👋
Te recordamos que hoy es la fecha de pago de tu cuota, por un monto de Q{cuotaMensual}. Agradeceremos realizar tu pago y compartir tu comprobante para aplicarlo a tu cuenta.

🛑 Si no realizas tu pago hoy, se agregará un recargo por mora de alrededor de Q{expectativaMoraDiaria} por cada día de atraso, hasta un máximo de Q{expectativaMora} al mes.

📞 Si necesitas apoyo, comunícate con tu asesor:
{nombreAsesor} - Asesor de Cobros
{telefonoAsesor}

🚗 Si ya realizó su pago, agradecemos hacer caso omiso a este recordatorio.
CashIn`,
		cuerpoWhastapp: `Hola {clienteNombre} 👋
Te recordamos que *hoy es la fecha de pago de tu cuota, por un monto de Q{cuotaMensual}*. Agradeceremos realizar tu pago y compartir tu comprobante para aplicarlo a tu cuenta.

🛑 *Si no realizas tu pago hoy, se agregará un recargo por mora de alrededor de Q{expectativaMoraDiaria} por cada día de atraso, hasta un máximo de Q{expectativaMora} al mes.*

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
		cuerpo: `Hola 👋
Te recordamos realizar el pago de tu Impuesto de Circulación {anioImpuesto}.
⏰ Fecha límite: {fechaLimiteImpuesto} a las 5:00 p.m.

🛑 En caso de no realizar el pago, CashIn lo realizará y te cobrará las multas y gastos administrativos adicionales.

✅ Al realizar el pago, comparte el comprobante con tu asesor antes de la hora límite:
{nombreAsesor} - Asesor de Cobros
{telefonoAsesor}

CashIn`,
		cuerpoWhastapp: `Hola 👋
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
		cuerpo: `Hola {clienteNombre} 👋
Te saludamos de CashIn para recordarte que tu próxima cuota tiene fecha de pago el {fechaPago}.

📞 Para consultas o apoyo con tu cuenta, comunícate directamente con tu asesor de cobros:
{nombreAsesor} - Asesor de Cobros
{telefonoAsesor}

🚗 Si ya realizó su pago, agradecemos hacer caso omiso a este recordatorio.
CashIn`,
		cuerpoWhastapp: `Hola {clienteNombre} 👋
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
		cuerpo: `Hola {clienteNombre} 👋
Tienes 1 cuota con atraso por un monto de Q{montoAdeudado} al día de hoy${CLAUSULA_INCREMENTO_DIARIO_MORA}.

Es importante que realices tu pago lo antes posible para evitar mayores recargos en tu cuenta.

📲 Al realizar el pago, comparte el comprobante con tu asesor:
{nombreAsesor} - Asesor de Cobros
{telefonoAsesor}

CashIn`,
		cuerpoWhastapp: `Hola {clienteNombre} 👋
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
		cuerpo: `Hola {clienteNombre},
Te informamos que actualmente tienes {cuotasAtraso} cuotas en atraso, por un monto total de Q{montoAdeudado} al día de hoy${CLAUSULA_INCREMENTO_DIARIO_MORA}.

⚠️ En caso de no recibir el pago, CashIn podrá aplicar las medidas de recuperación contempladas en tu contrato y la ejecución de garantía.

✅ Al realizar el pago, comparte el comprobante con tu asesor:
{nombreAsesor} - Asesor de Cobros
{telefonoAsesor}

CashIn`,
		cuerpoWhastapp: `Hola {clienteNombre},
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
		cuerpo: `Señor(a) {clienteNombre}, por este medio hacemos de su conocimiento que su obligación adquirida por medio de la plataforma de inversión CLUB CASH IN por la compra del vehículo ({placa}) {marcaLineaModelo}, se encuentra con {cuotasAtraso} cuota(s) de atraso, por un monto de {montoAdeudado} incluyendo moras al día de hoy${CLAUSULA_INCREMENTO_DIARIO_MORA}.

Por lo que le solicitamos ponerse en contacto con nosotros para entregar la unidad en un plazo no mayor de 24 horas para solventar su situación. De no obtener respuesta en el plazo establecido, procederemos a presentar DEMANDA en su contra por denuncia de robo.

Favor de comunicarse a los siguientes números: {telefonoAsesor} y 2234-1333. Nuestro horario de atención es de lunes a viernes en horario de 8:00 a 17:00 hrs.`,
		cuerpoWhastapp: `Señor(a) {clienteNombre}, le informamos que su obligación adquirida por medio de la plataforma de inversión CLUB CASH IN por la compra del vehículo ({placa}) {marcaLineaModelo}, se encuentra con {cuotasAtraso} cuota(s) de atraso, por un monto de {montoAdeudado} incluyendo moras al día de hoy${CLAUSULA_INCREMENTO_DIARIO_MORA}.

Por lo que le solicitamos ponerse en contacto con nosotros para entregar la unidad en un plazo no mayor de 24 horas para solventar su situación. De no obtener respuesta en el plazo establecido, procederemos a presentar DEMANDA en su contra por denuncia de robo.

${COBROS_NO_REPLY_WARNING}

Favor de comunicarse a los siguientes números: {telefonoAsesor} y 2234-1333. Nuestro horario de atención es de lunes a viernes en horario de 8:00 a 17:00 hrs.`,
	},
];
/**
 * true si hay un monto de aumento REAL que anunciar — sirve igual para el
 * ritmo diario y para su techo mensual. "" (cartera no lo mandó) y "0.00" son
 * lo mismo para el mensaje: no hay frase. El valor viene formateado
 * es-GT, así que se le quitan los separadores de miles antes de compararlo.
 */
export function hayIncrementoMora(valor: string | null | undefined): boolean {
	if (!valor) return false;
	return Number(valor.replace(/,/g, "")) > 0;
}

/** Sugiere una plantilla según el estado de mora y antigüedad del caso */
export function sugerirPlantilla(
	estadoMora: string | undefined,
	fechaInicio?: string | Date | null,
): string {
	// "Notificación 2-3 cuotas atrasadas" cubre mora_60 Y mora_90 (2 y 3 cuotas
	// según getDetallesCreditoCarteraBack). El aviso jurídico queda para 4+
	// cuotas (mora_120) e incobrables.
	const mapaMora: Record<string, string> = {
		pre_mora: "pre_mora",
		mora_30: "mora_30",
		mora_60: "mora_60",
		mora_90: "mora_60",
		mora_120: "aviso_juridico",
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
