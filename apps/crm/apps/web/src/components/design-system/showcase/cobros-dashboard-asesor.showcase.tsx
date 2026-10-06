import type * as React from "react";
import { useState } from "react";
import {
	AgendaHoy,
	type AgendaHoyProps,
	type ClaveFiltro,
} from "@/components/cobros/asesor/agenda-hoy";
import {
	CasosAtencion,
	type CasosAtencionProps,
	type FilaAtencion,
} from "@/components/cobros/asesor/casos-atencion";
import {
	DashboardAsesorVista,
	type DashboardAsesorVistaProps,
} from "@/components/cobros/asesor/dashboard-asesor-vista";
import type {
	FilaCartera,
	FilaCola,
} from "@/components/cobros/asesor/fila-cartera";
import {
	type DesempenoVista,
	MiDesempeno,
	type MiDesempenoProps,
} from "@/components/cobros/asesor/mi-desempeno";
import { ShowcaseGroup, type ShowcaseMeta } from "./_layout";

export const meta: ShowcaseMeta = {
	order: 300,
	title: "Cobros · Dashboard del asesor",
	figma: "CRM Ventas › Asesor Junior › 01 · Dashboard (Semana · Mes · Dark)",
	description:
		"DashboardAsesorVista (components/cobros/asesor) con datos de ejemplo: encabezado, Agenda de hoy, Mi desempeño, Distribución de mi cartera y Casos que requieren atención hoy. Estados: normal, cargando, vacío (Todo al día), filtro sin resultados, sin asesor, ausente y error.",
};

/* ── Datos de ejemplo ─────────────────────────────────────────────────────── */

const hoy = new Date();
const iso = (dias: number) => {
	const d = new Date(hoy);
	d.setDate(d.getDate() + dias);
	return d.toISOString().slice(0, 10);
};

type Ejemplo = {
	sifco: string;
	cliente: string;
	marca: string;
	modelo: string;
	placa: string;
	bucket: number;
	deuda: number;
	cuota: number;
	fecha: number;
	intentos: number;
	contactadoHoy?: boolean;
	estadoGestion: string;
	accion: { tipo: string; fecha: string | null } | null;
	cubierto?: string;
	flags: Partial<
		Record<
			| "slaHoy"
			| "promesaHoy"
			| "venceHoy"
			| "incumplida"
			| "promesaProxima"
			| "sinContacto",
			boolean
		>
	>;
};

const EJEMPLOS: Ejemplo[] = [
	{
		sifco: "01010214117590",
		cliente: "María José Contreras",
		marca: "Toyota",
		modelo: "Hilux",
		placa: "P-482GHT",
		bucket: 1,
		deuda: 48250,
		cuota: 3200,
		fecha: -5,
		intentos: 3,
		estadoGestion: "sin_acuerdo",
		accion: { tipo: "llamar", fecha: `${iso(0)}T15:00:00` },
		flags: { slaHoy: true, sinContacto: true },
	},
	{
		sifco: "01010214117591",
		cliente: "Luis Fernando Aguilar",
		marca: "Nissan",
		modelo: "Frontier",
		placa: "P-201KLM",
		bucket: 1,
		deuda: 31800,
		cuota: 2900,
		fecha: -15,
		intentos: 2,
		estadoGestion: "promesa_incumplida",
		accion: { tipo: "promesa_por_vencer", fecha: iso(0) },
		flags: { promesaHoy: true },
		cubierto: "Andrea Solís",
	},
	{
		sifco: "01010214117592",
		cliente: "Ana Lucía Morales",
		marca: "Kia",
		modelo: "Sportage",
		placa: "P-773XYZ",
		bucket: 1,
		deuda: 18400,
		cuota: 3600,
		fecha: -23,
		intentos: 1,
		estadoGestion: "promesa_vigente",
		accion: { tipo: "promesa_vencida", fecha: iso(-1) },
		flags: { incumplida: true },
	},
	{
		sifco: "01010214117593",
		cliente: "Roberto Cárcamo",
		marca: "Mazda",
		modelo: "BT-50",
		placa: "P-559ABC",
		bucket: 1,
		deuda: 67120,
		cuota: 3200,
		fecha: 3,
		intentos: 0,
		estadoGestion: "sin_acuerdo",
		accion: { tipo: "confirmar_pago", fecha: iso(0) },
		flags: { venceHoy: true },
	},
];

const ESTADO_MORA = ["al_dia", "mora_30", "mora_60", "mora_90", "mora_120"];

function filaCola(e: Ejemplo, i: number): FilaCola {
	return {
		creditoId: 1000 + i,
		numeroCreditoSifco: e.sifco,
		cliente: e.cliente,
		asesorId: 7,
		asesor: e.cubierto ?? "Carlos Ramírez",
		cubierto: !!e.cubierto,
		suplente: null,
		bucket: e.bucket,
		bucketPrefijo: `B${e.bucket}`,
		bucketNombre: "Alerta Temprana",
		fechaLimiteSla: iso(0),
		fechaPromesa: e.flags.promesaHoy ? iso(0) : null,
		telefono: "5555-1234",
		casoId: `caso-${i}`,
		vehiculoMarca: e.marca,
		vehiculoModelo: e.modelo,
		vehiculoYear: 2021,
		vehiculoPlaca: e.placa,
		slaHoy: !!e.flags.slaHoy,
		promesaHoy: !!e.flags.promesaHoy,
		venceHoy: !!e.flags.venceHoy,
		montoCuotaHoy: String(e.cuota),
		incumplida: !!e.flags.incumplida,
		promesaProxima: !!e.flags.promesaProxima,
		promesaActiva: false,
		sinContacto: !!e.flags.sinContacto,
		diasSinContacto: e.flags.sinContacto ? 4 : null,
		seguimiento: {
			intentosSinContacto: e.intentos,
			ultimoIntentoEn: e.intentos > 0 ? `${iso(-2)}T10:00:00` : null,
			intentadoHoy: false,
			contactadoHoy: !!e.contactadoHoy,
			proximaLlamadaEn: null,
		},
		estadoGestion: e.estadoGestion,
		accionPendiente: e.accion,
	} as unknown as FilaCola;
}

function filaCartera(e: Ejemplo, i: number): FilaCartera {
	return {
		contratoId: `contrato-${i}`,
		casoCobroId: `caso-${i}`,
		numeroCredito: e.sifco,
		clienteNombre: e.cliente,
		estadoMora: ESTADO_MORA[e.bucket],
		estadoContrato: "activo",
		bucketNumero: e.bucket,
		vehiculoMarca: e.marca,
		vehiculoModelo: e.modelo,
		vehiculoPlaca: e.placa,
		deudaVencida: String(e.deuda),
		cuotaMensual: String(e.cuota),
		fechaProximoPago: iso(e.fecha),
		seguimiento: filaCola(e, i).seguimiento,
		estadoGestion: e.estadoGestion,
		accionPendiente: e.accion,
	} as unknown as FilaCartera;
}

const FILAS: FilaAtencion[] = EJEMPLOS.map((e, i) => ({
	cola: filaCola(e, i),
	// La última fila simula un SIFCO que cartera no devolvió.
	credito: i === EJEMPLOS.length - 1 ? null : filaCartera(e, i),
}));

const DESEMPENO: DesempenoVista = {
	recuperacion: null,
	promesas: {
		cumplidas: 23,
		pactadas: 25,
		cumplidasAnterior: 20,
		pactadasAnterior: 24,
	},
	contactabilidad: {
		porcentaje: 84,
		porcentajeAnterior: 78,
		logrados: 42,
		intentos: 50,
	},
	movimiento: { bajaron: 8, subieron: 2, incluyeHoy: false },
};

const nada = () => {};

const AGENDA_BASE: AgendaHoyProps = {
	progreso: { hechas: 4, total: 16 },
	valores: {
		llamada_hoy: 12,
		promesa_hoy: 3,
		incumplida: 2,
		pagos_por_confirmar: null,
		sin_contacto: 8,
		referencias: null,
		sla_hoy: 5,
		vence_hoy: 1,
		promesa_proxima: 4,
		sin_intento_hoy: 9,
	},
	cargandoConteos: false,
	filtroActivo: null,
	onFiltro: nada,
	expandida: false,
	onExpandida: nada,
	proximos: {
		cargando: false,
		error: false,
		sinAsesor: false,
		ausente: false,
		dias: [
			{
				dia: 1,
				total: 2,
				items: [
					{
						cuotaId: 1,
						numeroCreditoSifco: "01010214117594",
						cliente: "Sofía Herrera",
						bucket: 0,
						montoCuota: "2850",
					},
					{
						cuotaId: 2,
						numeroCreditoSifco: "01010214117595",
						cliente: "Jorge Pineda",
						bucket: 1,
						montoCuota: "3100",
						cubierto: true,
						asesor: "Andrea Solís",
					},
				],
			},
			{
				dia: 3,
				total: 1,
				items: [
					{
						cuotaId: 3,
						numeroCreditoSifco: "01010214117596",
						cliente: "Patricia Lemus",
						bucket: 0,
						montoCuota: "4200",
					},
				],
			},
		],
	},
	seguimientos: {
		cargando: false,
		items: [
			{
				id: "s1",
				idFicha: "01010214117590",
				cliente: "María José Contreras",
				vehiculo: "Toyota Hilux 2021",
				fecha: new Date(hoy.getTime() - 86_400_000),
			},
			{
				id: "s2",
				idFicha: "01010214117592",
				cliente: "Ana Lucía Morales",
				vehiculo: "Kia Sportage 2020",
				fecha: hoy,
			},
		],
	},
	onAbrirFicha: nada,
};

const DESEMPENO_BASE: MiDesempenoProps = {
	periodo: "dia",
	onPeriodo: nada,
	desempeno: DESEMPENO,
	cargando: false,
	error: false,
	onReintentar: nada,
	moraCartera: 480_000,
	cargandoMora: false,
	metas: [
		{
			categoria: "mora_total",
			etiqueta: "Mora total",
			actual: 26.1,
			objetivo: 22,
		},
		{ categoria: "mora_30", etiqueta: "Mora 30", actual: 18.4, objetivo: 20 },
	],
	mesMetas: hoy.toLocaleDateString("es-GT", { month: "long", year: "numeric" }),
};

const CASOS_BASE: CasosAtencionProps = {
	estado: "listo",
	filas: FILAS,
	total: 312,
	page: 1,
	perPage: 20,
	totalPages: 16,
	onPage: nada,
	filtro: null,
	onQuitarFiltro: nada,
	onReintentar: nada,
	onVerCartera: nada,
	onVistaRapida: nada,
};

const BASE: DashboardAsesorVistaProps = {
	encabezado: {
		saludo: "Buen día",
		primerNombre: "Carlos",
	},
	agenda: AGENDA_BASE,
	desempeno: DESEMPENO_BASE,
	distribucion: {
		items: [
			{
				bucket: "B0",
				cantidad: 231,
				porcentaje: 74,
				capital: 3_240_000,
				mora: 0,
			},
			{
				bucket: "B1",
				cantidad: 81,
				porcentaje: 26,
				capital: 1_180_000,
				mora: 480_000,
			},
		],
		resumen: {
			asignados: 312,
			alDia: 74,
			capital: 4_420_000,
			contactosHoy: 12,
		},
		cargando: false,
		error: false,
		onReintentar: nada,
		sinCartera: false,
		onBucket: nada,
	},
	casos: CASOS_BASE,
};

/** Normal, con filtro y agenda interactivos. */
function DemoInteractivo() {
	const [filtro, setFiltro] = useState<ClaveFiltro | null>(null);
	const [abierta, setAbierta] = useState(false);
	const [periodo, setPeriodo] = useState<MiDesempenoProps["periodo"]>("dia");
	return (
		<DashboardAsesorVista
			{...BASE}
			agenda={{
				...AGENDA_BASE,
				filtroActivo: filtro,
				onFiltro: (c) => setFiltro((p) => (p === c ? null : c)),
				expandida: abierta,
				onExpandida: setAbierta,
			}}
			desempeno={{ ...DESEMPENO_BASE, periodo, onPeriodo: setPeriodo }}
			casos={{
				...CASOS_BASE,
				filtro: filtro ? "Filtro de la agenda" : null,
				onQuitarFiltro: () => setFiltro(null),
			}}
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

export default function CobrosDashboardAsesorShowcase() {
	return (
		<div className="space-y-8">
			<ShowcaseGroup title="Normal (Día) — interactivo">
				<Marco>
					<DemoInteractivo />
				</Marco>
			</ShowcaseGroup>

			<ShowcaseGroup title="Agenda expandida: seguimientos y próximos días">
				<div className="py-4">
					<AgendaHoy {...AGENDA_BASE} expandida filtroActivo="incumplida" />
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Recuperación con datos (cuando el backend la mande) · Mes">
				<div className="py-4">
					<MiDesempeno
						{...DESEMPENO_BASE}
						periodo="mes"
						desempeno={{
							...DESEMPENO,
							recuperacion: {
								monto: 410_000,
								montoAnterior: 397_600,
								meta: 440_000,
							},
							promesas: {
								cumplidas: 486,
								pactadas: 520,
								cumplidasAnterior: 444,
								pactadasAnterior: 500,
							},
						}}
					/>
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Cargando (cada bloque por su cuenta)">
				<Marco>
					<DashboardAsesorVista
						{...BASE}
						encabezado={BASE.encabezado}
						agenda={{
							...AGENDA_BASE,
							progreso: undefined,
							valores: {},
							cargandoConteos: true,
						}}
						desempeno={{
							...DESEMPENO_BASE,
							desempeno: undefined,
							cargando: true,
							moraCartera: undefined,
							cargandoMora: true,
							metas: [],
						}}
						distribucion={{
							...BASE.distribucion,
							items: [],
							resumen: undefined,
							cargando: true,
						}}
						casos={{ ...CASOS_BASE, estado: "cargando", filas: [] }}
					/>
				</Marco>
			</ShowcaseGroup>

			<ShowcaseGroup title="Vacío positivo: Todo al día">
				<div className="py-4">
					<CasosAtencion {...CASOS_BASE} filas={[]} total={0} totalPages={1} />
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Filtro sin resultados">
				<div className="py-4">
					<CasosAtencion
						{...CASOS_BASE}
						filas={[]}
						total={0}
						totalPages={1}
						filtro="Promesas vencidas"
					/>
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Sin asesor vinculado">
				<Marco>
					<DashboardAsesorVista
						{...BASE}
						agenda={{
							...AGENDA_BASE,
							progreso: { hechas: 0, total: 0 },
							valores: { pagos_por_confirmar: null, referencias: null },
						}}
						desempeno={{ ...DESEMPENO_BASE, metas: [] }}
						distribucion={{
							...BASE.distribucion,
							items: [],
							sinCartera: true,
						}}
						casos={{ ...CASOS_BASE, estado: "sinAsesor", filas: [], total: 0 }}
					/>
				</Marco>
			</ShowcaseGroup>

			<ShowcaseGroup title="Ausente (cobertura) y error">
				<div className="space-y-6 py-4">
					<CasosAtencion
						{...CASOS_BASE}
						estado="ausente"
						filas={[]}
						total={0}
					/>
					<CasosAtencion {...CASOS_BASE} estado="error" filas={[]} total={0} />
				</div>
			</ShowcaseGroup>
		</div>
	);
}
