import {
	ArrowDown,
	ArrowUp,
	Loader2,
	TrendingDown,
	TrendingUp,
} from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import { CampoFecha } from "@/components/cobros/campo-fecha";
import { CrmPill, inicialesDe } from "@/components/ds/cards-credito";
import { KpiMeta, KpiSimple } from "@/components/ds/kpi";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import {
	type BucketsCatalogoQueryData,
	catalogoDeNumero,
} from "@/lib/cobros/buckets-catalogo";
import {
	AvatarSuave,
	bucketId,
	ChipBucket,
	EncabezadoVistaDia,
	FilaDesplegable,
	FilasCargando,
	fechaCorta,
	KpisCargando,
	montoCompacto,
	montoQ,
	nombreBucket,
	PuntoBucket,
	PuntoLista,
	plural,
	SubFila,
	TarjetaReporte,
	TiraResumen,
	TituloGrupo,
	tonoNeto,
	ValorNota,
} from "./piezas";

/**
 * Apertura del día (CB-023) en «Mi equipo» › Día, con el lenguaje de Reportería
 * del Figma («Migración de bucket» 3550:5760 y «B3 · Rescate» 3537:5283). La
 * página vieja `/cobros/apertura` redirige a `/cobros/equipo?tab=dia&vista=apertura`.
 * Presentación pura: el contenedor (`apertura.tsx`) hace la consulta
 * `getAperturaDia` y el showcase la pinta con datos de ejemplo.
 *
 *   Encabezado      título, fecha de la apertura y controles (selector de vista y
 *                   fecha: hoy GT − 7 días … hoy, con spinner al recargar).
 *   KPIs            Cumplimiento de ayer · Movimientos de la noche (↓ ↑ y neto) ·
 *                   Cuentas críticas (por bucket) · Asignación del día.
 *   Franja          neto de la noche, cuentas que saltaron más de un bucket y lo
 *                   cobrado ayer (montos exactos).
 *   Casos críticos  una fila por bucket (los seis, ordenados por foco: del más
 *                   alto al más bajo) que se despliega hacia sus 3 cuentas de
 *                   mayor monto adeudado. Clic en una cuenta → ficha.
 *   Entradas        «Entradas y salidas» del Figma: a qué bucket entró cada
 *                   cuenta y de dónde venía; cada renglón filtra la lista.
 *   Asignación      una sub-fila por asesor: pool, orígenes ×n e ingresos.
 *   Lista           «Cuentas que cambiaron de bucket», filtrable por bucket
 *                   destino. Clic → ficha.
 */

// ─── Tipos del payload de getAperturaDia ─────────────────────────────────────
//
// Espejo local de los `Apertura*` de apps/server/src/types/cartera-back.ts.
// Importarlos de allá sería lo correcto, pero hoy el tsconfig del web no
// resuelve los .d.ts del server (TS6305: falta el build de `dist`), y sin
// resolución los tipos degradan a `any` — peor que la duplicación. Mantener
// ambos lados sincronizados a mano hasta que se arregle la referencia del
// proyecto; si cambia la forma del endpoint, actualizar los dos archivos.

interface Top3Fila {
	credito_id: number;
	numero_credito_sifco: string | null;
	cliente: string | null;
	bucket: number;
	status_credito: string;
	cuotas_vencidas: number;
	monto_cuota: number;
	monto_mora: number;
	monto_adeudado: number;
	dias_mora: number;
	asesor_id: number | null;
	asesor: string | null;
}

interface Top3Bucket {
	bucket: number;
	total_criticos: number;
	peor_monto: number;
	top: Top3Fila[];
}

interface CuentasNuevasOrigen {
	desde: number;
	tipo: "SUBIDA" | "BAJADA";
	cantidad: number;
}

interface CuentasNuevas {
	bucket: number;
	entradas: number;
	subidas: number;
	bajadas: number;
	origenes: CuentasNuevasOrigen[];
}

/** Un crédito que cambió de bucket hoy. */
interface Movimiento {
	credito_id: number;
	numero_credito_sifco: string | null;
	cliente: string | null;
	bucket_anterior: number | null;
	bucket_nuevo: number;
	tipo_evento: "SUBIDA" | "BAJADA";
	saltos: number;
	status_credito: string | null;
	cuotas_vencidas: number;
	monto_cuota: number;
	monto_mora: number;
	monto_adeudado: number;
	dias_mora: number;
	asesor_id: number | null;
	asesor: string | null;
	fecha: string;
}

interface Cumplimiento {
	fecha: string;
	cuentas_esperadas: number;
	cuentas_pagadas: number;
	pct: number;
	monto_esperado: number;
	monto_pagado: number;
}

/**
 * Ingreso agregado al bucket del asesor: "2 cuentas entraron desde B1".
 * No distingue subida de bajada: para quien recibe, ambas son trabajo nuevo.
 */
interface AsignacionBucket {
	desde: number | null;
	bucket: number; // destino (= bucket que atiende el asesor)
	cantidad: number;
}

interface AsignacionAsesor {
	asesor_id: number | null;
	asesor: string | null;
	/** Cuentas que entraron hoy al bucket del asesor. */
	ingresos: number;
	/** Bucket(s) del pool del asesor: a qué está asignado a atender. */
	buckets_pool: number[];
	porBucket: AsignacionBucket[];
}

export interface AperturaResponse {
	fecha: string;
	cuentas_nuevas: CuentasNuevas[];
	cumplimiento: Cumplimiento;
	top3: Top3Bucket[];
	asignacion: AsignacionAsesor[];
	movimientos: Movimiento[];
}
// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Hoy en Guatemala (YYYY-MM-DD). NO usar `new Date()` a secas: eso da el día
 * del navegador, así que un usuario en otra zona horaria podría elegir un
 * "mañana" que en GT todavía no existe — y el backend calcula todo en GT.
 */
export function hoyGT() {
	return new Date().toLocaleDateString("sv-SE", {
		timeZone: "America/Guatemala",
	});
}

// Ventana fiel de la apertura: hoy y hasta 7 días atrás. Igual que
// APERTURA_DIAS_ATRAS en cartera-back (routers/buckets.ts) — fuera de esta
// ventana el backend responde 400 porque el dueño/status del crédito no son
// reconstruibles. Acotar el date picker evita que el usuario pida un 400.
const APERTURA_DIAS_ATRAS = 7;

/** Fecha mínima elegible (hoy GT − 7 días), en YYYY-MM-DD. */
export function minFechaGT() {
	const [y, m, d] = hoyGT().split("-").map(Number);
	const min = new Date(Date.UTC(y, m - 1, d - APERTURA_DIAS_ATRAS));
	return min.toISOString().slice(0, 10);
}

// Todos los buckets del catálogo (0-5) — así la lista muestra SIEMPRE las 6
// filas aunque un bucket no tenga críticos (un bucket vacío es información, no
// ausencia — decisión CB-023). Se devuelven números de bucket estables (0-5),
// NO `orden` (presentación, reordenable), ordenados por `orden` del catálogo.
const BUCKET_NUMEROS = [0, 1, 2, 3, 4, 5] as const;
function bucketsOrdenados(catalogo: BucketsCatalogoQueryData | undefined) {
	if (!catalogo || catalogo.length === 0) return [...BUCKET_NUMEROS];
	return [...BUCKET_NUMEROS].sort(
		(a, b) =>
			(catalogoDeNumero(a, catalogo)?.orden ?? a) -
			(catalogoDeNumero(b, catalogo)?.orden ?? b),
	);
}

const suma = (valores: number[]) => valores.reduce((s, v) => s + v, 0);

/** «B3» (o «B?» si el número no es un bucket del funnel). */
function codigo(numero: number | null) {
	return numero == null ? "—" : (bucketId(numero) ?? `B${numero}`);
}

/** «4 desde B2 (deterioro) · 3 desde B4 (recuperación)». */
function textoOrigenes(origenes: CuentasNuevasOrigen[]) {
	return origenes
		.map(
			(o) =>
				`${o.cantidad} desde ${codigo(o.desde)} (${o.tipo === "SUBIDA" ? "deterioro" : "recuperación"})`,
		)
		.join(" · ");
}

/** Valor de «Movimientos de la noche»: ↓ bajaron (verde) ↑ subieron (rojo). */
function ValorFlechas({
	bajaron,
	subieron,
}: {
	bajaron: number;
	subieron: number;
}) {
	return (
		<span className="inline-flex items-center gap-5">
			<span className="inline-flex items-center gap-0.5 text-success-solid">
				<ArrowDown aria-hidden className="size-6" strokeWidth={2.5} />
				{bajaron.toLocaleString("es-GT")}
				<span className="sr-only"> bajaron</span>
			</span>
			<span className="inline-flex items-center gap-0.5 text-danger-solid">
				<ArrowUp aria-hidden className="size-6" strokeWidth={2.5} />
				{subieron.toLocaleString("es-GT")}
				<span className="sr-only"> subieron</span>
			</span>
		</span>
	);
}

/** Píldora chica de la fila («4 riesgo» del Figma). */
function Pildora({
	tono,
	children,
}: {
	tono: "danger" | "warning" | "neutral" | "brand";
	children: React.ReactNode;
}) {
	return (
		<CrmPill
			tone={tono}
			kind="chip"
			dot={false}
			className="px-2 py-0.5 font-semibold text-[10px]"
		>
			{children}
		</CrmPill>
	);
}

export type AperturaVistaProps = {
	apertura: AperturaResponse | undefined;
	catalogo: BucketsCatalogoQueryData | undefined;
	/** YYYY-MM-DD; vacío = hoy (lo resuelve el server). */
	fecha: string;
	onFecha: (fecha: string) => void;
	cargando: boolean;
	recargando: boolean;
	error: boolean;
	/** Abre la Ficha 360 del crédito (por número SIFCO). */
	onAbrirCaso: (numeroCreditoSifco: string) => void;
	/** Vuelve a pedir la apertura (botón del estado de error). */
	onReintentar?: () => void;
	/** Selector Apertura / Cierre / Gestiones (lo pone la pestaña Día). */
	selector?: React.ReactNode;
	/** Bucket de «Casos críticos» desplegado al entrar (por defecto, ninguno). */
	bucketAbiertoInicial?: number | null;
};

export function AperturaVista({
	apertura,
	catalogo,
	fecha,
	onFecha,
	cargando,
	recargando,
	error,
	onAbrirCaso,
	onReintentar,
	selector,
	bucketAbiertoInicial = null,
}: AperturaVistaProps) {
	return (
		<div className="flex min-w-0 flex-col gap-5">
			<EncabezadoVistaDia
				titulo="Apertura del día"
				descripcion={
					apertura
						? `Casos críticos y movimientos de la noche · ${fechaCorta(apertura.fecha)}`
						: "Casos críticos y movimientos de la noche para iniciar la jornada"
				}
				controles={
					<>
						{selector}
						{/* Spinner discreto al recargar por cambio de fecha: sin él la
						    vista se queda mostrando el día anterior sin avisar. */}
						{recargando ? (
							<Loader2
								aria-label="Actualizando"
								className="size-4 animate-spin text-fg-tertiary"
							/>
						) : null}
						<Label htmlFor="apertura-fecha" className="sr-only">
							Fecha de la apertura
						</Label>
						<CampoFecha
							id="apertura-fecha"
							className="h-9 w-40 rounded-lg px-3 text-[13px]"
							max={hoyGT()}
							min={minFechaGT()}
							onChange={onFecha}
							placeholder="Hoy"
							value={fecha}
						/>
					</>
				}
			/>

			{cargando ? (
				<>
					<KpisCargando />
					<FilasCargando cantidad={6} />
				</>
			) : error ? (
				<EmptyState
					variant="error"
					size="sm"
					title="No se pudo cargar la apertura del día"
					description="Intente de nuevo en unos segundos."
					action={
						onReintentar ? (
							<Button variant="outline" size="sm" onClick={onReintentar}>
								Reintentar
							</Button>
						) : undefined
					}
				/>
			) : apertura ? (
				<CuerpoApertura
					apertura={apertura}
					catalogo={catalogo}
					onAbrirCaso={onAbrirCaso}
					bucketAbiertoInicial={bucketAbiertoInicial}
				/>
			) : null}
		</div>
	);
}

function CuerpoApertura({
	apertura,
	catalogo,
	onAbrirCaso,
	bucketAbiertoInicial,
}: {
	apertura: AperturaResponse;
	catalogo: BucketsCatalogoQueryData | undefined;
	onAbrirCaso: (numeroCreditoSifco: string) => void;
	bucketAbiertoInicial: number | null;
}) {
	// Bucket desplegado en «Casos críticos» (uno a la vez para no llenar la pantalla).
	const [abierto, setAbierto] = useState<number | null>(bucketAbiertoInicial);
	// Filtro de la lista de movimientos: null = todos, o el bucket DESTINO.
	const [bucketFiltro, setBucketFiltro] = useState<number | null>(null);

	const { cumplimiento } = apertura;
	const cuentasNuevas = apertura.cuentas_nuevas ?? [];
	const movimientos = apertura.movimientos ?? [];
	const asignacion = apertura.asignacion ?? [];
	const top3PorBucket = new Map<number, Top3Bucket>(
		(apertura.top3 ?? []).map((t) => [t.bucket, t]),
	);
	const nuevasPorBucket = new Map<number, CuentasNuevas>(
		cuentasNuevas.map((c) => [c.bucket, c]),
	);
	// «Ordenado por foco» (Figma): del bucket más alto al más bajo.
	const porFoco = bucketsOrdenados(catalogo).reverse();

	const subidas = suma(cuentasNuevas.map((c) => c.subidas));
	const bajadas = suma(cuentasNuevas.map((c) => c.bajadas));
	const neto = bajadas - subidas;
	const criticos = suma((apertura.top3 ?? []).map((t) => t.total_criticos));
	const bucketsCriticos = porFoco
		.map((n) => top3PorBucket.get(n))
		.filter((t): t is Top3Bucket => !!t && t.total_criticos > 0)
		.sort((a, b) => b.total_criticos - a.total_criticos);
	const saltaron = movimientos.filter((m) => m.saltos > 1).length;
	const ingresos = suma(asignacion.map((a) => a.ingresos));
	const asesoresConIngresos = asignacion.filter((a) => a.asesor_id != null);
	const sinAsesor = asignacion
		.filter((a) => a.asesor_id == null)
		.reduce((s, a) => s + a.ingresos, 0);
	const hayEsperadas = cumplimiento.cuentas_esperadas > 0;

	// Filtrado en memoria: son los movimientos de UN día (decenas), así el
	// filtro responde al instante sin volver al server.
	const movimientosFiltrados = movimientos.filter(
		(m) => bucketFiltro === null || m.bucket_nuevo === bucketFiltro,
	);
	const entradas = porFoco
		.map((n) => nuevasPorBucket.get(n))
		.filter((c): c is CuentasNuevas => !!c && c.entradas > 0);
	const asignacionOrdenada = [...asignacion].sort(
		(a, b) => b.ingresos - a.ingresos,
	);

	return (
		<>
			<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
				{hayEsperadas ? (
					<KpiMeta
						title="Cumplimiento de ayer"
						info={`Cuentas con cuota que vencía el ${fechaCorta(cumplimiento.fecha)} y que ya pagaron.`}
						value={`${cumplimiento.pct}%`}
						progress={cumplimiento.pct}
						progressLabel={`${cumplimiento.cuentas_pagadas.toLocaleString("es-GT")} de ${plural(cumplimiento.cuentas_esperadas, "cuenta pagó", "cuentas pagaron")}`}
					/>
				) : (
					<KpiSimple
						title="Cumplimiento de ayer"
						value="—"
						showIcon={false}
						showTrend
						comparison="No había cuotas con vencimiento ayer."
					/>
				)}
				<KpiSimple
					title="Movimientos de la noche"
					info="Cuentas que entraron a otro bucket con el corte de la noche: ↓ bajaron (mejoraron) y ↑ subieron (empeoraron). El neto es bajadas menos subidas."
					value={<ValorFlechas bajaron={bajadas} subieron={subidas} />}
					trend={tonoNeto(neto)}
					trendValue={`${neto > 0 ? "+" : ""}${neto} neto`}
					comparison="bajaron · subieron"
				/>
				{/* KPI/Simple (no Desglose) para que la fila quede pareja: el
				    reparto por bucket cabe en la línea de comparación. */}
				<KpiSimple
					title="Cuentas críticas"
					info="Cuentas con al menos una cuota vencida, en todos los buckets."
					value={
						<span className={criticos > 0 ? "text-danger-text" : undefined}>
							{criticos.toLocaleString("es-GT")}
						</span>
					}
					showIcon={false}
					showTrend
					comparison={
						criticos > 0
							? bucketsCriticos
									.slice(0, 3)
									.map((t) => `${t.total_criticos} en ${codigo(t.bucket)}`)
									.join(" · ")
							: "Ninguna cuenta con cuota vencida."
					}
				/>
				<KpiSimple
					title="Asignación del día"
					info="Cuentas que hoy entraron al bucket de cada asesor: trabajo nuevo, sin importar si subieron o bajaron."
					value={ingresos.toLocaleString("es-GT")}
					showIcon={false}
					showTrend
					comparison={
						sinAsesor > 0
							? `para ${plural(asesoresConIngresos.length, "asesor", "asesores")} · ${sinAsesor} sin asesor`
							: `para ${plural(asesoresConIngresos.length, "asesor", "asesores")}`
					}
				/>
			</div>

			<TiraResumen
				items={[
					{
						etiqueta: "Neto de la noche",
						valor:
							neto > 0
								? `+${neto} a favor (bajan)`
								: neto < 0
									? `${neto} en contra (suben)`
									: "sin cambio",
						tono: neto > 0 ? "success" : neto < 0 ? "danger" : "neutral",
					},
					{
						etiqueta: "Saltaron más de un bucket",
						valor: plural(saltaron, "cuenta", "cuentas"),
						tono: saltaron > 0 ? "danger" : "neutral",
					},
					...(hayEsperadas
						? [
								{
									etiqueta: "Cobrado ayer",
									valor: `${montoQ(cumplimiento.monto_pagado)} de ${montoQ(cumplimiento.monto_esperado)}`,
								},
							]
						: []),
				]}
			/>

			{/* Casos críticos por bucket — filas que se despliegan (una a la vez) */}
			<section className="flex flex-col gap-2">
				<TituloGrupo
					titulo="Casos críticos por bucket"
					ayuda="Las 3 cuentas de mayor monto adeudado · toque un bucket para verlas"
				/>
				{porFoco.map((n) => {
					const grupo = top3PorBucket.get(n);
					const total = grupo?.total_criticos ?? 0;
					const top = grupo?.top ?? [];
					const estaAbierto = abierto === n;
					return (
						<FilaDesplegable
							key={n}
							abierta={estaAbierto}
							onToggle={
								top.length > 0
									? () => setAbierto(estaAbierto ? null : n)
									: undefined
							}
							etiqueta={`${codigo(n)} · ${nombreBucket(n, catalogo)}: ${plural(total, "cuenta crítica", "cuentas críticas")}`}
							inicio={<ChipBucket numero={n} catalogo={catalogo} />}
							titulo={nombreBucket(n, catalogo)}
							subtitulo={
								total > 0 ? "cuentas con cuota vencida" : "sin cuentas críticas"
							}
							fin={
								total > 0 && grupo ? (
									<>
										<Pildora tono="danger">
											{plural(total, "crítica", "críticas")}
										</Pildora>
										<ValorNota
											valor={montoCompacto(grupo.peor_monto)}
											nota="monto más alto"
										/>
									</>
								) : (
									<ValorNota valor="—" />
								)
							}
						>
							{top.map((fila) => (
								<SubFila
									key={fila.credito_id}
									// El detalle se abre por número SIFCO (caso de cobros), igual
									// que la Agenda. Sin SIFCO no hay a dónde navegar.
									onClick={
										fila.numero_credito_sifco
											? () => onAbrirCaso(fila.numero_credito_sifco as string)
											: undefined
									}
									etiqueta={`Abrir la ficha de ${fila.cliente ?? "este crédito"}`}
									inicio={
										<AvatarSuave
											iniciales={inicialesDe(fila.cliente ?? "") || "?"}
											neutro
										/>
									}
									titulo={fila.cliente ?? "—"}
									subtitulo={[
										fila.numero_credito_sifco ?? fila.credito_id,
										`${fila.dias_mora} días`,
										plural(
											fila.cuotas_vencidas,
											"cuota vencida",
											"cuotas vencidas",
										),
										fila.asesor ?? "Sin asesor",
									].join(" · ")}
									fin={
										<ValorNota
											tamano="sm"
											valor={montoQ(fila.monto_adeudado)}
											nota={`adeudado · cuota ${montoQ(fila.monto_cuota)}`}
										/>
									}
								/>
							))}
							{total > top.length ? (
								<p className="px-1 pt-0.5 text-[11px] text-fg-tertiary leading-[1.26]">
									Se muestran {top.length} de{" "}
									{plural(total, "cuenta crítica", "cuentas críticas")} en este
									bucket.
								</p>
							) : null}
						</FilaDesplegable>
					);
				})}
			</section>

			<div className="grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
				<div className="flex min-w-0 flex-col gap-4">
					{/* «Entradas y salidas» del Figma: cada renglón filtra la lista. */}
					<TarjetaReporte
						titulo="Entradas de la noche"
						descripcion="A qué bucket entró cada cuenta y de dónde venía · toque uno para filtrar la lista"
					>
						{entradas.length === 0 ? (
							<p className="text-fg-tertiary text-sm">
								Sin movimientos de bucket hoy.
							</p>
						) : (
							<div className="-mx-2.5 flex flex-col gap-0.5">
								<PuntoLista
									punto={
										<span
											aria-hidden
											className="size-2 shrink-0 rounded-full bg-fg-tertiary"
										/>
									}
									numero={movimientos.length.toLocaleString("es-GT")}
									texto={
										movimientos.length === 1
											? "cuenta cambió de bucket"
											: "cuentas cambiaron de bucket"
									}
									seleccionado={bucketFiltro === null}
									onClick={() => setBucketFiltro(null)}
								/>
								{entradas.map((c) => (
									<PuntoLista
										key={c.bucket}
										punto={<PuntoBucket numero={c.bucket} />}
										numero={c.entradas.toLocaleString("es-GT")}
										texto={`${c.entradas === 1 ? "entró" : "entraron"} a ${codigo(c.bucket)} · ${nombreBucket(c.bucket, catalogo)}`}
										detalle={
											c.origenes.length > 0
												? textoOrigenes(c.origenes)
												: undefined
										}
										seleccionado={bucketFiltro === c.bucket}
										onClick={() =>
											setBucketFiltro(
												bucketFiltro === c.bucket ? null : c.bucket,
											)
										}
									/>
								))}
							</div>
						)}
					</TarjetaReporte>

					{/* Asignación del día — qué le cayó HOY a cada asesor */}
					<TarjetaReporte
						titulo="Asignación del día"
						descripcion="Cuentas que hoy entraron al bucket de cada asesor · no aparecen los asesores sin entradas"
					>
						{asignacionOrdenada.length === 0 ? (
							<p className="text-fg-tertiary text-sm">
								Sin cuentas nuevas hoy.
							</p>
						) : (
							<div className="flex flex-col gap-1.5">
								{asignacionOrdenada.map((a) => (
									<SubFila
										key={a.asesor_id ?? "sin-asesor"}
										inicio={
											<AvatarSuave
												iniciales={a.asesor ? inicialesDe(a.asesor) : "?"}
												neutro={!a.asesor}
											/>
										}
										titulo={
											a.asesor ?? (
												<span className="text-warning-text">Sin asesor</span>
											)
										}
										// Pool del asesor (config estable) — distinto de los buckets
										// de donde vinieron sus ingresos de hoy (a la derecha).
										subtitulo={
											a.buckets_pool?.length
												? `Atiende ${a.buckets_pool.map(codigo).join(" · ")}`
												: "Sin pool asignado"
										}
										fin={
											<>
												{a.porBucket.length > 0 ? (
													<span className="flex flex-wrap items-center gap-1">
														<span className="text-[10px] text-fg-tertiary">
															desde
														</span>
														{a.porBucket.map((b) => (
															<span
																className="inline-flex items-center gap-0.5"
																key={`${b.desde}-${b.bucket}`}
															>
																<ChipBucket
																	numero={b.desde}
																	catalogo={catalogo}
																/>
																{b.cantidad > 1 ? (
																	<span className="font-medium text-[11px] text-fg-secondary">
																		×{b.cantidad}
																	</span>
																) : null}
															</span>
														))}
													</span>
												) : null}
												<ValorNota
													tamano="sm"
													valor={`+${a.ingresos}`}
													nota={
														a.ingresos === 1 ? "cuenta nueva" : "cuentas nuevas"
													}
												/>
											</>
										}
									/>
								))}
							</div>
						)}
					</TarjetaReporte>
				</div>

				{/* Cuentas que cambiaron de bucket — lista filtrable */}
				<TarjetaReporte
					titulo="Cuentas que cambiaron de bucket"
					descripcion={
						bucketFiltro === null
							? `${plural(movimientos.length, "cuenta", "cuentas")} · de dónde vino cada una`
							: `Entradas a ${codigo(bucketFiltro)} · ${nombreBucket(bucketFiltro, catalogo)} · ${plural(movimientosFiltrados.length, "cuenta", "cuentas")}`
					}
					accion={
						bucketFiltro !== null ? (
							<Button
								variant="text"
								size="sm"
								onClick={() => setBucketFiltro(null)}
							>
								Ver todas
							</Button>
						) : undefined
					}
				>
					{movimientosFiltrados.length === 0 ? (
						<p className="py-4 text-center text-fg-tertiary text-sm">
							{bucketFiltro === null
								? "Sin movimientos de bucket hoy."
								: `Sin entradas a ${codigo(bucketFiltro)} hoy.`}
						</p>
					) : (
						<div className="flex flex-col gap-1.5">
							{movimientosFiltrados.map((m) => {
								const esSubida = m.tipo_evento === "SUBIDA";
								return (
									<SubFila
										key={`${m.credito_id}-${m.fecha}-${m.bucket_nuevo}`}
										onClick={
											m.numero_credito_sifco
												? () => onAbrirCaso(m.numero_credito_sifco as string)
												: undefined
										}
										etiqueta={`Abrir la ficha de ${m.cliente ?? "este crédito"}`}
										inicio={
											<span
												className="flex w-27 items-center gap-1"
												title={`${esSubida ? "Subió" : "Bajó"} de ${codigo(m.bucket_anterior)} a ${codigo(m.bucket_nuevo)}`}
											>
												<ChipBucket
													numero={m.bucket_anterior}
													catalogo={catalogo}
												/>
												{esSubida ? (
													<TrendingUp
														aria-label="subió a"
														className="size-3.5 shrink-0 text-danger-text"
													/>
												) : (
													<TrendingDown
														aria-label="bajó a"
														className="size-3.5 shrink-0 text-success-text"
													/>
												)}
												<ChipBucket
													numero={m.bucket_nuevo}
													catalogo={catalogo}
												/>
											</span>
										}
										titulo={m.cliente ?? "—"}
										subtitulo={[
											m.numero_credito_sifco ?? m.credito_id,
											plural(
												m.cuotas_vencidas,
												"cuota vencida",
												"cuotas vencidas",
											),
											m.asesor ?? "Sin asesor",
										].join(" · ")}
										fin={
											<>
												{m.saltos > 1 ? (
													<Pildora tono="danger">{m.saltos} saltos</Pildora>
												) : null}
												<ValorNota
													tamano="sm"
													valor={montoQ(m.monto_cuota)}
													nota="cuota"
												/>
											</>
										}
									/>
								);
							})}
						</div>
					)}
				</TarjetaReporte>
			</div>
		</>
	);
}
