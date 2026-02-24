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
}

export function interpolar(
	texto: string,
	variables: VariablesPlantilla,
): string {
	return texto
		.replace(/{clienteNombre}/g, variables.clienteNombre)
		.replace(/{fechaPago}/g, variables.fechaPago)
		.replace(/{cuotaMensual}/g, variables.cuotaMensual)
		.replace(/{placa}/g, variables.placa)
		.replace(/{marcaLineaModelo}/g, variables.marcaLineaModelo)
		.replace(/{montoAdeudado}/g, variables.montoAdeudado)
		.replace(/{cuotasAtraso}/g, String(variables.cuotasAtraso))
		.replace(/{telefonoAsesor}/g, variables.telefonoAsesor)
		.replace(/{nombreAsesor}/g, variables.nombreAsesor);
}

export const PLANTILLAS_MENSAJES: PlantillaMensaje[] = [
	{
		id: "bienvenida",
		nombre: "Bienvenida",
		etapa: "al_dia",
		asunto: "Bienvenido/a a su plan de financiamiento",
		cuerpo: `Estimado/a {clienteNombre},

Le damos la bienvenida a su plan de financiamiento para su vehículo {marcaLineaModelo} ({placa}).

Su cuota mensual es de Q{cuotaMensual}, con fecha de pago el día {fechaPago} de cada mes.

Cualquier consulta no dude en comunicarse con nosotros.

Atentamente,
{nombreAsesor}
Tel: {telefonoAsesor}`,
	},
	{
		id: "al_dia",
		nombre: "Recordatorio de pago",
		etapa: "al_dia",
		asunto: "Recordatorio de pago - Vehículo {placa}",
		cuerpo: `Estimado/a {clienteNombre},

Le recordamos que su próxima cuota de Q{cuotaMensual} vence el día {fechaPago}.

Vehículo: {marcaLineaModelo} ({placa})

Agradecemos su puntualidad. Si ya realizó el pago, por favor haga caso omiso de este mensaje.

Saludos cordiales,
{nombreAsesor}
Tel: {telefonoAsesor}`,
	},
	{
		id: "pre_mora",
		nombre: "Aviso de atraso",
		etapa: "pre_mora",
		asunto: "Aviso de atraso en pago - Vehículo {placa}",
		cuerpo: `Estimado/a {clienteNombre},

Hemos notado que su pago correspondiente al día {fechaPago} aún no ha sido registrado.

Vehículo: {marcaLineaModelo} ({placa})
Monto pendiente: Q{montoAdeudado}

Le solicitamos ponerse al día a la brevedad para evitar recargos adicionales. Si ya realizó el pago, por favor envíenos el comprobante.

Quedo a sus órdenes,
{nombreAsesor}
Tel: {telefonoAsesor}`,
	},
	{
		id: "mora_30",
		nombre: "Mora 30 días",
		etapa: "mora_30",
		asunto: "URGENTE: Mora de 30 días - Vehículo {placa}",
		cuerpo: `Estimado/a {clienteNombre},

Su cuenta presenta un atraso de {cuotasAtraso} cuota(s) por un monto total de Q{montoAdeudado}.

Vehículo: {marcaLineaModelo} ({placa})

Es importante que regularice su situación a la brevedad posible para evitar acciones adicionales de cobro. Le invitamos a comunicarse con nosotros para buscar una solución.

Atentamente,
{nombreAsesor}
Tel: {telefonoAsesor}`,
	},
	{
		id: "mora_60",
		nombre: "Mora 60 días",
		etapa: "mora_60",
		asunto: "AVISO IMPORTANTE: Mora de 60 días - Vehículo {placa}",
		cuerpo: `Estimado/a {clienteNombre},

Su cuenta presenta un atraso significativo de {cuotasAtraso} cuota(s) con un saldo vencido de Q{montoAdeudado}.

Vehículo: {marcaLineaModelo} ({placa})

De no recibir respuesta o pago en los próximos días, nos veremos en la necesidad de escalar su caso a la siguiente fase de recuperación. Le urgimos comunicarse con nosotros para llegar a un acuerdo.

Atentamente,
{nombreAsesor}
Tel: {telefonoAsesor}`,
	},
	{
		id: "aviso_juridico",
		nombre: "Aviso jurídico",
		etapa: "mora_90",
		asunto: "ÚLTIMO AVISO: Proceso jurídico - Vehículo {placa}",
		cuerpo: `Estimado/a {clienteNombre},

Por medio de la presente le notificamos que debido al incumplimiento reiterado en sus pagos ({cuotasAtraso} cuotas vencidas por Q{montoAdeudado}), su caso será trasladado al departamento jurídico para iniciar las acciones legales correspondientes.

Vehículo: {marcaLineaModelo} ({placa})

Tiene un plazo de 48 horas para comunicarse con nosotros y regularizar su situación antes de que se proceda con las acciones legales.

Atentamente,
{nombreAsesor}
Tel: {telefonoAsesor}`,
	},
];

/** Sugiere una plantilla según el estado de mora del caso */
export function sugerirPlantilla(
	estadoMora: string | undefined,
): string | undefined {
	const mapa: Record<string, string> = {
		al_dia: "al_dia",
		pre_mora: "pre_mora",
		mora_30: "mora_30",
		mora_60: "mora_60",
		mora_90: "aviso_juridico",
		incobrable: "aviso_juridico",
	};
	return estadoMora ? mapa[estadoMora] : undefined;
}
