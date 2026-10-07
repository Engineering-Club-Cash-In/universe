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
import * as React from "react";
import type { ItemGestion } from "@/components/cobros/ficha/ficha-pestanas";
import {
	ContextoCasoVista,
	type ContextoCasoVistaProps,
	type TabContexto,
} from "@/components/cobros/workspace/contexto-caso";
import { InicioGestionVista } from "@/components/cobros/workspace/gestion/inicio";
import {
	NotasCompartidas,
	OpcionesAcuerdo,
	type ParticipanteGestion,
	ParticipantesVista,
	type ResultadoGestion,
	ResultadoGestionVista,
} from "@/components/cobros/workspace/gestion/llamada";
import {
	type AccionGestion,
	type GrupoGestiones,
	ListaGestiones,
} from "@/components/cobros/workspace/gestion/piezas";
import {
	GestionRegistradaVista,
	MensajeEnviadoVista,
	type ResumenRegistrada,
} from "@/components/cobros/workspace/gestion/registrada";
import { VisitaProgramadaTarjeta } from "@/components/cobros/workspace/gestion/visita-programada";
import { CrmPill } from "@/components/ds/cards-credito";
import { AccionPendiente } from "@/components/ds/indicadores";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ShowcaseGroup, type ShowcaseMeta } from "./_layout";

export const meta: ShowcaseMeta = {
	order: 330,
	title: "Cobros · Workspace",
	figma:
		"CRM Ventas › Workspace · Contexto del caso (ctx/*) y Gestión (gp/*, 2873:18339, 2135:734, 2370:3885, 3788:7794)",
	description:
		"Workspace de cobros (components/cobros/workspace) con datos de ejemplo, en marcos de 600×780 (gestión) y 566×780 (contexto). Panel izquierdo (ContextoCasoVista): Resumen B1 con promesa, B3 sin acuerdo, Historial, Estado de cuenta y B4. Panel derecho (gestion/*): inicio en B1, B3 y B4, ¿con quién está hablando?, resultado con opciones de acuerdo, mensaje enviado y gestión registrada.",
};

/* ── Datos de ejemplo ─────────────────────────────────────────────────────── */

const CORREO_LARGO = "maria.jose.contreras.lopez1994@correo-largo.com.gt";

const gestion = (
	id: string,
	cuando: string,
	canal: string,
	resultado: { texto: string; tone: "success" | "warning" | "brand" },
	tono: ItemGestion["tono"],
	nota: string,
	derecha?: string,
): ItemGestion => ({
	id,
	cuando,
	titulo: (
		<span className="inline-flex items-center gap-1.5">
			<Phone aria-hidden className="size-3.5" />
			{canal}
		</span>
	),
	badge: (
		<CrmPill
			kind="chip"
			tone={resultado.tone}
			className="px-2 py-0.5 text-[11px]"
		>
			{resultado.texto}
		</CrmPill>
	),
	subtitulo: "Por: Ana García",
	tono,
	nota,
	derecha,
	detalles: [{ label: "Próximo paso", valor: "Llamar el 15 ago a las 10:00" }],
});

const HISTORIAL: ItemGestion[] = [
	gestion(
		"g1",
		"20 jul 2026 · 10:30",
		"WhatsApp",
		{ texto: "Mensaje enviado", tone: "brand" },
		"sin-contacto",
		"Se envió la tarjeta de circulación por WhatsApp.",
	),
	gestion(
		"g2",
		"18 jul 2026 · 16:45",
		"Llamada",
		{ texto: "Contactado", tone: "success" },
		"logrado",
		"El cliente solicitó el cambio de placas; se trasladó al supervisor.",
	),
	gestion(
		"g3",
		"15 jul 2026 · 09:12",
		"Llamada",
		{ texto: "Promesa de pago", tone: "brand" },
		"neutro",
		"Promesa de pago registrada automáticamente desde la gestión de la llamada con el titular.",
		"Q2,500.00",
	),
	gestion(
		"g4",
		"11 jul 2026 · 08:05",
		"Llamada",
		{ texto: "No contesta", tone: "warning" },
		"sin-contacto",
		"Buzón de voz.",
	),
];

const BASE: ContextoCasoVistaProps = {
	nombre: "María José Contreras López",
	credito: "01010214048972",
	vehiculo: "Nissan Frontier 2021",
	placa: "P-201KLM",
	intentosSinContacto: 2,
	ultimoIntento: "11 ago 2026",
	bucket: "B1",
	bucketTitulo: "B1 · Alerta Temprana",
	mora: { nivel: "Mora30", texto: "Mora Q200.00" },
	resumen: {
		estadoCobro: {
			estado: { etiqueta: "En mora", tone: "danger" },
			diasMora: 30,
			bucket: "bucket B1",
			filas: [
				{ label: "Cuotas pagadas", valor: "35 / 48" },
				{ label: "Último mes pagado", valor: "jul 2026" },
				{ label: "Fecha de pago", valor: "15 de cada mes" },
				{ label: "Cuota mensual", valor: "Q3,200.00" },
			],
		},
		promesa: {
			monto: "Q3,200.00",
			fecha: "7 ago 2026",
			responsable: "Ana García",
		},
		cobroHoy: {
			conceptos: [
				{
					label: "1 cuota vencida",
					detalle: "Q3,200.00 c/u",
					monto: "Q3,200.00",
				},
				{
					label: "Mora acumulada",
					detalle: "Sube alrededor de Q6.67 por día.",
					monto: "Q200.00",
				},
			],
			total: "Q3,400.00",
		},
		alertas: [],
		contacto: {
			telefonos: [
				{ texto: "5555-0101", href: "tel:55550101" },
				{ texto: "2233-4455", href: "tel:22334455" },
			],
			correo: CORREO_LARGO,
			direccion:
				"5a. avenida 12-34, colonia Las Margaritas, zona 11, Ciudad de Guatemala, frente al parque",
			aviso: "1 número nuevo sin guardar · 3 referencias con teléfono",
		},
		vehiculoRecuperar: null,
	},
	historial: { estado: "ok", total: HISTORIAL.length, items: HISTORIAL },
	historico: null,
	estadoCuenta: {
		saldoTotal: "Q41,600.00",
		filas: [
			{ label: "Saldo vencido", valor: "Q3,400.00", tono: "danger" },
			{ label: "Cuotas restantes", valor: "13 de 48" },
			{ label: "Próximo pago", valor: "15 ago 2026" },
		],
		cuotas: [
			{
				id: "c13",
				titulo: "Cuota 13 de 48",
				estado: "vencida",
				monto: "Q3,200.00",
				montoDetalle: "+Q200.00 mora",
				lineas: ["Venció 15 jul 2026"],
				chips: ["Abonado Q500.00 · Falta Q2,700.00"],
			},
			{
				id: "c12",
				titulo: "Cuota 12 de 48",
				estado: "pagada",
				monto: "Q3,200.00",
				lineas: ["Vence 15 jun 2026", "Pagó 14 jun 2026 · Q3,200.00"],
			},
			{
				id: "c11",
				titulo: "Cuota 11 de 48",
				estado: "validacion",
				monto: "Q3,200.00",
				lineas: ["Vence 15 may 2026", "Pago recibido, en validación"],
			},
		],
		estadoPlan: "ok",
		onEnviar: () => undefined,
	},
	documentos: {
		enviar: [
			{
				clave: "estado-cuenta",
				nombre: "Estado de cuenta",
				descripcion: "Resumen del crédito, por WhatsApp",
				onClick: () => undefined,
			},
			{
				clave: "seguro",
				nombre: "Información de seguro",
				descripcion: "Póliza vigente",
				motivoDeshabilitado: "Pendiente de backend (tarea F6).",
			},
		],
		solicitar: [
			{
				clave: "contrato",
				nombre: "Contrato de crédito",
				descripcion: "PDF · Documento legal",
				motivoDeshabilitado: "Pendiente de backend (tarea F6).",
			},
		],
	},
	referencias: {
		estado: "ok",
		items: [
			{
				id: "r1",
				nombre: "María José Aguilar",
				detalle: "Hermano/a · 5555-0001",
				estado: { etiqueta: "Verificada", tone: "success" },
			},
			{
				id: "r2",
				nombre: "Pedro Ramírez",
				detalle: "Vecino/a · 5555-0003",
				estado: { etiqueta: "Pendiente", tone: "neutral" },
			},
			{
				id: "r3",
				nombre: "Lucía Ortega",
				detalle: "Compañero de trabajo · 5555-0004",
				estado: { etiqueta: "No contactada", tone: "danger" },
			},
		],
	},
	ubicaciones: [
		{
			clave: "residencia",
			titulo: "Residencia",
			direccion: "5a. avenida 12-34, zona 11",
			verificacion: {
				fecha: "12 jun 2026",
				direccionVisitada: "5a. avenida 12-34, zona 11",
				resultado: "Promesa de pago",
				responsable: "Carlos Ramírez",
				comentarios: "La casa coincide con la dirección; atendió la madre.",
			},
		},
		{
			clave: "trabajo",
			titulo: "Trabajo · Distribuidora La Económica",
			direccion: "Calzada Roosevelt 22-43, zona 7",
			verificacion: null,
		},
	],
	resumenIA: null,
	onAbrirFicha: () => undefined,
};

const B3_SIN_ACUERDO: ContextoCasoVistaProps = {
	...BASE,
	nombre: "Ana Lucía Morales",
	credito: "01010214004730",
	vehiculo: "Toyota Hilux 2020",
	placa: null,
	bucket: "B3",
	bucketTitulo: "B3 · Rescate",
	mora: { nivel: "Mora90", texto: "Mora Q600.00" },
	resumen: {
		...BASE.resumen,
		estadoCobro: {
			...BASE.resumen.estadoCobro,
			diasMora: 90,
			bucket: "bucket B3",
			filas: [
				{ label: "Cuotas pagadas", valor: "33 / 48" },
				{ label: "Último mes pagado", valor: "may 2026" },
				{ label: "Fecha de pago", valor: "15 de cada mes" },
				{ label: "Cuota mensual", valor: "Q3,200.00" },
			],
		},
		promesa: null,
		cobroHoy: {
			conceptos: [
				{
					label: "2 cuotas vencidas",
					detalle: "Q3,200.00 c/u",
					monto: "Q6,400.00",
				},
				{ label: "Mora acumulada", monto: "Q600.00" },
			],
			total: "Q7,000.00",
		},
		alertas: [
			{
				id: "a1",
				tono: "danger",
				titulo: "Convenio incumplido",
				detalle: "Una cuota del convenio vencida · debe Q1,850.00",
			},
			{
				id: "a2",
				tono: "info",
				titulo: "Unidad (apagado): Registre la confirmación de LEGION",
				detalle:
					"El supervisor aprobó el apagado. Registre la evidencia cuando LEGION confirme.",
			},
		],
		// Cerradas por defecto en «Alertas del caso · 3» (los CRM-<uuid> ya
		// vienen acortados por el contenedor).
		alertasCaso: [
			{
				id: "c1",
				tono: "warning",
				titulo: "Caso sin contacto reciente",
				detalle: "El caso CRM-b95db82d lleva 66 días sin contacto",
			},
			{
				id: "c2",
				tono: "warning",
				titulo: "Cliente vencido: 3 días hábiles sin contacto",
				detalle:
					"El asesor Ana García lleva 3+ días hábiles sin contactar el crédito CRM-b95db82d en Alerta Temprana.",
			},
			{
				id: "c3",
				tono: "warning",
				titulo: "Cliente subió de bucket",
				detalle: "El crédito CRM-b95db82d subió a B3. Priorice el contacto.",
			},
		],
	},
};

const B4_RECUPERAR: ContextoCasoVistaProps = {
	...BASE,
	nombre: "Luis Ramírez",
	credito: "01010214050231",
	vehiculo: "Toyota Hilux 2021",
	placa: "P-742XZT",
	intentosSinContacto: 4,
	bucket: "B4",
	bucketTitulo: "B4 · Pre Jurídico",
	mora: { nivel: "Mora120", texto: "Mora Q2,350.00" },
	resumen: {
		...BASE.resumen,
		estadoCobro: {
			...BASE.resumen.estadoCobro,
			diasMora: 128,
			bucket: "bucket B4",
		},
		promesa: null,
		alertas: [
			{
				id: "a1",
				tono: "warning",
				titulo: "Recuperación del vehículo por aprobar",
				detalle: "La solicitud espera la decisión de un supervisor.",
			},
		],
		vehiculoRecuperar: {
			vehiculo: "Toyota Hilux 2021",
			detalle: "Placa P-742XZT · Motor 2GD-4471982",
			gps: { tone: "success", texto: "GPS vinculado · unidad activa" },
		},
	},
};

/* ── Marco ────────────────────────────────────────────────────────────────── */

function Marco({
	titulo,
	children,
	tamano = "figma",
}: {
	titulo: string;
	children: React.ReactNode;
	/**
	 * figma: 600×780 (R2-2). 1280: el panel derecho real con la ventana a
	 * 1280×800 (modal de 1200×768, columna 1.12fr ≈ 634px, cuerpo ≈ 710px).
	 */
	tamano?: "figma" | "1280";
}) {
	return (
		<figure className="flex flex-col gap-2">
			<figcaption className="type-label-sm text-fg-tertiary">
				{titulo}
			</figcaption>
			<div
				className={cn(
					"flex max-w-full flex-col overflow-hidden rounded-2xl border border-line-subtle bg-surface shadow-clay-subtle",
					tamano === "1280" ? "h-[710px] w-[634px]" : "h-[780px] w-[600px]",
				)}
			>
				{children}
			</div>
		</figure>
	);
}

function Panel({
	titulo,
	props,
	tab,
	historial,
	movil = false,
}: {
	titulo: string;
	props: ContextoCasoVistaProps;
	tab?: TabContexto;
	historial?: "actual" | "historico";
	/** Móvil (390px): el modal muestra un panel a la vez, de ≈356px. */
	movil?: boolean;
}) {
	// Tamaño real del panel izquierdo: el modal de 1200×840 reparte
	// 1fr : 1.12fr (≈566px) y la cabecera deja ≈780px de alto.
	return (
		<figure className="flex flex-col gap-2">
			<figcaption className="type-label-sm text-fg-tertiary">
				{titulo}
			</figcaption>
			<div
				className={cn(
					"flex max-w-full flex-col overflow-hidden rounded-2xl border border-line-subtle bg-surface shadow-clay-subtle",
					movil ? "h-[680px] w-[356px]" : "h-[780px] w-[566px]",
				)}
			>
				<ContextoCasoVista
					{...props}
					tabInicial={tab}
					historialInicial={historial}
				/>
			</div>
		</figure>
	);
}

/* ── Panel de gestión (datos de ejemplo) ───────────────────────────────────── */

const nada = () => {};

const accion = (
	id: string,
	icono: AccionGestion["icono"],
	titulo: string,
	subtitulo: string,
	extra: Partial<AccionGestion> = {},
): AccionGestion => ({ id, icono, titulo, subtitulo, onClick: nada, ...extra });

/** U1: el primer grupo de «Otras gestiones», en lugar del pie de botones. */
const CONTACTO: GrupoGestiones = {
	id: "contacto",
	titulo: "Contacto",
	acciones: [
		accion(
			"llamada",
			Phone,
			"Llamada",
			"Registrar una llamada al cliente o a un codeudor",
		),
		accion(
			"mensaje",
			MessageSquare,
			"Mensaje",
			"WhatsApp, SMS o correo con las plantillas del sistema",
		),
		accion(
			"llamada-entrante",
			PhoneIncoming,
			"Llamada entrante",
			"El cliente llamó",
		),
		accion(
			"whatsapp-entrante",
			MessageCircle,
			"WhatsApp entrante",
			"El cliente escribió por WhatsApp",
		),
	],
};

const PAGOS: GrupoGestiones = {
	id: "pagos",
	titulo: "Pagos",
	acciones: [
		accion(
			"link",
			Link2,
			"Generar link de pago",
			"Links de Págalo para que el cliente pague con tarjeta",
		),
		accion(
			"comprobante",
			Receipt,
			"Registrar comprobante de pago",
			"El cliente ya pagó y envió su comprobante",
			{ tono: "success" },
		),
	],
};

const acuerdos = (
	convenioBloqueo: string | null,
	conConvenioVigente = false,
): GrupoGestiones => ({
	id: "acuerdos",
	titulo: "Acuerdos",
	acciones: [
		accion(
			"promesa",
			HandCoins,
			"Editar promesa de pago",
			"El cliente tiene una promesa de pago vigente",
			{ tono: "success" },
		),
		accion(
			"convenio",
			Handshake,
			"Convenio de pago",
			"Plan de pago para ponerse al día",
			{ motivoBloqueo: convenioBloqueo },
		),
		...(conConvenioVigente
			? [
					accion(
						"deshacer-convenio",
						Undo2,
						"Deshacer convenio",
						"El crédito vuelve a MOROSO con su mora recalculada. El acuerdo y sus pagos quedan guardados.",
						{ tono: "danger" },
					),
				]
			: []),
		accion(
			"rebaja",
			Percent,
			"Solicitar rebaja de mora",
			"Requiere la aprobación del supervisor",
			{ pronto: true, onClick: undefined },
		),
	],
});

const campo = (apagadoBloqueado: boolean): GrupoGestiones => ({
	id: "campo",
	titulo: "Campo y rescate",
	acciones: [
		accion(
			"referencias",
			Users,
			"Contactar referencias",
			"3 referencias con teléfono",
		),
		accion(
			"visita",
			MapPin,
			"Programar o registrar visita",
			"Residencia o lugar de trabajo",
		),
		accion(
			"investigacion",
			Search,
			"Investigación en redes",
			"Registrar hallazgos de redes sociales y otras fuentes",
		),
		accion(
			"apagado",
			Power,
			"Apagado de la unidad",
			"Con la ubicación del vehículo · requiere aprobación",
			{
				tono: "danger",
				critica: true,
				motivoBloqueo: apagadoBloqueado
					? "Ya hay una solicitud de apagado o reactivación abierta."
					: null,
			},
		),
	],
});

const vehiculo = (b4: boolean): GrupoGestiones => ({
	id: "vehiculo",
	titulo: "Vehículo",
	acciones: [
		accion(
			"recuperacion",
			Car,
			"Recuperación del vehículo",
			"Solicitud al supervisor para recuperar la unidad",
			{
				tono: "warning",
				motivoBloqueo: b4
					? "El crédito ya está en recuperación del vehículo."
					: null,
			},
		),
		accion(
			"entrega",
			PackageCheck,
			"Entrega voluntaria",
			"El cliente entrega el vehículo",
			{ tono: "warning" },
		),
		...(b4
			? [
					accion(
						"recepcion",
						Warehouse,
						"Registrar recuperación del vehículo",
						"Confirmar la recepción de la unidad",
						{ tono: "success" },
					),
				]
			: []),
		accion(
			"juridico",
			Scale,
			"Escalar a Jurídico",
			"Sin acuerdo ni recuperación: el caso pasa al área legal",
			{ tono: "danger", pronto: true, onClick: undefined },
		),
	],
});

const DOCUMENTOS: GrupoGestiones = {
	id: "documentos",
	titulo: "Documentos",
	acciones: [
		accion(
			"carta-notarial",
			FileText,
			"Carta notarial",
			"Registrar el envío de una carta notarial al cliente",
		),
	],
};

const SEGUIMIENTO: GrupoGestiones = {
	id: "seguimiento",
	titulo: "Seguimiento",
	acciones: [
		accion(
			"seguimiento",
			CalendarClock,
			"Seguimiento programado",
			"Alertas de contacto recurrentes para este caso",
			{ tono: "info" },
		),
	],
};

/** Accesos rápidos de «En visita de campo hoy» (3829-12). */
const ACCESOS_VISITA: AccionGestion[] = [
	accion("convenio", Handshake, "Convenio de pago", ""),
	accion("recuperacion", Car, "Recuperación del vehículo", "", {
		tono: "warning",
	}),
	accion("entrega", PackageCheck, "Entrega voluntaria", "", {
		tono: "warning",
	}),
	accion("juridico", Scale, "Escalar a Jurídico", "", {
		tono: "danger",
		pronto: true,
		onClick: undefined,
	}),
];

const PARTICIPANTES: ParticipanteGestion[] = [
	{
		id: "titular",
		tipo: "titular",
		nombre: "María José Contreras",
		rol: "Titular",
		iniciales: "MC",
		telefonos: [
			{ numero: "5555-1234", etiqueta: "Principal" },
			{ numero: "4478-9910", etiqueta: "Alternativo" },
			{ numero: "00000000", etiqueta: "Alternativo", invalido: true },
		],
		correo: "sin-email@example.com",
		correoInvalido: true,
	},
	{
		id: "codeudor-1",
		tipo: "codeudor",
		nombre: "Roberto Contreras Aguilar",
		rol: "Codeudor 1",
		iniciales: "RA",
		telefonos: [{ numero: "5555-9876", etiqueta: "Principal" }],
		correo: CORREO_LARGO,
	},
];

const OPCIONES_ACUERDO: AccionGestion[] = [
	accion(
		"promesa",
		CircleCheck,
		"Sí, hubo compromiso",
		"Registrar una promesa de pago",
		{ tono: "success" },
	),
	accion(
		"pago",
		CircleCheck,
		"Realizar pago",
		"Generar links de Págalo para que el cliente pague hoy",
		{ tono: "success" },
	),
	accion(
		"comprobante",
		CircleCheck,
		"Comprobante de pago recibido",
		"El cliente ya pagó y envió su comprobante",
		{ tono: "success" },
	),
	accion(
		"convenio",
		CircleCheck,
		"Convenio de pago",
		"Acordar un plan de pago",
		{
			tono: "success",
		},
	),
];

const REGISTRADA_NA: ResumenRegistrada = {
	titulo: "Gestión registrada",
	subtitulo:
		"El resultado de la gestión quedó guardado en el historial del crédito.",
	filas: [
		{ label: "Resultado", valor: "Contactado · sin acuerdo de pago" },
		{ label: "Tipo de gestión", valor: "Llamada saliente" },
		{ label: "Participante", valor: "María José Contreras · Titular" },
		{ label: "Compromiso", valor: "No aplica" },
		{ label: "Registrada", valor: "Hoy · 10:04" },
	],
	proximoContacto: "12 oct 2026 · Llamada",
};

const REGISTRADA_PROMESA: ResumenRegistrada = {
	titulo: "Promesa de pago registrada",
	subtitulo: "La promesa de pago quedó guardada en el historial del crédito.",
	filas: [
		{ label: "Resultado", valor: "Promesa de pago", tono: "success" },
		{ label: "Tipo de gestión", valor: "Llamada saliente" },
		{ label: "Participante", valor: "María José Contreras · Titular" },
		{ label: "Compromiso", valor: "Q6,800.00 · 15 oct 2026" },
		{ label: "Conceptos", valor: "Cuotas 33 a 34 + mora" },
		{ label: "Registrada", valor: "Hoy · 10:04" },
	],
};

const REGISTRADA_LINKS: ResumenRegistrada = {
	titulo: "Links de pago generados",
	subtitulo: "Comparta los links con el cliente para que realice el pago.",
	chip: { texto: "Sin registro en el historial", tono: "warning" },
	avisos: [
		{
			tono: "danger",
			texto:
				"Los links se crearon, pero la gestión no quedó en el historial del caso. Informe a soporte para que la agregue.",
		},
	],
	filas: [
		{ label: "Resultado", valor: "Realizar pago", tono: "success" },
		{ label: "Links", valor: "3" },
		{ label: "Monto total", valor: "Q6,800.00" },
		{ label: "Envío por WhatsApp", valor: "No enviado", tono: "warning" },
		{ label: "Registrada", valor: "Hoy · 10:45" },
	],
};

function DemoParticipantes({
	destinatario = false,
}: {
	/** «¿A quién le escribimos?»: muestra el correo de cada participante. */
	destinatario?: boolean;
}) {
	const [id, setId] = React.useState("titular");
	const [tel, setTel] = React.useState<string | null>("5555-1234");
	return (
		<ParticipantesVista
			titulo={
				destinatario ? "¿A quién le escribimos?" : "¿Con quién está hablando?"
			}
			descripcion={
				destinatario
					? "Seleccione el destinatario del mensaje."
					: "Seleccione el participante con el que registrará esta gestión. Puede cambiarlo durante la llamada."
			}
			mostrarCorreo={destinatario}
			participantes={PARTICIPANTES}
			participanteId={id}
			onParticipante={(v) => {
				setId(v);
				setTel(
					PARTICIPANTES.find((p) => p.id === v)?.telefonos[0]?.numero ?? null,
				);
			}}
			telefono={tel}
			onTelefono={setTel}
			onAtras={nada}
			pie={
				destinatario ? (
					<Button type="button" className="w-full">
						Continuar
					</Button>
				) : (
					<div className="grid grid-cols-[auto_1fr] gap-2.5">
						<Button type="button" variant="secondary">
							Continuar sin marcar
						</Button>
						<Button type="button">
							<Phone aria-hidden />
							Llamar al titular
						</Button>
					</div>
				)
			}
		/>
	);
}

function DemoResultado() {
	const [resultado, setResultado] = React.useState<ResultadoGestion>("acuerdo");
	const [notas, setNotas] = React.useState("");
	return (
		<ResultadoGestionVista
			banda="Llamada saliente · María José Contreras · 5555-1234"
			onCambiarParticipante={nada}
			onAtras={nada}
			resultados={["acuerdo", "no_acuerdo", "no_contacto"]}
			resultado={resultado}
			onResultado={setResultado}
		>
			<OpcionesAcuerdo
				opciones={OPCIONES_ACUERDO}
				secundaria={accion(
					"rebaja",
					Percent,
					"Solicitar rebaja de mora",
					"Requiere la aprobación del supervisor",
					{ pronto: true, onClick: undefined },
				)}
				notas={notas}
				onNotasChange={setNotas}
			/>
		</ResultadoGestionVista>
	);
}

/** La nota compartida, abierta (el colapsable arranca abierto si hay texto). */
function DemoNotasAbiertas() {
	const [notas, setNotas] = React.useState(
		"El cliente pide pagar la próxima semana; cobra el día 15.",
	);
	return <NotasCompartidas valor={notas} onChange={setNotas} />;
}

export default function CobrosWorkspaceShowcase() {
	return (
		<div className="space-y-8">
			<ShowcaseGroup title="Contexto del caso (panel izquierdo)">
				<div className="flex flex-wrap gap-6 py-3">
					<Panel titulo="Resumen · B1 con promesa vigente" props={BASE} />
					<Panel
						titulo="Resumen · B3 sin acuerdo, con alertas"
						props={B3_SIN_ACUERDO}
					/>
					<Panel titulo="Historial actual" props={BASE} tab="historial" />
					<Panel
						titulo="Histórico (pendiente de backend)"
						props={BASE}
						tab="historial"
						historial="historico"
					/>
					<Panel titulo="Estado de cuenta" props={BASE} tab="estado-cuenta" />
					<Panel
						titulo="Resumen · B4 con vehículo a recuperar"
						props={B4_RECUPERAR}
					/>
					<Panel titulo="Más › Referencias" props={BASE} tab="referencias" />
					<Panel titulo="Más › Ubicaciones" props={BASE} tab="ubicaciones" />
					<Panel titulo="Asistente IA" props={BASE} tab="asistente" />
					<Panel
						titulo="Móvil · Asistente IA pasa a «Más»"
						props={BASE}
						tab="asistente"
						movil
					/>
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Gestión (panel derecho)">
				<div className="flex flex-wrap gap-6 py-3">
					<Marco titulo="Inicio · B1 sin gestiones (estado vacío compacto)">
						<InicioGestionVista
							grupos={[
								CONTACTO,
								PAGOS,
								acuerdos("Disponible desde B2."),
								DOCUMENTOS,
								SEGUIMIENTO,
							]}
						/>
					</Marco>
					<Marco titulo="Inicio · B1 con última gestión y acción pendiente">
						<InicioGestionVista
							ultimaGestion={{
								resultado: "El cliente no respondió",
								detalle: "11 oct 2026 · 2 intentos sin contacto",
								por: "Llamada · por Ana García",
							}}
							pendiente={
								<AccionPendiente
									tipo="Promesa por vencer"
									detalle="vence 15 oct"
								/>
							}
							grupos={[
								CONTACTO,
								PAGOS,
								acuerdos("Disponible desde B2."),
								DOCUMENTOS,
								SEGUIMIENTO,
							]}
						/>
					</Marco>
					<Marco
						titulo="Inicio · B1 a 1280×800 (tamaño real del panel)"
						tamano="1280"
					>
						<InicioGestionVista
							ultimaGestion={{
								resultado: "El cliente no respondió",
								detalle: "11 oct 2026 · 2 intentos sin contacto",
								por: "Llamada · por Ana García",
							}}
							grupos={[
								CONTACTO,
								PAGOS,
								acuerdos("Disponible desde B2."),
								DOCUMENTOS,
								SEGUIMIENTO,
							]}
						/>
					</Marco>
					<Marco titulo="Inicio · B3 rescate (Campo y rescate primero)">
						<InicioGestionVista
							rescate={{
								titulo: "Rescate · última oportunidad de acuerdo antes de B4",
								detalle:
									"Inicie el contacto para presentar la última propuesta estructurada de pago.",
							}}
							ultimaGestion={{
								resultado: "El cliente no respondió",
								detalle: "11 oct 2026 · 4 intentos sin contacto",
							}}
							grupos={[
								CONTACTO,
								campo(false),
								PAGOS,
								acuerdos(null),
								vehiculo(false),
								DOCUMENTOS,
								SEGUIMIENTO,
							]}
						/>
					</Marco>
					<Marco titulo="Inicio · B4 recuperación (Vehículo primero)">
						<InicioGestionVista
							ultimaGestion={{
								resultado: "Rechaza pagar",
								detalle: "2 oct 2026",
								por: "Visita a domicilio · por Samuel Gamboa",
							}}
							grupos={[
								CONTACTO,
								vehiculo(true),
								PAGOS,
								acuerdos(null),
								campo(true),
								DOCUMENTOS,
								SEGUIMIENTO,
							]}
						/>
					</Marco>
					<Marco titulo="Inicio · visita programada">
						<InicioGestionVista
							visita={
								<VisitaProgramadaTarjeta
									visita={{
										tipo: "Visita a residencia",
										fecha: "9 oct 2026 · 10:30",
										hoy: false,
										vencida: false,
										direccion:
											"4a calle 5-23, zona 7, Ciudad de Guatemala (portón negro)",
									}}
									onRegistrar={nada}
								/>
							}
							grupos={[
								CONTACTO,
								PAGOS,
								acuerdos(null),
								campo(false),
								DOCUMENTOS,
								SEGUIMIENTO,
							]}
						/>
					</Marco>
					<Marco titulo="Inicio · en visita de campo hoy (3829-12)">
						<InicioGestionVista
							visita={
								<VisitaProgramadaTarjeta
									visita={{
										tipo: "Visita al lugar de trabajo",
										fecha: "6 oct 2026 · 09:00",
										hoy: true,
										vencida: true,
										direccion: "Distribuidora El Sol · 12 av. 3-40, zona 1",
									}}
									accesos={ACCESOS_VISITA}
									onRegistrar={nada}
								/>
							}
							grupos={[
								CONTACTO,
								PAGOS,
								acuerdos(null),
								campo(false),
								vehiculo(false),
								DOCUMENTOS,
								SEGUIMIENTO,
							]}
						/>
					</Marco>
					<Marco titulo="Inicio · convenio vigente (sin recuperación, con «Deshacer convenio»)">
						<InicioGestionVista
							grupos={[
								CONTACTO,
								PAGOS,
								acuerdos(
									"El crédito ya tiene un convenio de pago vigente.",
									true,
								),
								DOCUMENTOS,
								SEGUIMIENTO,
							]}
						/>
					</Marco>
					<Marco titulo="Inicio · crédito sin caso de cobros">
						<InicioGestionVista sinCaso grupos={[]} />
					</Marco>
					<Marco titulo="Llamada · ¿Con quién está hablando? (con dato no válido)">
						<DemoParticipantes />
					</Marco>
					<Marco titulo="Mensaje · ¿A quién le escribimos? (correo de relleno)">
						<DemoParticipantes destinatario />
					</Marco>
					<Marco titulo="Llamada · resultado «Se llegó a un acuerdo»">
						<DemoResultado />
					</Marco>
					<Marco titulo="Notas de la gestión (colapsable abierto)">
						<div className="p-5">
							<DemoNotasAbiertas />
						</div>
					</Marco>
					<Marco titulo="Mensaje enviado (WhatsApp)">
						<MensajeEnviadoVista
							canal="whatsapp"
							destinatario={"María José Contreras · 5555-1234"}
							abrir={{
								href: "https://wa.me/50255551234",
								etiqueta: "Abrir WhatsApp",
							}}
							onRegistrarResultado={nada}
							onSiguienteCaso={nada}
							onVolverInicio={nada}
						/>
					</Marco>
					<Marco titulo="Gestión registrada · sin acuerdo">
						<GestionRegistradaVista
							resumen={REGISTRADA_NA}
							onSiguienteCaso={nada}
							onVolverInicio={nada}
						/>
					</Marco>
					<Marco titulo="Gestión registrada · B3 sin acuerdo, con acciones de rescate">
						<GestionRegistradaVista
							resumen={REGISTRADA_NA}
							onSiguienteCaso={nada}
							onVolverInicio={nada}
						>
							<ListaGestiones
								titulo="Acciones de rescate · seleccione según el caso"
								acciones={campo(false).acciones}
							/>
						</GestionRegistradaVista>
					</Marco>
					<Marco titulo="Gestión registrada · promesa de pago">
						<GestionRegistradaVista
							resumen={REGISTRADA_PROMESA}
							onSiguienteCaso={nada}
							onVolverInicio={nada}
						/>
					</Marco>
					<Marco titulo="Links generados con aviso · último caso de la lista">
						<GestionRegistradaVista
							resumen={REGISTRADA_LINKS}
							onVolverInicio={nada}
						/>
					</Marco>
				</div>
			</ShowcaseGroup>
		</div>
	);
}
