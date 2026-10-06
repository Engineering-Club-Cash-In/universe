/**
 * Workspace · panel de gestión: arma el «Resumen de la gestión» de la pantalla
 * «Gestión registrada» a partir de lo que devuelve cada formulario al guardar
 * (los callbacks `onCreado` / `onExito` / `onRegistrada` / `onProgramada`).
 *
 * Funciones puras: sin queries ni estado.
 */
import { etiquetaMetodoContacto } from "server/src/lib/gestion-temprana-b1";
import { MOTIVOS_INMOVILIZACION } from "server/src/lib/inmovilizacion-unidad";
import { ESTADOS_VEHICULO } from "server/src/lib/recuperacion-vehiculo";
import {
	RESULTADO_VISITA_LABEL,
	TIPO_VISITA_LABEL,
} from "server/src/lib/visitas-cobros";
import { fechaLarga } from "@/components/cobros/asesor/fila-cartera";
import type { ResultadoConvenio } from "@/components/cobros/convenio-modal";
import type { ResumenSolicitudInmovilizacion } from "@/components/cobros/inmovilizacion-solicitar-modal";
import type { ResumenInvestigacionRedes } from "@/components/cobros/investigacion-redes-dialog";
import type { ResumenLinksPagalo } from "@/components/cobros/pagalo-link-dialog";
import type { RecepcionConfirmada } from "@/components/cobros/recuperacion-vehiculo-card";
import type { ResultadoRecuperacion } from "@/components/cobros/recuperacion-vehiculo-dialog";
import type { ResumenGestionReferencia } from "@/components/cobros/referencias-dialogs";
import type { PagoRegistrado } from "@/components/cobros/registrar-pago-form";
import type { SeguimientoProgramado } from "@/components/cobros/seguimiento-recurrente-modal";
import type {
	VisitaProgramadaResumen,
	VisitaRegistrada,
} from "@/components/cobros/visita-dialog";
import {
	etiquetaMetodoReferencia,
	etiquetaResultadoReferencia,
} from "@/lib/cobros/referencias";
import { formatoQuetzales } from "@/lib/cobros/reglas-caso";
import type { ConvenioDeshecho } from "./deshacer-convenio";
import { etiquetaResultado, hoyConHora } from "./piezas";
import type {
	AvisoResumen,
	FilaResumen,
	ResumenRegistrada,
} from "./registrada";

/**
 * La gestión que devuelve `createContactoCobros` (la fila completa). El
 * `onCreado` de ContactoModal la tipa como `{ id }`, pero en tiempo de
 * ejecución trae la fila insertada o actualizada.
 */
export type ContactoRegistrado = {
	id: string;
	metodoContacto?: string | null;
	estadoContacto?: string | null;
	montoComprometido?: string | number | null;
	fechaProximoContacto?: string | Date | null;
	cuotaInicio?: number | null;
	cuotaFin?: number | null;
	incluyeMora?: boolean | null;
};

const registrada = (): FilaResumen => ({
	label: "Registrada",
	valor: hoyConHora(),
});

const conValor = (valor: string | null | undefined, vacio = "—") =>
	valor?.trim() ? valor : vacio;

/** «Cuotas 3 a 5 + mora». */
function textoCuotas(c: ContactoRegistrado): string | null {
	const partes: string[] = [];
	if (c.cuotaInicio != null) {
		partes.push(
			c.cuotaFin != null && c.cuotaFin !== c.cuotaInicio
				? `Cuotas ${c.cuotaInicio} a ${c.cuotaFin}`
				: `Cuota ${c.cuotaInicio}`,
		);
	}
	if (c.incluyeMora) partes.push(partes.length ? "+ mora" : "Mora");
	return partes.length ? partes.join(" ") : null;
}

/** Una gestión de ContactoModal (llamada, mensaje, entrante o promesa). */
export function resumenContacto(
	c: ContactoRegistrado,
	ctx: {
		/** «Llamada saliente», «WhatsApp entrante»… */
		tipoGestion: string;
		/** «María José Contreras · Titular». */
		participante?: string | null;
		promesa?: boolean;
		edicion?: boolean;
	},
): ResumenRegistrada {
	const esPromesa = ctx.promesa || c.estadoContacto === "promesa_pago";
	const fecha = c.fechaProximoContacto
		? fechaLarga(c.fechaProximoContacto)
		: "";
	const monto =
		c.montoComprometido != null && Number(c.montoComprometido) > 0
			? formatoQuetzales(c.montoComprometido)
			: null;

	if (esPromesa) {
		const cuotas = textoCuotas(c);
		return {
			titulo: ctx.edicion
				? "Promesa de pago actualizada"
				: "Promesa de pago registrada",
			subtitulo:
				"La promesa de pago quedó guardada en el historial del crédito.",
			filas: [
				{ label: "Resultado", valor: "Promesa de pago", tono: "success" },
				{ label: "Tipo de gestión", valor: ctx.tipoGestion },
				{
					label: "Participante",
					valor: conValor(ctx.participante),
				},
				{
					label: "Compromiso",
					valor: [monto, fecha].filter(Boolean).join(" · ") || "—",
				},
				...(cuotas ? [{ label: "Conceptos", valor: cuotas }] : []),
				registrada(),
			],
		};
	}

	return {
		titulo: "Gestión registrada",
		subtitulo:
			"El resultado de la gestión quedó guardado en el historial del crédito.",
		filas: [
			{ label: "Resultado", valor: etiquetaResultado(c.estadoContacto) },
			{ label: "Tipo de gestión", valor: ctx.tipoGestion },
			{ label: "Participante", valor: conValor(ctx.participante) },
			{ label: "Compromiso", valor: monto ?? "No aplica" },
			registrada(),
		],
		proximoContacto: fecha
			? `${fecha}${c.metodoContacto ? ` · ${etiquetaMetodoContacto(c.metodoContacto)}` : ""}`
			: null,
	};
}

export function resumenLinksPagalo(r: ResumenLinksPagalo): ResumenRegistrada {
	const avisos: AvisoResumen[] = [];
	if (r.revisionRequerida) {
		avisos.push({
			tono: "warning",
			texto:
				"El grupo de links de Págalo requiere revisión. Verifique los links antes de compartirlos con el cliente.",
		});
	}
	if (!r.gestionRegistrada) {
		avisos.push({
			tono: "danger",
			texto:
				"Los links se crearon, pero la gestión no quedó en el historial del caso. Informe a soporte para que la agregue.",
		});
	}
	return {
		titulo: "Links de pago generados",
		subtitulo:
			r.whatsappEnviado === true
				? "Los links se enviaron al cliente por WhatsApp."
				: "Comparta los links con el cliente para que realice el pago.",
		chip: r.gestionRegistrada
			? undefined
			: { texto: "Sin registro en el historial", tono: "warning" },
		avisos,
		filas: [
			{ label: "Resultado", valor: "Realizar pago", tono: "success" },
			{ label: "Links", valor: String(r.cantidadLinks) },
			{ label: "Monto total", valor: formatoQuetzales(r.montoTotal) },
			{
				label: "Envío por WhatsApp",
				valor:
					r.whatsappEnviado === null
						? "No aplica"
						: r.whatsappEnviado
							? "Enviado"
							: "No enviado",
				tono: r.whatsappEnviado === false ? "warning" : undefined,
			},
			...(r.origen === "BOT"
				? [
						{
							label: "Origen",
							valor: "Generados por el cliente desde WhatsApp",
						},
					]
				: []),
			registrada(),
		],
	};
}

export function resumenPago(
	r: PagoRegistrado,
	participante?: string | null,
): ResumenRegistrada {
	return {
		titulo: "Pago registrado",
		subtitulo: conValor(
			r.mensaje,
			"El comprobante quedó guardado en el historial del crédito.",
		),
		chip: r.gestionRegistrada
			? undefined
			: { texto: "Sin registro en el historial", tono: "warning" },
		avisos: r.gestionRegistrada
			? []
			: [
					{
						tono: "warning",
						texto:
							"El pago se aplicó correctamente, pero no se pudo registrar como gestión en el historial del caso. Informe a soporte para que lo agregue manualmente.",
					},
				],
		filas: [
			{
				label: "Resultado",
				valor: "Comprobante de pago recibido",
				tono: "success",
			},
			...(participante ? [{ label: "Participante", valor: participante }] : []),
			{ label: "Monto de la boleta", valor: formatoQuetzales(r.montoBoleta) },
			...(r.cuota != null
				? [{ label: "Cuota", valor: `Cuota ${r.cuota}` }]
				: []),
			registrada(),
		],
	};
}

export function resumenConvenio(r: ResultadoConvenio): ResumenRegistrada {
	return {
		titulo: r.pendienteActivacion
			? "Convenio de pago enviado a aprobación"
			: "Convenio de pago registrado",
		subtitulo: r.pendienteActivacion
			? "El convenio queda pendiente de activación. El crédito sale del flujo de cobro cuando se active."
			: "El convenio de pago quedó activo en el crédito.",
		chip: r.pendienteActivacion
			? { texto: "Pendiente de activación", tono: "warning" }
			: undefined,
		filas: [
			{ label: "Resultado", valor: "Convenio de pago", tono: "success" },
			{ label: "Monto total", valor: formatoQuetzales(r.montoTotal) },
			{ label: "Cuota del convenio", valor: formatoQuetzales(r.cuotaMensual) },
			{
				label: "Plazo",
				valor: `${r.numeroMeses} ${r.numeroMeses === 1 ? "mes" : "meses"}`,
			},
			{ label: "Cuotas incluidas", valor: String(r.cantidadCuotas) },
			registrada(),
		],
	};
}

export function resumenConvenioDeshecho(
	r: ConvenioDeshecho,
): ResumenRegistrada {
	return {
		titulo: "Convenio deshecho",
		subtitulo: r.mensaje,
		chip: { texto: "Guardado para auditoría · hoy", tono: "success" },
		filas: [
			{ label: "Resultado", valor: "Convenio deshecho", tono: "danger" },
			{
				label: "Estado del crédito",
				valor: conValor(r.statusCredito),
				tono: r.statusCredito === "MOROSO" ? "danger" : undefined,
			},
			...(r.cuotasAtrasadas != null
				? [{ label: "Cuotas vencidas", valor: String(r.cuotasAtrasadas) }]
				: []),
			{ label: "Motivo", valor: r.motivo },
			registrada(),
		],
	};
}

const fechaHora = (d: Date) =>
	d.toLocaleString("es-GT", {
		timeZone: "America/Guatemala",
		day: "numeric",
		month: "short",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});

export function resumenVisitaProgramada(
	r: VisitaProgramadaResumen,
): ResumenRegistrada {
	return {
		titulo: "Visita programada",
		subtitulo:
			"La visita quedó en la agenda del responsable para la fecha indicada.",
		filas: [
			{ label: "Tipo", valor: TIPO_VISITA_LABEL[r.tipo] },
			{ label: "Dirección", valor: r.direccion },
			{ label: "Fecha y hora", valor: fechaHora(r.fechaProgramada) },
			{ label: "Responsable", valor: conValor(r.responsableNombre) },
			registrada(),
		],
	};
}

export function resumenVisitaRegistrada(
	r: VisitaRegistrada,
): ResumenRegistrada {
	return {
		titulo: "Visita registrada",
		subtitulo:
			"El resultado de la visita quedó guardado en el historial del crédito.",
		filas: [
			{ label: "Tipo", valor: TIPO_VISITA_LABEL[r.tipo] },
			{
				label: "Resultado",
				valor: RESULTADO_VISITA_LABEL[r.resultado],
				tono: r.resultado === "sin_contacto" ? "warning" : "success",
			},
			{ label: "Dirección", valor: r.direccion },
			{ label: "Fecha", valor: fechaHora(r.fechaVisita) },
			...(r.montoRecibido != null && r.montoRecibido > 0
				? [
						{
							label: "Monto recibido",
							valor: formatoQuetzales(r.montoRecibido),
						},
					]
				: []),
		],
	};
}

export function resumenRecuperacion(
	r: ResultadoRecuperacion,
): ResumenRegistrada {
	const tipo =
		r.tipo === "tomado" ? "Recuperación del vehículo" : "Entrega voluntaria";
	const titulo =
		r.modo === "solicitud"
			? "Solicitud enviada al supervisor"
			: r.tipo === "tomado"
				? "Recuperación del vehículo registrada"
				: "Entrega voluntaria registrada";
	return {
		titulo,
		subtitulo: r.mensaje,
		chip:
			r.modo === "solicitud"
				? { texto: "Pendiente de aprobación", tono: "warning" }
				: undefined,
		filas: [
			{ label: "Tipo de gestión", valor: tipo },
			{
				label: "Estado",
				valor:
					r.modo === "solicitud"
						? "Pendiente de aprobación del supervisor"
						: r.modo === "trasladado"
							? "Caso trasladado"
							: "Registrada",
				tono: r.modo === "solicitud" ? "warning" : "success",
			},
			...(r.bucketNuevo != null
				? [{ label: "Bucket", valor: `B${r.bucketNuevo}` }]
				: []),
			registrada(),
		],
	};
}

export function resumenRecepcion(r: RecepcionConfirmada): ResumenRegistrada {
	return {
		titulo: "Recepción del vehículo confirmada",
		subtitulo: "El vehículo quedó registrado como recuperado.",
		filas: [
			{ label: "Fecha de recepción", valor: fechaHora(r.fechaRecepcion) },
			{ label: "Lugar", valor: r.lugar },
			{
				label: "Estado del vehículo",
				valor:
					ESTADOS_VEHICULO[r.estadoVehiculo as keyof typeof ESTADOS_VEHICULO] ??
					r.estadoVehiculo,
			},
			...(r.kilometraje != null
				? [
						{
							label: "Kilometraje",
							valor: `${r.kilometraje.toLocaleString("es-GT")} km`,
						},
					]
				: []),
			registrada(),
		],
	};
}

const FRECUENCIA: Record<string, string> = {
	diario: "Diario",
	semanal: "Semanal",
	quincenal: "Quincenal",
};

export function resumenSeguimiento(
	r: SeguimientoProgramado,
): ResumenRegistrada {
	return {
		titulo: "Seguimiento programado",
		subtitulo:
			"Las alertas de contacto se generarán según la frecuencia indicada.",
		filas: [
			{ label: "Medio", valor: etiquetaMetodoContacto(r.metodoContacto) },
			{
				label: "Frecuencia",
				valor:
					FRECUENCIA[r.presetOriginal] ??
					`Cada ${r.intervaloDias} ${r.intervaloDias === 1 ? "día" : "días"}`,
			},
			{ label: "Inicio", valor: fechaLarga(`${r.fechaInicio}T12:00:00`) },
			{
				label: "Fin",
				valor: r.fechaFin
					? fechaLarga(`${r.fechaFin}T12:00:00`)
					: "Sin fecha de fin",
			},
			registrada(),
		],
	};
}

export function resumenInvestigacion(
	r: ResumenInvestigacionRedes,
): ResumenRegistrada {
	return {
		titulo: "Investigación registrada",
		subtitulo: "Los hallazgos quedaron en el historial del caso.",
		filas: [
			{ label: "Fuente", valor: r.fuenteEtiqueta },
			{
				label: "Resultado",
				valor:
					r.resultado === "con_hallazgos" ? "Con hallazgos" : "Sin hallazgos",
				tono: r.resultado === "con_hallazgos" ? "success" : undefined,
			},
			{ label: "Fecha", valor: fechaHora(r.fechaInvestigacion) },
			{ label: "Evidencias", valor: String(r.cantidadEvidencias) },
			registrada(),
		],
	};
}

export function resumenReferencia(
	r: ResumenGestionReferencia,
): ResumenRegistrada {
	return {
		titulo: "Gestión registrada",
		subtitulo: "El contacto con la referencia quedó en el historial del caso.",
		filas: [
			{ label: "Referencia", valor: r.referenciaNombre },
			{ label: "Canal", valor: etiquetaMetodoReferencia(r.metodo) },
			...(r.telefono ? [{ label: "Teléfono", valor: r.telefono }] : []),
			{ label: "Resultado", valor: etiquetaResultadoReferencia(r.resultado) },
			...(r.cantidadHallazgos > 0
				? [{ label: "Hallazgos", valor: String(r.cantidadHallazgos) }]
				: []),
			registrada(),
		],
	};
}

export function resumenApagado(
	r: ResumenSolicitudInmovilizacion,
): ResumenRegistrada {
	return {
		titulo: "Solicitud enviada al supervisor",
		subtitulo:
			"La solicitud de apagado de la unidad quedó registrada. Un supervisor la revisará y aprobará.",
		chip: { texto: "Pendiente de aprobación", tono: "warning" },
		filas: [
			{
				label: "Tipo de gestión",
				valor:
					r.accion === "apagado"
						? "Apagado de la unidad"
						: "Reactivación de la unidad",
			},
			{
				label: "Estado",
				valor: "Pendiente de aprobación del supervisor",
				tono: "warning",
			},
			...(r.accion === "apagado" && r.motivos.length > 0
				? [
						{
							label: "Motivos",
							valor: r.motivos
								.map(
									(m) =>
										MOTIVOS_INMOVILIZACION[
											m as keyof typeof MOTIVOS_INMOVILIZACION
										] ?? m,
								)
								.join(", "),
						},
					]
				: []),
			registrada(),
		],
	};
}
