import * as React from "react";
import type { FilaCartera } from "@/components/cobros/asesor/fila-cartera";
import {
	CumplimientoAgendaAsesorVista,
	DetalleAgendaVista,
	type DetalleData,
	type ResumenFila,
} from "@/components/cobros/cumplimiento-agenda-panel";
import {
	type AsesorEncabezado,
	DetalleAsesorVista,
} from "@/components/cobros/equipo/detalle/detalle-asesor-vista";
import {
	enlacesAsesor,
	enlacesCriticos,
	type TabDetalle,
} from "@/components/cobros/equipo/detalle/enlaces";
import {
	ResumenAsesorVista,
	type ResumenAsesorVistaProps,
} from "@/components/cobros/equipo/detalle/resumen-asesor";
import { GestionesDelDiaVista } from "@/components/cobros/gestiones-del-dia-panel";
import { CambiosBucketVista } from "@/components/cobros/historial/cambios-bucket";
import type { CategoriaActividad } from "@/components/cobros/historial/categorias";
import { aFechaISO_GT } from "@/components/cobros/historial/formato";
import {
	type FiltrosHistorialUI,
	HistorialGestionesVista,
} from "@/components/cobros/historial/historial-gestiones-vista";
import type { MovimientoBucket } from "@/components/cobros/historial/linea-tiempo";
import type {
	FilaHistorialData,
	RespuestaHistorial,
	ResumenHistorial,
} from "@/components/cobros/historial/tipos";
import {
	type FilaSolicitudAsesor,
	SolicitudesDeAsesorVista,
} from "@/components/cobros/solicitudes/solicitudes-de-asesor";
import { EmptyState } from "@/components/ui/empty-state";
import { ShowcaseGroup, type ShowcaseMeta } from "./_layout";

export const meta: ShowcaseMeta = {
	order: 315,
	title: "Cobros · Detalle del asesor (supervisor)",
	figma:
		"CRM Ventas › Supervisor › Detalle de asesor (2082:13), Cartera del asesor (3650:5563), Casos críticos (3662:5853), Historial de actividad (4063:12) y Solicitudes del asesor (3654:5711)",
	description:
		"Pantalla /cobros/equipo/$asesorId con datos de ejemplo: encabezado (nivel, estado, Trasladar cartera, Marcar ausente, Ver sus casos y selector de asesor) y las pestañas Resumen (KPIs, diagnóstico, casos críticos, vista rápida de su cartera e historial reciente), Agenda (cumplimiento por día con navegación), Actividad (Historial de gestiones del asesor con los chips del Figma, línea de tiempo o tabla, y Cambios de bucket) y Solicitudes. Estados: cargando, asesor no encontrado, sin usuario del CRM y vacío.",
};

/* ── Fechas de ejemplo ────────────────────────────────────────────────────── */

const AHORA = new Date();
const HOY = aFechaISO_GT(AHORA);
const haceHoras = (h: number) =>
	new Date(AHORA.getTime() - h * 60 * 60 * 1000).toISOString();
const diaISO = (delta: number) => {
	const [y, m, d] = HOY.split("-").map(Number);
	return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
};
const nada = () => {};

/* ── Asesor ───────────────────────────────────────────────────────────────── */

const ASESOR_ID = 12;
const NOMBRE = "Marta Gómez";
const ASESOR: AsesorEncabezado = {
	asesorId: ASESOR_ID,
	nombre: NOMBRE,
	nivel: "senior",
	estado: "requiere_atencion",
};
const ASESORES = [
	{ asesorId: 7, nombre: "Ana Lucía Díaz" },
	{ asesorId: 9, nombre: "Carlos Ramírez" },
	{ asesorId: ASESOR_ID, nombre: NOMBRE },
	{ asesorId: 15, nombre: "Luis Morales" },
];

/* ── Cartera (filas de Mi Cartera) ───────────────────────────────────────── */

type Semilla = [
	cliente: string,
	vehiculo: string,
	placa: string,
	bucket: number,
	deuda: number,
	cuota: number,
	intentos: number,
	gestion: string,
	accion: { tipo: string; fecha: string | null } | null,
];

const SEMILLAS: Semilla[] = [
	[
		"Luis Fernando Aguilar",
		"Nissan Frontier",
		"P-201KLM",
		3,
		11900,
		2900,
		0,
		"sin_acuerdo",
		{ tipo: "llamar", fecha: haceHoras(0) },
	],
	[
		"Ana Lucía Morales",
		"Kia Sportage",
		"P-773XYZ",
		2,
		18300,
		3600,
		0,
		"convenio_vigente",
		{ tipo: "promesa_por_vencer", fecha: haceHoras(0) },
	],
	[
		"Roberto Cárcamo",
		"Mazda BT-50",
		"P-559ABC",
		3,
		15400,
		3200,
		3,
		"promesa_incumplida",
		{ tipo: "promesa_vencida", fecha: haceHoras(24) },
	],
	[
		"María José Contreras",
		"Toyota Hilux",
		"P-482GHT",
		2,
		14600,
		3200,
		2,
		"sin_acuerdo",
		{ tipo: "confirmar_pago", fecha: haceHoras(0) },
	],
	[
		"Sergio Ramírez",
		"Toyota Corolla",
		"P-112DEF",
		3,
		9800,
		2400,
		0,
		"convenio_vigente",
		{ tipo: "gestionar_sla", fecha: haceHoras(0) },
	],
];

const ESTADO_MORA = ["al_dia", "mora_30", "mora_60", "mora_90", "mora_120"];

const FILAS_CARTERA: FilaCartera[] = SEMILLAS.map(
	(
		[cliente, vehiculo, placa, bucket, deuda, cuota, intentos, gestion, accion],
		i,
	) => {
		const [marca, modelo] = vehiculo.split(" ");
		return {
			contratoId: String(3000 + i),
			casoCobroId: `caso-${i}`,
			clienteNombre: cliente,
			vehiculoMarca: marca,
			vehiculoModelo: modelo,
			vehiculoYear: 2022,
			vehiculoPlaca: placa,
			estadoContrato: "activo",
			montoFinanciado: (deuda * 10).toFixed(2),
			cuotaMensual: cuota.toFixed(2),
			fechaProximoPago: diaISO(5 - i * 3),
			asesorNombre: NOMBRE,
			estadoMora: ESTADO_MORA[bucket],
			montoEnMora: (deuda * 0.08).toFixed(2),
			diasMoraMaximo: bucket * 30,
			numeroCredito: `0101021411${7600 + i}`,
			etiquetas: null,
			promesaActiva: false,
			bucketNumero: bucket,
			deudaVencida: deuda.toFixed(2),
			seguimiento: {
				intentosSinContacto: intentos,
				ultimoIntentoEn: haceHoras(intentos ? 48 : 24),
				intentadoHoy: false,
				contactadoHoy: i === 1,
				proximaLlamadaEn: null,
			},
			estadoGestion: gestion,
			accionPendiente: accion,
			isPool: false,
		} as unknown as FilaCartera;
	},
);

/* ── Gestiones (historial) ───────────────────────────────────────────────── */

function gestion(
	i: number,
	horas: number,
	cliente: string,
	metodo: string,
	estado: string,
	comentarios: string,
	extra: Partial<FilaHistorialData> = {},
): FilaHistorialData {
	return {
		id: `g-${i}`,
		fechaContacto: haceHoras(horas),
		usuarioId: "u-marta",
		usuarioNombre: NOMBRE,
		usuarioRol: "cobros",
		bucketSnapshot: i % 2 === 0 ? 3 : 2,
		casoCobroId: `caso-${i}`,
		numeroCreditoSifco: `4${8972 - i * 120}`,
		clienteNombre: cliente,
		metodoContacto: metodo,
		estadoContacto: estado,
		comentarios,
		fechaProximoContacto: estado === "promesa_pago" ? haceHoras(-72) : null,
		proximoPaso: null,
		requiereSeguimiento: null,
		estadoPromesa: estado === "promesa_pago" ? "pendiente" : null,
		cuotaInicio: estado === "promesa_pago" ? 5 : null,
		cuotaFin: estado === "promesa_pago" ? 6 : null,
		incluyeMora: null,
		montoComprometido: estado === "promesa_pago" ? "2900.00" : null,
		fechaAlerta: null,
		updatedAt: null,
		origen: "manual",
		fueEditadoManual: false,
		ultimaEdicion: null,
		vecesEditado: 0,
		...extra,
	};
}

const GESTIONES: FilaHistorialData[] = [
	gestion(
		0,
		1,
		"Luis Fernando Aguilar",
		"llamada",
		"promesa_pago",
		"Se comprometió a pagar el viernes.",
	),
	gestion(
		1,
		3,
		"Sofía Marroquín",
		"visita_domicilio",
		"contactado",
		"Sin acuerdo; se reagendó en 3 días.",
	),
	gestion(
		2,
		5,
		"Ana Lucía Ramírez",
		"whatsapp",
		"contactado",
		"Recordatorio de pago enviado.",
		{ fueEditadoManual: true, vecesEditado: 2 },
	),
	gestion(
		3,
		26,
		"Diego Herrera",
		"llamada",
		"no_contesta",
		"Tercer intento sin respuesta.",
	),
	gestion(
		4,
		29,
		"Roberto Cárcamo",
		"llamada",
		"acuerdo_parcial",
		"Abonará la mitad de la cuota esta semana.",
	),
	gestion(
		5,
		52,
		"María José Contreras",
		"sms",
		"contactado",
		"Envío de estado de cuenta.",
		{ origen: "premora" },
	),
];

const RESPUESTA_HISTORIAL: RespuestaHistorial = {
	items: GESTIONES,
	total: GESTIONES.length,
	totalEsAproximado: false,
	page: 1,
	pageSize: 50,
	totalPaginas: 1,
	rangoAplicado: {
		desde: haceHoras(24 * 30),
		hasta: haceHoras(-24),
		esDefault: true,
	},
	verTodos: false,
};

const RESUMEN_HISTORIAL: ResumenHistorial = {
	total: 128,
	efectivos: 91,
	promesas: 23,
	sinContacto: 37,
	conProximaAccion: 44,
	editadas: 3,
	porBucket: [
		{ bucket: 2, cantidad: 71 },
		{ bucket: 3, cantidad: 52 },
		{ bucket: null, cantidad: 5 },
	],
};

const MOVIMIENTOS: MovimientoBucket[] = [
	{
		id: "m-1",
		tipo: "bajada",
		casoCobroId: "caso-7",
		numeroCreditoSifco: "49210",
		bucketAnterior: 3,
		bucket: 2,
		fecha: diaISO(-1),
	},
	{
		id: "m-2",
		tipo: "subida",
		casoCobroId: "caso-8",
		numeroCreditoSifco: "43990",
		bucketAnterior: 2,
		bucket: 3,
		fecha: diaISO(-1),
	},
	{
		id: "m-3",
		tipo: "subida",
		casoCobroId: "caso-9",
		numeroCreditoSifco: "41500",
		bucketAnterior: 3,
		bucket: 4,
		fecha: diaISO(-4),
	},
];

/* ── Agenda ───────────────────────────────────────────────────────────────── */

const FILA_AGENDA: ResumenFila = {
	snapshotId: "s-1",
	asesorId: "u-marta",
	asesorNombre: NOMBRE,
	planificados: 24,
	atendidos: 16,
	pendientes: 8,
	porcentaje: 66.67,
	estado: "cerrado",
	capturadoEn: haceHoras(30),
	cerradoEn: haceHoras(6),
};

const DETALLE_AGENDA: DetalleData = {
	fecha: diaISO(-1),
	asesorId: "u-marta",
	page: 1,
	perPage: 50,
	total: 3,
	totalPages: 1,
	items: [
		{
			id: "d-1",
			numeroCreditoSifco: "01010214117600",
			casoCobroId: "caso-0",
			clienteNombre: "Luis Fernando Aguilar",
			bucketSnapshot: 3,
			motivoAgenda: "sla_hoy",
			atendido: true,
			pendiente: false,
			contactoCobroId: "g-0",
			atendidoEn: haceHoras(28),
			resultadoContacto: "promesa_pago",
			metodoContacto: "llamada",
			comentarios: "Se comprometió a pagar el viernes.",
			promesaCumplida: false,
			promesaContactoCobroId: null,
			promesaCumplidaEn: null,
		},
		{
			id: "d-2",
			numeroCreditoSifco: "01010214117601",
			casoCobroId: "caso-1",
			clienteNombre: "Ana Lucía Morales",
			bucketSnapshot: 2,
			motivoAgenda: "promesa_hoy",
			atendido: false,
			pendiente: false,
			contactoCobroId: null,
			atendidoEn: null,
			resultadoContacto: null,
			metodoContacto: null,
			comentarios: null,
			promesaCumplida: true,
			promesaContactoCobroId: "g-9",
			promesaCumplidaEn: haceHoras(27),
		},
		{
			id: "d-3",
			numeroCreditoSifco: "01010214117602",
			casoCobroId: null,
			clienteNombre: "Roberto Cárcamo",
			bucketSnapshot: 3,
			motivoAgenda: "D-0",
			atendido: false,
			pendiente: true,
			contactoCobroId: null,
			atendidoEn: null,
			resultadoContacto: null,
			metodoContacto: null,
			comentarios: null,
			promesaCumplida: false,
			promesaContactoCobroId: null,
			promesaCumplidaEn: null,
			cubiertoPor: null,
		},
	],
};

/* ── Solicitudes ──────────────────────────────────────────────────────────── */

const SOLICITUDES: FilaSolicitudAsesor[] = [
	{
		id: "s-1",
		fecha: haceHoras(2),
		tipo: "convenio",
		credito: "47120",
		bucket: 2,
		cliente: "María José Contreras",
		estado: "pendiente",
		resultado: "6 cuotas · entrada Q1,500",
		ficha: { id: "47120" },
	},
	{
		id: "s-2",
		fecha: haceHoras(30),
		tipo: "recuperacion",
		credito: "43990",
		bucket: 3,
		cliente: "Sergio Ramírez",
		estado: "aprobada",
		resultado: "Enviado a B4",
		ficha: { id: "43990" },
	},
	{
		id: "s-3",
		fecha: haceHoras(52),
		tipo: "apagado",
		credito: "44870",
		bucket: 3,
		cliente: "Roberto Cárcamo",
		estado: "rechazada",
		resultado: "Falta evidencia de los intentos de contacto",
		ficha: { id: "44870", seccion: "inmovilizacion" },
	},
];

/* ── Props base del Resumen ───────────────────────────────────────────────── */

const RESUMEN: ResumenAsesorVistaProps = {
	nombre: NOMBRE,
	kpis: {
		creditos: 34,
		cumplimiento: { atendidos: 16, planificados: 24, fecha: "6 oct" },
		contactabilidad: { actual: 71, anterior: 75 },
		comparacion: "vs. 7 días previos",
		infoContactabilidad:
			"Contactos efectivos / gestiones registradas en los últimos 7 días.",
	},
	distribucion: {
		segmentos: [
			{ bucket: "B2", cuentas: 24 },
			{ bucket: "B3", cuentas: 10 },
		],
		total: 34,
		pool: "Asesor Senior (B2 y B3)",
	},
	criticos: {
		items: [
			{
				clave: "convenios",
				cantidad: 2,
				etiqueta: "convenios pendientes de aprobación",
				destino: enlacesCriticos(ASESOR_ID).convenios,
			},
			{
				clave: "promesas",
				cantidad: 3,
				etiqueta: "promesas incumplidas",
				destino: enlacesCriticos(ASESOR_ID).promesas,
			},
			{
				clave: "sin_gestion",
				cantidad: 8,
				etiqueta: "sin gestión > 48h",
				destino: enlacesCriticos(ASESOR_ID).sinGestion,
			},
			{
				clave: "proximos_bucket",
				cantidad: null,
				etiqueta: "próximos a subir de bucket",
				pronto: true,
			},
		],
		total: 13,
		verCasos: enlacesAsesor(ASESOR_ID).casos,
	},
	cartera: {
		filas: FILAS_CARTERA,
		total: 34,
		cargando: false,
		error: null,
		buckets: "B2 y B3",
		destino: enlacesAsesor(ASESOR_ID).casos,
		onAbrir: nada,
		onVistaRapida: nada,
	},
	actividad: {
		items: GESTIONES.slice(0, 5),
		cargando: false,
		error: false,
		esSupervisor: true,
		onVerTodo: nada,
		hoy: HOY,
	},
};

const RESUMEN_VACIO: ResumenAsesorVistaProps = {
	...RESUMEN,
	nombre: "Luis Morales",
	kpis: {
		...RESUMEN.kpis,
		creditos: 0,
		cumplimiento: null,
		contactabilidad: { actual: null, anterior: null },
	},
	distribucion: {
		segmentos: [],
		total: 0,
		pool: "Asesor Junior (B0 y B1)",
	},
	criticos: {
		...RESUMEN.criticos,
		items: RESUMEN.criticos.items.map((i) =>
			i.pronto ? i : { ...i, cantidad: 0 },
		),
		total: 0,
	},
	cartera: { ...RESUMEN.cartera, filas: [], total: 0, buckets: "B0 y B1" },
	actividad: { ...RESUMEN.actividad, items: [] },
};

const RESUMEN_CARGANDO: ResumenAsesorVistaProps = {
	...RESUMEN,
	kpis: {
		...RESUMEN.kpis,
		creditos: undefined,
		cumplimiento: undefined,
		contactabilidad: undefined,
	},
	distribucion: undefined,
	criticos: {
		...RESUMEN.criticos,
		items: RESUMEN.criticos.items.map((i) =>
			i.pronto ? i : { ...i, cantidad: undefined },
		),
		total: undefined,
	},
	cartera: { ...RESUMEN.cartera, filas: [], total: null, cargando: true },
	actividad: { ...RESUMEN.actividad, items: [], cargando: true },
};

/* ── Pestañas interactivas ────────────────────────────────────────────────── */

const FILTROS_INICIALES: FiltrosHistorialUI = {
	rangoFechas: undefined,
	usuarioIds: null,
	rol: "todos",
	estadoContacto: "todos",
	metodoContacto: "todos",
	estadoPromesa: "todos",
	busquedaSifco: "",
	incluirAutomaticos: false,
	buckets: null,
};

function ActividadDemo({
	vacio = false,
	nombre = NOMBRE,
}: {
	vacio?: boolean;
	nombre?: string;
}) {
	const [filtros, setFiltros] = React.useState(FILTROS_INICIALES);
	const [categoria, setCategoria] = React.useState<CategoriaActividad>("todas");
	const [vista, setVista] = React.useState<"tabla" | "linea">("linea");
	const datos = vacio
		? { ...RESPUESTA_HISTORIAL, items: [], total: 0, totalPaginas: 1 }
		: RESPUESTA_HISTORIAL;
	return (
		<HistorialGestionesVista
			encabezado={{
				tipo: "seccion",
				titulo: `Historial de actividad de ${nombre}`,
				descripcion:
					"Todo lo que ha trabajado el asesor · más reciente primero",
			}}
			esSupervisor
			mostrarFiltrosEquipo={false}
			usuarios={[]}
			filtros={filtros}
			onFiltros={(c) => setFiltros((f) => ({ ...f, ...c }))}
			filtrosActivos={categoria === "todas" ? 0 : 1}
			onLimpiar={() => {
				setFiltros(FILTROS_INICIALES);
				setCategoria("todas");
			}}
			catalogo={undefined}
			bucketsChips={vacio ? [] : RESUMEN_HISTORIAL.porBucket}
			resumen={{
				datos: vacio
					? {
							...RESUMEN_HISTORIAL,
							total: 0,
							efectivos: 0,
							promesas: 0,
							sinContacto: 0,
							conProximaAccion: 0,
							editadas: 0,
							porBucket: [],
						}
					: RESUMEN_HISTORIAL,
				cargando: false,
				error: false,
			}}
			listado={{ datos, cargando: false, error: false, actualizando: false }}
			page={1}
			pageSize={50}
			hayMasPaginas={false}
			onPage={nada}
			onPageSize={nada}
			exportacion={{
				exportando: false,
				deshabilitada: categoria === "cambios_bucket" || vacio,
				motivo:
					categoria === "cambios_bucket"
						? "La exportación es del historial de gestiones. Elija otra categoría para exportar."
						: undefined,
				onExportar: nada,
			}}
			categorias={{ activa: categoria, onCambiar: setCategoria }}
			vistaLista={{ valor: vista, onCambiar: setVista }}
			contenidoAlterno={
				categoria === "cambios_bucket" ? (
					<CambiosBucketVista
						movimientos={vacio ? [] : MOVIMIENTOS}
						cargando={false}
						error={false}
						vista={vista}
						hoy={HOY}
					/>
				) : undefined
			}
			hoy={HOY}
		/>
	);
}

function AgendaDemo({
	vacio = false,
	nombre = NOMBRE,
}: {
	vacio?: boolean;
	nombre?: string;
}) {
	const [fecha, setFecha] = React.useState(diaISO(-1));
	return (
		<CumplimientoAgendaAsesorVista
			nombre={nombre}
			fecha={fecha}
			hoy={HOY}
			onFecha={setFecha}
			cargando={false}
			error={null}
			agenda={
				vacio
					? { tipo: "sin_evaluar" }
					: fecha === HOY
						? { tipo: "en_curso" }
						: {
								tipo: "metricas",
								fila: FILA_AGENDA,
								detalle: (
									<DetalleAgendaVista
										datos={DETALLE_AGENDA}
										cargando={false}
										error={false}
										page={1}
										onPage={nada}
									/>
								),
							}
			}
			gestiones={
				<GestionesDelDiaVista
					fecha={fecha}
					asesorNombre={nombre}
					items={
						vacio
							? []
							: GESTIONES.slice(0, 3).map((g, i) => ({
									...g,
									enAgenda: i !== 1,
									enAgendaDeTitular: null,
								}))
					}
					cargando={false}
					error={false}
					page={1}
					totalPaginas={1}
					onPage={nada}
					catalogo={undefined}
					esSupervisor
				/>
			}
		/>
	);
}

function SolicitudesDemo({
	vacio = false,
	nombre = NOMBRE,
}: {
	vacio?: boolean;
	nombre?: string;
}) {
	return (
		<SolicitudesDeAsesorVista
			nombre={nombre}
			filas={vacio ? [] : SOLICITUDES}
			cargando={false}
			error={false}
			onReintentar={nada}
		/>
	);
}

function DetalleDemo({
	asesor = ASESOR,
	inicial = "resumen",
	vacio = false,
}: {
	asesor?: AsesorEncabezado;
	inicial?: TabDetalle;
	vacio?: boolean;
}) {
	const [tab, setTab] = React.useState<TabDetalle>(inicial);
	return (
		<DetalleAsesorVista
			asesorId={asesor.asesorId}
			carga={{ tipo: "listo", asesor }}
			asesores={ASESORES}
			onCambiarAsesor={nada}
			tab={tab}
			onTab={setTab}
			contenido={{
				resumen: <ResumenAsesorVista {...(vacio ? RESUMEN_VACIO : RESUMEN)} />,
				agenda: <AgendaDemo vacio={vacio} nombre={asesor.nombre} />,
				actividad: <ActividadDemo vacio={vacio} nombre={asesor.nombre} />,
				solicitudes: <SolicitudesDemo vacio={vacio} nombre={asesor.nombre} />,
			}}
		/>
	);
}

const SIN_USUARIO = (
	<EmptyState
		variant="no-data"
		title="Sin usuario del CRM"
		description="Este asesor no tiene un usuario del CRM vinculado a su correo de Cash-In, así que no se pueden consultar sus gestiones ni su agenda."
	/>
);

export default function Showcase() {
	return (
		<div className="space-y-8">
			<ShowcaseGroup title="Detalle del asesor (pestañas Resumen, Agenda, Actividad y Solicitudes)">
				<div className="-mx-4 rounded-2xl bg-canvas py-2">
					<DetalleDemo />
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Pestaña Agenda (navegación por día)">
				<div className="-mx-4 rounded-2xl bg-canvas py-2">
					<DetalleDemo inicial="agenda" />
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Pestaña Actividad (chips del Figma; «Cambios de bucket» desde el cierre)">
				<div className="-mx-4 rounded-2xl bg-canvas py-2">
					<DetalleDemo inicial="actividad" />
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Pestaña Solicitudes">
				<div className="-mx-4 rounded-2xl bg-canvas py-2">
					<DetalleDemo inicial="solicitudes" />
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Ausente (con el Resumen cargando)">
				<div className="-mx-4 rounded-2xl bg-canvas py-2">
					<DetalleAsesorVista
						asesorId={ASESOR_ID}
						carga={{
							tipo: "listo",
							asesor: {
								...ASESOR,
								estado: "ausente",
								ausencia: "Ausente · Vacaciones · vuelve el 14 oct",
							},
						}}
						asesores={ASESORES}
						onCambiarAsesor={nada}
						tab="resumen"
						onTab={nada}
						contenido={{
							resumen: <ResumenAsesorVista {...RESUMEN_CARGANDO} />,
							agenda: null,
							actividad: null,
							solicitudes: null,
						}}
					/>
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Vacío (asesor sin cartera ni gestiones)">
				<div className="-mx-4 rounded-2xl bg-canvas py-2">
					<DetalleDemo
						vacio
						asesor={{
							asesorId: 15,
							nombre: "Luis Morales",
							nivel: "junior",
							estado: "al_dia",
						}}
					/>
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Sin usuario del CRM">
				<div className="-mx-4 rounded-2xl bg-canvas py-2">
					<DetalleAsesorVista
						asesorId={ASESOR_ID}
						carga={{ tipo: "listo", asesor: { ...ASESOR, estado: "al_dia" } }}
						asesores={ASESORES}
						onCambiarAsesor={nada}
						tab="agenda"
						onTab={nada}
						avisos={[
							"Este asesor no tiene un usuario del CRM vinculado a su correo de Cash-In: su agenda, su historial y su contactabilidad no se pueden consultar.",
						]}
						contenido={{
							resumen: null,
							agenda: SIN_USUARIO,
							actividad: SIN_USUARIO,
							solicitudes: null,
						}}
					/>
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Cargando y error">
				<div className="-mx-4 space-y-6 rounded-2xl bg-canvas py-2">
					<DetalleAsesorVista
						asesorId={ASESOR_ID}
						carga={{ tipo: "cargando" }}
						asesores={ASESORES}
						onCambiarAsesor={nada}
						tab="resumen"
						onTab={nada}
						contenido={{
							resumen: null,
							agenda: null,
							actividad: null,
							solicitudes: null,
						}}
					/>
					<DetalleAsesorVista
						asesorId={99}
						carga={{
							tipo: "error",
							titulo: "Asesor no encontrado",
							descripcion:
								"No hay un asesor con el número 99 en el pool de cartera. Elija otro asesor o vuelva a Mi equipo.",
						}}
						asesores={ASESORES}
						onCambiarAsesor={nada}
						tab="resumen"
						onTab={nada}
						contenido={{
							resumen: null,
							agenda: null,
							actividad: null,
							solicitudes: null,
						}}
					/>
					<DetalleAsesorVista
						asesorId={ASESOR_ID}
						carga={{
							tipo: "error",
							titulo: "No se pudo cargar el catálogo de asesores",
							descripcion:
								"Sin el catálogo no se puede saber quién es este asesor. Intente de nuevo en unos segundos.",
							onReintentar: nada,
						}}
						asesores={[]}
						onCambiarAsesor={nada}
						tab="resumen"
						onTab={nada}
						contenido={{
							resumen: null,
							agenda: null,
							actividad: null,
							solicitudes: null,
						}}
					/>
				</div>
			</ShowcaseGroup>
		</div>
	);
}
