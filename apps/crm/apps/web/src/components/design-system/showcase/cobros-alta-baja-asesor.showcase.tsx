import type * as React from "react";
import { useState } from "react";
import type { MotivoBaja, RolAsesor } from "server/src/lib/alta-baja-asesor";
import { recomendarCarteraInicial } from "server/src/lib/alta-baja-asesor";
import { AccionesEquipo } from "@/components/cobros/equipo/acciones-equipo";
import {
	AltaAsesorVista,
	type AltaAsesorVistaProps,
	type CarteraAlta,
} from "@/components/cobros/equipo/alta-baja/alta-asesor-vista";
import {
	BajaAsesorVista,
	type BajaAsesorVistaProps,
	type RepartoBaja,
} from "@/components/cobros/equipo/alta-baja/baja-asesor-vista";
import { ANCHO_MODAL_ALTA_BAJA } from "@/components/cobros/equipo/alta-baja/piezas";
import {
	AsesoresVista,
	type FilaAsesorEquipo,
} from "@/components/cobros/equipo/asesores-vista";
import { dialogPanelClassName } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ShowcaseGroup, type ShowcaseMeta } from "./_layout";

export const meta: ShowcaseMeta = {
	order: 307,
	title: "Cobros · Alta y baja de asesor",
	figma:
		"CRM Ventas › 05 · Alta y Baja de Asesor: Crear asesor (4298:12), Cartera inicial (4298:48), Asesor creado (4298:104), Dar de baja (4300:12), Redistribuir cartera (4300:36), Asesor dado de baja (4300:94)",
	description:
		"Modales de Mi equipo (components/cobros/equipo/alta-baja) con datos de ejemplo. Alta: datos con rol y supervisor, cartera inicial (− / + con lo recomendado, rango sugerido, de dónde saldrán y cómo queda el equipo; se recalcula al ajustar) y éxito. Baja: aviso, motivo y último día, reparto por capacidad que propone cartera con el responsable de las cuentas fuera de cobro, y éxito. También los estados de bloqueo (otro rol, sin equipo, créditos sin bucket, reparto vencido) y la tarjeta del asesor con el menú «⋯» → «Dar de baja».",
};

const nada = () => {};

function Panel({ children }: { children: React.ReactNode }) {
	return (
		<div
			className={cn(dialogPanelClassName, ANCHO_MODAL_ALTA_BAJA, "max-w-130")}
		>
			{children}
		</div>
	);
}

function Fila({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex flex-wrap items-start gap-6 py-4">{children}</div>
	);
}

/* ── Alta ─────────────────────────────────────────────────────────────── */

const EQUIPO_JUNIOR = [
	{ asesorId: 1, nombre: "C. Ruiz", carga: 66 },
	{ asesorId: 2, nombre: "A. Díaz", carga: 64 },
	{ asesorId: 3, nombre: "L. Morales", carga: 63 },
	{ asesorId: 4, nombre: "P. Gómez", carga: 61 },
	{ asesorId: 5, nombre: "M. Soto", carga: 60 },
	{ asesorId: 6, nombre: "J. Luna", carga: 59 },
	{ asesorId: 7, nombre: "R. Pérez", carga: 58 },
];

const CARTERA: CarteraAlta = {
	usuario: { estado: "nuevo" },
	asesorExistente: null,
	equipo: EQUIPO_JUNIOR,
	recomendacion: recomendarCarteraInicial(EQUIPO_JUNIOR),
};

const SUPERVISORES = [
	{ userId: "s1", nombre: "Marta Gómez" },
	{ userId: "s2", nombre: "Diego Morales" },
];

const altaBase: AltaAsesorVistaProps = {
	paso: "datos",
	nombre: "",
	onNombre: nada,
	correo: "",
	onCorreo: nada,
	rol: "junior",
	onRol: nada,
	supervisores: SUPERVISORES,
	supervisorId: "s1",
	onSupervisor: nada,
	errorDatos: "Ingrese el nombre completo del asesor.",
	bloqueo: null,
	errorServidor: null,
	pendiente: false,
	cartera: null,
	creditos: 0,
	onCreditos: nada,
	resultado: null,
	onCancelar: nada,
	onSiguiente: nada,
	onAtras: nada,
	onCrear: nada,
	onVerAsesor: nada,
	onCerrar: nada,
};

/** «Crear asesor» completo y navegable con datos de ejemplo (sin servidor). */
function DemoAlta() {
	const [p, set] = useState({
		paso: "datos" as AltaAsesorVistaProps["paso"],
		nombre: "Juan Pérez",
		correo: "juan.perez@clubcashin.com",
		rol: "junior" as RolAsesor,
		supervisorId: "s1",
		creditos: CARTERA.recomendacion.recomendado,
	});
	return (
		<AltaAsesorVista
			{...altaBase}
			{...p}
			errorDatos={
				p.nombre.trim() ? null : "Ingrese el nombre completo del asesor."
			}
			onNombre={(nombre) => set({ ...p, nombre })}
			onCorreo={(correo) => set({ ...p, correo })}
			onRol={(rol) => set({ ...p, rol })}
			onSupervisor={(supervisorId) => set({ ...p, supervisorId })}
			cartera={CARTERA}
			onCreditos={(creditos) => set({ ...p, creditos })}
			resultado={{
				asesorId: 99,
				nombre: p.nombre,
				rol: p.rol,
				asignados: p.creditos,
				usuario: "creado",
			}}
			onSiguiente={() => set({ ...p, paso: "cartera" })}
			onAtras={() => set({ ...p, paso: "datos" })}
			onCrear={() => set({ ...p, paso: "creado" })}
			onCerrar={() => set({ ...p, paso: "datos" })}
			onCancelar={() => set({ ...p, paso: "datos" })}
		/>
	);
}

/* ── Baja ─────────────────────────────────────────────────────────────── */

const REPARTO: RepartoBaja = {
	nombre: "Carlos Ruiz",
	nivel: "junior",
	resumen: {
		total: 61,
		repartidos: 61,
		composicion: [
			{ bucket: 0, cantidad: 40 },
			{ bucket: 1, cantidad: 18 },
		],
		especiales: { cantidad: 3, responsableId: 2 },
		receptores: [
			{
				asesorId: 2,
				nombre: "A. Díaz",
				antes: 57,
				despues: 69,
				recibe: 12,
				capacidad: 80,
			},
			{
				asesorId: 3,
				nombre: "L. Morales",
				antes: 56,
				despues: 68,
				recibe: 12,
				capacidad: 80,
			},
			{
				asesorId: 4,
				nombre: "P. Gómez",
				antes: 55,
				despues: 67,
				recibe: 12,
				capacidad: 80,
			},
			{
				asesorId: 5,
				nombre: "M. Soto",
				antes: 54,
				despues: 66,
				recibe: 12,
				capacidad: 80,
			},
			{
				asesorId: 6,
				nombre: "J. Luna",
				antes: 52,
				despues: 62,
				recibe: 10,
				capacidad: 80,
			},
		],
		rangoDespues: { min: 62, max: 69 },
		bloqueados: 0,
		sinBucket: 0,
	},
	responsableEspeciales: { asesorId: 2, nombre: "A. Díaz" },
	candidatosEspeciales: [
		{ asesorId: 2, nombre: "A. Díaz" },
		{ asesorId: 3, nombre: "L. Morales" },
		{ asesorId: 4, nombre: "P. Gómez" },
	],
};

const bajaBase: BajaAsesorVistaProps = {
	paso: "datos",
	cargando: false,
	errorCarga: false,
	onReintentar: nada,
	asesor: {
		nombre: "Carlos Ruiz",
		nivel: "junior",
		creditos: 58,
		supervisor: "Marta Gómez",
	},
	avisoAsesor: null,
	motivo: "renuncia",
	onMotivo: nada,
	detalle: "",
	onDetalle: nada,
	ultimoDia: "2026-10-30",
	onUltimoDia: nada,
	errorDatos: null,
	errorServidor: null,
	pendiente: false,
	reparto: REPARTO,
	vencida: false,
	onRecalcular: nada,
	onResponsable: nada,
	resultado: {
		nombre: "Carlos Ruiz",
		cuentas: 61,
		receptores: 5,
		nivel: "junior",
		usuarioSuspendido: true,
		sinUsuarioCobros: false,
	},
	onCancelar: nada,
	onSiguiente: nada,
	onAtras: nada,
	onConfirmar: nada,
	onVerEquipo: nada,
	onCerrar: nada,
};

/** «Dar de baja» navegable con datos de ejemplo (sin servidor). */
function DemoBaja() {
	const [paso, setPaso] = useState<BajaAsesorVistaProps["paso"]>("datos");
	const [motivo, setMotivo] = useState<MotivoBaja | "">("renuncia");
	const [ultimoDia, setUltimoDia] = useState("2026-10-30");
	return (
		<BajaAsesorVista
			{...bajaBase}
			paso={paso}
			motivo={motivo}
			onMotivo={setMotivo}
			ultimoDia={ultimoDia}
			onUltimoDia={setUltimoDia}
			errorDatos={motivo ? null : "Seleccione el motivo de la baja."}
			onSiguiente={() => setPaso("reparto")}
			onAtras={() => setPaso("datos")}
			onConfirmar={() => setPaso("hecha")}
			onCerrar={() => setPaso("datos")}
			onCancelar={() => setPaso("datos")}
		/>
	);
}

/* ── Tarjeta con el menú «⋯» ─────────────────────────────────────────── */

const FILA: FilaAsesorEquipo = {
	asesorId: 1,
	nombre: "Carlos Ruiz",
	nivel: "junior",
	estado: "al_dia",
	creditos: 58,
	distribucion: [
		{ bucket: "B0", cantidad: 40 },
		{ bucket: "B1", cantidad: 18 },
	],
	gestiones: { atendidos: 18, planificados: 20 },
	contactabilidad: 88,
	recuperacion: { porcentaje: 74, detalle: "Q7.4K de Q10K", tono: "normal" },
	ausencia: null,
	destino: { to: "/cobros/equipo/1" },
};

export default function CobrosAltaBajaAsesorShowcase() {
	return (
		<div className="space-y-6">
			<ShowcaseGroup title="Encabezado de Mi equipo y tarjeta con «⋯» → «Dar de baja»">
				<Fila>
					<AccionesEquipo
						onCrearAsesor={nada}
						onTrasladar={nada}
						onMarcarAusente={nada}
					/>
				</Fila>
				<div className="max-w-sm py-4">
					<AsesoresVista
						filas={[FILA]}
						grupo="todos"
						onGrupo={nada}
						cargando={false}
						error={false}
						onReintentar={nada}
						onDarDeBaja={nada}
						fechaAgenda="14/10/2026"
						diasContactabilidad={7}
					/>
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Crear asesor (interactivo: datos → cartera inicial → creado)">
				<Fila>
					<Panel>
						<DemoAlta />
					</Panel>
				</Fila>
			</ShowcaseGroup>

			<ShowcaseGroup title="Crear asesor · pasos (4298:12, 4298:48, 4298:104)">
				<Fila>
					<Panel>
						<AltaAsesorVista
							{...altaBase}
							nombre="Juan Pérez"
							correo="juan.perez@clubcashin.com"
							errorDatos={null}
						/>
					</Panel>
					<Panel>
						<AltaAsesorVista
							{...altaBase}
							paso="cartera"
							nombre="Juan Pérez"
							cartera={CARTERA}
							creditos={CARTERA.recomendacion.recomendado}
						/>
					</Panel>
					<Panel>
						<AltaAsesorVista
							{...altaBase}
							paso="creado"
							resultado={{
								asesorId: 99,
								nombre: "Juan Pérez",
								rol: "junior",
								asignados: 53,
								usuario: "creado",
							}}
						/>
					</Panel>
				</Fila>
			</ShowcaseGroup>

			<ShowcaseGroup title="Crear asesor · bloqueos y casos límite">
				<Fila>
					<Panel>
						<AltaAsesorVista
							{...altaBase}
							nombre="Ana López"
							correo="ana.lopez@clubcashin.com"
							errorDatos={null}
							bloqueo="El correo ya pertenece a Ana López, usuario del CRM con otro rol (sales). Un administrador debe cambiarle el rol a Cobros en Administración › Usuarios antes de darlo de alta."
						/>
					</Panel>
					<Panel>
						<AltaAsesorVista
							{...altaBase}
							paso="cartera"
							nombre="Luis Mejía"
							rol="especial"
							cartera={{
								usuario: {
									estado: "existente",
									userId: "u9",
									nombre: "Luis Mejía",
								},
								asesorExistente: null,
								equipo: [],
								recomendacion: recomendarCarteraInicial([]),
							}}
						/>
					</Panel>
					<Panel>
						<AltaAsesorVista
							{...altaBase}
							paso="cartera"
							nombre="Juan Pérez"
							cartera={{
								...CARTERA,
								usuario: {
									estado: "existente",
									userId: "u1",
									nombre: "Juan Pérez",
								},
								asesorExistente: { asesorId: 99, carga: 20 },
							}}
							creditos={53}
							errorServidor="El asesor quedó creado con su pool, pero no se pudo asignar su cartera inicial. Vuelva a intentarlo (no se duplica): Hay un proceso de buckets trabajando sobre la cartera en este momento."
						/>
					</Panel>
				</Fila>
			</ShowcaseGroup>

			<ShowcaseGroup title="Dar de baja (interactivo: datos → redistribuir → dado de baja)">
				<Fila>
					<Panel>
						<DemoBaja />
					</Panel>
				</Fila>
			</ShowcaseGroup>

			<ShowcaseGroup title="Dar de baja · pasos (4300:12, 4300:36, 4300:94)">
				<Fila>
					<Panel>
						<BajaAsesorVista {...bajaBase} />
					</Panel>
					<Panel>
						<BajaAsesorVista {...bajaBase} paso="reparto" />
					</Panel>
					<Panel>
						<BajaAsesorVista {...bajaBase} paso="hecha" />
					</Panel>
				</Fila>
			</ShowcaseGroup>

			<ShowcaseGroup title="Dar de baja · bloqueos y casos límite">
				<Fila>
					<Panel>
						<BajaAsesorVista
							{...bajaBase}
							motivo=""
							errorDatos="Seleccione el motivo de la baja."
							avisoAsesor="Carlos Ruiz está ausente con su cartera repartida. Reactívelo antes de darlo de baja."
						/>
					</Panel>
					<Panel>
						<BajaAsesorVista
							{...bajaBase}
							paso="reparto"
							reparto={{
								...REPARTO,
								resumen: {
									...REPARTO.resumen,
									repartidos: 55,
									bloqueados: 4,
									sinBucket: 2,
								},
							}}
						/>
					</Panel>
					<Panel>
						<BajaAsesorVista {...bajaBase} paso="reparto" vencida />
					</Panel>
				</Fila>
			</ShowcaseGroup>
		</div>
	);
}
