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
	type FilaEquipo,
} from "@/components/cobros/supervision/equipo-tabla";
import type { Periodo } from "@/components/cobros/supervision/formato";
import { LinksPago } from "@/components/cobros/supervision/links-pago";
import { PendientesHoy } from "@/components/cobros/supervision/pendientes-hoy";
import type { Bucket } from "@/components/ds/badges";
import { ShowcaseGroup, type ShowcaseMeta } from "./_layout";

export const meta: ShowcaseMeta = {
	order: 305,
	title: "Cobros · Dashboard del supervisor",
	figma: "CRM Ventas › Supervisor › Dashboard · Supervisor (1954:14)",
	description:
		"DashboardSupervisorVista (components/cobros/supervision) con datos de ejemplo: encabezado, Sus pendientes de hoy (con Tareas B3), Desempeño del equipo, Links de pago, Aprobaciones pendientes, Cartera del equipo por bucket, y Equipo. Estados: hoy (stubs S1–S4 en «—»), con el backend de José completo, cargando, vacío y error.",
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
		tipo: "convenio",
		cliente: "Marvin Castillo",
		credito: "01010214146980",
		asesor: "M. Gómez",
		solicitadoEn: haceMin(40),
		destino: { to: "/cobros/solicitudes", search: { tipo: "convenio" } },
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
];

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

const EQUIPO: FilaEquipo[] = [
	["L. Morales", 92, 86, null],
	["J. Pérez", 78, 71, null],
	["C. Ramírez", 84, 54, "Vacaciones"],
	["A. Díaz", 58, 81, null],
].map(([nombre, casos, agenda, ausencia], i) => ({
	asesorId: i + 1,
	nombre: nombre as string,
	casos: casos as number,
	contactosHoy: null,
	meta: null,
	rescate: null,
	agenda: agenda as number,
	ausencia: ausencia as string | null,
	estado:
		(agenda as number) >= 80
			? "bien"
			: (agenda as number) >= 60
				? "atencion"
				: "riesgo",
	destino: { to: `/cobros/equipo/${i + 1}` },
}));

/** Lo mismo con S4 (contactos hoy, meta y rescate) como llegará del backend. */
const EQUIPO_S4: FilaEquipo[] = EQUIPO.map((f, i) => ({
	...f,
	contactosHoy: [24, 15, 9, 19][i],
	meta: [88, 71, 54, 81][i],
	rescate: [74, 66, 51, 70][i],
	estado: (["bien", "atencion", "riesgo", "bien"] as const)[i],
}));

const ITEMS_HOY = [
	{
		clave: "aprobaciones",
		icono: ClipboardCheck,
		tono: "neutral" as const,
		valor: 8,
		etiqueta: "Aprobaciones pendientes",
		info: "Convenios de pago por aprobar, solicitudes de recuperación del vehículo y de apagado o reactivación.",
	},
	{
		clave: "rebajas",
		icono: BadgePercent,
		tono: "neutral" as const,
		valor: null,
		etiqueta: "Rebajas de mora por revisar",
		pronto: true,
	},
	{
		clave: "documentos",
		icono: FileWarning,
		tono: "danger" as const,
		valor: null,
		etiqueta: "Documentos por autorizar",
		pronto: true,
	},
	{
		clave: "sin_contacto",
		icono: PhoneOff,
		tono: "warning" as const,
		valor: 6,
		etiqueta: "Sin contacto > 5 días (equipo)",
		info: "Créditos del equipo sin contacto en más de 5 días (criterio de la cola del día). El conteo de más de 3 días hábiles del diseño está pendiente.",
		destino: cartera({ cola: "sin_contacto" }),
	},
	{
		clave: "prejuridico",
		icono: Gavel,
		tono: "warning" as const,
		valor: null,
		etiqueta: "Listos para pasar a Prejurídico",
		pronto: true,
	},
	{
		clave: "ausentes",
		icono: UserX,
		tono: "danger" as const,
		valor: 1,
		etiqueta: "Asesores ausentes",
		info: "Asesores con una cobertura vigente hoy (vacaciones o permiso).",
		destino: {
			to: "/cobros/equipo",
			search: { tab: "asignacion", seccion: "coberturas" },
		},
	},
];

/** Cómo se verá con S1/S2 completos. */
const ITEMS_S1 = ITEMS_HOY.map((i) => {
	switch (i.clave) {
		case "rebajas":
			return { ...i, valor: 3, pronto: false };
		case "documentos":
			return { ...i, valor: 5, pronto: false };
		case "prejuridico":
			return { ...i, valor: 2, pronto: false };
		case "sin_contacto":
			return {
				...i,
				etiqueta: "Sin contacto > 3 días (equipo)",
				info: undefined,
			};
		default:
			return i;
	}
});

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
		aprobaciones: { pendientes: 8, resueltasHoy: null },
		cargando: false,
		tareas: <TareasEjemplo />,
	},
	desempeno: {
		periodo: "dia",
		onPeriodo: nada,
		recuperacion: null,
		cuentasCuradas: null,
		promesas: null,
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
		total: 8,
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

/** Normal (hoy, con los stubs en «—»): segmentado Día / Semana / Mes interactivo. */
function DemoInteractivo() {
	const [periodo, setPeriodo] = useState<Periodo>("dia");
	return (
		<DashboardSupervisorVista
			{...BASE}
			desempeno={{ ...BASE.desempeno, periodo, onPeriodo: setPeriodo }}
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
			<ShowcaseGroup title="Hoy: stubs S1–S4 en «—» y «Pronto» (interactivo)">
				<Marco>
					<DemoInteractivo />
				</Marco>
			</ShowcaseGroup>

			<ShowcaseGroup title="Con el backend de José (S1–S4) completo">
				<div className="space-y-6 py-4">
					<PendientesHoy
						items={ITEMS_S1}
						aprobaciones={{ pendientes: 8, resueltasHoy: 6 }}
						cargando={false}
					/>
					<DesempenoEquipo
						{...BASE.desempeno}
						recuperacion={{
							monto: 142_000,
							meta: 180_000,
							montoAnterior: 136_300,
						}}
						cuentasCuradas={{ curadas: 48, total: 70, curadasAnterior: 40 }}
						promesas={{ cumplidas: 38, pactadas: 50, montoIncumplido: 28_000 }}
					/>
					<EquipoTabla {...BASE.equipo} filas={EQUIPO_S4} />
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
