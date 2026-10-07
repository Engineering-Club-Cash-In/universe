import type * as React from "react";
import { useState } from "react";
import { AccionesEquipo } from "@/components/cobros/equipo/acciones-equipo";
import {
	AsesoresVista,
	type FilaAsesorEquipo,
	resumenEquipo,
} from "@/components/cobros/equipo/asesores-vista";
import {
	MarcarAusenteVista,
	type MarcarAusenteVistaProps,
	type MotivoAusencia,
} from "@/components/cobros/equipo/asignacion/marcar-ausente";
import { MiEquipoVista } from "@/components/cobros/equipo/mi-equipo-vista";
import type { GrupoEquipo, TabEquipo } from "@/components/cobros/equipo/search";
import { dialogPanelClassName } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ShowcaseGroup, type ShowcaseMeta } from "./_layout";
import {
	DemoAsignacion,
	GruposAsignacion,
	POOL,
} from "./_mi-equipo-asignacion";
import { DemoDia, GruposDia } from "./_mi-equipo-dia";

export const meta: ShowcaseMeta = {
	order: 306,
	title: "Cobros · Mi equipo",
	figma:
		"CRM Ventas › Supervisor › Equipo · Supervisor (2028:13), vacío «Necesitan atención» (2044:12), Marcar ausente (3359:4251 / 3367:4244); Trasladar cartera con Reasignar (3631:5567), Redistribución (3360:4254) y éxito (3629:5636); Carga y asignación con Reportería (3550:5760)",
	description:
		"Mi equipo (components/cobros/equipo) con datos de ejemplo: encabezado con «Trasladar cartera» y «Marcar ausente» (primarios, en las tres pestañas), pestaña Asesores (tarjetas CardAsesor con nivel, estado, créditos por bucket, gestiones cumplidas, contactabilidad y recuperación «—» hasta M1; ausente con «Reactivar»), pestaña Día (Apertura, Cierre y Gestiones con el lenguaje de Reportería: KPIs, filas por bucket y por asesor que se despliegan, «Entradas de la noche») y pestaña Carga y asignación (KPIs del DS, carga por bucket que se despliega hacia sus asesores con Trasladar, Marcar ausente y Editar capacidad; historial con selector segmentado Reasignaciones · Traslados · Coberturas). Además: estado vacío de «Necesitan atención», cargando, error y los modales: «Trasladar cartera» en tres pasos (origen y reparto, revisión del reparto, resultado; real sobre una caché de ejemplo y con vistas previas de ejemplo), «Editar capacidad» y «Marcar ausente» (formulario, sin asesor elegido y revisión).",
};

/* ── Datos de ejemplo ─────────────────────────────────────────────────────── */

const nada = () => {};
const detalle = (id: number) => ({ to: `/cobros/equipo/${id}` });

const FILAS: FilaAsesorEquipo[] = [
	{
		asesorId: 1,
		nombre: "Carlos Ramírez",
		nivel: "senior",
		estado: "al_dia",
		creditos: 28,
		distribucion: [
			{ bucket: "B2", cantidad: 20 },
			{ bucket: "B3", cantidad: 8 },
		],
		gestiones: { atendidos: 18, planificados: 20 },
		contactabilidad: 92,
		ausencia: null,
		destino: detalle(1),
	},
	{
		asesorId: 2,
		nombre: "Andrea Solís",
		nivel: "senior",
		estado: "al_dia",
		creditos: 30,
		distribucion: [
			{ bucket: "B2", cantidad: 22 },
			{ bucket: "B3", cantidad: 8 },
		],
		gestiones: { atendidos: 20, planificados: 22 },
		contactabilidad: 93,
		ausencia: null,
		destino: detalle(2),
	},
	{
		asesorId: 3,
		nombre: "Marta Gómez",
		nivel: "senior",
		estado: "requiere_atencion",
		creditos: 34,
		distribucion: [
			{ bucket: "B2", cantidad: 24 },
			{ bucket: "B3", cantidad: 10 },
		],
		gestiones: { atendidos: 16, planificados: 24 },
		contactabilidad: 70,
		ausencia: null,
		destino: detalle(3),
	},
	{
		asesorId: 4,
		nombre: "Luis Fernández",
		nivel: "especial",
		estado: "al_dia",
		creditos: 27,
		distribucion: [
			{ bucket: "B4", cantidad: 19 },
			{ bucket: "B5", cantidad: 8 },
		],
		gestiones: { atendidos: 17, planificados: 19 },
		contactabilidad: 89,
		ausencia: null,
		destino: detalle(4),
	},
	{
		asesorId: 5,
		nombre: "María López",
		nivel: "junior",
		estado: "al_dia",
		creditos: 32,
		distribucion: [{ bucket: "B1", cantidad: 32 }],
		gestiones: { atendidos: 22, planificados: 24 },
		contactabilidad: 86,
		ausencia: null,
		destino: detalle(5),
	},
	{
		asesorId: 6,
		nombre: "José Pérez",
		nivel: "junior",
		estado: "requiere_atencion",
		creditos: 30,
		distribucion: [{ bucket: "B1", cantidad: 30 }],
		gestiones: { atendidos: 15, planificados: 22 },
		contactabilidad: 71,
		ausencia: null,
		destino: detalle(6),
	},
	{
		asesorId: 7,
		nombre: "Ana Díaz",
		nivel: "junior",
		estado: "al_dia",
		creditos: 28,
		distribucion: [
			{ bucket: "B0", cantidad: 10 },
			{ bucket: "B1", cantidad: 18 },
		],
		gestiones: null,
		contactabilidad: null,
		ausencia: null,
		destino: detalle(7),
	},
	{
		asesorId: 8,
		nombre: "Diego Morales",
		nivel: "junior",
		estado: "ausente",
		creditos: 31,
		distribucion: [{ bucket: "B1", cantidad: 31 }],
		gestiones: { atendidos: 17, planificados: 23 },
		contactabilidad: 74,
		ausencia: "Ausente · Vacaciones · vuelve el 30 sep",
		destino: detalle(8),
	},
];

/* ── Demos interactivas ───────────────────────────────────────────────────── */

function Marco({ children }: { children: React.ReactNode }) {
	return (
		<div className="overflow-hidden rounded-2xl border border-line-subtle bg-canvas">
			{children}
		</div>
	);
}

function DemoAsesores() {
	const [grupo, setGrupo] = useState<GrupoEquipo>("todos");
	return (
		<AsesoresVista
			filas={FILAS}
			grupo={grupo}
			onGrupo={setGrupo}
			cargando={false}
			error={false}
			onReintentar={nada}
			onReactivar={nada}
			fechaAgenda="06/10/2026"
			diasContactabilidad={7}
		/>
	);
}

function DemoPagina() {
	const [tab, setTab] = useState<TabEquipo>("asesores");
	return (
		<MiEquipoVista
			tab={tab}
			onTab={setTab}
			subtitulo={resumenEquipo(FILAS.map((f) => f.nivel))}
			acciones={<AccionesEquipo onTrasladar={nada} onMarcarAusente={nada} />}
			asesores={<DemoAsesores />}
			dia={<DemoDia />}
			asignacion={<DemoAsignacion />}
		/>
	);
}

const BASE_AUSENTE: MarcarAusenteVistaProps = {
	paso: "formulario",
	cargando: false,
	errorCarga: false,
	onReintentar: nada,
	titulares: POOL,
	titular: "3",
	onTitular: nada,
	titularInfo: { nombre: "Marta Gómez", buckets: [2, 3], creditos: 34 },
	avisoTitular: null,
	suplente: "1",
	onSuplente: nada,
	suplentes: POOL.filter((a) => a.asesor_id === 1 || a.asesor_id === 2),
	nombreSuplente: "Carlos Ramírez",
	motivo: "vacaciones",
	onMotivo: nada,
	desde: "2026-10-12",
	hasta: "2026-10-23",
	onDesde: nada,
	onHasta: nada,
	hoy: "2026-10-07",
	error: null,
	errorServidor: null,
	pendiente: false,
	onCancelar: nada,
	onContinuar: nada,
	onVolver: nada,
	onConfirmar: nada,
};

function PanelModal({ children }: { children: React.ReactNode }) {
	return (
		<div className={cn(dialogPanelClassName, "max-w-120")}>{children}</div>
	);
}

function DemoMarcarAusente() {
	const [motivo, setMotivo] = useState<MotivoAusencia>("vacaciones");
	return (
		<PanelModal>
			<MarcarAusenteVista
				{...BASE_AUSENTE}
				motivo={motivo}
				onMotivo={setMotivo}
			/>
		</PanelModal>
	);
}

export default function CobrosMiEquipoShowcase() {
	return (
		<div className="space-y-8">
			<ShowcaseGroup title="Página completa: tres pestañas (interactiva)">
				<Marco>
					<DemoPagina />
				</Marco>
			</ShowcaseGroup>

			<GruposDia />

			<GruposAsignacion />

			<ShowcaseGroup title="Estado vacío de «Necesitan atención» (Figma 2044:12)">
				<div className="py-4">
					<AsesoresVista
						filas={FILAS.filter((f) => f.estado !== "requiere_atencion")}
						grupo="atencion"
						onGrupo={nada}
						cargando={false}
						error={false}
						onReintentar={nada}
						fechaAgenda="06/10/2026"
						diasContactabilidad={7}
					/>
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Cargando, error y sin asesores">
				<div className="grid gap-6 py-4">
					<AsesoresVista
						filas={[]}
						grupo="todos"
						onGrupo={nada}
						cargando
						error={false}
						onReintentar={nada}
						fechaAgenda={null}
						diasContactabilidad={7}
					/>
					<AsesoresVista
						filas={[]}
						grupo="todos"
						onGrupo={nada}
						cargando={false}
						error
						onReintentar={nada}
						fechaAgenda={null}
						diasContactabilidad={7}
					/>
					<AsesoresVista
						filas={[]}
						grupo="todos"
						onGrupo={nada}
						cargando={false}
						error={false}
						onReintentar={nada}
						fechaAgenda={null}
						diasContactabilidad={7}
						avisos={[
							"No se pudo cargar la contactabilidad de algunos asesores.",
						]}
					/>
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Modal «Marcar ausente» (Figma 3359:4251 y 3367:4244)">
				<div className="flex flex-wrap items-start gap-6 py-4">
					<DemoMarcarAusente />
					<PanelModal>
						<MarcarAusenteVista
							{...BASE_AUSENTE}
							titular=""
							titularInfo={null}
							suplente=""
							suplentes={[]}
							nombreSuplente={null}
							error="Seleccione el titular."
						/>
					</PanelModal>
					<PanelModal>
						<MarcarAusenteVista {...BASE_AUSENTE} paso="revision" />
					</PanelModal>
				</div>
			</ShowcaseGroup>
		</div>
	);
}
