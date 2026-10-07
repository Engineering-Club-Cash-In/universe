import { Check } from "lucide-react";
import type * as React from "react";
import {
	type Destino,
	EnlaceDestino,
} from "@/components/cobros/supervision/destino";
import { type BucketAsesor, CardAsesor } from "@/components/ds/card-asesor";
import { CrmPill } from "@/components/ds/cards-credito";
import { FilterChip } from "@/components/ds/cartera-chips";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
	ESTADO_ASESOR_LABEL,
	type EstadoAsesor,
	etiquetaNivel,
	NIVEL_ASESOR_LABEL,
	type NivelAsesor,
	TONO_ESTADO_ASESOR,
	UMBRAL_CONTACTABILIDAD,
	UMBRAL_CUMPLIMIENTO,
} from "./estado-asesor";
import type { GrupoEquipo } from "./search";

/**
 * «Mi equipo» › pestaña Asesores — Figma «Equipo · Supervisor» (2028:13).
 * Presentación pura: una `CardAsesor` del design system por asesor activo, con
 * los chips Todos / Junior / Senior / Necesitan atención y el estado vacío del
 * Figma 2044:12. El contenedor (`asesores.tsx`) arma las filas.
 *
 * Al hacer clic en una tarjeta se abre el Detalle del asesor
 * (`/cobros/equipo/<asesor_id>`). En la tarjeta de un asesor ausente,
 * «Reactivar» cancela su cobertura vigente (lo confirma el contenedor).
 */

export type FilaAsesorEquipo = {
	asesorId: number;
	nombre: string;
	nivel: NivelAsesor | null;
	estado: EstadoAsesor;
	/** Créditos asignados (getCargaPorAsesorBucket); `null` si no hay dato. */
	creditos: number | null;
	distribucion: { bucket: BucketAsesor; cantidad: number }[];
	/** Atendidos / planificados del último cierre de agenda. */
	gestiones: { atendidos: number; planificados: number } | null;
	/** % de contactabilidad del rango (0–100). */
	contactabilidad: number | null;
	/** «Ausente · Vacaciones · vuelve el 30 sep», si tiene cobertura vigente. */
	ausencia: string | null;
	destino: Destino;
};

export type AsesoresVistaProps = {
	filas: FilaAsesorEquipo[];
	grupo: GrupoEquipo;
	onGrupo: (grupo: GrupoEquipo) => void;
	cargando: boolean;
	error: boolean;
	onReintentar: () => void;
	/** Reactivar a un asesor ausente (cancela su cobertura vigente). */
	onReactivar?: (asesorId: number) => void;
	reactivandoId?: number | null;
	/** Día del último cierre de agenda («06/10/2026»). */
	fechaAgenda: string | null;
	/** Días que mide la contactabilidad. */
	diasContactabilidad: number;
	/** Fuentes que fallaron (la tarjeta muestra «—» en ese dato). */
	avisos?: string[];
};

export function filtrarPorGrupo(
	filas: FilaAsesorEquipo[],
	grupo: GrupoEquipo,
): FilaAsesorEquipo[] {
	switch (grupo) {
		case "junior":
		case "senior":
		case "especial":
			return filas.filter((f) => f.nivel === grupo);
		case "atencion":
			return filas.filter((f) => f.estado === "requiere_atencion");
		default:
			return filas;
	}
}

/** «10 asesores · 6 Junior · 4 Senior» (subtítulo de la página). */
export function resumenEquipo(
	niveles: readonly (NivelAsesor | null)[],
): string {
	const cuenta = (n: NivelAsesor) => niveles.filter((x) => x === n).length;
	const partes = [
		`${niveles.length} ${niveles.length === 1 ? "asesor" : "asesores"}`,
		`${cuenta("junior")} Junior`,
		`${cuenta("senior")} Senior`,
	];
	const especiales = cuenta("especial");
	if (especiales > 0) partes.push(`${especiales} Especial`);
	return partes.join(" · ");
}

function TarjetaAsesor({
	fila,
	onReactivar,
	reactivando,
}: {
	fila: FilaAsesorEquipo;
	onReactivar?: (asesorId: number) => void;
	reactivando: boolean;
}) {
	const bajaContactabilidad =
		fila.contactabilidad !== null &&
		fila.contactabilidad < UMBRAL_CONTACTABILIDAD;
	return (
		// La tarjeta entera abre el detalle: el enlace la cubre por encima y el
		// botón «Reactivar» queda sobre el enlace (z-10) para no anidar
		// elementos interactivos.
		<div className="group relative min-w-0">
			<CardAsesor
				className="h-full group-hover:border-line group-hover:shadow-modal [&_button]:relative [&_button]:z-10"
				nombre={fila.nombre}
				rol={etiquetaNivel(fila.nivel)}
				estadoChip={
					<CrmPill kind="chip" tone={TONO_ESTADO_ASESOR[fila.estado]}>
						{ESTADO_ASESOR_LABEL[fila.estado]}
					</CrmPill>
				}
				creditosAsignados={fila.creditos ?? 0}
				distribucion={fila.distribucion}
				gestionesCumplidas={
					fila.gestiones
						? `${fila.gestiones.atendidos} / ${fila.gestiones.planificados}`
						: "—"
				}
				contactabilidad={
					fila.contactabilidad === null
						? "—"
						: `${Math.round(fila.contactabilidad)}%`
				}
				contactabilidadTone={
					fila.contactabilidad === null
						? "neutral"
						: bajaContactabilidad
							? "warning"
							: "success"
				}
				// TODO(José) · tarea M1: recuperación por asesor (Q recuperado de Q
				// esperado, con meta). Hasta entonces la barra va en «—».
				recuperacion={{ porcentaje: null, detalle: "Pronto" }}
				ausencia={fila.ausencia ?? undefined}
				onReactivar={onReactivar ? () => onReactivar(fila.asesorId) : undefined}
				reactivando={reactivando}
			/>
			<EnlaceDestino
				destino={fila.destino}
				aria-label={`Ver el detalle de ${fila.nombre}`}
				className="absolute inset-0 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
			/>
		</div>
	);
}

const CHIPS: { grupo: GrupoEquipo; etiqueta: string }[] = [
	{ grupo: "todos", etiqueta: "Todos" },
	{ grupo: "junior", etiqueta: NIVEL_ASESOR_LABEL.junior },
	{ grupo: "senior", etiqueta: NIVEL_ASESOR_LABEL.senior },
	{ grupo: "especial", etiqueta: NIVEL_ASESOR_LABEL.especial },
	{ grupo: "atencion", etiqueta: "Necesitan atención" },
];

/** Figma 2044:12, en usted. */
function SinAtencion() {
	return (
		<div className="rounded-2xl border border-line-subtle bg-surface">
			<EmptyState
				className="[&>div:first-child]:bg-success-subtle [&>div:first-child]:text-success-text"
				icon={<Check aria-hidden />}
				title="Ningún asesor necesita atención"
				description="Todo el equipo está al día en gestiones y contacto. Nada requiere su intervención ahora."
			/>
		</div>
	);
}

function Marco({ children }: { children: React.ReactNode }) {
	return (
		<div className="rounded-2xl border border-line-subtle bg-surface">
			{children}
		</div>
	);
}

export function AsesoresVista({
	filas,
	grupo,
	onGrupo,
	cargando,
	error,
	onReintentar,
	onReactivar,
	reactivandoId,
	fechaAgenda,
	diasContactabilidad,
	avisos = [],
}: AsesoresVistaProps) {
	const visibles = filtrarPorGrupo(filas, grupo);
	const conteo = (g: GrupoEquipo) => filtrarPorGrupo(filas, g).length;

	let cuerpo: React.ReactNode;
	if (cargando && filas.length === 0) {
		cuerpo = (
			<div
				className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,22.5rem),1fr))] gap-5"
				aria-hidden
			>
				{[0, 1, 2, 3].map((i) => (
					<Skeleton key={i} className="h-80 w-full rounded-2xl" />
				))}
			</div>
		);
	} else if (error && filas.length === 0) {
		cuerpo = (
			<Marco>
				<EmptyState
					variant="error"
					title="No se pudo cargar el equipo"
					description="Intente de nuevo en unos segundos."
					action={
						<Button variant="outline" size="sm" onClick={onReintentar}>
							Reintentar
						</Button>
					}
				/>
			</Marco>
		);
	} else if (filas.length === 0) {
		cuerpo = (
			<Marco>
				<EmptyState
					variant="no-data"
					title="Sin asesores en el pool"
					description="Ningún asesor activo tiene buckets asignados en cartera."
				/>
			</Marco>
		);
	} else if (visibles.length === 0) {
		cuerpo =
			grupo === "atencion" ? (
				<SinAtencion />
			) : (
				<Marco>
					<EmptyState
						size="sm"
						title={`Sin asesores ${CHIPS.find((c) => c.grupo === grupo)?.etiqueta ?? ""}`}
						description="Ningún asesor del equipo tiene este nivel."
					/>
				</Marco>
			);
	} else {
		cuerpo = (
			<div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,22.5rem),1fr))] gap-5">
				{visibles.map((f) => (
					<TarjetaAsesor
						key={f.asesorId}
						fila={f}
						onReactivar={onReactivar}
						reactivando={reactivandoId === f.asesorId}
					/>
				))}
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-2">
				<fieldset className="flex min-w-0 flex-wrap items-center gap-2">
					<legend className="sr-only">Filtrar asesores</legend>
					{CHIPS.filter(
						// «Especial» solo aparece si hay alguno (no está en el Figma).
						(c) => c.grupo !== "especial" || conteo("especial") > 0,
					).map((c) => (
						<FilterChip
							key={c.grupo}
							seleccionado={grupo === c.grupo}
							cantidad={
								cargando && filas.length === 0 ? undefined : conteo(c.grupo)
							}
							onClick={() => onGrupo(c.grupo)}
						>
							{c.etiqueta}
						</FilterChip>
					))}
				</fieldset>
				<p className="text-fg-tertiary text-xs leading-[1.4]">
					Gestiones cumplidas: agenda cerrada
					{fechaAgenda ? ` del ${fechaAgenda}` : " más reciente"}.
					Contactabilidad: contactos efectivos de los últimos{" "}
					{diasContactabilidad} días. Requiere atención: cumplimiento menor al{" "}
					{UMBRAL_CUMPLIMIENTO} % o contactabilidad menor al{" "}
					{UMBRAL_CONTACTABILIDAD} %.
				</p>
				{avisos.length > 0 ? (
					<output className="block text-warning-text text-xs leading-[1.4]">
						{avisos.join(" ")}
					</output>
				) : null}
			</div>
			{cuerpo}
		</div>
	);
}
