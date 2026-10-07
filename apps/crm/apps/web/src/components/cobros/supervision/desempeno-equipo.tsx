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
import { COMPARACION, type Periodo } from "./formato";

/**
 * «Desempeño del equipo» del Dashboard del supervisor (Figma `1954:14`): cinco
 * KPI cards de ds/kpi.tsx con el segmentado Día / Semana / Mes. Presentación pura.
 *
 *   Recuperación del equipo   → KpiMeta (monto / meta). Sin fuente: «—» (tarea S3).
 *   Cuentas curadas           → KpiMeta (curadas / total). Sin fuente: «—» (S3).
 *   Contactabilidad del equipo → KpiSimple: efectivos / total de getHistorialAgendasResumen,
 *                               con la tendencia contra el período anterior.
 *   Migración de bucket       → KpiSimple: ↓ bajaron (recuperados) ↑ subieron
 *                               (escalados), del cierre diario.
 *   Promesas cumplidas        → KpiSimple con el % y el monto incumplido. Sin fuente: «—» (S3).
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
	/** `null` = sin fuente (S3); `undefined` = cargando. */
	recuperacion: RecuperacionEquipo | null | undefined;
	cuentasCuradas: CuentasCuradas | null | undefined;
	promesas: PromesasEquipo | null | undefined;
	contactabilidad: ContactabilidadEquipo | undefined;
	migracion: MigracionBucket | undefined;
	/** Errores de las dos fuentes reales: la card muestra «—» con la causa. */
	errorContactabilidad?: boolean;
	errorMigracion?: boolean;
};

const META_TEXTO: Record<Periodo, string> = {
	dia: "de la meta del día",
	semana: "de la meta de la semana",
	mes: "de la meta del mes",
};

const PRONTO = "Pronto: este indicador todavía no está disponible.";

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
			<KpiSimple title={titulo} info={PRONTO} value="—" showIcon={false} />
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
			<KpiSimple title={titulo} info={PRONTO} value="—" showIcon={false} />
		);
	}
	const delta =
		cuentas.curadasAnterior !== null
			? cuentas.curadas - cuentas.curadasAnterior
			: null;
	return (
		<KpiMeta
			title={titulo}
			info="Créditos que quedaron sin mora y siguen en su bucket."
			value={cuentas.curadas.toLocaleString("es-GT")}
			target={`/ ${cuentas.total.toLocaleString("es-GT")}`}
			progress={cuentas.total > 0 ? (cuentas.curadas / cuentas.total) * 100 : 0}
			progressLabel="sin mora, siguen en su bucket"
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
				info={error ? "No se pudo cargar el historial de gestiones." : PRONTO}
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
				info={error ? "No se pudo cargar el cierre diario." : PRONTO}
				value="—"
			/>
		);
	}
	return (
		<KpiSimple
			title={titulo}
			info="Créditos del equipo que bajaron de bucket (recuperados, ↓) o subieron (escalados, ↑) en el período. Sale del cierre diario: el día en curso se suma después del cierre de las 22:00."
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
		return <KpiSimple title={titulo} info={PRONTO} value="—" />;
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
}: DesempenoEquipoProps) {
	return (
		<section className="flex flex-col gap-4">
			<SectionHeader
				titleAs="h2"
				title="Desempeño del equipo"
				description="Resumen de KPIs de sus carteras y de su equipo."
				action={<PeriodSelector value={periodo} onChange={onPeriodo} />}
				className="flex-wrap"
			/>
			<div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
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
