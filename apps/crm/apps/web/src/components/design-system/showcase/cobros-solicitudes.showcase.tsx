import * as React from "react";
import type { EntradaBitacora } from "server/src/lib/bitacora-supervision";
import {
	BandejaSolicitudes,
	type FiltroTipoSolicitud,
} from "@/components/cobros/solicitudes/bandeja-solicitudes";
import {
	type ContrapropuestaHistorialItem,
	ContrapropuestaPendienteAviso,
	ContrapropuestaVista,
	type ContrapropuestaVistaProps,
	RetirarContrapropuestaVista,
} from "@/components/cobros/solicitudes/contrapropuesta-dialog";
import {
	DecidirSolicitudVista,
	type DecidirSolicitudVistaProps,
} from "@/components/cobros/solicitudes/decidir-solicitud-modal";
import {
	AvisoSuSolicitud,
	MarcoEspacioAprobacion,
	PanelSolicitudVista,
	type ResolucionSolicitud,
	resolucionDe,
} from "@/components/cobros/solicitudes/espacio-aprobacion";
import {
	type EntradaHistorial,
	entradaDeBitacora,
	type FiltrosHistorial,
	filtroServidorHistorial,
} from "@/components/cobros/solicitudes/historial";
import {
	DetalleInmovilizacion,
	DetalleRecuperacion,
	HistorialDecisiones,
} from "@/components/cobros/solicitudes/historial-decisiones";
import {
	type InmovilizacionHistorialFuente,
	type RecuperacionFuente,
	type Solicitud,
	solicitudDeConvenio,
	solicitudDeDocumento,
	solicitudDeInmovilizacion,
	solicitudDeJuridico,
	solicitudDeRebaja,
	solicitudDeRecuperacion,
} from "@/components/cobros/solicitudes/normalizar";
import {
	type FilaSolicitudAsesor,
	SolicitudesDeAsesorVista,
} from "@/components/cobros/solicitudes/solicitudes-de-asesor";
import { SolicitudesPaginaVista } from "@/components/cobros/solicitudes/solicitudes-pagina";
import {
	ContextoCasoVista,
	type ContextoCasoVistaProps,
} from "@/components/cobros/workspace/contexto-caso";
import {
	Dialog,
	DialogContent,
	dialogPanelClassName,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ShowcaseGroup, type ShowcaseMeta } from "./_layout";

export const meta: ShowcaseMeta = {
	order: 312,
	title: "Cobros · Solicitudes (supervisor)",
	figma:
		"CRM Ventas › Supervisor › Aprobaciones (3310:12), Historial de decisiones (3602:5360), Espacio de aprobación (3699:5850, 3699:6285, 3329:7989, «WS Aprob · * · Resuelto») y Solicitudes del asesor (3654:5711)",
	description:
		"Pantalla /cobros/solicitudes con datos de ejemplo: la bandeja única (chips por tipo con conteo, buscador, asesor, «Por ejecutar», rebajas de mora con su error al aplicar, Jurídico y documentos), el Historial de decisiones sobre la bitácora del servidor (chips, tipo, estado, asesor, fechas, paginación y detalle por fila), el Espacio de aprobación por tipo (convenio con contrapropuesta pendiente e historial de contrapropuestas, apagado, recuperación, rebaja, Jurídico y documento; la regla de cuatro ojos; por ejecutar) con su estado «Resuelto», los modales de decisión, el editor de la contrapropuesta y las solicitudes de un asesor (Detalle del asesor).",
};

/* ── Datos de ejemplo ─────────────────────────────────────────────────────── */

const AHORA = new Date();
const hace = (min: number) =>
	new Date(AHORA.getTime() - min * 60_000).toISOString();
const dia = (delta: number) =>
	new Date(AHORA.getTime() + delta * 86_400_000).toISOString().slice(0, 10);
const nada = () => {};

const CONVENIO = solicitudDeConvenio({
	convenio_id: 98,
	credito_id: 659,
	numero_credito_sifco: "01010214047330",
	cliente_nombre: "Carlos Mendoza",
	asesor_id: 3,
	asesor_nombre: "Carmen Ramírez",
	fecha_convenio: hace(180),
	monto_total_convenio: "12900.00",
	cuota_mensual: "2150.00",
	numero_meses: 6,
	motivo:
		"El cliente puede retomar pagos con una cuota más baja tras recuperar ingresos.",
	activo: false,
	completado: false,
	bucket_previo: 3,
	bucket_previo_prefijo: "B3",
});

const CONVENIO_2 = solicitudDeConvenio({
	convenio_id: 101,
	numero_credito_sifco: "01010214048215",
	cliente_nombre: "Luis Fernando Aguilar",
	asesor_id: 4,
	asesor_nombre: "José Pérez",
	fecha_convenio: hace(120),
	monto_total_convenio: "12900.00",
	cuota_mensual: "2580.00",
	numero_meses: 5,
	motivo: null,
	bucket_previo: 4,
	bucket_previo_prefijo: "B4",
});

const APAGADO = solicitudDeInmovilizacion({
	id: "a1",
	casoCobroId: "caso-1",
	numeroCreditoSifco: "01010214048972",
	accion: "apagado",
	estado: "pendiente_aprobacion",
	solicitadoAt: hace(300),
	solicitanteNombre: "Luis Morales",
	clienteNombre: "María José Contreras",
	motivo:
		"Sin contacto por 5 días ni acuerdo; se solicita el apagado para presionar el pago.",
	ubicacionSolicitud: {
		fuente: "gps",
		unidad: "P-201KLM",
		lat: 14.62213,
		lng: -90.53712,
		senalAt: hace(3),
		velocidadKmh: 0,
		ignicion: false,
	},
	bucketSnapshot: 3,
});

const REACTIVACION = solicitudDeInmovilizacion({
	id: "a2",
	casoCobroId: "caso-2",
	numeroCreditoSifco: "01010214047221",
	accion: "reactivacion",
	estado: "pendiente_aprobacion",
	solicitadoAt: hace(60),
	solicitanteNombre: "Ana Díaz",
	clienteNombre: "Patricia López",
	motivo: "El cliente pagó las dos cuotas vencidas.",
	quePaso: "pago",
	bucketSnapshot: 2,
});

const POR_EJECUTAR = solicitudDeInmovilizacion({
	id: "a3",
	casoCobroId: "caso-3",
	numeroCreditoSifco: "01010214046887",
	accion: "apagado",
	estado: "aprobada",
	solicitadoAt: hace(60 * 30),
	solicitanteNombre: "Luis Morales",
	clienteNombre: "Andrés Castillo",
	motivo: "Unidad sin pagos desde junio.",
	ubicacionSolicitud: {
		fuente: "manual",
		direccion: "Calzada Roosevelt 22-43, zona 7",
	},
	bucketSnapshot: 4,
});

const CHECKLIST: RecuperacionFuente["checklist"] = [
	{
		paso: "llamadas",
		titulo: "Llamadas al cliente",
		estado: "hecho",
		evidencia: "12 llamadas en los últimos 30 días, 2 contestadas.",
		justificacion: null,
		justificacionEtiqueta: null,
		nota: null,
	},
	{
		paso: "visita_residencia",
		titulo: "Visita a la residencia",
		estado: "parcial",
		evidencia: "1 visita programada, sin realizar.",
		justificacion: "zona_roja",
		justificacionEtiqueta: "La dirección está en zona de riesgo",
		nota: "Se coordinará con seguridad.",
	},
	{
		paso: "referencias",
		titulo: "Contacto con referencias",
		estado: "pendiente",
		evidencia: "Sin gestiones a referencias.",
		justificacion: "sin_referencias",
		justificacionEtiqueta: "El crédito no tiene referencias válidas",
		nota: null,
	},
];

const recuperacion = (
	id: string,
	extra: Partial<RecuperacionFuente>,
): RecuperacionFuente => ({
	id,
	casoCobroId: `caso-${id}`,
	numeroSifco: "01010214047980",
	cliente: "Sergio Ramírez",
	solicitante: "José Pérez",
	solicitadoAt: hace(60 * 26),
	estadoSolicitud: "pendiente",
	bucketOrigen: 3,
	motivos: ["ilocalizable", "promesas_incumplidas"],
	motivoDetalle:
		"El cliente ya no puede sostener los pagos y no responde desde hace tres semanas.",
	observaciones: "El vehículo se ha visto estacionado frente a la residencia.",
	checklist: CHECKLIST,
	ubicacionDireccion: "5a. avenida 12-34, zona 11",
	ubicacionEnlace: null,
	ubicacionLat: 14.6,
	ubicacionLng: -90.55,
	estadoVehiculo: "regular",
	saldoPendiente: "32164.00",
	cuotasVencidas: 3,
	totalParaPonerseAlDia: "9800.00",
	esMia: false,
	...extra,
});

const RECUPERACION = solicitudDeRecuperacion(recuperacion("r1", {}));
const RECUPERACION_PROPIA = solicitudDeRecuperacion(
	recuperacion("r2", {
		cliente: "Diana Herrera",
		numeroSifco: "01010214047450",
		solicitante: "Daniel Rodríguez",
		solicitadoAt: hace(60 * 8),
		esMia: true,
		totalParaPonerseAlDia: "6800.00",
	}),
);

const rebaja = (
	id: string,
	extra: Partial<Parameters<typeof solicitudDeRebaja>[0]>,
) =>
	solicitudDeRebaja({
		id,
		casoCobroId: `caso-${id}`,
		numeroCreditoSifco: "01010214046120",
		estado: "pendiente",
		moraSnapshot: "1240.00",
		montoSolicitado: "600.00",
		notas:
			"El cliente pagó las dos cuotas atrasadas y pide rebajar la mora que se acumuló mientras el banco liberaba su sueldo.",
		solicitadoEn: hace(60 * 5),
		solicitadoPorId: "u-ana",
		solicitadoPor: "Ana Díaz",
		clienteNombre: "Roberto Cárcamo",
		...extra,
	});

const REBAJA = rebaja("rb1", {});
const REBAJA_ERROR = rebaja("rb2", {
	estado: "error_aplicacion",
	numeroCreditoSifco: "01010214045987",
	clienteNombre: "Gabriela Méndez",
	solicitadoEn: hace(60 * 28),
	montoSolicitado: "350.00",
	moraSnapshot: "910.00",
	notaResolucion:
		"Cartera no respondió a tiempo. Intente de nuevo en unos minutos.",
});
const REBAJA_PROPIA = rebaja("rb3", {
	numeroCreditoSifco: "01010214044017",
	clienteNombre: "Julio César Barrios",
	solicitadoPorId: "u-yo",
	solicitadoPor: "Daniel Rodríguez",
	solicitadoEn: hace(45),
});

const JURIDICO = solicitudDeJuridico({
	id: "j1",
	casoCobroId: "caso-j1",
	numeroCreditoSifco: "01010214044410",
	bucketSnapshot: 4,
	motivo: "no_quiere_pagar",
	notaJuridico:
		"Se negó a pagar en tres llamadas y no recibe visitas; el vehículo sigue en circulación.",
	estado: "pendiente",
	solicitadoEn: hace(60 * 30),
	solicitadoPorId: "u-luis",
	solicitadoPor: "Luis Morales",
	clienteNombre: "Andrea Solís",
});

const DOCUMENTO = solicitudDeDocumento({
	id: "d1",
	casoCobroId: "caso-d1",
	numeroCreditoSifco: "01010214047330",
	clave: "contrato",
	comentario: "El cliente pide copia del contrato para su abogado.",
	estado: "pendiente",
	solicitadoEn: hace(60 * 2),
	solicitadoPorId: "u-carmen",
	solicitadoPor: "Carmen Ramírez",
	documento: "Contrato de crédito",
	clienteNombre: "Carlos Mendoza",
});
/** Pedida por quien mira: «Su solicitud», pero sin bloquear la decisión. */
const DOCUMENTO_PROPIO = solicitudDeDocumento({
	id: "d2",
	casoCobroId: "caso-d2",
	numeroCreditoSifco: "01010214045210",
	clave: "carta-poder",
	comentario: null,
	estado: "pendiente",
	solicitadoEn: hace(30),
	solicitadoPorId: "u-yo",
	solicitadoPor: "Daniel Rodríguez",
	documento: "Carta poder",
	clienteNombre: "Ana Lucía Morales",
});

const PENDIENTES: Solicitud[] = [
	RECUPERACION,
	RECUPERACION_PROPIA,
	APAGADO,
	CONVENIO,
	CONVENIO_2,
	REACTIVACION,
	REBAJA,
	REBAJA_ERROR,
	JURIDICO,
	DOCUMENTO,
].sort(
	(a, b) =>
		new Date(a.solicitadoEn ?? 0).getTime() -
		new Date(b.solicitadoEn ?? 0).getTime(),
);

/* Contexto del caso (panel izquierdo del Workspace, solo lectura) */
const CONTEXTO: ContextoCasoVistaProps = {
	nombre: "Carlos Mendoza",
	credito: "01010214047330",
	vehiculo: "Toyota Hilux 2020",
	placa: "P-330KLM",
	intentosSinContacto: 2,
	ultimoIntento: "11 ago 2026",
	bucket: "B2",
	bucketTitulo: "B2 · Gestión Activa",
	mora: { nivel: "Mora60", texto: "Mora Q600.00" },
	resumen: {
		estadoCobro: {
			estado: { etiqueta: "En mora", tone: "danger" },
			diasMora: 44,
			bucket: "bucket B2",
			filas: [
				{ label: "Cuotas pagadas", valor: "35 / 48" },
				{ label: "Último mes pagado", valor: "jul 2026" },
				{ label: "Fecha de pago", valor: "15 de cada mes" },
				{ label: "Cuota mensual", valor: "Q3,200.00" },
			],
		},
		promesa: { monto: "Q3,200.00", fecha: "7 ago 2026", responsable: null },
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
		alertas: [],
		contacto: {
			telefonos: [{ texto: "5555-1234", href: "tel:55551234" }],
			correo: "carlos.mendoza@correo.com",
			direccion: "Zona 10, Guatemala",
		},
		vehiculoRecuperar: null,
	},
	historial: { estado: "vacio", total: 0, items: [] },
	historico: null,
	estadoCuenta: {
		saldoTotal: "Q41,600.00",
		filas: [{ label: "Saldo vencido", valor: "Q7,000.00", tono: "danger" }],
		cuotas: [],
		estadoPlan: "ok",
	},
	documentos: { enviar: [], solicitar: [] },
	referencias: { estado: "ok", items: [] },
	ubicaciones: [],
	resumenIA: null,
	onAbrirFicha: nada,
};

const contextoDe = (s: Solicitud): ContextoCasoVistaProps => ({
	...CONTEXTO,
	nombre: s.cliente,
	credito: s.credito ?? "—",
});

/* Historial */
const HIST_APAGADO: InmovilizacionHistorialFuente = {
	id: "h1",
	casoCobroId: "caso-h1",
	numeroCreditoSifco: "01010214043990",
	accion: "apagado",
	estado: "ejecutada",
	motivo: "Sin pagos desde mayo; no contesta.",
	bucketSnapshot: 4,
	solicitadoAt: hace(60 * 50),
	solicitanteNombre: "Ana Díaz",
	decididoAt: hace(60 * 48),
	decididoPorNombre: "Daniel Rodríguez",
	ejecutadoAt: hace(60 * 30),
	ejecutadoPorNombre: "Ana Díaz",
	referenciaEjecucion: "LEGION-4471",
	evidenciaUrl: "https://example.com/evidencia.pdf",
	evidenciaNombreArchivo: "confirmacion-legion.pdf",
	ubicacionEjecucion: {
		fuente: "manual",
		direccion: "Predio de la 12 calle, zona 1",
	},
	clienteNombre: "Diana Herrera",
};

const HIST_RECUPERACION = recuperacion("r9", {
	estadoSolicitud: "aprobada",
	decidioPor: "Daniel Rodríguez",
	decididoAt: hace(60 * 20),
	motivoDecision: null,
	cliente: "Roberto Cárcamo",
	numeroSifco: "01010214047120",
});

const persona = (nombre: string) => ({ userId: `u-${nombre}`, nombre });
const yo = persona("Daniel Rodríguez");
const b = (
	x: Partial<EntradaBitacora> &
		Pick<EntradaBitacora, "tipo" | "refId" | "fecha" | "estado">,
): EntradaBitacora => ({
	id: `${x.tipo}-${x.refId}`,
	decision: null,
	solicitante: null,
	decididoPor: null,
	credito: null,
	resumen: null,
	motivo: null,
	nota: null,
	...x,
});

const BITACORA: EntradaBitacora[] = [
	b({
		tipo: "rebaja",
		refId: "rb7",
		fecha: hace(25),
		decision: "aprobada",
		estado: "aplicada",
		solicitante: persona("Ana Díaz"),
		decididoPor: yo,
		credito: { sifco: "01010214046120", cliente: "Roberto Cárcamo" },
		motivo: "Pagó las cuotas atrasadas; pide rebajar la mora de la demora.",
		nota: "Aprobada por pago completo de lo vencido.",
		montos: {
			solicitado: "600.00",
			moraAlPedir: "1240.00",
			aplicado: "600.00",
		},
	}),
	b({
		tipo: "documento",
		refId: "d7",
		fecha: hace(60 * 2),
		decision: "aprobada",
		estado: "aprobada",
		solicitante: persona("Carmen Ramírez"),
		decididoPor: yo,
		credito: { sifco: "01010214046980", cliente: "Ana Lucía Morales" },
		motivo: "El cliente la necesita para el traspaso.",
		nota: "Enviada por correo",
		documento: "Carta poder",
	}),
	b({
		tipo: "juridico",
		refId: "j7",
		fecha: hace(60 * 3),
		decision: "rechazada",
		estado: "rechazada",
		solicitante: persona("Luis Morales"),
		decididoPor: yo,
		credito: { sifco: "01010214044410", cliente: "Andrea Solís" },
		motivo: "no_contacto",
		nota: "Falta visitar el lugar de trabajo antes de escalar.",
		bucket: 4,
		notaJuridico:
			"No contesta desde agosto y la dirección de trabajo ya no es válida.",
	}),
	b({
		tipo: "contrapropuesta",
		refId: "c1",
		fecha: hace(60 * 4),
		estado: "aceptada",
		decididoPor: persona("Carmen Ramírez"),
		credito: { sifco: "01010214047330", cliente: "Carlos Mendoza" },
		resumen: "6 → 8 cuotas de Q 1612.50",
		motivo: "Ocho cuotas para no pasar del 30 % de su ingreso.",
		plan: {
			montoTotal: "12900.00",
			original: {
				numeroMeses: 6,
				cuotaMensual: "2150.00",
				primerPago: dia(10),
			},
			propuesto: {
				numeroMeses: 8,
				cuotaMensual: "1612.50",
				primerPago: dia(20),
			},
			propuestaPor: yo,
			nota: "Ocho cuotas para no pasar del 30 % de su ingreso.",
		},
	}),
	b({
		tipo: "contrapropuesta",
		refId: "c0",
		fecha: hace(60 * 5),
		estado: "retirada",
		decididoPor: yo,
		credito: { sifco: "01010214048215", cliente: "Luis Fernando Aguilar" },
		resumen: "5 → 4 cuotas de Q 3225.00",
		motivo: "Cuatro cuotas para cerrar antes de fin de año.",
		nota: "El cliente consiguió un ingreso extra.",
		plan: {
			montoTotal: "12900.00",
			original: { numeroMeses: 5, cuotaMensual: "2580.00", primerPago: null },
			propuesto: {
				numeroMeses: 4,
				cuotaMensual: "3225.00",
				primerPago: dia(15),
			},
			propuestaPor: yo,
			nota: "Cuatro cuotas para cerrar antes de fin de año.",
		},
	}),
	b({
		tipo: "convenio",
		refId: "412",
		fecha: hace(60 * 6),
		decision: "aprobada",
		estado: "aprobado",
		solicitante: persona("Carmen Ramírez"),
		decididoPor: yo,
		credito: { sifco: "01010214047330", cliente: "Carlos Mendoza" },
		resumen: "6 cuotas de Q 2150.00",
		motivo: "Recuperó ingresos y puede pagar una cuota más baja.",
		nota: "Plan sostenible con su ingreso actual.",
	}),
	b({
		tipo: "rebaja",
		refId: "rb6",
		fecha: hace(60 * 9),
		decision: "aprobada",
		estado: "error_aplicacion",
		solicitante: persona("José Pérez"),
		decididoPor: yo,
		credito: { sifco: "01010214045987", cliente: "Gabriela Méndez" },
		motivo: "Error del banco al debitar la cuota de agosto.",
		nota: "Cartera no respondió a tiempo. Intente de nuevo en unos minutos.",
	}),
	b({
		tipo: "recuperacion",
		refId: "r9",
		fecha: hace(60 * 20),
		decision: "aprobada",
		estado: "aprobada",
		solicitante: persona("José Pérez"),
		decididoPor: yo,
		credito: { sifco: "01010214047120", cliente: "Roberto Cárcamo" },
		motivo: "El cliente ya no puede sostener los pagos.",
	}),
	b({
		tipo: "apagado",
		refId: "h1",
		fecha: hace(60 * 48),
		decision: "aprobada",
		estado: "ejecutada",
		solicitante: persona("Ana Díaz"),
		decididoPor: yo,
		credito: { sifco: "01010214043990", cliente: "Diana Herrera" },
		motivo: "Sin pagos desde mayo; no contesta.",
	}),
	b({
		tipo: "reasignacion",
		refId: "77",
		fecha: hace(60 * 52),
		estado: "realizada",
		decididoPor: { userId: null, nombre: "Daniel Rodríguez" },
		credito: { sifco: "01010214044870", cliente: "Ana Lucía Morales" },
		resumen: "Carmen Ramírez → Luis Morales",
		motivo: "Rebalanceo de cartera B3",
		bucket: 3,
	}),
	b({
		tipo: "traslado",
		refId: "op-5c1",
		evento: "baja",
		fecha: hace(60 * 60),
		estado: "realizada",
		decididoPor: { userId: null, nombre: "supervisor@clubcashin.com" },
		resumen: "31 cuentas (redistribucion)",
		motivo: "Renuncia: último día el 30 de septiembre",
		asesorAfectado: { asesorId: 12, userId: null, nombre: "Diego Morales" },
		cuentas: { movidas: 31 },
	}),
	b({
		tipo: "traslado",
		refId: "op-6d2",
		evento: "traslado",
		fecha: hace(60 * 64),
		estado: "realizada",
		decididoPor: yo,
		resumen: "18 cuentas (por_bucket)",
		motivo: "Redistribución: equilibrar B2 entre el equipo",
		asesorAfectado: { asesorId: 5, userId: null, nombre: "Carmen Ramírez" },
		cuentas: { movidas: 18 },
	}),
	b({
		tipo: "ausencia_indefinida",
		refId: "aus-1",
		id: "reactivacion_indefinida-aus-1",
		evento: "reactivacion",
		fecha: hace(60 * 66),
		estado: "reactivada",
		decididoPor: yo,
		resumen: "Wilson Pérez · ausente desde el 2026-10-01",
		motivo: "incidente",
		asesorAfectado: { asesorId: 8, userId: "u-wilson", nombre: "Wilson Pérez" },
		periodo: { desde: dia(-13), hasta: dia(-3) },
		cuentas: { movidas: 54, devueltas: 53, retenidas: 1 },
	}),
	b({
		tipo: "ausencia_indefinida",
		refId: "aus-1",
		id: "ausencia_indefinida-aus-1",
		evento: "ausencia",
		fecha: hace(60 * 24 * 13),
		estado: "reactivada",
		decididoPor: yo,
		resumen: "Wilson Pérez · 54 cuentas repartidas",
		motivo: "incidente",
		nota: "Accidente de tránsito; regresa cuando le den el alta.",
		asesorAfectado: { asesorId: 8, userId: "u-wilson", nombre: "Wilson Pérez" },
		periodo: { desde: dia(-13), hasta: dia(-3) },
		cuentas: { movidas: 54 },
	}),
	b({
		tipo: "reactivacion",
		refId: "h2",
		fecha: hace(60 * 69),
		decision: "rechazada",
		estado: "rechazada",
		solicitante: persona("José Pérez"),
		decididoPor: yo,
		credito: { sifco: "01010214045210", cliente: "Sergio Ramírez" },
		motivo: "Prometió pagar el viernes.",
		nota: "Falta el comprobante del pago.",
	}),
	b({
		tipo: "cobertura",
		refId: "cob-1",
		id: "reactivacion-cob-1",
		evento: "reactivacion",
		fecha: `${dia(-2)}T23:59:00-06:00`,
		estado: "realizada",
		resumen: `Laura Gómez · ${dia(-12)} al ${dia(-2)}`,
		motivo: "vacaciones",
		nota: "Terminó el período de la cobertura",
	}),
	b({
		tipo: "cobertura",
		refId: "cob-1",
		id: "cobertura-cob-1",
		evento: "ausencia",
		fecha: hace(60 * 24 * 14),
		estado: "realizada",
		decididoPor: yo,
		resumen: `Laura Gómez → Ana Díaz · ${dia(-12)} al ${dia(-2)}`,
		motivo: "vacaciones",
	}),
];

/** Lo que el servidor filtra y busca, imitado sobre los datos de ejemplo. */
function bitacoraFiltrada(f: FiltrosHistorial): EntradaHistorial[] {
	const sv = filtroServidorHistorial(f);
	if (sv.vacio) return [];
	const q = sv.busqueda?.toLowerCase();
	return BITACORA.filter(
		(e) =>
			(!sv.tipos || sv.tipos.includes(e.tipo)) &&
			(!sv.decisiones ||
				(e.decision !== null && sv.decisiones.includes(e.decision))) &&
			(!sv.solicitanteId || e.solicitante?.userId === sv.solicitanteId) &&
			(!sv.eventos || !e.evento || sv.eventos.includes(e.evento)) &&
			(!q ||
				(!!e.credito &&
					(e.credito.sifco.includes(q) ||
						(e.credito.cliente ?? "").toLowerCase().includes(q)))),
	).map(entradaDeBitacora);
}

/** El detalle completo que el Historial consulta al abrir una fila. */
function DetalleExtraEjemplo({
	entrada,
	base,
}: {
	entrada: EntradaHistorial;
	base: React.ReactNode;
}) {
	if (entrada.origen?.refId === "h1")
		return <DetalleInmovilizacion i={HIST_APAGADO} />;
	if (entrada.origen?.refId === "r9")
		return <DetalleRecuperacion r={HIST_RECUPERACION} />;
	return <>{base}</>;
}

/* Contrapropuestas del convenio */
const CONTRAPROPUESTAS: ContrapropuestaHistorialItem[] = [
	{
		id: "c3",
		estado: "retirada",
		numeroMeses: 8,
		cuotaMensual: "1612.50",
		primerPago: dia(20),
		nota: "Ocho cuotas para no pasar del 30 % de su ingreso.",
		creadaPor: "Daniel Rodríguez",
		creadaEn: hace(60 * 24 * 2),
		resueltaPor: "Daniel Rodríguez",
		resueltaEn: hace(60 * 24),
		notaRespuesta: "El cliente consiguió un ingreso extra.",
	},
	{
		id: "c2",
		estado: "descartada",
		numeroMeses: 4,
		cuotaMensual: "3225.00",
		primerPago: dia(10),
		nota: "Cuatro cuotas para cerrar antes de fin de año.",
		creadaPor: "Laura Gómez",
		creadaEn: hace(60 * 24 * 4),
		resueltaPor: "Carmen Ramírez",
		resueltaEn: hace(60 * 24 * 3),
		notaRespuesta: "La cuota no le alcanza al cliente.",
	},
	{
		id: "c1",
		estado: "aceptada",
		numeroMeses: 6,
		cuotaMensual: "2150.00",
		primerPago: dia(15),
		nota: "Mover el primer pago al día de cobro del cliente.",
		creadaPor: "Daniel Rodríguez",
		creadaEn: hace(60 * 24 * 6),
		resueltaPor: "Carmen Ramírez",
		resueltaEn: hace(60 * 24 * 5),
		notaRespuesta: null,
	},
];

/* Solicitudes de un asesor */
const FILAS_ASESOR_EJEMPLO: FilaSolicitudAsesor[] = [
	{
		id: "1",
		fecha: hace(60 * 3),
		tipo: "convenio",
		credito: "01010214047120",
		bucket: 2,
		cliente: "María José Contreras",
		estado: "pendiente",
		resultado: "6 cuotas · Q 1,500.00 al mes",
		solicitud: CONVENIO,
		ficha: { id: "01010214047120" },
	},
	{
		id: "2",
		fecha: hace(60 * 26),
		tipo: "recuperacion",
		credito: "01010214043990",
		bucket: 3,
		cliente: "Sergio Ramírez",
		estado: "pendiente",
		resultado: "No contesta o no se le localiza, Incumple sus promesas de pago",
		solicitud: RECUPERACION,
		ficha: { id: "caso-r1" },
	},
	{
		id: "3",
		fecha: hace(60 * 50),
		tipo: "apagado",
		credito: "01010214043110",
		bucket: 3,
		cliente: "Diana Herrera",
		estado: "aprobada",
		resultado: "Ejecutada el 22/9/2026",
		ficha: { id: "caso-h1", seccion: "inmovilizacion" },
	},
	{
		id: "4",
		fecha: hace(60 * 75),
		tipo: "reactivacion",
		credito: "01010214045210",
		bucket: 3,
		cliente: "Roberto Cárcamo",
		estado: "rechazada",
		resultado: "Falta el comprobante del pago.",
		ficha: { id: "caso-h2", seccion: "inmovilizacion" },
	},
	{
		id: "5",
		fecha: hace(60 * 24 * 6),
		tipo: "convenio",
		credito: "01010214042750",
		bucket: 2,
		cliente: "Carlos Mendoza",
		estado: "aprobada",
		resultado: "Convenio activo · 4 cuotas · Q 2,100.00 al mes",
		ficha: { id: "01010214042750" },
	},
	{
		id: "rebaja-rb1",
		fecha: hace(60 * 5),
		tipo: "rebaja",
		credito: "01010214046120",
		bucket: undefined,
		cliente: "Roberto Cárcamo",
		estado: "pendiente",
		resultado: "Pide Q 600.00 de Q 1,240.00 de mora",
		solicitud: REBAJA,
		ficha: { id: "caso-rb1" },
	},
	{
		id: "rebaja-rb7",
		fecha: hace(60 * 30),
		tipo: "rebaja",
		credito: "01010214046980",
		bucket: undefined,
		cliente: "Luis Fernando Aguilar",
		estado: "aprobada",
		resultado: "Rebaja de Q 600.00 aplicada",
		ficha: { id: "01010214046980" },
	},
	{
		id: "documento-d7",
		fecha: hace(60 * 32),
		tipo: "documentos",
		credito: "01010214045210",
		bucket: undefined,
		cliente: "Ana Lucía Morales",
		estado: "aprobada",
		resultado: "Carta poder · Enviada por correo",
		ficha: { id: "01010214045210" },
	},
	{
		id: "juridico-j7",
		fecha: hace(60 * 24 * 3),
		tipo: "juridico",
		credito: "01010214043110",
		bucket: 4,
		cliente: "Diana Herrera",
		estado: "aprobada",
		resultado: "Enviado a Jurídico (B5)",
		ficha: { id: "01010214043110" },
	},
	{
		id: "rebaja-rb5",
		fecha: hace(60 * 24 * 7),
		tipo: "rebaja",
		credito: "01010214041200",
		bucket: undefined,
		cliente: "Patricia López",
		estado: "rechazada",
		resultado: "Fuera de política: la mora es de menos de 30 días.",
		ficha: { id: "01010214041200" },
	},
];
/** Las más recientes primero, como las ordena el contenedor. */
const FILAS_ASESOR = [...FILAS_ASESOR_EJEMPLO].sort(
	(a, b) => new Date(b.fecha ?? 0).getTime() - new Date(a.fecha ?? 0).getTime(),
);

/* ── Marcos ───────────────────────────────────────────────────────────────── */

function Marco({ children }: { children: React.ReactNode }) {
	return (
		<div className="overflow-hidden rounded-2xl border border-line-subtle bg-canvas">
			{children}
		</div>
	);
}

/** El Espacio de aprobación a su tamaño real (≈1060×720). */
function EspacioEjemplo({
	titulo,
	solicitud,
	resolucion,
	aviso,
	sinBotones = false,
	bloqueo,
	contrapropuestas,
	conContraproponer = false,
}: {
	titulo: string;
	solicitud: Solicitud;
	resolucion?: ResolucionSolicitud;
	aviso?: React.ReactNode;
	sinBotones?: boolean;
	/** Botones visibles pero deshabilitados (contrapropuesta pendiente…). */
	bloqueo?: string;
	contrapropuestas?: ContrapropuestaHistorialItem[];
	conContraproponer?: boolean;
}) {
	const [notas, setNotas] = React.useState("");
	return (
		<figure className="flex flex-col gap-2 py-3">
			<figcaption className="type-label-sm text-fg-tertiary">
				{titulo}
			</figcaption>
			<div className="flex h-[720px] w-[1060px] max-w-full flex-col overflow-hidden rounded-2xl border border-line-subtle bg-surface shadow-clay-raised">
				<MarcoEspacioAprobacion
					tipo={solicitud.tipo}
					posicion={1}
					total={6}
					onAnterior={nada}
					onSiguiente={nada}
					onCerrar={nada}
					contexto={
						<ContextoCasoVista
							{...contextoDe(solicitud)}
							className="h-full bg-canvas"
						/>
					}
					panel={
						<PanelSolicitudVista
							solicitud={solicitud}
							ahora={AHORA}
							notas={notas}
							onNotas={setNotas}
							{...(sinBotones || bloqueo
								? {}
								: {
										onAprobar: nada,
										onRechazar: nada,
										...(conContraproponer ? { onContraproponer: nada } : {}),
									})}
							bloqueo={bloqueo}
							aviso={aviso}
							resolucion={resolucion}
							onVolver={nada}
							onSiguiente={nada}
							conMapa={false}
							primerPago={
								solicitud.tipo === "convenio"
									? { cargando: false, valor: dia(15) }
									: undefined
							}
							contrapropuestas={contrapropuestas}
							className="h-full"
						/>
					}
				/>
			</div>
		</figure>
	);
}

/** Bandeja con filtros vivos; clic en una fila abre el Espacio (estático). */
function DemoBandeja() {
	const [tipo, setTipo] = React.useState<FiltroTipoSolicitud>("todas");
	const [busqueda, setBusqueda] = React.useState("");
	const [asesor, setAsesor] = React.useState<string | null>(null);
	const [abierta, setAbierta] = React.useState<Solicitud | null>(null);
	const [notas, setNotas] = React.useState("");
	const [resuelta, setResuelta] = React.useState<ResolucionSolicitud | null>(
		null,
	);
	return (
		<>
			<SolicitudesPaginaVista
				tab="pendientes"
				onTab={nada}
				pendientes={PENDIENTES.length}
			>
				<BandejaSolicitudes
					pendientes={PENDIENTES}
					porEjecutar={[POR_EJECUTAR]}
					tipo={tipo}
					onTipo={setTipo}
					busqueda={busqueda}
					onBusqueda={setBusqueda}
					asesor={asesor}
					onAsesor={setAsesor}
					cargando={false}
					errores={[]}
					onReintentar={nada}
					onAbrir={(lista, i) => {
						setNotas("");
						setResuelta(null);
						setAbierta(lista[i] ?? null);
					}}
					idAbierta={abierta?.id}
					ahora={AHORA}
				/>
			</SolicitudesPaginaVista>
			<Dialog
				open={abierta !== null}
				onOpenChange={(o) => {
					if (!o) setAbierta(null);
				}}
			>
				<DialogContent
					showCloseButton={false}
					className="flex h-[min(780px,calc(100dvh-2rem))] w-[min(1100px,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
				>
					{abierta ? (
						<MarcoEspacioAprobacion
							enDialogo
							tipo={abierta.tipo}
							posicion={0}
							total={1}
							onCerrar={() => setAbierta(null)}
							contexto={
								<ContextoCasoVista
									{...contextoDe(abierta)}
									className="h-full bg-canvas"
								/>
							}
							panel={
								<PanelSolicitudVista
									solicitud={abierta}
									ahora={AHORA}
									notas={notas}
									onNotas={setNotas}
									onAprobar={() =>
										setResuelta(resolucionDe(abierta.tipo, "aprobada"))
									}
									onRechazar={() =>
										setResuelta(resolucionDe(abierta.tipo, "rechazada"))
									}
									resolucion={resuelta}
									onVolver={() => setAbierta(null)}
									conMapa={false}
									className="h-full"
								/>
							}
						/>
					) : null}
				</DialogContent>
			</Dialog>
		</>
	);
}

const ASESORES_FILTRO = [
	{ value: "u-Ana Díaz", label: "Ana Díaz" },
	{ value: "u-Carmen Ramírez", label: "Carmen Ramírez" },
	{ value: "u-José Pérez", label: "José Pérez" },
	{ value: "u-Luis Morales", label: "Luis Morales" },
];

function DemoHistorial() {
	const [filtros, setFiltros] = React.useState<FiltrosHistorial>({
		vista: "todas",
		tipo: "todas",
		estado: "todos",
		busqueda: "",
		asesorId: null,
		desde: null,
		hasta: null,
	});
	const entradas = bitacoraFiltrada(filtros);
	return (
		<SolicitudesPaginaVista
			tab="historial"
			onTab={nada}
			pendientes={PENDIENTES.length}
		>
			<HistorialDecisiones
				entradas={entradas}
				total={entradas.length}
				pagina={1}
				totalPaginas={1}
				onPagina={nada}
				porPagina={20}
				filtros={filtros}
				onFiltros={(c) => setFiltros((f) => ({ ...f, ...c }))}
				asesores={ASESORES_FILTRO}
				cargando={false}
				error={false}
				onReintentar={nada}
				DetalleExtra={DetalleExtraEjemplo}
			/>
		</SolicitudesPaginaVista>
	);
}

/* ── Modales (vista estática: el Root cerrado solo da contexto a Radix) ─────── */

function PanelModal({
	titulo,
	ancho = "w-120",
	children,
}: {
	titulo: string;
	ancho?: string;
	children: React.ReactNode;
}) {
	return (
		<Dialog>
			<figure className="flex flex-col gap-2 py-3">
				<figcaption className="type-label-sm text-fg-tertiary">
					{titulo}
				</figcaption>
				<div className={cn(dialogPanelClassName, "max-w-full", ancho)}>
					{children}
				</div>
			</figure>
		</Dialog>
	);
}

function DecisionEjemplo(
	props: Omit<
		DecidirSolicitudVistaProps,
		"nota" | "onNota" | "pendiente" | "onCancelar" | "onConfirmar"
	> & { notaInicial?: string; pendiente?: boolean },
) {
	const [nota, setNota] = React.useState(props.notaInicial ?? "");
	return (
		<DecidirSolicitudVista
			{...props}
			nota={nota}
			onNota={setNota}
			pendiente={props.pendiente ?? false}
			onCancelar={nada}
			onConfirmar={nada}
		/>
	);
}

/** El editor de la contrapropuesta con estado local (cuotas, fecha y nota vivas). */
function EditorContrapropuesta(
	props: Partial<ContrapropuestaVistaProps> & { notaInicial?: string },
) {
	const [meses, setMeses] = React.useState(props.meses ?? "6");
	const [primerPago, setPrimerPago] = React.useState(
		props.primerPago ?? dia(15),
	);
	const [nota, setNota] = React.useState(props.notaInicial ?? "");
	return (
		<ContrapropuestaVista
			cliente="Carlos Mendoza"
			total={12900}
			actual={{ meses: 6, cuota: 2150, primerPago: dia(15) }}
			meses={meses}
			onMeses={setMeses}
			maxMeses={props.maxMeses === undefined ? 24 : props.maxMeses}
			onReintentarLimite={props.onReintentarLimite}
			primerPago={primerPago}
			onPrimerPago={setPrimerPago}
			minPrimerPago={dia(1)}
			maxPrimerPago={dia(90)}
			nota={nota}
			onNota={setNota}
			error={props.error ?? null}
			errorServidor={props.errorServidor ?? null}
			pendiente={props.pendiente ?? false}
			onCancelar={nada}
			onEnviar={nada}
		/>
	);
}

export default function CobrosSolicitudesShowcase() {
	return (
		<div className="space-y-8">
			<ShowcaseGroup title="Bandeja de aprobaciones (3310:12) · interactiva: filtros y clic en una fila">
				<Marco>
					<DemoBandeja />
				</Marco>
			</ShowcaseGroup>

			<ShowcaseGroup title="Historial de decisiones (3602:5360) · bitácora del servidor; clic en una fila para ver el detalle">
				<Marco>
					<DemoHistorial />
				</Marco>
			</ShowcaseGroup>

			<ShowcaseGroup title="Espacio de aprobación por tipo">
				<div className="flex flex-col gap-2">
					<EspacioEjemplo
						titulo="Convenio (3699:5850) · con «Editar y contraproponer» y las contrapropuestas anteriores"
						solicitud={CONVENIO}
						conContraproponer
						contrapropuestas={CONTRAPROPUESTAS}
					/>
					<EspacioEjemplo
						titulo="Convenio con una contrapropuesta esperando al asesor: no se decide; el supervisor puede retirarla"
						solicitud={CONVENIO_2}
						bloqueo="Hay una contrapropuesta esperando la respuesta del asesor"
						aviso={
							<ContrapropuestaPendienteAviso
								contrapropuesta={{
									numeroMeses: 8,
									cuotaMensual: "1612.50",
									primerPago: dia(20),
									nota: "Ocho cuotas para no pasar del 30 % de su ingreso.",
								}}
								onRetirar={nada}
							/>
						}
						contrapropuestas={CONTRAPROPUESTAS.slice(1)}
					/>
					<EspacioEjemplo
						titulo="Apagado · acción crítica (3329:7989)"
						solicitud={APAGADO}
					/>
					<EspacioEjemplo
						titulo="Recuperación del vehículo de otro asesor (3699:6285)"
						solicitud={RECUPERACION}
					/>
					<EspacioEjemplo
						titulo="Recuperación propia: regla de cuatro ojos, sin botones"
						solicitud={RECUPERACION_PROPIA}
						sinBotones
						aviso={<AvisoSuSolicitud />}
					/>
					<EspacioEjemplo
						titulo="Rebaja de mora (W2) · monto pedido, mora al pedir, motivo y quién la pidió"
						solicitud={REBAJA}
					/>
					<EspacioEjemplo
						titulo="Rebaja de mora que cartera no pudo aplicar: se reintenta o se rechaza"
						solicitud={REBAJA_ERROR}
					/>
					<EspacioEjemplo
						titulo="Rebaja de mora propia: regla de cuatro ojos, sin botones"
						solicitud={REBAJA_PROPIA}
						sinBotones
						aviso={<AvisoSuSolicitud />}
					/>
					<EspacioEjemplo
						titulo="Escalar a Jurídico (W3)"
						solicitud={JURIDICO}
					/>
					<EspacioEjemplo
						titulo="Solicitud de documento (F6) · con el nombre del cliente"
						solicitud={DOCUMENTO}
					/>
					<EspacioEjemplo
						titulo="Documento pedido por quien mira: «Su solicitud» como aviso, sin bloquear la decisión"
						solicitud={DOCUMENTO_PROPIO}
						aviso={<AvisoSuSolicitud bloquea={false} />}
					/>
					<EspacioEjemplo
						titulo="Por ejecutar: aprobada, la registra el asesor en la Ficha 360"
						solicitud={POR_EJECUTAR}
						sinBotones
					/>
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Resuelto («WS Aprob · * · Resuelto»)">
				<div className="flex flex-col gap-2">
					<EspacioEjemplo
						titulo="Convenio aprobado"
						solicitud={CONVENIO}
						resolucion={resolucionDe("convenio", "aprobada")}
					/>
					<EspacioEjemplo
						titulo="Apagado autorizado"
						solicitud={APAGADO}
						resolucion={resolucionDe("apagado", "aprobada")}
					/>
					<EspacioEjemplo
						titulo="Recuperación rechazada"
						solicitud={RECUPERACION}
						resolucion={resolucionDe("recuperacion", "rechazada")}
					/>
					<EspacioEjemplo
						titulo="Rebaja aplicada"
						solicitud={REBAJA}
						resolucion={{
							...resolucionDe("rebaja", "aprobada"),
							descripcion:
								"Cartera aplicó la rebaja. La mora del crédito quedó en Q 640.00. Se avisó al asesor.",
						}}
					/>
					<EspacioEjemplo
						titulo="Escalado a Jurídico"
						solicitud={JURIDICO}
						resolucion={resolucionDe("juridico", "aprobada")}
					/>
					<EspacioEjemplo
						titulo="Solicitud de documento rechazada"
						solicitud={DOCUMENTO}
						resolucion={resolucionDe("documentos", "rechazada")}
					/>
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Modales de decisión (rebaja, Jurídico y documentos)">
				<div className="flex flex-wrap items-start gap-6">
					<PanelModal titulo="Aprobar una rebaja">
						<DecisionEjemplo
							tipo="rebaja"
							decision="aprobar"
							quien="Roberto Cárcamo (crédito 01010214046120)"
							resumen="Rebaja de Q 600.00 sobre una mora de Q 1,240.00 al pedirla."
						/>
					</PanelModal>
					<PanelModal titulo="La mora ya no alcanza: el servidor pide rechazarla">
						<DecisionEjemplo
							tipo="rebaja"
							decision="aprobar"
							quien="Roberto Cárcamo (crédito 01010214046120)"
							resumen="Rebaja de Q 600.00 sobre una mora de Q 1,240.00 al pedirla."
							ofrecerRechazo="La mora ahora es Q 420.00 y la rebaja pedida es Q 600.00. Rechácela para que el asesor pida una nueva."
							onPasarARechazo={nada}
						/>
					</PanelModal>
					<PanelModal titulo="Rechazar: nota de 10 caracteres o más">
						<DecisionEjemplo
							tipo="rebaja"
							decision="rechazar"
							quien="Roberto Cárcamo (crédito 01010214046120)"
							notaInicial="Mora baja"
						/>
					</PanelModal>
					<PanelModal titulo="Reintentar una rebaja que no se aplicó">
						<DecisionEjemplo
							tipo="rebaja"
							decision="aprobar"
							reintento
							quien="Gabriela Méndez (crédito 01010214045987)"
							errorServidor="Cartera no respondió a tiempo. Intente de nuevo en unos minutos."
						/>
					</PanelModal>
					<PanelModal titulo="Aprobar el escalado a Jurídico">
						<DecisionEjemplo
							tipo="juridico"
							decision="aprobar"
							quien="Andrea Solís (crédito 01010214044410)"
							resumen="Motivo: No quiere pagar · B4 al pedirlo."
						/>
					</PanelModal>
					<PanelModal titulo="Rechazar una solicitud de documento (nota opcional)">
						<DecisionEjemplo
							tipo="documentos"
							decision="rechazar"
							quien="Contrato de crédito (crédito 01010214047330)"
						/>
					</PanelModal>
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Editor de la contrapropuesta (M4, «WS Aprob · Convenio · Contrapropuesta»)">
				<div className="flex flex-wrap items-start gap-6">
					<PanelModal titulo="Igual al plan del asesor: no se puede enviar">
						<EditorContrapropuesta error="Cambie las cuotas o la fecha del primer pago: es igual al plan del asesor." />
					</PanelModal>
					<PanelModal titulo="Lista para enviar (la cuota se recalcula)">
						<EditorContrapropuesta
							meses="8"
							primerPago={dia(20)}
							notaInicial="Ocho cuotas para no pasar del 30 % de su ingreso."
						/>
					</PanelModal>
					<PanelModal titulo="Enviando">
						<EditorContrapropuesta
							meses="8"
							notaInicial="Ocho cuotas para no pasar del 30 % de su ingreso."
							pendiente
						/>
					</PanelModal>
					<PanelModal titulo="Error del servidor">
						<EditorContrapropuesta
							meses="8"
							notaInicial="Ocho cuotas para no pasar del 30 % de su ingreso."
							errorServidor="El convenio ya no está pendiente: se decidió fuera del CRM."
						/>
					</PanelModal>
					<PanelModal titulo="Sin el límite de cuotas: ofrece reintentar">
						<EditorContrapropuesta
							maxMeses={null}
							error="No se pudo cargar el límite de cuotas del convenio."
							onReintentarLimite={nada}
						/>
					</PanelModal>
					<PanelModal titulo="Retirar la contrapropuesta">
						<RetirarContrapropuestaVista
							nota=""
							onNota={nada}
							errorServidor={null}
							pendiente={false}
							onCancelar={nada}
							onRetirar={nada}
						/>
					</PanelModal>
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Solicitudes de un asesor (3654:5711) · pestaña del Detalle del asesor">
				<div className="py-4">
					<SolicitudesDeAsesorVista
						nombre="Marta Gómez"
						filas={FILAS_ASESOR}
						cargando={false}
						error={false}
						onReintentar={nada}
						onAbrir={nada}
						onCargarMas={nada}
					/>
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Estados: cargando y vacío">
				<div className="flex flex-col gap-6 py-4">
					<BandejaSolicitudes
						pendientes={[]}
						porEjecutar={[]}
						tipo="todas"
						onTipo={nada}
						busqueda=""
						onBusqueda={nada}
						asesor={null}
						onAsesor={nada}
						cargando
						errores={[]}
						onReintentar={nada}
						onAbrir={nada}
					/>
					<BandejaSolicitudes
						pendientes={[]}
						porEjecutar={[]}
						tipo="todas"
						onTipo={nada}
						busqueda=""
						onBusqueda={nada}
						asesor={null}
						onAsesor={nada}
						cargando={false}
						errores={[]}
						onReintentar={nada}
						onAbrir={nada}
					/>
					<BandejaSolicitudes
						pendientes={PENDIENTES.filter((s) => s.tipo !== "juridico")}
						porEjecutar={[]}
						tipo="juridico"
						onTipo={nada}
						busqueda=""
						onBusqueda={nada}
						asesor={null}
						onAsesor={nada}
						cargando={false}
						errores={[]}
						onReintentar={nada}
						onAbrir={nada}
					/>
					<SolicitudesDeAsesorVista
						nombre="Marta Gómez"
						filas={[]}
						cargando={false}
						error={false}
						onReintentar={nada}
					/>
				</div>
			</ShowcaseGroup>
		</div>
	);
}
