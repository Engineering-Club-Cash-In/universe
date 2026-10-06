import { ArrowDown, ArrowUp, Target } from "lucide-react";
import {
	KpiCard,
	KpiMeta,
	KpiSimple,
	type KpiTrendTone,
} from "@/components/ds/kpi";
import { Button } from "@/components/ui/button";
import { PeriodSelector } from "@/components/ui/period-selector";
import { SectionHeader } from "@/components/ui/section-header";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * "Mi desempeño" del Dashboard del asesor (Figma › 01 · Dashboard, cards KPI de
 * ds/kpi.tsx). Presentación pura.
 *
 *   Recuperación      → KpiMeta (o KpiSimple con "—" mientras el backend no la mande)
 *   Promesas cumplidas → KpiMeta (cumplidas / pactadas)
 *   Contactabilidad   → KpiSimple (tendencia vs período previo)
 *   Movimiento        → KpiSimple (↓ bajaron ↑ subieron de bucket)
 *   Mora de mi cartera → KpiSimple (suma de la mora de getCobrosDashboardStats)
 * Debajo, compacto: las metas de mora del mes (lo que antes era la card
 * "Metas de Mora" del dashboard).
 */

export type Periodo = "dia" | "semana" | "mes";

export type RecuperacionVista = {
	monto: number;
	montoAnterior: number | null;
	meta: number | null;
};

export type DesempenoVista = {
	recuperacion: RecuperacionVista | null;
	promesas: {
		cumplidas: number;
		pactadas: number;
		cumplidasAnterior: number;
		pactadasAnterior: number;
	};
	contactabilidad: {
		porcentaje: number | null;
		porcentajeAnterior: number | null;
		logrados: number;
		intentos: number;
	};
	movimiento: { bajaron: number; subieron: number; incluyeHoy: boolean };
};

export type MetaMoraVista = {
	categoria: string;
	etiqueta: string;
	/** % real; `undefined` → "—". */
	actual: number | undefined;
	objetivo: number;
};

export type MiDesempenoProps = {
	periodo: Periodo;
	onPeriodo: (p: Periodo) => void;
	desempeno: DesempenoVista | undefined;
	cargando: boolean;
	error: boolean;
	onReintentar: () => void;
	/** Suma de la mora de la cartera (Q). `undefined` mientras carga. */
	moraCartera: number | undefined;
	cargandoMora: boolean;
	metas: MetaMoraVista[];
	/** "octubre de 2026". */
	mesMetas: string;
};

const TEXTOS: Record<
	Periodo,
	{ recuperacion: string; meta: string; comparacion: string }
> = {
	dia: {
		recuperacion: "Recuperación del día",
		meta: "de la meta diaria",
		comparacion: "vs ayer",
	},
	semana: {
		recuperacion: "Recuperación de la semana",
		meta: "de la meta semanal",
		comparacion: "vs semana previa",
	},
	mes: {
		recuperacion: "Recuperación del mes",
		meta: "de la meta mensual",
		comparacion: "vs mes previo",
	},
};

/** Q18.5K · Q0.48M · Q950 (formato de las cards de Figma). */
export function formatoQCompacto(monto: number) {
	const abs = Math.abs(monto);
	if (abs >= 100_000) return `Q${(monto / 1_000_000).toFixed(2)}M`;
	if (abs >= 1_000) {
		return `Q${(monto / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
	}
	return `Q${Math.round(monto).toLocaleString("es-GT")}`;
}

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
	recuperacion: RecuperacionVista | null;
}) {
	const t = TEXTOS[periodo];
	const info =
		"Monto que usted recuperó de su cartera en el período, frente a su meta.";
	if (!recuperacion) {
		return (
			<KpiSimple
				title={t.recuperacion}
				info="Disponible próximamente"
				value="—"
				showIcon={false}
			/>
		);
	}
	const { monto, montoAnterior, meta } = recuperacion;
	const variacion =
		montoAnterior && montoAnterior > 0
			? ((monto - montoAnterior) / montoAnterior) * 100
			: null;
	if (meta === null || meta <= 0) {
		return (
			<KpiSimple
				title={t.recuperacion}
				info={info}
				value={formatoQCompacto(monto)}
				showIcon={false}
				trend={variacion !== null ? tono(variacion) : undefined}
				trendValue={variacion !== null ? conSigno(variacion, "%") : undefined}
				comparison={variacion !== null ? t.comparacion : undefined}
			/>
		);
	}
	const pct = (monto / meta) * 100;
	return (
		<KpiMeta
			title={t.recuperacion}
			info={info}
			value={formatoQCompacto(monto)}
			target={`/ ${formatoQCompacto(meta)}`}
			progress={pct}
			progressLabel={`${Math.round(pct)}% ${t.meta}`}
			trend={variacion !== null ? tono(variacion) : undefined}
			trendValue={variacion !== null ? conSigno(variacion, "%") : undefined}
		/>
	);
}

function CardPromesas({ promesas }: { promesas: DesempenoVista["promesas"] }) {
	const { cumplidas, pactadas, cumplidasAnterior } = promesas;
	const pct = pactadas > 0 ? (cumplidas / pactadas) * 100 : 0;
	const delta = cumplidas - cumplidasAnterior;
	return (
		<KpiMeta
			title="Promesas cumplidas"
			info="Promesas de pago que usted pactó con fecha en el período y que el cliente ya cumplió."
			value={cumplidas.toLocaleString("es-GT")}
			target={`/ ${pactadas.toLocaleString("es-GT")}`}
			progress={pct}
			progressLabel={
				pactadas > 0
					? `${Math.round(pct)}% de cumplimiento`
					: "Sin promesas con fecha en el período"
			}
			trend={tono(delta)}
			trendValue={conSigno(delta)}
		/>
	);
}

function CardContactabilidad({
	periodo,
	contactabilidad,
}: {
	periodo: Periodo;
	contactabilidad: DesempenoVista["contactabilidad"];
}) {
	const { porcentaje, porcentajeAnterior, logrados, intentos } =
		contactabilidad;
	const delta =
		porcentaje !== null && porcentajeAnterior !== null
			? porcentaje - porcentajeAnterior
			: null;
	return (
		<KpiSimple
			title="Contactabilidad"
			info={`Contactos efectivos sobre los intentos que usted realizó en el período (${logrados} de ${intentos}).`}
			value={porcentaje !== null ? `${Math.round(porcentaje)}%` : "—"}
			trend={delta !== null ? tono(delta) : undefined}
			trendValue={delta !== null ? conSigno(delta, "%") : undefined}
			comparison={delta !== null ? TEXTOS[periodo].comparacion : undefined}
		/>
	);
}

function CardMovimiento({
	movimiento,
}: {
	movimiento: DesempenoVista["movimiento"];
}) {
	return (
		<KpiSimple
			title="Movimiento"
			info="Créditos de su cartera que bajaron (↓) o subieron (↑) de bucket en el período. Se actualiza al cierre del día."
			value={
				<span className="inline-flex items-center gap-5">
					<span className="inline-flex items-center gap-0.5 text-success-solid">
						<ArrowDown aria-hidden className="size-6" strokeWidth={2.5} />
						{movimiento.bajaron}
						<span className="sr-only"> bajaron</span>
					</span>
					<span className="inline-flex items-center gap-0.5 text-danger-solid">
						<ArrowUp aria-hidden className="size-6" strokeWidth={2.5} />
						{movimiento.subieron}
						<span className="sr-only"> subieron</span>
					</span>
				</span>
			}
		/>
	);
}

function MetasMora({ metas, mes }: { metas: MetaMoraVista[]; mes: string }) {
	return (
		<div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-line-subtle bg-surface px-5 py-3.5">
			<div className="flex items-center gap-2">
				<Target aria-hidden className="size-4 text-fg-secondary" />
				<span className="type-label-base text-fg">Metas de mora del mes</span>
				<span className="type-caption text-fg-tertiary">{mes}</span>
			</div>
			{metas.map((m) => {
				const cumplida =
					m.actual !== undefined ? m.actual <= m.objetivo : undefined;
				return (
					<div key={m.categoria} className="flex items-baseline gap-2">
						<span className="type-caption text-fg-secondary">{m.etiqueta}</span>
						<span
							className={cn(
								"font-bold text-[15px] tabular-nums leading-[1.26]",
								cumplida === undefined
									? "text-fg"
									: cumplida
										? "text-success-text"
										: "text-danger-text",
							)}
						>
							{m.actual !== undefined ? `${m.actual.toFixed(2)}%` : "—"}
						</span>
						<span className="type-caption text-fg-tertiary">
							meta {m.objetivo.toFixed(2)}%
						</span>
						{m.actual !== undefined ? (
							cumplida ? (
								<span className="font-semibold text-success-text text-xs">
									✓
								</span>
							) : (
								<span className="font-semibold text-danger-text text-xs">
									↑ {(m.actual - m.objetivo).toFixed(2)}%
								</span>
							)
						) : null}
					</div>
				);
			})}
		</div>
	);
}

export function MiDesempeno({
	periodo,
	onPeriodo,
	desempeno,
	cargando,
	error,
	onReintentar,
	moraCartera,
	cargandoMora,
	metas,
	mesMetas,
}: MiDesempenoProps) {
	return (
		<section className="flex flex-col gap-4">
			<SectionHeader
				titleAs="h2"
				title="Mi desempeño"
				description="Su gestión personal"
				action={<PeriodSelector value={periodo} onChange={onPeriodo} />}
			/>
			<div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
				{error && !desempeno ? (
					<KpiCard className="items-start justify-center sm:col-span-2 lg:col-span-2 xl:col-span-4">
						<p className="type-body-base text-fg-secondary">
							No se pudo cargar su desempeño.
						</p>
						<Button variant="outline" size="sm" onClick={onReintentar}>
							Reintentar
						</Button>
					</KpiCard>
				) : cargando && !desempeno ? (
					<>
						<TarjetaCargando />
						<TarjetaCargando />
						<TarjetaCargando />
						<TarjetaCargando />
					</>
				) : desempeno ? (
					<>
						<CardRecuperacion
							periodo={periodo}
							recuperacion={desempeno.recuperacion}
						/>
						<CardPromesas promesas={desempeno.promesas} />
						<CardContactabilidad
							periodo={periodo}
							contactabilidad={desempeno.contactabilidad}
						/>
						<CardMovimiento movimiento={desempeno.movimiento} />
					</>
				) : null}
				{cargandoMora && moraCartera === undefined ? (
					<TarjetaCargando />
				) : (
					<KpiSimple
						title="Mora de mi cartera"
						info="Suma de la mora de los créditos de su cartera que están en mora."
						value={
							moraCartera !== undefined ? formatoQCompacto(moraCartera) : "—"
						}
					/>
				)}
			</div>
			{metas.length > 0 ? <MetasMora metas={metas} mes={mesMetas} /> : null}
		</section>
	);
}
