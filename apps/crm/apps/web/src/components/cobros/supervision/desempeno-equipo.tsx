import { ArrowDown, ArrowUp } from "lucide-react";
import { formatoQCompacto } from "@/components/cobros/asesor/mi-desempeno";
import {
	KpiCard,
	KpiMeta,
	KpiSimple,
	type KpiTrendTone,
} from "@/components/ds/kpi";
import { PeriodSelector } from "@/components/ui/period-selector";
import { SectionHeader } from "@/components/ui/section-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { COMPARACION, type Periodo } from "./formato";

/**
 * «Desempeño del equipo» del Dashboard del supervisor (Figma `1954:14`): cinco
 * KPI cards de ds/kpi.tsx con el segmentado Día / Semana / Mes. Presentación pura.
 *
 *   Recuperación del equipo   → KpiMeta (monto / meta) de getSupervisionComplementos (S3).
 *   Cuentas curadas           → KpiMeta: créditos del equipo que bajaron de bucket en
 *                               el período, sobre las cuentas del equipo con mora hoy (S3).
 *   Contactabilidad del equipo → KpiSimple: efectivos / total de getHistorialAgendasResumen,
 *                               con la tendencia contra el período anterior.
 *   Migración de bucket       → KpiSimple: ↓ bajaron (recuperados) ↑ subieron
 *                               (escalados), del cierre diario.
 *   Promesas cumplidas        → KpiSimple con el % y el monto incumplido (S3).
 *
 * Las consultas guardan el período anterior mientras llega el nuevo
 * (`keepPreviousData`): `actualizando` atenúa las tarjetas y muestra un spinner
 * junto al segmentado para que no parezca que los números «no cambian».
 */

export type RecuperacionEquipo = {
	monto: number;
	meta: number | null;
	montoAnterior: number | null;
};

export type CuentasCuradas = {
	curadas: number;
	total: number;
	curadasAnterior: number | null;
};

export type PromesasEquipo = {
	cumplidas: number;
	pactadas: number;
	montoIncumplido: number;
};

export type ContactabilidadEquipo = {
	efectivos: number;
	total: number;
	/** % del período anterior (null si no hubo contactos). */
	porcentajeAnterior: number | null;
};

export type MigracionBucket = {
	bajaron: number;
	subieron: number;
};

export type DesempenoEquipoProps = {
	periodo: Periodo;
	onPeriodo: (p: Periodo) => void;
	/** `null` = la fuente no respondió («—»); `undefined` = cargando. */
	recuperacion: RecuperacionEquipo | null | undefined;
	cuentasCuradas: CuentasCuradas | null | undefined;
	promesas: PromesasEquipo | null | undefined;
	contactabilidad: ContactabilidadEquipo | undefined;
	migracion: MigracionBucket | undefined;
	/** Errores de las dos fuentes reales: la card muestra «—» con la causa. */
	errorContactabilidad?: boolean;
	errorMigracion?: boolean;
	/** Llega el período nuevo y las tarjetas todavía muestran el anterior. */
	actualizando?: boolean;
};

const META_TEXTO: Record<Periodo, string> = {
	dia: "de la meta del día",
	semana: "de la meta de la semana",
	mes: "de la meta del mes",
};

/** El servidor manda `null` cuando una fuente no respondió (cada bloque falla solo). */
const SIN_DATO =
	"No se pudo calcular este indicador en este momento. Intente de nuevo más tarde.";

function tono(delta: number): KpiTrendTone {
	return delta > 0 ? "positiva" : delta < 0 ? "negativa" : "neutra";
}

function conSigno(n: number, sufijo = "") {
	const r = Math.round(n * 10) / 10;
	return `${r > 0 ? "+" : ""}${r.toLocaleString("es-GT")}${sufijo}`;
}

function TarjetaCargando() {
	return (
		<KpiCard aria-hidden>
			<Skeleton className="h-3.5 w-1/2" />
			<Skeleton className="h-9 w-2/3" />
			<Skeleton className="h-2.5 w-full" />
		</KpiCard>
	);
}

function CardRecuperacion({
	periodo,
	recuperacion,
}: {
	periodo: Periodo;
	recuperacion: RecuperacionEquipo | null;
}) {
	const titulo = "Recuperación del equipo";
	if (!recuperacion) {
		return (
			<KpiSimple title={titulo} info={SIN_DATO} value="—" showIcon={false} />
		);
	}
	const { monto, meta, montoAnterior } = recuperacion;
	const variacion =
		montoAnterior && montoAnterior > 0
			? ((monto - montoAnterior) / montoAnterior) * 100
			: null;
	const info =
		"Monto recuperado por el equipo en el período, frente a la meta.";
	if (meta === null || meta <= 0) {
		return (
			<KpiSimple
				title={titulo}
				info={info}
				value={formatoQCompacto(monto)}
				showIcon={false}
				trend={variacion !== null ? tono(variacion) : undefined}
				trendValue={variacion !== null ? conSigno(variacion, "%") : undefined}
				comparison={variacion !== null ? COMPARACION[periodo] : undefined}
			/>
		);
	}
	const pct = (monto / meta) * 100;
	return (
		<KpiMeta
			title={titulo}
			info={info}
			value={formatoQCompacto(monto)}
			target={`/ ${formatoQCompacto(meta)}`}
			progress={pct}
			progressLabel={`${Math.round(pct)}% ${META_TEXTO[periodo]}`}
			trend={variacion !== null ? tono(variacion) : undefined}
			trendValue={variacion !== null ? conSigno(variacion, "%") : undefined}
		/>
	);
}

function CardCuentasCuradas({ cuentas }: { cuentas: CuentasCuradas | null }) {
	const titulo = "Cuentas curadas";
	if (!cuentas) {
		return (
			<KpiSimple title={titulo} info={SIN_DATO} value="—" showIcon={false} />
		);
	}
	const delta =
		cuentas.curadasAnterior !== null
			? cuentas.curadas - cuentas.curadasAnterior
			: null;
	return (
		<KpiMeta
			title={titulo}
			info={`Créditos del equipo que bajaron de bucket en el período (${cuentas.curadas.toLocaleString("es-GT")}), sobre las cuentas del equipo con mora hoy (B1 en adelante, ${cuentas.total.toLocaleString("es-GT")}). Incluye los movimientos de hoy.`}
			value={cuentas.curadas.toLocaleString("es-GT")}
			target={`/ ${cuentas.total.toLocaleString("es-GT")}`}
			progress={cuentas.total > 0 ? (cuentas.curadas / cuentas.total) * 100 : 0}
			progressLabel="bajaron de bucket en el período"
			trend={delta !== null ? tono(delta) : undefined}
			trendValue={delta !== null ? conSigno(delta) : undefined}
		/>
	);
}

function CardContactabilidad({
	periodo,
	contactabilidad,
	error,
}: {
	periodo: Periodo;
	contactabilidad: ContactabilidadEquipo | undefined;
	error?: boolean;
}) {
	const titulo = "Contactabilidad del equipo";
	if (!contactabilidad) {
		return (
			<KpiSimple
				title={titulo}
				info={error ? "No se pudo cargar el historial de gestiones." : SIN_DATO}
				value="—"
			/>
		);
	}
	const { efectivos, total, porcentajeAnterior } = contactabilidad;
	const porcentaje = total > 0 ? (efectivos / total) * 100 : null;
	const delta =
		porcentaje !== null && porcentajeAnterior !== null
			? porcentaje - porcentajeAnterior
			: null;
	return (
		<KpiSimple
			title={titulo}
			info={`Contactos efectivos sobre las gestiones registradas por el equipo en el período (${efectivos.toLocaleString("es-GT")} de ${total.toLocaleString("es-GT")}). No cuenta los envíos automáticos.`}
			value={porcentaje !== null ? `${Math.round(porcentaje)}%` : "—"}
			trend={delta !== null ? tono(delta) : undefined}
			trendValue={delta !== null ? conSigno(delta, "%") : undefined}
			comparison={delta !== null ? COMPARACION[periodo] : undefined}
		/>
	);
}

function CardMigracion({
	migracion,
	error,
}: {
	migracion: MigracionBucket | undefined;
	error?: boolean;
}) {
	const titulo = "Migración de bucket";
	if (!migracion) {
		return (
			<KpiSimple
				title={titulo}
				info={error ? "No se pudo cargar el cierre diario." : SIN_DATO}
				value="—"
			/>
		);
	}
	return (
		<KpiSimple
			title={titulo}
			info="Créditos del equipo que bajaron de bucket (recuperados, ↓) o subieron (escalados, ↑) en el período. Sale del cierre diario, que corre a las 00:15 del día siguiente: lo de hoy se suma después de ese cierre."
			value={
				<span className="inline-flex items-center gap-5">
					<span className="inline-flex items-center gap-0.5 text-success-solid">
						<ArrowDown aria-hidden className="size-6" strokeWidth={2.5} />
						{migracion.bajaron.toLocaleString("es-GT")}
						<span className="sr-only"> recuperados</span>
					</span>
					<span className="inline-flex items-center gap-0.5 text-danger-solid">
						<ArrowUp aria-hidden className="size-6" strokeWidth={2.5} />
						{migracion.subieron.toLocaleString("es-GT")}
						<span className="sr-only"> escalados</span>
					</span>
				</span>
			}
			showTrend
			comparison="recuperados · escalados"
		/>
	);
}

function CardPromesas({ promesas }: { promesas: PromesasEquipo | null }) {
	const titulo = "Promesas cumplidas";
	if (!promesas) {
		return <KpiSimple title={titulo} info={SIN_DATO} value="—" />;
	}
	const pct =
		promesas.pactadas > 0
			? (promesas.cumplidas / promesas.pactadas) * 100
			: null;
	return (
		<KpiSimple
			title={titulo}
			info={`Promesas de pago del equipo con fecha en el período que el cliente cumplió (${promesas.cumplidas} de ${promesas.pactadas}).`}
			value={pct !== null ? `${Math.round(pct)}%` : "—"}
			trend={promesas.montoIncumplido > 0 ? "negativa" : "neutra"}
			trendValue={
				promesas.montoIncumplido > 0
					? `−${formatoQCompacto(promesas.montoIncumplido)}`
					: undefined
			}
			comparison={promesas.montoIncumplido > 0 ? "sin pagar" : undefined}
		/>
	);
}

export function DesempenoEquipo({
	periodo,
	onPeriodo,
	recuperacion,
	cuentasCuradas,
	promesas,
	contactabilidad,
	migracion,
	errorContactabilidad,
	errorMigracion,
	actualizando,
}: DesempenoEquipoProps) {
	return (
		<section className="flex flex-col gap-4">
			<SectionHeader
				titleAs="h2"
				title="Desempeño del equipo"
				description="Resumen de KPIs de sus carteras y de su equipo."
				action={
					<div className="flex items-center gap-2.5">
						{actualizando ? (
							<Spinner size="sm" label="Actualizando el período" />
						) : null}
						<PeriodSelector value={periodo} onChange={onPeriodo} />
					</div>
				}
				className="flex-wrap"
			/>
			<div
				aria-busy={actualizando || undefined}
				className={cn(
					"grid gap-5 transition-opacity duration-150 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5",
					actualizando && "opacity-60",
				)}
			>
				{recuperacion === undefined ? (
					<TarjetaCargando />
				) : (
					<CardRecuperacion periodo={periodo} recuperacion={recuperacion} />
				)}
				{cuentasCuradas === undefined ? (
					<TarjetaCargando />
				) : (
					<CardCuentasCuradas cuentas={cuentasCuradas} />
				)}
				{contactabilidad === undefined && !errorContactabilidad ? (
					<TarjetaCargando />
				) : (
					<CardContactabilidad
						periodo={periodo}
						contactabilidad={contactabilidad}
						error={errorContactabilidad}
					/>
				)}
				{migracion === undefined && !errorMigracion ? (
					<TarjetaCargando />
				) : (
					<CardMigracion migracion={migracion} error={errorMigracion} />
				)}
				{promesas === undefined ? (
					<TarjetaCargando />
				) : (
					<CardPromesas promesas={promesas} />
				)}
			</div>
		</section>
	);
}
