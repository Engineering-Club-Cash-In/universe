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
    .replace(/{nombreAsesor}/g, v(variables.nombreAsesor, "nombre asesor"));
}

export const PLANTILLAS_MENSAJES: PlantillaMensaje[] = [
  {
    id: "bienvenida",
    nombre: "Bienvenida",
    etapa: "al_dia",
    asunto: "Bienvenido/a a su plan de financiamiento",
    cuerpo: `Hola {clienteNombre},

Le saludamos cordialmente de Clubcashin.com para recordarle sobre el pago de su crédito, el cual debe realizarse el {fechaPago}. Sus cuotas son por un monto de Q{cuotaMensual}.

A continuación, le compartimos los números de cuenta para realizar su depósito o transferencia:

- CUBE INVESTMENTS, S.A. (monetaria) No. 5520029876 - BANCO INDUSTRIAL (BI)
- CUBE INVESTMENTS, S.A. (monetaria) No. 3020123033 - BANCO AGROMERCANTIL (BAM)
- CUBE INVESTMENTS, S.A. (monetaria) No. 01300039945 - BANCO GyT CONTINENTAL
- CUBE INVESTMENTS, S.A. (monetaria) No. 3394002346 - BANRURAL

Por favor, envíe su boleta o comprobante de pago por este medio para aplicarlo a su cuenta.

Si tiene alguna duda o consulta, estamos a su disposición.

Agradecemos confirme la recepción de este mensaje.

Atentamente, 
{nombreAsesor} 
Tel: {telefonoAsesor}.`,
    cuerpoWhastapp: `Hola {clienteNombre}, Le saludamos cordialmente de Clubcashin.com para recordarle sobre el pago de su crédito, el cual debe realizarse el {fechaPago}. Sus cuotas son por un monto de Q{cuotaMensual}.

A continuación, le compartimos los números de cuenta para realizar su depósito o transferencia: - CUBE INVESTMENTS, S.A. (monetaria) No. 5520029876 BANCO INDUSTRIAL (BI) / CUBE INVESTMENTS, S.A. (monetaria) No. 3020123033 BANCO AGROMERCANTIL (BAM) / CUBE INVESTMENTS, S.A. (monetaria) No. 01300039945 BANCO GyT CONTINENTAL / CUBE INVESTMENTS, S.A. (monetaria) No. 3394002346 BANRURAL

Por favor, envíe su boleta o comprobante de pago al {telefonoAsesor} para aplicarlo a su cuenta. Si tiene alguna duda o consulta, estamos a su disposición.

${COBROS_NO_REPLY_WARNING}

Agradecemos confirme la recepción de este mensaje. Atentamente, {nombreAsesor} Tel: {telefonoAsesor}.`,
  },
  {
    id: "al_dia",
    nombre: "Recordatorio de pago",
    etapa: "al_dia",
    asunto: "Recordatorio de pago - Vehículo {placa}",
    cuerpo: `Estimado(a) {clienteNombre}, buen día, cordialmente le saludamos de Clubcashin para recordarle sobre el pago de su crédito el día de hoy, quedamos a la espera de su comprobante de pago.

Atentamente, 
{nombreAsesor} 
Tel: {telefonoAsesor}.`,
    cuerpoWhastapp: `Estimado(a) {clienteNombre}, buen día, cordialmente le saludamos de Clubcashin para recordarle sobre el pago de su crédito el día de hoy, quedamos a la espera de su comprobante de pago.

${COBROS_NO_REPLY_WARNING}

Atentamente, {nombreAsesor} Tel: {telefonoAsesor}.`,
  },
  {
    id: "pre_mora",
    nombre: "Aviso de atraso",
    etapa: "pre_mora",
    asunto: "Aviso de atraso en pago - Vehículo {placa}",
    cuerpo: `Hola {clienteNombre}, le saludamos de Clubcashin recordándole que su cuota esta próxima a vencer. Su día de pago es el {fechaPago}. Ponemos a su disposición nuestros medios de pago en Banco Industrial, BANRURAL, Banco Agromercantil (BAM) y GyT.

Si tiene alguna duda por favor comunicarse por este medio.

SI YA REALIZO SU PAGO POR FAVOR HACER CASO OMISO A ESTE MENSAJE.

Atentamente, 
{nombreAsesor} 
Tel: {telefonoAsesor}.`,
    cuerpoWhastapp: `Hola {clienteNombre}, le saludamos de Clubcashin recordándole que su cuota esta próxima a vencer. Su día de pago es el {fechaPago}. Ponemos a su disposición nuestros medios de pago en Banco Industrial, BANRURAL, Banco Agromercantil (BAM) y GyT.

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
    cuerpo: `Estimado(a) {clienteNombre}, buen día, el motivo de la notificación es porque tenemos 1 cuota en atraso, se solicita que su pago sea lo antes posible para poder solventar su situación, quedaremos a la espera de su boleta el día {fechaPago}.

Atentamente, 
{nombreAsesor} 
Tel: {telefonoAsesor}.`,
    cuerpoWhastapp: `Estimado(a) {clienteNombre}, buen día, el motivo de la notificación es porque tenemos 1 cuota en atraso, se solicita que su pago sea lo antes posible para poder solventar su situación, quedaremos a la espera de su boleta el día {fechaPago}.

${COBROS_NO_REPLY_WARNING}

Atentamente, {nombreAsesor} Tel: {telefonoAsesor}.`,
  },
  {
    id: "mora_60",
    nombre: "Mora 60 días",
    etapa: "mora_60",
    asunto: "AVISO IMPORTANTE: Mora de 60 días - Vehículo {placa}",
    cuerpo: `Estimado/a {clienteNombre},

Buen día. El motivo de la notificación es porque tenemos {cuotasAtraso} cuota(s) en atraso. Se solicita que su pago sea lo antes posible para poder solventar su situación. Quedaremos a la espera de su boleta el día {fechaPago}.

Si no recibimos el pago dentro del plazo establecido, nos veremos obligados a tomar medidas adicionales para recuperar la deuda, incluida la posible ejecución del vehículo y el apagado de la unidad en movimiento o estacionado.

Atentamente,
{nombreAsesor}
Tel: {telefonoAsesor}`,
    cuerpoWhastapp: `Estimado/a {clienteNombre}, Buen día. El motivo de la notificación es porque tenemos {cuotasAtraso} cuota(s) en atraso. Se solicita que su pago sea lo antes posible para poder solventar su situación. Quedaremos a la espera de su boleta el día {fechaPago}.

Si no recibimos el pago dentro del plazo establecido, nos veremos obligados a tomar medidas adicionales para recuperar la deuda, incluida la posible ejecución del vehículo y el apagado de la unidad en movimiento o estacionado.

${COBROS_NO_REPLY_WARNING}

Atentamente, {nombreAsesor} Tel: {telefonoAsesor}`,
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
