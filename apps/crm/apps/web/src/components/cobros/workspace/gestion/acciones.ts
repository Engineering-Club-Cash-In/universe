/**
 * Workspace · panel de gestión: qué gestiones ofrece el inicio para un caso
 * («Otras gestiones», agrupadas) y cuáles ofrece «Se llegó a un acuerdo».
 *
 * Las reglas son las de la Ficha 360 (`lib/cobros/reglas-caso.ts`, ya
 * calculadas en `CasoWorkspace`):
 *  - Lo que no aplica al bucket se oculta (como el Figma por rol).
 *  - Lo que el estado del caso bloquea se ve deshabilitado con su motivo.
 *  - Lo que el sistema todavía no tiene va deshabilitado con «Pronto».
 *
 * Funciones puras: reciben el caso y a dónde navegar.
 */
import {
	CalendarClock,
	Car,
	CircleCheck,
	FileText,
	HandCoins,
	Handshake,
	Link2,
	MapPin,
	MessageCircle,
	MessageSquare,
	PackageCheck,
	Percent,
	Phone,
	PhoneIncoming,
	Power,
	Receipt,
	Scale,
	Search,
	Undo2,
	Users,
	Warehouse,
} from "lucide-react";
import type { CasoWorkspace } from "../use-caso-workspace";
import type { AccionGestion, GrupoGestiones } from "./piezas";

/** Los formularios que se abren desde el inicio. */
export type AccionDirecta =
	| "promesa"
	| "link"
	| "comprobante"
	| "convenio"
	| "referencias"
	| "visita"
	| "investigacion"
	| "apagado"
	| "recuperacion"
	| "entrega"
	| "recepcion"
	| "seguimiento"
	| "deshacer-convenio"
	| "carta-notarial";

/** Las gestiones de contacto del grupo «Contacto» (pedido U1). */
export type InicioContacto =
	| "llamada"
	| "mensaje"
	| "llamada-entrante"
	| "whatsapp-entrante";

/** Título del paso de cada formulario («‹ Atrás · Título»). */
export function tituloAccion(
	accion: AccionDirecta,
	caso: Pick<CasoWorkspace, "promesa">,
): string {
	switch (accion) {
		case "promesa":
			return caso.promesa.promesaActiva
				? "Editar promesa de pago"
				: "Registrar promesa de pago";
		case "link":
			return "Generar link de pago";
		case "comprobante":
			return "Registrar comprobante de pago";
		case "convenio":
			return "Convenio de pago";
		case "referencias":
			return "Contactar referencias";
		case "visita":
			return "Visita";
		case "investigacion":
			return "Investigación en redes";
		case "apagado":
			return "Apagado de la unidad";
		case "recuperacion":
			return "Recuperación del vehículo";
		case "entrega":
			return "Entrega voluntaria";
		case "recepcion":
			return "Registrar recuperación del vehículo";
		case "seguimiento":
			return "Seguimiento programado";
		case "deshacer-convenio":
			return "Deshacer convenio de pago";
		case "carta-notarial":
			return "Carta notarial";
	}
}

/**
 * Nivel del caso para mostrar u ocultar gestiones: el bucket del motor o,
 * fuera del funnel (convenio), el último antes de salir.
 */
export function nivelDelCaso(caso: Pick<CasoWorkspace, "bucket">): number {
	return caso.bucket.numero ?? caso.bucket.previo ?? 0;
}

const SIN_OPERACION = "No está disponible en el bucket actual del caso.";

/**
 * Con un convenio vigente que se puede deshacer, la ficha no ofrece la
 * recuperación ni la entrega voluntaria: primero se deshace el convenio.
 */
export function recuperacionVisible(
	caso: Pick<CasoWorkspace, "recuperacion" | "convenio">,
): boolean {
	return caso.recuperacion.puede && !caso.convenio.puedeDeshacer;
}

/** «Recuperación del vehículo» como fila (inicio y visita de hoy). */
export function accionRecuperacion(
	caso: CasoWorkspace,
	onClick: () => void,
): AccionGestion {
	return {
		id: "recuperacion",
		icono: Car,
		titulo: "Recuperación del vehículo",
		subtitulo: "Solicitud al supervisor para recuperar la unidad",
		tono: "warning",
		motivoBloqueo:
			caso.recuperacion.bloqueoForzosa ??
			(caso.recuperacion.operacion("tomado") ? null : SIN_OPERACION),
		onClick,
	};
}

/** «Entrega voluntaria» como fila (inicio y visita de hoy). */
export function accionEntrega(
	caso: CasoWorkspace,
	onClick: () => void,
): AccionGestion {
	return {
		id: "entrega",
		icono: PackageCheck,
		titulo: "Entrega voluntaria",
		subtitulo: "El cliente entrega el vehículo",
		tono: "warning",
		motivoBloqueo:
			caso.recuperacion.bloqueoVoluntaria ??
			(caso.recuperacion.operacion("entrega_voluntaria")
				? null
				: SIN_OPERACION),
		onClick,
	};
}

/** «Escalar a Jurídico»: no existe todavía (Pronto). */
export function accionJuridico(): AccionGestion {
	return {
		id: "juridico",
		icono: Scale,
		titulo: "Escalar a Jurídico",
		subtitulo: "Sin acuerdo ni recuperación: el caso pasa al área legal",
		tono: "danger",
		// TODO(José) · tarea W3: escalar a Jurídico de forma manual.
		pronto: true,
	};
}

/** «Campo y rescate» (B2 en adelante); null si no aplica al caso. */
export function grupoCampo(
	caso: CasoWorkspace,
	abrir: (accion: AccionDirecta) => void,
): GrupoGestiones | null {
	if (nivelDelCaso(caso) < 2) return null;
	const campo: AccionGestion[] = [
		{
			id: "referencias",
			icono: Users,
			titulo: "Contactar referencias",
			subtitulo:
				caso.contacto.textoReferencias ?? "Llamar y registrar la gestión",
			onClick: () => abrir("referencias"),
		},
		{
			id: "visita",
			icono: MapPin,
			titulo: "Programar o registrar visita",
			subtitulo: "Residencia o lugar de trabajo",
			motivoBloqueo: caso.visita.bloqueo,
			onClick: () => abrir("visita"),
		},
	];
	if (caso.investigacion.permitida) {
		campo.push({
			id: "investigacion",
			icono: Search,
			titulo: "Investigación en redes",
			subtitulo: "Registrar hallazgos de redes sociales y otras fuentes",
			onClick: () => abrir("investigacion"),
		});
	}
	if (caso.apagado.permitido || caso.apagado.mostrarTarjeta) {
		campo.push({
			id: "apagado",
			icono: Power,
			titulo: "Apagado de la unidad",
			subtitulo: "Con la ubicación del vehículo · requiere aprobación",
			tono: "danger",
			critica: true,
			motivoBloqueo: caso.apagado.permitido
				? null
				: (caso.apagado.motivoBloqueo ??
					"El apagado no está disponible en este momento."),
			onClick: () => abrir("apagado"),
		});
	}
	return { id: "campo", titulo: "Campo y rescate", acciones: campo };
}

/** «Otras gestiones» del inicio, en el orden del bucket (pedido U1 y R2-3). */
export function gruposDelInicio(
	caso: CasoWorkspace,
	abrir: (accion: AccionDirecta) => void,
	contactar: (tipo: InicioContacto) => void,
): GrupoGestiones[] {
	const nivel = nivelDelCaso(caso);

	// ── Contacto (siempre el primero) ────────────────────────────────────────
	const contacto: GrupoGestiones = {
		id: "contacto",
		titulo: "Contacto",
		acciones: [
			{
				id: "llamada",
				icono: Phone,
				titulo: "Llamada",
				subtitulo: "Registrar una llamada al cliente o a un codeudor",
				onClick: () => contactar("llamada"),
			},
			{
				id: "mensaje",
				icono: MessageSquare,
				titulo: "Mensaje",
				subtitulo: "WhatsApp, SMS o correo con las plantillas del sistema",
				onClick: () => contactar("mensaje"),
			},
			{
				id: "llamada-entrante",
				icono: PhoneIncoming,
				titulo: "Llamada entrante",
				subtitulo: "El cliente llamó",
				onClick: () => contactar("llamada-entrante"),
			},
			{
				id: "whatsapp-entrante",
				icono: MessageCircle,
				titulo: "WhatsApp entrante",
				subtitulo: "El cliente escribió por WhatsApp",
				onClick: () => contactar("whatsapp-entrante"),
			},
		],
	};

	// ── Pagos ────────────────────────────────────────────────────────────────
	const pagos: AccionGestion[] = [];
	if (caso.pagos.puedeGenerarLinks) {
		pagos.push({
			id: "link",
			icono: Link2,
			titulo: "Generar link de pago",
			subtitulo: "Links de Págalo para que el cliente pague con tarjeta",
			onClick: () => abrir("link"),
		});
	}
	pagos.push({
		id: "comprobante",
		icono: Receipt,
		titulo: "Registrar comprobante de pago",
		subtitulo: "El cliente ya pagó y envió su comprobante",
		tono: "success",
		onClick: () => abrir("comprobante"),
	});

	// ── Acuerdos ─────────────────────────────────────────────────────────────
	const acuerdos: AccionGestion[] = [
		{
			id: "promesa",
			icono: HandCoins,
			titulo: caso.promesa.promesaActiva
				? "Editar promesa de pago"
				: "Promesa de pago",
			subtitulo: caso.promesa.promesaActiva
				? "El cliente tiene una promesa de pago vigente"
				: "Registrar el compromiso de pago del cliente",
			tono: "success",
			onClick: () => abrir("promesa"),
		},
		{
			id: "convenio",
			icono: Handshake,
			titulo: "Convenio de pago",
			subtitulo: "Plan de pago para ponerse al día",
			motivoBloqueo: caso.convenio.motivoBloqueo,
			onClick: () => abrir("convenio"),
		},
	];
	// Solo con un convenio vigente que el server confirma (como la ficha).
	if (caso.convenio.puedeDeshacer) {
		acuerdos.push({
			id: "deshacer-convenio",
			icono: Undo2,
			titulo: "Deshacer convenio",
			subtitulo:
				"El crédito vuelve a MOROSO con su mora recalculada. El acuerdo y sus pagos quedan guardados.",
			tono: "danger",
			onClick: () => abrir("deshacer-convenio"),
		});
	}
	acuerdos.push({
		id: "rebaja",
		icono: Percent,
		titulo: "Solicitar rebaja de mora",
		subtitulo: "Requiere la aprobación del supervisor",
		// TODO(José) · tarea W2: solicitud de rebaja de mora.
		pronto: true,
	});

	// ── Campo y rescate (B2 en adelante) ─────────────────────────────────────
	const campo = grupoCampo(caso, abrir);

	// ── Vehículo ─────────────────────────────────────────────────────────────
	let vehiculo: GrupoGestiones | null = null;
	if (caso.recuperacion.puede && (nivel >= 2 || caso.mora.enRecuperacion)) {
		const filas: AccionGestion[] = [];
		if (recuperacionVisible(caso)) {
			filas.push(
				accionRecuperacion(caso, () => abrir("recuperacion")),
				accionEntrega(caso, () => abrir("entrega")),
			);
		}
		if (caso.recuperacion.enB4 && caso.recuperacion.porRecibir) {
			filas.push({
				id: "recepcion",
				icono: Warehouse,
				titulo: "Registrar recuperación del vehículo",
				subtitulo: "Confirmar la recepción de la unidad",
				tono: "success",
				onClick: () => abrir("recepcion"),
			});
		}
		if (nivel >= 3) filas.push(accionJuridico());
		if (filas.length > 0) {
			vehiculo = { id: "vehiculo", titulo: "Vehículo", acciones: filas };
		}
	}

	// ── Documentos ───────────────────────────────────────────────────────────
	const documentos: GrupoGestiones = {
		id: "documentos",
		titulo: "Documentos",
		acciones: [
			{
				id: "carta-notarial",
				icono: FileText,
				titulo: "Carta notarial",
				subtitulo: "Registrar el envío de una carta notarial al cliente",
				onClick: () => abrir("carta-notarial"),
			},
		],
	};

	// ── Seguimiento ──────────────────────────────────────────────────────────
	const seguimiento: GrupoGestiones = {
		id: "seguimiento",
		titulo: "Seguimiento",
		acciones: [
			{
				id: "seguimiento",
				icono: CalendarClock,
				titulo: "Seguimiento programado",
				subtitulo: "Alertas de contacto recurrentes para este caso",
				tono: "info",
				onClick: () => abrir("seguimiento"),
			},
		],
	};

	// Orden: Contacto; en B3 «Campo y rescate» y en B4 (o en recuperación)
	// «Vehículo»; luego Pagos, Acuerdos y el resto.
	const vehiculoPrimero = nivel >= 4 || caso.mora.enRecuperacion;
	const campoPrimero = nivel === 3 && !vehiculoPrimero;
	const grupos: Array<GrupoGestiones | null> = [
		contacto,
		campoPrimero ? campo : null,
		vehiculoPrimero ? vehiculo : null,
		{ id: "pagos", titulo: "Pagos", acciones: pagos },
		{ id: "acuerdos", titulo: "Acuerdos", acciones: acuerdos },
		campoPrimero ? null : campo,
		vehiculoPrimero ? null : vehiculo,
		documentos,
		seguimiento,
	];
	return grupos.filter((g): g is GrupoGestiones => g !== null);
}

/** Las opciones de «Se llegó a un acuerdo». */
export type OpcionAcuerdo =
	| "promesa"
	| "pago"
	| "comprobante"
	| "convenio"
	| "entrega";

export function tituloOpcionAcuerdo(
	opcion: OpcionAcuerdo,
	caso: Pick<CasoWorkspace, "promesa">,
): string {
	switch (opcion) {
		case "promesa":
			return caso.promesa.promesaActiva
				? "Editar promesa de pago"
				: "Registrar promesa de pago";
		case "pago":
			return "Generar link de pago";
		case "comprobante":
			return "Registrar comprobante de pago";
		case "convenio":
			return "Convenio de pago";
		case "entrega":
			return "Entrega voluntaria";
	}
}

export function opcionesDeAcuerdo(
	caso: CasoWorkspace,
	elegir: (opcion: OpcionAcuerdo) => void,
): { opciones: AccionGestion[]; secundaria: AccionGestion } {
	const opciones: AccionGestion[] = [
		{
			id: "promesa",
			icono: CircleCheck,
			titulo: "Sí, hubo compromiso",
			subtitulo: caso.promesa.promesaActiva
				? "Editar la promesa de pago vigente"
				: "Registrar una promesa de pago",
			tono: "success",
			onClick: () => elegir("promesa"),
		},
	];
	if (caso.pagos.puedeGenerarLinks) {
		opciones.push({
			id: "pago",
			icono: CircleCheck,
			titulo: "Realizar pago",
			subtitulo: "Generar links de Págalo para que el cliente pague hoy",
			tono: "success",
			onClick: () => elegir("pago"),
		});
	}
	opciones.push({
		id: "comprobante",
		icono: CircleCheck,
		titulo: "Comprobante de pago recibido",
		subtitulo: "El cliente ya pagó y envió su comprobante",
		tono: "success",
		onClick: () => elegir("comprobante"),
	});
	if (caso.convenio.habilitado) {
		opciones.push({
			id: "convenio",
			icono: CircleCheck,
			titulo: "Convenio de pago",
			subtitulo: "Acordar un plan de pago",
			tono: "success",
			onClick: () => elegir("convenio"),
		});
	}
	if (
		recuperacionVisible(caso) &&
		!caso.recuperacion.bloqueoVoluntaria &&
		caso.recuperacion.operacion("entrega_voluntaria")
	) {
		opciones.push({
			id: "entrega",
			icono: CircleCheck,
			titulo: "Entrega voluntaria del vehículo",
			subtitulo: "El cliente acordó entregar la unidad",
			tono: "success",
			onClick: () => elegir("entrega"),
		});
	}
	return {
		opciones,
		secundaria: {
			id: "rebaja",
			icono: Percent,
			titulo: "Solicitar rebaja de mora",
			subtitulo: "Requiere la aprobación del supervisor",
			// TODO(José) · tarea W2: solicitud de rebaja de mora.
			pronto: true,
		},
	};
}
