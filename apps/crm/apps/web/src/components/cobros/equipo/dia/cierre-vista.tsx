import {
	ArrowDown,
	ArrowUp,
	Loader2,
	TrendingDown,
	TrendingUp,
} from "lucide-react";
import type * as React from "react";
import { fechaAIso, isoAFecha } from "@/components/cobros/campo-fecha";
import { CrmPill, inicialesDe } from "@/components/ds/cards-credito";
import { KpiMeta, KpiSimple, KpiTrendPill } from "@/components/ds/kpi";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-picker";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	AvatarSuave,
	ChipBucket,
	EncabezadoVistaDia,
	FilaDesplegable,
	FilasCargando,
	Flechas,
	KpisCargando,
	plural,
	SubFila,
	TituloGrupo,
	tonoNeto,
	ValorNota,
} from "./piezas";

/**
 * Cierre diario (CB-020) en «Mi equipo» › Día, con el lenguaje de Reportería
 * del Figma («Migración de bucket» 3550:5760: KPIs arriba y sub-filas de
 * asesor con avatar, ↑↓ y valores). La página vieja `/cobros/cierre` redirige a
 * `/cobros/equipo?tab=dia&vista=cierre`. Presentación pura: el contenedor
 * (`cierre.tsx`) consulta `getCierreDiarioPorRango` y, al desplegar un asesor,
 * `getDetalleCierrePorAsesor` (inyectado con `renderDetalle`, así el showcase
 * lo pinta sin servidor).
 *
 *   Encabezado  selector de vista, rango de fechas (por defecto del lunes GT a
 *               hoy; el calendario de rango no deja invertirlo) y el filtro de
 *               asesor (solo los que tienen cierre en el rango).
 *   KPIs        efectivos / total, promesas, migración ↓↑ con su neto y los
 *               asesores con cierre — sumados de las filas que se ven.
 *   Filas       una por asesor (pool o «Sin pool asignado», contactos, ↑↓,
 *               efectivos y promesas) que se despliega hacia «Contactos» y
 *               «Movimientos de bucket»; cada renglón abre la ficha.
 */

/** Hoy en Guatemala (YYYY-MM-DD) — el backend calcula todo en GT. */
export function hoyGT() {
	return new Date().toLocaleDateString("sv-SE", {
		timeZone: "America/Guatemala",
	});
}

/** Lunes de la semana GT actual (YYYY-MM-DD), para el default del rango. */
export function lunesDeEstaSemanaGT() {
	const [y, m, d] = hoyGT().split("-").map(Number);
	const hoy = new Date(Date.UTC(y, m - 1, d));
	const diaSemana = hoy.getUTCDay(); // 0=domingo
	const offset = diaSemana === 0 ? 6 : diaSemana - 1;
	const lunes = new Date(hoy);
	lunes.setUTCDate(hoy.getUTCDate() - offset);
	return lunes.toISOString().slice(0, 10);
}

// CB-020 (Codex, PR #1148): toLocaleDateString("es-GT") sin `timeZone`
// explícito usa la zona horaria LOCAL del navegador para decidir qué día
// es, no Guatemala — el string "es-GT" solo cambia el FORMATO (dd/mm/yyyy),
// no la zona horaria del cálculo. Un asesor en una zona horaria distinta ve
// un día distinto al que realmente se guardó. Mismo fix que $id.tsx.
function formatFechaGT(date: Date): string {
	return date.toLocaleDateString("es-GT", { timeZone: "America/Guatemala" });
}

// Etiquetas del funnel operativo. Un movimiento puede ir a cualquier bucket,
// por eso están los seis.
const BUCKET_LABEL: Record<number, string> = {
	0: "B0 · Cartera Sana",
	1: "B1 · Alerta Temprana",
	2: "B2 · Gestión Activa",
	3: "B3 · Rescate",
	4: "B4 · Última Instancia / Pre Jurídico",
	5: "B5 · Jurídico",
};

const etiquetaBucket = (b: number | null) =>
	b == null ? "—" : (BUCKET_LABEL[b] ?? `B${b}`);

type TonoEstado =
	| "success"
	| "warning"
	| "danger"
	| "info"
	| "neutral"
	| "brand";

const ESTADO: Record<string, { label: string; tono: TonoEstado }> = {
	contactado: { label: "Contactado", tono: "success" },
	no_contesta: { label: "No contesta", tono: "warning" },
	mensaje_enviado: { label: "Mensaje enviado", tono: "neutral" },
	numero_equivocado: { label: "Número equivocado", tono: "danger" },
	promesa_pago: { label: "Promesa de pago", tono: "brand" },
	acuerdo_parcial: { label: "Acuerdo parcial", tono: "info" },
	rechaza_pagar: { label: "Rechaza pagar", tono: "danger" },
};

/**
 * Por qué un contacto no suma como efectivo. El orden importa: un envío del
 * sistema queda registrado como 'contactado' pero no es gestión del asesor, así
 * que ese motivo gana sobre el del estado.
 */
function motivoNoEfectivo(
	origen: string | null,
	estadoContacto: string | null,
): string {
	if (origen === "premora") return "Recordatorio automático";
	if (origen === "wsp_masivo") return "Envío masivo";
	if (estadoContacto === "promesa_pago") return "Cuenta como promesa de pago";
	if (estadoContacto === "no_contesta") return "No contestó";
	if (estadoContacto === "mensaje_enviado")
		return "Mensaje enviado, sin respuesta";
	if (estadoContacto === "numero_equivocado") return "Número equivocado";
	return "—";
}

export interface CierreFila {
	asesorId: string;
	asesorNombre: string;
	contactosEfectivos: number;
	promesasObtenidas: number;
	totalContactos: number;
	/** Créditos que SALIERON del bucket del asesor ese día. */
	subieron: number;
	bajaron: number;
	/** Buckets del pool al que está asignado el asesor (estado actual). */
	bucketsPool: number[];
}

/** Fila de `getDetalleCierrePorAsesor`. */
export interface DetalleCierreItem {
	id: string | number;
	tipo: string;
	numeroCreditoSifco: string | null;
	estadoContacto: string | null;
	esEfectivoManual: boolean | null;
	fechaContacto: string | Date | null;
	bucketAnterior: number | null;
	bucket: number | null;
	origen: string | null;
}

export type CierreVistaProps = {
	filas: CierreFila[];
	/** Para el select: asesores con cierre en el rango. */
	asesoresConCierre: CierreFila[];
	fechaInicio: string;
	fechaFin: string;
	onRango: (rango: { inicio: string; fin: string }) => void;
	asesorId: string;
	onAsesor: (asesorId: string) => void;
	/** Fila desplegada (una a la vez). */
	abierto: string | null;
	onToggle: (asesorId: string) => void;
	cargando: boolean;
	recargando: boolean;
	error: boolean;
	/** Vuelve a pedir el cierre (botón del estado de error). */
	onReintentar?: () => void;
	/** Contenido de la fila desplegada (el contenedor hace la consulta). */
	renderDetalle: (fila: CierreFila) => React.ReactNode;
	/** Selector Apertura / Cierre / Gestiones (lo pone la pestaña Día). */
	selector?: React.ReactNode;
};

const suma = (valores: number[]) => valores.reduce((s, v) => s + v, 0);

export function CierreVista({
	filas,
	asesoresConCierre,
	fechaInicio,
	fechaFin,
	onRango,
	asesorId,
	onAsesor,
	abierto,
	onToggle,
	cargando,
	recargando,
	error,
	onReintentar,
	renderDetalle,
	selector,
}: CierreVistaProps) {
	const hoy = isoAFecha(hoyGT());
	return (
		<div className="flex min-w-0 flex-col gap-5">
			<EncabezadoVistaDia
				titulo="Cierre diario"
				descripcion="Gestión de cada asesor en el rango · se genera todos los días a las 22:00 GT"
				controles={
					<>
						{selector}
						{recargando ? (
							<Loader2
								aria-label="Actualizando"
								className="size-4 animate-spin text-fg-tertiary"
							/>
						) : null}
						<Label htmlFor="cierre-rango" className="sr-only">
							Rango de fechas
						</Label>
						<DateRangePicker
							id="cierre-rango"
							className="h-9 w-auto min-w-48 rounded-lg px-3 text-[13px]"
							range={{ from: isoAFecha(fechaInicio), to: isoAFecha(fechaFin) }}
							onRangeChange={(r) => {
								if (!r?.from) return;
								// Un día suelto es un rango de un día. El calendario de rango
								// no deja invertir inicio y fin (un rango invertido devolvía
								// vacío en silencio y se leía como "el job no corrió").
								const inicio = fechaAIso(r.from);
								onRango({ inicio, fin: r.to ? fechaAIso(r.to) : inicio });
							}}
							disabledDays={hoy ? { after: hoy } : undefined}
						/>
						<Select value={asesorId} onValueChange={onAsesor}>
							<SelectTrigger
								size="default"
								aria-label="Asesor"
								className="h-9 w-48 max-w-full rounded-lg px-3 text-[13px]"
							>
								<SelectValue placeholder="Todos los asesores" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="todos">Todos los asesores</SelectItem>
								{asesoresConCierre.map((a) => (
									<SelectItem key={a.asesorId} value={a.asesorId}>
										{a.asesorNombre}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</>
				}
			/>

			{cargando ? (
				<>
					<KpisCargando />
					<FilasCargando />
				</>
			) : error ? (
				<EmptyState
					variant="error"
					size="sm"
					title="No se pudo cargar el cierre diario"
					description="Intente de nuevo en unos segundos."
					action={
						onReintentar ? (
							<Button variant="outline" size="sm" onClick={onReintentar}>
								Reintentar
							</Button>
						) : undefined
					}
				/>
			) : filas.length === 0 ? (
				<EmptyState
					variant="no-data"
					size="sm"
					title="No hay cierre generado en este rango"
					description="El cierre se genera todos los días a las 22:00 GT."
				/>
			) : (
				<>
					<KpisCierre filas={filas} />
					<section className="flex flex-col gap-2">
						<TituloGrupo
							titulo="Gestión por asesor"
							ayuda="Toque un asesor para ver sus contactos y movimientos"
						/>
						{filas.map((fila) => (
							<FilaAsesor
								abierto={abierto === fila.asesorId}
								fila={fila}
								key={fila.asesorId}
								onToggle={() => onToggle(fila.asesorId)}
								detalle={abierto === fila.asesorId ? renderDetalle(fila) : null}
							/>
						))}
					</section>
				</>
			)}
		</div>
	);
}

/** KPIs del rango, sumados de las filas visibles (todas o el asesor elegido). */
function KpisCierre({ filas }: { filas: CierreFila[] }) {
	const efectivos = suma(filas.map((f) => f.contactosEfectivos));
	const total = suma(filas.map((f) => f.totalContactos));
	const promesas = suma(filas.map((f) => f.promesasObtenidas));
	const subieron = suma(filas.map((f) => f.subieron));
	const bajaron = suma(filas.map((f) => f.bajaron));
	const neto = bajaron - subieron;
	const pct = total > 0 ? Math.round((efectivos / total) * 100) : 0;
	const sinEfectivos = filas.filter((f) => f.contactosEfectivos === 0).length;
	return (
		<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
			<KpiMeta
				title="Contactos efectivos"
				info="Contactos en los que el asesor habló con el cliente, sobre todos los que registró en el rango. No cuentan los envíos automáticos."
				value={efectivos.toLocaleString("es-GT")}
				target={`/ ${total.toLocaleString("es-GT")}`}
				progress={pct}
				progressLabel={`${pct}% de los contactos registrados`}
			/>
			<KpiSimple
				title="Promesas obtenidas"
				info="Promesas de pago que el equipo consiguió en el rango."
				value={promesas.toLocaleString("es-GT")}
				showIcon={false}
				showTrend
				comparison={
					efectivos > 0
						? `${Math.round((promesas / efectivos) * 100)}% de los contactos efectivos`
						: "sin contactos efectivos"
				}
			/>
			<KpiSimple
				title="Migración de bucket"
				info="Créditos que salieron del bucket de cada asesor: ↓ bajaron (recuperados) y ↑ subieron (escalados). El neto es bajadas menos subidas."
				value={
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
				}
				trend={tonoNeto(neto)}
				trendValue={`${neto > 0 ? "+" : ""}${neto} neto`}
				comparison="recuperados · escalados"
			/>
			<KpiSimple
				title="Asesores con cierre"
				info="Asesores con cierre generado en el rango (o el asesor elegido)."
				value={filas.length.toLocaleString("es-GT")}
				showIcon={false}
				showTrend
				comparison={
					sinEfectivos > 0
						? `${sinEfectivos} sin contactos efectivos`
						: "todos con contactos efectivos"
				}
			/>
		</div>
	);
}

function FilaAsesor({
	fila,
	abierto,
	onToggle,
	detalle,
}: {
	fila: CierreFila;
	abierto: boolean;
	onToggle: () => void;
	detalle: React.ReactNode;
}) {
	const neto = fila.bajaron - fila.subieron;
	return (
		<FilaDesplegable
			abierta={abierto}
			onToggle={onToggle}
			etiqueta={`${fila.asesorNombre}: ${fila.contactosEfectivos} de ${fila.totalContactos} contactos efectivos. Ver contactos y movimientos`}
			inicio={<AvatarSuave iniciales={inicialesDe(fila.asesorNombre)} />}
			titulo={fila.asesorNombre}
			// Pool de buckets al que está asignado el asesor (estado actual).
			subtitulo={`${
				fila.bucketsPool.length > 0
					? `Atiende ${fila.bucketsPool.map((b) => `B${b}`).join(" · ")}`
					: "Sin pool asignado"
			} · ${plural(fila.totalContactos, "contacto", "contactos")}`}
			fin={
				<>
					{neto !== 0 ? (
						<KpiTrendPill trend={tonoNeto(neto)}>
							{neto > 0 ? `+${neto}` : neto}
						</KpiTrendPill>
					) : null}
					<Flechas subieron={fila.subieron} bajaron={fila.bajaron} />
					{/* Efectivos sobre el total de contactos registrados: de N
					    intentos, en M le contestaron. */}
					<ValorNota
						tamano="sm"
						valor={`${fila.contactosEfectivos}/${fila.totalContactos}`}
						nota="efectivos"
						className="min-w-14"
					/>
					<ValorNota
						tamano="sm"
						valor={fila.promesasObtenidas}
						nota={fila.promesasObtenidas === 1 ? "promesa" : "promesas"}
						className="min-w-12"
					/>
				</>
			}
		>
			{detalle}
		</FilaDesplegable>
	);
}

/** Píldora chica del estado del contacto. */
function PildoraEstado({ estado }: { estado: string | null }) {
	if (!estado) return <span className="text-[11px] text-fg-tertiary">—</span>;
	const def = ESTADO[estado] ?? { label: estado, tono: "neutral" as const };
	return (
		<CrmPill
			tone={def.tono}
			kind="chip"
			className="px-2 py-0.5 font-semibold text-[10px]"
		>
			{def.label}
		</CrmPill>
	);
}

/** Contenido de un asesor desplegado: «Contactos» y «Movimientos de bucket». */
export function DetalleCierreVista({
	cargando,
	items,
	onAbrirCaso,
}: {
	cargando: boolean;
	items: DetalleCierreItem[];
	onAbrirCaso: (numeroCreditoSifco: string) => void;
}) {
	if (cargando) {
		return (
			<div className="flex items-center gap-2 px-1 py-4 text-fg-secondary text-sm">
				<Loader2 className="h-4 w-4 animate-spin" />
				Cargando detalle…
			</div>
		);
	}

	const contactos = items.filter((d) => d.tipo === "contacto");
	const movimientos = items.filter(
		(d) => d.tipo === "subida" || d.tipo === "bajada",
	);
	const irACaso = (numeroCreditoSifco: string | null) =>
		numeroCreditoSifco ? () => onAbrirCaso(numeroCreditoSifco) : undefined;

	return (
		<div className="grid gap-x-4 gap-y-3 border-divider border-t pt-3 lg:grid-cols-2">
			<section className="flex min-w-0 flex-col gap-1.5">
				<h4 className="px-1 font-semibold text-fg text-xs">
					Contactos{" "}
					<span className="font-normal text-fg-tertiary">
						· {contactos.length}
					</span>
				</h4>
				{contactos.length > 0 ? (
					<div className="flex max-h-96 flex-col gap-1.5 overflow-y-auto">
						{contactos.map((c) => (
							<SubFila
								key={c.id}
								onClick={irACaso(c.numeroCreditoSifco)}
								etiqueta={`Abrir la ficha del crédito ${c.numeroCreditoSifco ?? ""}`}
								titulo={c.numeroCreditoSifco ?? "—"}
								subtitulo={
									c.fechaContacto
										? formatFechaGT(new Date(c.fechaContacto))
										: "—"
								}
								fin={
									<>
										<PildoraEstado estado={c.estadoContacto} />
										{c.esEfectivoManual ? (
											<span className="font-semibold text-[11px] text-success-text">
												Efectivo
											</span>
										) : (
											<span className="text-[11px] text-fg-tertiary">
												{motivoNoEfectivo(c.origen, c.estadoContacto)}
											</span>
										)}
									</>
								}
							/>
						))}
					</div>
				) : (
					<p className="px-1 text-fg-tertiary text-xs">
						Sin contactos en este rango.
					</p>
				)}
			</section>

			<section className="flex min-w-0 flex-col gap-1.5">
				<h4 className="px-1 font-semibold text-fg text-xs">
					Movimientos de bucket{" "}
					<span className="font-normal text-fg-tertiary">
						· {movimientos.length}
					</span>
				</h4>
				{movimientos.length > 0 ? (
					<div className="flex max-h-96 flex-col gap-1.5 overflow-y-auto">
						{movimientos.map((m) => {
							const subio = m.tipo === "subida";
							return (
								<SubFila
									key={m.id}
									onClick={irACaso(m.numeroCreditoSifco)}
									etiqueta={`Abrir la ficha del crédito ${m.numeroCreditoSifco ?? ""}`}
									inicio={
										<span className="flex items-center gap-1">
											<ChipBucket numero={m.bucketAnterior} />
											{subio ? (
												<TrendingUp
													aria-hidden
													className="size-3.5 text-danger-text"
												/>
											) : (
												<TrendingDown
													aria-hidden
													className="size-3.5 text-success-text"
												/>
											)}
											<ChipBucket numero={m.bucket} />
										</span>
									}
									titulo={m.numeroCreditoSifco ?? "—"}
									subtitulo={`${subio ? "Subió" : "Bajó"} de ${etiquetaBucket(m.bucketAnterior)} a ${etiquetaBucket(m.bucket)}`}
								/>
							);
						})}
					</div>
				) : (
					<p className="px-1 text-fg-tertiary text-xs">
						Sin movimientos de bucket en este rango.
					</p>
				)}
			</section>
		</div>
	);
}
