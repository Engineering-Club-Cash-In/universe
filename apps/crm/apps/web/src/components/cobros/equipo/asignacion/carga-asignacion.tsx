import { useQuery } from "@tanstack/react-query";
import type * as React from "react";
import { useState } from "react";
import {
	CoberturasRegistradas,
	type RangoCoberturas,
} from "@/components/cobros/coberturas-panel";
import { PeriodSelector } from "@/components/ui/period-selector";
import { SectionHeader } from "@/components/ui/section-header";
import { orpc } from "@/utils/orpc";
import type { AccionEquipo, SeccionHistorial } from "../search";
import {
	type CargaData,
	CargaResumenVista,
	type EdicionCapacidad,
	EncabezadoCarga,
} from "./carga-resumen-vista";
import { EditarCapacidadDialog } from "./editar-capacidad-dialog";
import { HistorialReasignaciones } from "./historial-reasignaciones";
import { HistorialTrasladosPanel } from "./historial-traslados";

/**
 * «Mi equipo» › Carga y asignación: una sola página que une las viejas
 * `/cobros/carga` y `/cobros/reasignaciones` (menos su pestaña «Buckets», que
 * el usuario decidió eliminar: la cubre «Reasignar en bloque» de la Cartera
 * general).
 *
 *   Arriba → «Carga del equipo»: KPIs y la carga por bucket, que se despliega
 *            hacia sus asesores con «Trasladar cartera», «Marcar ausente» y
 *            «Editar capacidad» (admin). Los dos primeros también están en el
 *            encabezado de Mi equipo; los formularios son modales
 *            (`acciones-equipo.tsx`).
 *   Abajo  → «Historial» con el selector segmentado del DS:
 *            Reasignaciones · Traslados · Coberturas.
 *
 * URL: `?seccion=` (historial visible); las filas abren
 * `?accion=trasladar|ausente&asesor=`.
 */

const SECCIONES: { value: SeccionHistorial; label: string }[] = [
	{ value: "reasignaciones", label: "Reasignaciones" },
	{ value: "traslados", label: "Traslados" },
	{ value: "coberturas", label: "Coberturas" },
];

const DESCRIPCION_SECCION: Record<SeccionHistorial, string> = {
	reasignaciones: "Cambios de asesor por crédito, manuales y automáticos.",
	traslados: "Traslados masivos de cartera confirmados.",
	coberturas: "Ausencias registradas y quién atiende la agenda.",
};

export function AsignacionVista({
	resumen,
	seccion,
	onSeccion,
	historial,
}: {
	resumen: React.ReactNode;
	seccion: SeccionHistorial;
	onSeccion: (seccion: SeccionHistorial) => void;
	historial: React.ReactNode;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-8">
			<section aria-label="Carga del equipo" className="flex flex-col gap-4">
				<EncabezadoCarga />
				{resumen}
			</section>

			<section aria-label="Historial" className="flex min-w-0 flex-col gap-4">
				<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
					<SectionHeader
						titleAs="h2"
						title="Historial"
						description={DESCRIPCION_SECCION[seccion]}
						className="w-auto min-w-0"
					/>
					{/* Con poco ancho el selector se desplaza, no ensancha la página. */}
					<div className="max-w-full overflow-x-auto">
						<PeriodSelector
							aria-label="Historial a mostrar"
							value={seccion}
							onChange={onSeccion}
							options={SECCIONES}
						/>
					</div>
				</div>
				{historial}
			</section>
		</div>
	);
}

export function MiEquipoAsignacion({
	habilitado,
	esAdmin,
	seccion,
	onSeccion,
	rangoCoberturas,
	onRangoCoberturas,
	onAccion,
}: {
	habilitado: boolean;
	/** El lápiz de capacidad solo lo ve el rol admin. */
	esAdmin: boolean;
	seccion: SeccionHistorial;
	onSeccion: (seccion: SeccionHistorial) => void;
	/** Fechas de «Coberturas registradas» (la ruta lo mueve al registrar una). */
	rangoCoberturas: RangoCoberturas;
	onRangoCoberturas: (rango: RangoCoberturas) => void;
	/** Abre un modal de la fila con su asesor. */
	onAccion: (accion: AccionEquipo, asesor: number) => void;
}) {
	const [editando, setEditando] = useState<EdicionCapacidad | null>(null);

	// Sin filtro de bucket: cada bucket se despliega hacia sus asesores.
	const query = useQuery({
		...orpc.getCargaPorAsesorBucket.queryOptions({ input: {} }),
		enabled: habilitado,
	});

	const historial =
		seccion === "traslados" ? (
			<HistorialTrasladosPanel />
		) : seccion === "coberturas" ? (
			<CoberturasRegistradas
				rango={rangoCoberturas}
				onRango={onRangoCoberturas}
			/>
		) : (
			<HistorialReasignaciones />
		);

	return (
		<>
			<AsignacionVista
				resumen={
					<CargaResumenVista
						data={query.data as CargaData | undefined}
						cargando={query.isLoading}
						error={query.isError}
						onReintentar={() => void query.refetch()}
						esAdmin={esAdmin}
						onEditarCapacidad={setEditando}
						onTrasladar={(id) => onAccion("trasladar", id)}
						onMarcarAusente={(id) => onAccion("ausente", id)}
					/>
				}
				seccion={seccion}
				onSeccion={onSeccion}
				historial={historial}
			/>

			{editando && (
				<EditarCapacidadDialog
					key={`${editando.asesorId}-${editando.bucket}`}
					asesorId={editando.asesorId}
					nombre={editando.nombre}
					bucket={editando.bucket}
					cuentas={editando.cuentas}
					capacidadBase={editando.capacidadBase}
					margenAlertaTipo={editando.margenAlertaTipo}
					margenAlertaValor={editando.margenAlertaValor}
					open={!!editando}
					onOpenChange={(next) => {
						if (!next) setEditando(null);
					}}
				/>
			)}
		</>
	);
}
