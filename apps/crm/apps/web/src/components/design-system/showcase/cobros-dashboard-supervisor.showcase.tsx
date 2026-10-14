import {
	BadgePercent,
	ClipboardCheck,
	FileWarning,
	Gavel,
	PhoneOff,
	UserX,
} from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import type { FilaAprobacion } from "@/components/cobros/supervision/aprobaciones-pendientes";
import { AprobacionesPendientes } from "@/components/cobros/supervision/aprobaciones-pendientes";
import { CarteraEquipoBucket } from "@/components/cobros/supervision/cartera-equipo-bucket";
import {
	DashboardSupervisorVista,
	type DashboardSupervisorVistaProps,
} from "@/components/cobros/supervision/dashboard-supervisor-vista";
import { DesempenoEquipo } from "@/components/cobros/supervision/desempeno-equipo";
import {
	EquipoTabla,
	estadoDelAsesor,
	type FilaEquipo,
} from "@/components/cobros/supervision/equipo-tabla";
import type { Periodo } from "@/components/cobros/supervision/formato";
import { LinksPago } from "@/components/cobros/supervision/links-pago";
import {
	type ItemPendiente,
	PendientesHoy,
} from "@/components/cobros/supervision/pendientes-hoy";
import type { Bucket } from "@/components/ds/badges";
import { ShowcaseGroup, type ShowcaseMeta } from "./_layout";

export const meta: ShowcaseMeta = {
	order: 305,
	title: "Cobros · Dashboard del supervisor",
	figma: "CRM Ventas › Supervisor › Dashboard · Supervisor (1954:14)",
	description:
		"DashboardSupervisorVista (components/cobros/supervision) con datos de ejemplo: encabezado, Sus pendientes de hoy (con Tareas B3), Desempeño del equipo, Links de pago, Aprobaciones pendientes (con rebajas, documentos y Jurídico), Cartera del equipo por bucket, y Equipo. Estados: completo (interactivo, con el cambio de período), actualizando el período, fuentes caídas («—»), cargando, vacío y error.",
};

/* ── Datos de ejemplo ─────────────────────────────────────────────────────── */

const AHORA = new Date();
const haceMin = (min: number) =>
	new Date(AHORA.getTime() - min * 60_000).toISOString();
const nada = () => {};
const cartera = (search?: Record<string, string>) => ({
	to: "/cobros/cartera",
	search,
});

const APROBACIONES: FilaAprobacion[] = [
	{
		id: "1",
		tipo: "recuperacion",
		cliente: "Roberto Cárcamo",
		credito: "01010214147120",
		asesor: "A. Díaz",
		solicitadoEn: haceMin(60 * 50),
		destino: { to: "/cobros/solicitudes", search: { tipo: "recuperacion" } },
	},
	{
		id: "2",
		tipo: "apagado",
		cliente: "Ana Lucía Morales",
		credito: "01010214147730",
		asesor: "C. Ramírez",
		solicitadoEn: haceMin(60 * 26),
		destino: { to: "/cobros/solicitudes" },
	},
	{
		id: "3",
		tipo: "reactivacion",
		cliente: "María José Contreras",
		credito: "01010214148972",
		asesor: "L. Morales",
		solicitadoEn: haceMin(60 * 5),
		destino: { to: "/cobros/solicitudes" },
	},
	{
		id: "4",
		tipo: "convenio",
		cliente: "Luis Fernando Aguilar",
		credito: "01010214148215",
		asesor: "J. Pérez",
		solicitadoEn: haceMin(60 * 3),
		destino: { to: "/cobros/solicitudes", search: { tipo: "convenio" } },
	},
	{
		id: "5",
		tipo: "juridico",
		cliente: "Carlos Enrique Batres",
		credito: "01010214145510",
		asesor: "J. Pérez",
		solicitadoEn: haceMin(60 * 2),
		destino: { to: "/cobros/solicitudes", search: { tipo: "juridico" } },
	},
	{
		id: "6",
		tipo: "rebaja",
		cliente: "Marvin Castillo",
		credito: "01010214146980",
		asesor: "M. Gómez",
		solicitadoEn: haceMin(70),
		destino: { to: "/cobros/solicitudes", search: { tipo: "rebaja" } },
	},
	{
		id: "7",
		tipo: "documentos",
		cliente: "Estado de cuenta",
		credito: "01010214147730",
		asesor: "C. Ramírez",
		solicitadoEn: haceMin(40),
		destino: { to: "/cobros/solicitudes", search: { tipo: "documentos" } },
	},
];

const BANDEJAS = [
	{
		clave: "convenios",
		etiqueta: "Convenios",
		cantidad: 5,
		destino: { to: "/cobros/solicitudes", search: { tipo: "convenio" } },
	},
	{
		clave: "recuperaciones",
		etiqueta: "Recuperación del vehículo",
		cantidad: 1,
		destino: { to: "/cobros/solicitudes", search: { tipo: "recuperacion" } },
	},
	{
		clave: "inmovilizaciones",
		etiqueta: "Apagado y reactivación",
		cantidad: 2,
		destino: { to: "/cobros/solicitudes" },
	},
	{
		clave: "rebajas",
		etiqueta: "Rebaja de mora",
		cantidad: 3,
		destino: { to: "/cobros/solicitudes", search: { tipo: "rebaja" } },
	},
	{
		clave: "documentos",
		etiqueta: "Documentos",
		cantidad: 5,
		destino: { to: "/cobros/solicitudes", search: { tipo: "documentos" } },
	},
	{
		clave: "juridico",
		etiqueta: "Jurídico",
		cantidad: 1,
		destino: { to: "/cobros/solicitudes", search: { tipo: "juridico" } },
	},
];
/** Convenios 5 + recuperación 1 + apagados 2 + rebajas 3 + documentos 5 + Jurídico 1. */
const TOTAL_APROBACIONES = BANDEJAS.reduce((t, b) => t + (b.cantidad ?? 0), 0);

const CUENTAS: [Bucket, number][] = [
	["B0", 128],
	["B1", 84],
	["B2", 50],
	["B3", 34],
	["B4", 16],
];
const TOTAL_CUENTAS = CUENTAS.reduce((t, [, n]) => t + n, 0);
const SEGMENTOS = CUENTAS.map(([bucket, cuentas]) => ({
	bucket,
	cuentas,
	porcentaje: (cuentas / TOTAL_CUENTAS) * 100,
	destino: cartera({ bucket }),
}));

/**
 * El punto de estado sale de `estadoDelAsesor`, el mismo criterio de la
 * pantalla: la Meta del período y, sin meta, la Agenda (S. Juárez no tiene
 * meta: su punto sale de la agenda). Rivas no tiene ninguno: gris.
 */
const EQUIPO: FilaEquipo[] = (
	[
		["L. Morales", 92, 24, 88, 74, 86, null],
		["J. Pérez", 78, 15, 71, 66, 71, null],
		["C. Ramírez", 84, 9, 54, 51, 54, "Vacaciones"],
		["A. Díaz", 58, 19, 81, 100, 81, null],
		["S. Juárez", 40, 12, null, null, 64, null],
		["K. Rivas", 12, null, null, null, null, null],
	] as const
).map(([nombre, casos, contactosHoy, meta, rescate, agenda, ausencia], i) => ({
	asesorId: i + 1,
	nombre,
	casos,
	contactosHoy,
	meta,
	rescate,
	agenda,
	ausencia,
	estado: estadoDelAsesor({ meta, agenda }),
	destino: { to: `/cobros/equipo/${i + 1}` },
}));

const ITEMS_HOY: ItemPendiente[] = [
	{
		clave: "aprobaciones",
		icono: ClipboardCheck,
		tono: "neutral",
		valor: TOTAL_APROBACIONES,
		etiqueta: "Aprobaciones pendientes",
		info: "Convenios de pago por aprobar, solicitudes de recuperación del vehículo, de apagado o reactivación, rebajas de mora, documentos y escalados a Jurídico.",
	},
	{
		clave: "rebajas",
		icono: BadgePercent,
		tono: "neutral",
		valor: 3,
		etiqueta: "Rebajas de mora por revisar",
		info: "Solicitudes de rebaja de mora pendientes o que no se pudieron aplicar y esperan su decisión.",
		destino: { to: "/cobros/solicitudes", search: { tipo: "rebaja" } },
	},
	{
		clave: "documentos",
		icono: FileWarning,
		tono: "danger",
		valor: 5,
		etiqueta: "Documentos por autorizar",
		destino: { to: "/cobros/solicitudes", search: { tipo: "documentos" } },
	},
	{
		clave: "sin_contacto",
		icono: PhoneOff,
		tono: "warning",
		valor: 6,
		etiqueta: "Sin contacto en 3 días hábiles (equipo)",
		info: "Créditos del equipo sin gestión manual en al menos 3 días hábiles completos. No cuentan los envíos automáticos ni los links de pago. Es el mismo criterio de la cola del día.",
		destino: cartera({ cola: "sin_contacto" }),
	},
	{
		clave: "prejuridico",
		icono: Gavel,
		tono: "warning",
		valor: 2,
		etiqueta: "Listos para pasar a Prejurídico",
		info: "Créditos del equipo en B3, activos o morosos y sin promesa vigente, cuya 4.ª cuota vence en 7 días o menos.",
	},
	{
		clave: "ausentes",
		icono: UserX,
		tono: "danger",
		valor: 1,
		etiqueta: "Asesores ausentes",
		info: "Asesores con una cobertura vigente hoy (vacaciones o permiso).",
		destino: {
			to: "/cobros/equipo",
			search: { tab: "asignacion", seccion: "coberturas" },
		},
	},
];

/** Una fuente del servidor no respondió: su conteo llega `null` («—»). */
const ITEMS_SIN_FUENTE = ITEMS_HOY.map((i) =>
	i.clave === "rebajas" || i.clave === "prejuridico"
		? { ...i, valor: null }
		: i,
);

/** Tareas B3: en la pantalla real es MisTareasB3 (consulta propia). */
function TareasEjemplo() {
	return (
		<div className="flex flex-col gap-2 border-brand/20 border-t pt-3">
			<span className="type-label-base text-fg">Mis tareas · 2</span>
			<p className="type-caption text-fg-secondary">
				Aquí se muestran las Tareas B3 del supervisor (MisTareasB3): llamadas
				por ingreso a B3, vencidas primero, con «Ver caso».
			</p>
		</div>
	);
}

const BASE: DashboardSupervisorVistaProps = {
	encabezado: {
		saludo: "Buen día",
		primerNombre: "Andrea",
		reporteria: { to: "/cobros/reportes" },
		carteraGeneral: cartera(),
	},
	pendientes: {
		items: ITEMS_HOY,
		// Resueltas hoy = aprobacionesResueltasHoy + otrasResueltasHoy.
		aprobaciones: { pendientes: TOTAL_APROBACIONES, resueltasHoy: 6 },
		cargando: false,
		tareas: <TareasEjemplo />,
	},
	desempeno: {
		periodo: "dia",
		onPeriodo: nada,
		recuperacion: { monto: 142_000, meta: 180_000, montoAnterior: 136_300 },
		cuentasCuradas: { curadas: 48, total: 70, curadasAnterior: 40 },
		promesas: { cumplidas: 38, pactadas: 50, montoIncumplido: 28_000 },
		contactabilidad: { efectivos: 168, total: 200, porcentajeAnterior: 78 },
		migracion: { bajaron: 8, subieron: 2 },
	},
	links: {
		pendientes: 46,
		vencidos: 14,
		verTodos: { to: "/cobros/pagalo" },
	},
	aprobaciones: {
		filas: APROBACIONES,
		total: TOTAL_APROBACIONES,
		cargando: false,
		error: false,
		onReintentar: nada,
		verTodas: { to: "/cobros/solicitudes" },
		bandejas: BANDEJAS,
		ahora: AHORA,
	},
	cartera: {
		segmentos: SEGMENTOS,
		total: TOTAL_CUENTAS,
		cargando: false,
		error: false,
		onReintentar: nada,
		verCartera: cartera(),
	},
	equipo: {
		filas: EQUIPO,
		cargando: false,
		error: false,
		onReintentar: nada,
		verEquipo: { to: "/cobros/equipo" },
		fechaAgenda: "06/10/2026",
	},
};

/**
 * Completo e interactivo: al cambiar Día / Semana / Mes, las tarjetas y la tabla
 * se atenúan con el spinner mientras «llega» el período nuevo (en la pantalla
 * real, `isPlaceholderData` de las consultas con `keepPreviousData`).
 */
function DemoInteractivo() {
	const [periodo, setPeriodo] = useState<Periodo>("dia");
	const [actualizando, setActualizando] = useState(false);
	const cambiar = (p: Periodo) => {
		setPeriodo(p);
		setActualizando(true);
		window.setTimeout(() => setActualizando(false), 1200);
	};
	return (
		<DashboardSupervisorVista
			{...BASE}
			desempeno={{
				...BASE.desempeno,
				periodo,
				onPeriodo: cambiar,
				actualizando,
			}}
			equipo={{ ...BASE.equipo, actualizando }}
		/>
	);
}

function Marco({ children }: { children: React.ReactNode }) {
	return (
		<div className="overflow-hidden rounded-2xl border border-line-subtle bg-canvas">
			{children}
		</div>
	);
}

export default function CobrosDashboardSupervisorShowcase() {
	return (
		<div className="space-y-8">
			<ShowcaseGroup title="Completo (interactivo: cambie el período)">
				<Marco>
					<DemoInteractivo />
				</Marco>
			</ShowcaseGroup>

			<ShowcaseGroup title="Actualizando el período (muestra el anterior atenuado)">
				<div className="space-y-6 py-4">
					<DesempenoEquipo {...BASE.desempeno} periodo="semana" actualizando />
					<EquipoTabla {...BASE.equipo} actualizando />
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Fuentes caídas: el servidor manda null y se ve «—»">
				<div className="space-y-6 py-4">
					<PendientesHoy
						items={ITEMS_SIN_FUENTE}
						aprobaciones={{
							pendientes: TOTAL_APROBACIONES,
							resueltasHoy: null,
						}}
						cargando={false}
					/>
					<DesempenoEquipo
						{...BASE.desempeno}
						recuperacion={null}
						cuentasCuradas={null}
						promesas={null}
					/>
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Cargando (cada bloque por su cuenta)">
				<div className="space-y-6 py-4">
					<PendientesHoy
						items={[]}
						aprobaciones={{ pendientes: null, resueltasHoy: null }}
						cargando
					/>
					<DesempenoEquipo
						{...BASE.desempeno}
						recuperacion={undefined}
						cuentasCuradas={undefined}
						promesas={undefined}
						contactabilidad={undefined}
						migracion={undefined}
					/>
					<LinksPago
						{...BASE.links}
						pendientes={undefined}
						vencidos={undefined}
					/>
					<div className="grid gap-5 lg:grid-cols-2">
						<AprobacionesPendientes
							{...BASE.aprobaciones}
							filas={[]}
							total={0}
							cargando
						/>
						<EquipoTabla {...BASE.equipo} filas={[]} cargando />
					</div>
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Vacío y error">
				<div className="grid gap-5 py-4 lg:grid-cols-2">
					<AprobacionesPendientes {...BASE.aprobaciones} filas={[]} total={0} />
					<CarteraEquipoBucket
						{...BASE.cartera}
						segmentos={[]}
						total={0}
						error
					/>
					<EquipoTabla {...BASE.equipo} filas={[]} error />
					<LinksPago {...BASE.links} error />
				</div>
			</ShowcaseGroup>
		</div>
	);
}
