import { InteraccionesSesionBot } from "@/components/cobros/actividad-bot";
import type { DatosHistorialUnificado } from "@/components/cobros/ficha/historial-unificado";
import {
	cortePeriodoActual,
	type EventoHistorial,
	eventoDeDecisionConvenio,
	eventoDeGrupoPagalo,
	eventoDeHito,
	eventoDeRecordatorio,
	eventosDeBot,
	eventosDeContactos,
	eventosDePagos,
	type HitoFuente,
	mezclarEventos,
	type SesionBotFuente,
} from "@/lib/cobros/historial-unificado";

/**
 * Historial unificado de ejemplo para los showcases (Ficha 360 y Workspace):
 * pasa por los MISMOS normalizadores que los datos reales. El crédito entró a
 * B2 el 3 oct 2026: lo de esa fecha en adelante es «Historial actual».
 */

const AHORA = new Date("2026-10-15T18:00:00Z");

const HITOS: HitoFuente[] = [
	{
		id: "bucket-2",
		descripcion: "Subió a Bucket B2 · Gestión activa (desde B1)",
		fecha: "2026-10-03T12:00:00Z",
		tipo: "bucket",
	},
	{
		id: "bucket-1",
		descripcion: "Ingresó a Bucket B1 · Alerta temprana",
		fecha: "2026-09-01T12:00:00Z",
		tipo: "bucket",
	},
];

const SESION_BOT: SesionBotFuente = {
	numero: 3,
	referenciaSufijo: "9f2c1a",
	inicio: "2026-10-09T15:20:00Z",
	operadoPor: "titular",
	codeudorNombre: null,
	interacciones: [
		{
			id: "b1",
			accion: "buscar_cliente",
			exito: true,
			codigo: null,
			numeroSifco: null,
			detalle: { tipoBusqueda: "dpi", otpEnviadoA: "****1234" },
			creadoEn: "2026-10-09T15:20:00Z",
		},
		{
			id: "b2",
			accion: "boleta_leer",
			exito: false,
			codigo: "BOLETA_ILEGIBLE",
			numeroSifco: null,
			detalle: {},
			creadoEn: "2026-10-09T15:22:00Z",
		},
		{
			id: "b3",
			accion: "estado_cuenta",
			exito: true,
			codigo: null,
			numeroSifco: null,
			detalle: {},
			creadoEn: "2026-10-09T15:24:00Z",
		},
	],
};

function eventosDemo(): EventoHistorial[] {
	const contactos = eventosDeContactos(
		[
			{
				id: "g1",
				fechaContacto: "2026-10-14T16:30:00Z",
				metodoContacto: "llamada",
				direccionContacto: "entrante",
				estadoContacto: "contactado",
				participanteTipo: "codeudor",
				participanteNombre: "Juan Pérez López",
				telefonoContactado: "5555-1234",
				realizadoPor: "Caren Rivera",
				comentarios:
					"El cliente perdió el empleo temporalmente; retomará los pagos en noviembre.",
				fechaProximoContacto: "2026-10-20",
				horaProximoContacto: "10:30:00",
				medioProximoContacto: "whatsapp",
				proximoPaso: "Confirmar el depósito del viernes",
				duracionLlamada: 312,
			},
			{
				id: "p1",
				fechaContacto: "2026-10-10T15:00:00Z",
				metodoContacto: "llamada",
				estadoContacto: "promesa_pago",
				estadoPromesa: "pendiente",
				fechaProximoContacto: "2026-10-20T06:00:00Z",
				cuotaInicio: 5,
				cuotaFin: 6,
				incluyeMora: true,
				montoComprometido: "3600",
				participanteTipo: "titular",
				participanteNombre: "María José Contreras López",
				telefonoContactado: "4444-9876",
				realizadoPor: "Caren Rivera",
				compromisosPago: "Depósito en BI el 20 de octubre",
			},
			{
				id: "g2",
				fechaContacto: "2026-10-07T14:05:00Z",
				metodoContacto: "whatsapp",
				estadoContacto: "no_contesta",
				participanteTipo: "titular",
				participanteNombre: "María José Contreras López",
				telefonoContactado: "4444-9876",
				realizadoPor: "Caren Rivera",
			},
			{
				id: "g3",
				fechaContacto: "2026-09-28T17:40:00Z",
				metodoContacto: "visita_domicilio",
				estadoContacto: "rechaza_pagar",
				participanteTipo: "titular",
				participanteNombre: "María José Contreras López",
				realizadoPor: "Samuel Gamboa",
				comentarios:
					"Indica que no pagará hasta resolver el reclamo del seguro.",
			},
			{
				id: "p0",
				fechaContacto: "2026-09-12T15:00:00Z",
				metodoContacto: "llamada",
				estadoContacto: "promesa_pago",
				estadoPromesa: "incumplida",
				fechaProximoContacto: "2026-09-20T06:00:00Z",
				cuotaInicio: 4,
				cuotaFin: 4,
				incluyeMora: false,
				montoComprometido: "1800",
				realizadoPor: "Caren Rivera",
			},
		],
		undefined,
		AHORA,
	);
	const recordatorios = [
		eventoDeRecordatorio({
			id: "r1",
			tipo: "premora_0",
			telefono: "4444-9876",
			enviado: true,
			error: null,
			modoPrueba: false,
			fecha: "2026-10-15T14:00:00Z",
		}),
		eventoDeRecordatorio({
			id: "r2",
			tipo: "premora_3_mora",
			telefono: "4444-9876",
			enviado: false,
			error: "El número no tiene WhatsApp.",
			modoPrueba: false,
			fecha: "2026-10-05T14:00:00Z",
		}),
	];
	const pagos = eventosDePagos([
		{
			numeroCuota: 3,
			pagos: [
				{
					pagoId: 9012,
					montoBoleta: "2400",
					montoAplicado: "1800",
					fechaPago: "2026-10-12T00:00:00",
					validationStatus: "validated",
					estado: "validado",
				},
			],
		},
		{
			numeroCuota: 4,
			pagos: [
				{
					pagoId: 9012,
					montoBoleta: "2400",
					montoAplicado: "600",
					fechaPago: "2026-10-12T00:00:00",
					validationStatus: "validated",
					estado: "parcial",
				},
				{
					pagoId: 8870,
					montoBoleta: "1200",
					montoAplicado: "1200",
					fechaPago: "2026-08-30T09:15:00",
					validationStatus: "validated",
					estado: "parcial",
				},
			],
		},
	]);
	const link = eventoDeGrupoPagalo({
		id: "grupo-1",
		status: "COMPLETED",
		origen: "BOT",
		totalAmount: "2400",
		carteraImportId: 451,
		lastDispatchError: null,
		createdAt: "2026-10-09T15:30:00Z",
		creadoPor: null,
		links: [{}, {}],
	});
	const bot = eventosDeBot({
		sesiones: [SESION_BOT],
		accesosFallidos: [
			{
				id: "a1",
				accion: "acceso_fallido",
				exito: false,
				codigo: "DEMASIADOS_ENVIOS",
				numeroSifco: null,
				detalle: {},
				creadoEn: "2026-08-28T20:00:00Z",
			},
		],
	}).map((e) =>
		e.datos?.tipo === "bot_sesion"
			? {
					...e,
					contenido: {
						detalleNodo: (
							<InteraccionesSesionBot
								interacciones={e.datos.sesion.interacciones}
								numeroSifcoCaso="01010214048972"
							/>
						),
					},
				}
			: e,
	);
	const vida = [
		...HITOS.map(eventoDeHito),
		eventoDeDecisionConvenio({
			decisionId: 7,
			decision: "rechazado",
			motivo: "Los ingresos no cubren la cuota propuesta.",
			origen: "crm",
			decididoPorEmail: "supervisor@clubcashin.com",
			decididoEn: "2026-09-15T16:00:00Z",
			snapshot: { monto_total_convenio: "14400", numero_meses: 6 },
		}),
	];
	return mezclarEventos(
		contactos,
		recordatorios,
		pagos,
		[
			{
				...link,
				contenido: {
					detalleNodo: (
						<p className="text-fg-secondary text-xs">
							Capital Q1,800.00 · Mora e intereses Q600.00 · 2 links pagados
						</p>
					),
				},
			},
		],
		bot,
		vida,
	);
}

export function historialDemo({
	cargando = false,
	conAvisos = false,
	vacio = false,
}: {
	cargando?: boolean;
	/** Una fuente con error, otra cargando, «Cargar más» y la nota de tope. */
	conAvisos?: boolean;
	vacio?: boolean;
} = {}): DatosHistorialUnificado {
	return {
		eventos: vacio ? [] : eventosDemo(),
		corte: cortePeriodoActual({
			fechaEntradaBucket: "2026-10-03T12:00:00Z",
			bucket: "B2 · Gestión activa",
		}),
		horizonte: null,
		cargando,
		fuentes: conAvisos
			? [
					{
						clave: "bot",
						etiqueta: "bot de WhatsApp",
						estado: "error",
						onReintentar: () => undefined,
					},
					{ clave: "pagos", etiqueta: "pagos", estado: "cargando" },
				]
			: [],
		hayMasEnServidor: conAvisos,
		cargandoMas: false,
		onCargarMas: () => undefined,
		avisos: conAvisos
			? ["Solo se consultan los 30 recordatorios de pago más recientes."]
			: [],
	};
}
