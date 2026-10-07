import * as React from "react";
import {
	BandejaSolicitudes,
	type FiltroTipoSolicitud,
} from "@/components/cobros/solicitudes/bandeja-solicitudes";
import {
	MarcoEspacioAprobacion,
	PanelSolicitudVista,
	type ResolucionSolicitud,
	resolucionDe,
} from "@/components/cobros/solicitudes/espacio-aprobacion";
import {
	type EntradaHistorial,
	entradaDeInmovilizacion,
	entradaDeReasignacion,
	entradaDeRecuperacion,
	entradaDeTraslado,
	entradasDeCobertura,
	type FiltrosHistorial,
	ordenarHistorial,
} from "@/components/cobros/solicitudes/historial";
import { HistorialDecisiones } from "@/components/cobros/solicitudes/historial-decisiones";
import {
	type RecuperacionFuente,
	type Solicitud,
	solicitudDeConvenio,
	solicitudDeInmovilizacion,
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
import { CrmPill } from "@/components/ds/cards-credito";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ShowcaseGroup, type ShowcaseMeta } from "./_layout";

export const meta: ShowcaseMeta = {
	order: 312,
	title: "Cobros · Solicitudes (supervisor)",
	figma:
		"CRM Ventas › Supervisor › Aprobaciones (3310:12), Historial de decisiones (3602:5360), Espacio de aprobación (3699:5850, 3699:6285, 3329:7989, «WS Aprob · * · Resuelto») y Solicitudes del asesor (3654:5711)",
	description:
		"Pantalla /cobros/solicitudes con datos de ejemplo: la bandeja única (chips por tipo con conteo, buscador, asesor, «Por ejecutar», Rebaja y Documentos en «Pronto»), el Historial de decisiones (chips, tipo, estado y detalle por fila), el Espacio de aprobación por tipo (convenio con «Editar y contraproponer» en «Pronto», apagado, recuperación ajena y propia con la regla de cuatro ojos, por ejecutar) con su estado «Resuelto», y las solicitudes de un asesor (Detalle del asesor).",
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

const PENDIENTES: Solicitud[] = [
	RECUPERACION,
	RECUPERACION_PROPIA,
	APAGADO,
	CONVENIO,
	CONVENIO_2,
	REACTIVACION,
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
const HIST_INMOV = [
	{
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
	},
	{
		id: "h2",
		casoCobroId: "caso-h2",
		numeroCreditoSifco: "01010214045210",
		accion: "reactivacion",
		estado: "rechazada",
		motivo: "Prometió pagar el viernes.",
		motivoRechazo: "Falta el comprobante del pago.",
		bucketSnapshot: 3,
		solicitadoAt: hace(60 * 70),
		solicitanteNombre: "José Pérez",
		decididoAt: hace(60 * 69),
		decididoPorNombre: "Daniel Rodríguez",
		clienteNombre: "Sergio Ramírez",
	},
] as const;

const ENTRADAS: EntradaHistorial[] = ordenarHistorial([
	...HIST_INMOV.map((i) => entradaDeInmovilizacion({ ...i })),
	entradaDeRecuperacion(
		recuperacion("r9", {
			estadoSolicitud: "aprobada",
			decidioPor: "Daniel Rodríguez",
			decididoAt: hace(60 * 20),
			motivoDecision: null,
			cliente: "Roberto Cárcamo",
			numeroSifco: "01010214047120",
		}),
	),
	entradaDeRecuperacion(
		recuperacion("r8", {
			estadoSolicitud: "cancelada",
			decidioPor: "José Pérez",
			decididoAt: hace(60 * 90),
			motivoDecision: "El cliente se puso al día.",
		}),
	),
	entradaDeReasignacion({
		historial_id: 77,
		fecha: hace(60 * 40),
		numero_credito_sifco: "01010214044870",
		cliente: "Ana Lucía Morales",
		asesor_anterior: "Carmen Ramírez",
		asesor_nuevo: "Luis Morales",
		bucket: 3,
		bucket_prefijo: "B3",
		origen: "API_MANUAL",
		motivo: "Rebalanceo de cartera B3",
		usuario: "daniel.r@clubcashin.com",
	}),
	entradaDeTraslado(
		{
			id: "op-5c1",
			motivo: "Renuncia: último día el 30 de septiembre",
			asesor_origen_id: 9,
			actor_email: "supervisor@clubcashin.com",
			created_at: hace(60 * 60),
			cuentas: 31,
		},
		() => "Diego Morales",
	),
	...entradasDeCobertura(
		{
			id: "cob-1",
			titularId: "u-laura",
			suplenteId: "u-ana",
			motivo: "vacaciones",
			desde: dia(-12),
			hasta: dia(-2),
			canceladaEn: null,
			createdAt: hace(60 * 24 * 14),
		},
		(id) => (id === "u-laura" ? "Laura Gómez" : "Ana Díaz"),
		dia(0),
	),
]);

/* Solicitudes de un asesor */
const FILAS_ASESOR: FilaSolicitudAsesor[] = [
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
];

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
}: {
	titulo: string;
	solicitud: Solicitud;
	resolucion?: ResolucionSolicitud;
	aviso?: React.ReactNode;
	sinBotones?: boolean;
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
							{...(sinBotones ? {} : { onAprobar: nada, onRechazar: nada })}
							aviso={aviso}
							resolucion={resolucion}
							onVolver={nada}
							onSiguiente={nada}
							conMapa={false}
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

function DemoHistorial() {
	const [filtros, setFiltros] = React.useState<FiltrosHistorial>({
		vista: "todas",
		tipo: "todas",
		estado: "todos",
		busqueda: "",
	});
	return (
		<SolicitudesPaginaVista
			tab="historial"
			onTab={nada}
			pendientes={PENDIENTES.length}
		>
			<HistorialDecisiones
				entradas={ENTRADAS}
				filtros={filtros}
				onFiltros={(c) => setFiltros((f) => ({ ...f, ...c }))}
				cargando={false}
				errores={[]}
				onReintentar={nada}
				inmovilizaciones={{ cargadas: 2, total: 74 }}
				onCargarMas={nada}
				historialEquipo={{
					to: "/cobros/equipo",
					search: { tab: "asignacion" },
				}}
			/>
		</SolicitudesPaginaVista>
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

			<ShowcaseGroup title="Historial de decisiones (3602:5360) · clic en una fila para ver el detalle">
				<Marco>
					<DemoHistorial />
				</Marco>
			</ShowcaseGroup>

			<ShowcaseGroup title="Espacio de aprobación por tipo">
				<div className="flex flex-col gap-2">
					<EspacioEjemplo
						titulo="Convenio (3699:5850) · «Editar y contraproponer» en Pronto (M4)"
						solicitud={CONVENIO}
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
						aviso={
							<div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted px-3 py-2.5 text-[13px] text-fg-secondary">
								<CrmPill tone="neutral" kind="chip" className="px-2 py-0.5">
									Su solicitud
								</CrmPill>
								<span className="min-w-0 flex-1">
									Debe aprobarla otro supervisor o administrador. Si ya no
									aplica, cancélela desde la ficha.
								</span>
							</div>
						}
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

			<ShowcaseGroup title="Estados: cargando, vacío y Pronto">
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
						pendientes={PENDIENTES}
						porEjecutar={[]}
						tipo="rebaja"
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
