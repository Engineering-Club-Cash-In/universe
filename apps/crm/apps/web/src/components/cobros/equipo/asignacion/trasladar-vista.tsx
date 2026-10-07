import { Link } from "@tanstack/react-router";
import {
	ArrowRight,
	Check,
	ChevronDown,
	Clock,
	Info,
	Plus,
	TriangleAlert,
} from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { type Bucket, BucketBadge } from "@/components/ds/badges";
import { CrmAvatar, CrmPill, inicialesDe } from "@/components/ds/cards-credito";
import { bucketSolidClass } from "@/components/ds/distribucion-bucket";
import { Button } from "@/components/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { dialogTitleClassName } from "@/components/ui/dialog";
import { FieldMessage } from "@/components/ui/field-message";
import { Label } from "@/components/ui/label";
import { Pagination } from "@/components/ui/pagination";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { resumirTraslado } from "@/lib/cobros/traslados";
import { cn } from "@/lib/utils";
import type { client } from "@/utils/orpc";
import { etiquetaNivel, nivelAsesor } from "../estado-asesor";
import { AvatarMini } from "./carga-resumen-vista";
import {
	type AsesorTraslado,
	EstadoConsulta,
	SelectorAsesor,
} from "./selector-asesor";

/**
 * «Trasladar cartera» — presentación del modal, por pasos, con el estándar
 * compacto de «Marcar ausente» (Figma 3367:4244) y las piezas de «Reasignar»
 * (3631:5567 / 3627:5567: tarjetas de radio con barra de capacidad y motivo en
 * chips), «Redistribución de cartera» (3360:4254: lista «antes → después +N»)
 * y la pantalla de éxito (3629:5636).
 *
 *   1. formulario → asesor de origen, forma de repartir, motivo, explicación
 *                   y, si aplica, el responsable de las cuentas sin bucket.
 *   2. revision   → el resultado de `previsualizarTraslado`: receptores,
 *                   contadores, vencimiento, bloqueos, cuentas sin bucket
 *                   operativo, créditos sin destino y el detalle por crédito.
 *   3. resultado  → «Traslado confirmado».
 *
 * Presentación pura: el estado, las validaciones, la vista previa, la
 * confirmación (con su AlertDialog) y las invalidaciones viven en
 * `TrasladosPanel` (components/cobros/traslados-panel.tsx).
 */

/* ── Tipos ──────────────────────────────────────────────────────────────── */

export type PreviewTraslado = Awaited<
	ReturnType<typeof client.previsualizarTraslado>
>;
// El cliente oRPC conserva el contrato previo durante el desarrollo; el
// backend envía estos campos opcionales.
export type AsignacionPreview = PreviewTraslado["asignaciones"][number] & {
	cliente?: string | null;
	estadoEspecial?:
		| "INCOBRABLE"
		| "CANCELADO"
		| "PENDIENTE_CANCELACION"
		| "CAIDO";
};
export type ExcluidoPreview = PreviewTraslado["excluidos"][number] & {
	numeroCreditoSifco?: string;
	cliente?: string | null;
	estado?: string;
};

export type ModoTraslado =
	| "redistribucion"
	| "traslado_completo"
	| "destino_por_bucket";

export type RazonTraslado = "redistribucion" | "despido" | "renuncia" | "otro";

/**
 * Texto del motivo que viaja a cartera-back (y se lee en el historial de
 * traslados). No cambia: los chips muestran una etiqueta corta.
 */
export const MOTIVOS_TRASLADO: Record<RazonTraslado, string> = {
	redistribucion: "Redistribución operativa",
	despido: "Despido",
	renuncia: "Renuncia",
	otro: "Otro",
};

const CHIPS_MOTIVO: { valor: RazonTraslado; etiqueta: string }[] = [
	{ valor: "redistribucion", etiqueta: "Redistribución" },
	{ valor: "despido", etiqueta: "Despido" },
	{ valor: "renuncia", etiqueta: "Renuncia" },
	{ valor: "otro", etiqueta: "Otro" },
];

const MODOS: { valor: ModoTraslado; titulo: string; detalle: string }[] = [
	{
		valor: "redistribucion",
		titulo: "Repartir entre el equipo",
		detalle: "Entre los asesores activos de cada bucket.",
	},
	{
		valor: "traslado_completo",
		titulo: "A un solo asesor",
		detalle: "Recibe toda la cartera y atiende todos sus buckets.",
	},
	{
		valor: "destino_por_bucket",
		titulo: "Destino por bucket",
		detalle: "Usted elige quién recibe cada bucket.",
	},
];

/** Cuentas y capacidad base de un asesor en uno o varios buckets. */
export type CapacidadDestino = { cuentas: number; capacidad: number };

export type OrigenTraslado = {
	nombre: string;
	activo: boolean;
	/** Buckets del pool (definen el nivel). */
	buckets: number[];
	/** Cuentas de su cartera por bucket; `null` mientras carga. */
	porBucket: { bucket: number; cuentas: number }[] | null;
};

export type TrasladoVistaProps = {
	paso: "formulario" | "revision" | "resultado";
	/** Catálogo de asesores (`getAsesoresTraslados`). */
	cargando: boolean;
	errorCarga: boolean;
	onReintentar: () => void;
	/** Previsualizando o confirmando: los campos se bloquean. */
	ocupado: boolean;

	/* Paso 1 */
	asesores: AsesorTraslado[];
	origen: string;
	onOrigen: (asesorId: string) => void;
	origenInfo: OrigenTraslado | null;
	modo: ModoTraslado;
	onModo: (modo: ModoTraslado) => void;
	/** «A un solo asesor»: el elegido y los candidatos con su capacidad. */
	destino: string;
	onDestino: (asesorId: string) => void;
	destinos: { asesor: AsesorTraslado; capacidad: CapacidadDestino | null }[];
	/** Los buckets de la cartera del origen todavía se están cargando. */
	cargandoBucketsOrigen: boolean;
	bucketsOrigen: number[];
	destinosPorBucket: Record<number, string>;
	onDestinoBucket: (bucket: number, asesorId: string) => void;
	candidatosPorBucket: Record<number, AsesorTraslado[]>;
	/** Carga de un asesor en un bucket (para la pista bajo cada destino). */
	capacidadEnBucket: (
		asesorId: number,
		bucket: number,
	) => CapacidadDestino | null;
	destinoEspecial: string;
	onDestinoEspecial: (asesorId: string) => void;
	candidatosEspecial: AsesorTraslado[];
	/** Despido o renuncia: el responsable de las cuentas sin bucket es obligatorio. */
	requiereDestinoEspecial: boolean;
	razon: RazonTraslado;
	onRazon: (razon: RazonTraslado) => void;
	detalle: string;
	onDetalle: (detalle: string) => void;
	/** Validación del formulario (null = se puede revisar el reparto). */
	errorFormulario: string | null;
	errorPrevisualizar: string | null;
	previsualizando: boolean;
	onCancelar: () => void;
	onRevisar: () => void;

	/* Paso 2 */
	preview: PreviewTraslado | null;
	vencido: boolean;
	nombres: Record<number, string>;
	puedeConfirmar: boolean;
	pagina: number;
	onPagina: (pagina: number) => void;
	errorConfirmar: string | null;
	confirmando: boolean;
	onAtras: () => void;
	/** Abre la confirmación final («Confirmar traslado permanente»). */
	onConfirmar: () => void;

	/* Paso 3 */
	resultado: { cuentas: number; operacionId: string } | null;
	onListo: () => void;
};

/* ── Utilidades ─────────────────────────────────────────────────────────── */

const POR_PAGINA = 25;
const RECEPTORES_VISIBLES = 6;

function aBucket(numero: number | null): Bucket | null {
	return numero !== null && numero >= 0 && numero <= 5
		? (`B${numero}` as Bucket)
		: null;
}

/** «B2», «B2 y B3», «B2, B3 y B4». */
export function listaBuckets(buckets: readonly number[]) {
	const nombres = buckets.map((b) => `B${b}`);
	if (nombres.length <= 1) return nombres.join("");
	return `${nombres.slice(0, -1).join(", ")} y ${nombres.at(-1)}`;
}

function plural(n: number, uno: string, varios: string) {
	return `${n.toLocaleString("es-GT")} ${n === 1 ? uno : varios}`;
}

function descripcionEstadoEspecial(estado: string) {
	return (
		{
			INCOBRABLE: "Cuenta marcada para gestión no recuperable.",
			CANCELADO: "Crédito cerrado; se conserva para consulta e historial.",
			PENDIENTE_CANCELACION: "Cierre administrativo aún en proceso.",
			CAIDO: "Crédito dado de baja de cobranza activa.",
		}[estado] ?? "Cuenta sin bucket operativo."
	);
}

function etiquetaEstado(estado: string | undefined) {
	if (!estado) return "Sin bucket";
	const texto = estado.replaceAll("_", " ").toLowerCase();
	return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function agruparCuentasEspeciales(asignaciones: AsignacionPreview[]) {
	const grupos = new Map<
		string,
		{
			estado: NonNullable<AsignacionPreview["estadoEspecial"]>;
			asesorId: number;
			cuentas: number;
		}
	>();
	for (const asignacion of asignaciones) {
		if (!asignacion.estadoEspecial) continue;
		const key = `${asignacion.estadoEspecial}:${asignacion.asesorNuevoId}`;
		const actual = grupos.get(key);
		if (actual) actual.cuentas++;
		else
			grupos.set(key, {
				estado: asignacion.estadoEspecial,
				asesorId: asignacion.asesorNuevoId,
				cuentas: 1,
			});
	}
	return [...grupos.values()];
}

/* ── Piezas ─────────────────────────────────────────────────────────────── */

/** Leyenda «● B2 24 · ● B3 10» de la cartera (como la de CardAsesor). */
function ComposicionCartera({
	porBucket,
}: {
	porBucket: { bucket: number; cuentas: number }[];
}) {
	return (
		<ul className="flex flex-wrap gap-x-3 gap-y-1">
			{porBucket.map((d) => {
				const b = aBucket(d.bucket);
				return (
					<li
						key={d.bucket}
						className="flex items-center gap-1.25 font-medium text-[11px] text-fg-secondary leading-[1.26]"
					>
						<span
							aria-hidden
							className={cn(
								"size-1.75 shrink-0 rounded-full",
								b ? bucketSolidClass[b] : "bg-fg-tertiary",
							)}
						/>
						B{d.bucket} {d.cuentas.toLocaleString("es-GT")}
					</li>
				);
			})}
		</ul>
	);
}

/** Asesor de origen: avatar, nivel, cuentas y su reparto por bucket. */
function ResumenOrigen({
	info,
	cargando,
	ocupado,
	onCambiar,
}: {
	info: OrigenTraslado;
	/** Su cartera por bucket todavía se está cargando. */
	cargando: boolean;
	ocupado: boolean;
	onCambiar: () => void;
}) {
	const total = info.porBucket?.reduce((t, d) => t + d.cuentas, 0) ?? null;
	return (
		<div className="flex items-center gap-3 rounded-xl bg-brand-subtle/60 px-3.5 py-3">
			<CrmAvatar iniciales={inicialesDe(info.nombre)} activo={info.activo} />
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
					<p className="truncate font-semibold text-fg text-sm leading-[1.26]">
						{info.nombre}
					</p>
					{!info.activo ? (
						<CrmPill tone="neutral" kind="chip" className="px-2 py-0.5">
							Inactivo
						</CrmPill>
					) : null}
				</div>
				<p className="text-fg-secondary text-xs leading-[1.26]">
					{etiquetaNivel(nivelAsesor(info.buckets))}
					{cargando
						? " · cargando su cartera…"
						: total !== null
							? ` · ${plural(total, "cuenta", "cuentas")} a trasladar`
							: ""}
				</p>
				{!cargando && info.porBucket?.length ? (
					<ComposicionCartera porBucket={info.porBucket} />
				) : null}
			</div>
			<Button
				variant="text"
				size="sm"
				className="self-start"
				disabled={ocupado}
				onClick={onCambiar}
			>
				Cambiar
			</Button>
		</div>
	);
}

/** Tarjeta de radio de la forma de repartir. */
function TarjetaModo({
	id,
	valor,
	titulo,
	detalle,
	activo,
}: {
	id: string;
	valor: ModoTraslado;
	titulo: string;
	detalle: string;
	activo: boolean;
}) {
	return (
		<label
			htmlFor={id}
			className={cn(
				"flex min-w-0 cursor-pointer gap-2.5 rounded-xl border px-3 py-2.5 transition-colors duration-150 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 sm:flex-col sm:gap-1.5",
				activo
					? "border-brand bg-brand-subtle"
					: "border-line bg-surface hover:bg-muted/60",
			)}
		>
			<RadioGroupItem id={id} value={valor} className="mt-0.5 sm:mt-0" />
			<span className="flex min-w-0 flex-col gap-0.5">
				<span className="font-semibold text-[13px] text-fg leading-[1.26]">
					{titulo}
				</span>
				<span className="text-[11px] text-fg-secondary leading-[1.3]">
					{detalle}
				</span>
			</span>
		</label>
	);
}

/** «Asignar a»: tarjeta de radio con la barra de capacidad (Figma 3631:5567). */
function TarjetaDestino({
	id,
	asesor,
	capacidad,
	buckets,
	activo,
}: {
	id: string;
	asesor: AsesorTraslado;
	capacidad: CapacidadDestino | null;
	buckets: number[];
	activo: boolean;
}) {
	const libre = capacidad ? capacidad.capacidad - capacidad.cuentas : null;
	const pct =
		capacidad && capacidad.capacidad > 0
			? (capacidad.cuentas / capacidad.capacidad) * 100
			: 0;
	return (
		<label
			htmlFor={id}
			className={cn(
				"flex min-w-0 cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 transition-colors duration-150 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60",
				activo
					? "border-brand bg-brand-subtle"
					: "border-line bg-surface hover:bg-muted/60",
			)}
		>
			<RadioGroupItem id={id} value={String(asesor.asesor_id)} />
			<span className="flex min-w-0 flex-1 flex-col gap-0.75">
				<span className="truncate font-semibold text-fg text-sm leading-[1.26]">
					{asesor.nombre}
				</span>
				{capacidad && libre !== null ? (
					<span
						className={cn(
							"text-xs leading-[1.26]",
							libre <= 0
								? "text-warning-text"
								: activo
									? "text-success-text"
									: "text-fg-tertiary",
						)}
					>
						{plural(capacidad.cuentas, "cuenta", "cuentas")} en{" "}
						{listaBuckets(buckets)} ·{" "}
						{libre > 0
							? `capacidad para +${libre.toLocaleString("es-GT")}`
							: "sin capacidad disponible"}
					</span>
				) : (
					<span className="text-fg-tertiary text-xs leading-[1.26]">
						Atiende {listaBuckets(asesor.buckets)}
					</span>
				)}
			</span>
			{capacidad ? (
				<Progress
					value={Math.min(pct, 100)}
					size="sm"
					tone={libre !== null && libre <= 0 ? "warning" : "success"}
					aria-label={`Utilización de ${asesor.nombre}`}
					className="w-16 shrink-0 sm:w-22"
				/>
			) : null}
		</label>
	);
}

/** Pista bajo el destino de un bucket: «20 de 30 en B2 · capacidad para +10». */
function PistaCapacidad({
	capacidad,
	bucket,
}: {
	capacidad: CapacidadDestino | null;
	bucket: number;
}) {
	if (!capacidad) return null;
	const libre = capacidad.capacidad - capacidad.cuentas;
	return (
		<p
			className={cn(
				"text-[11px] leading-[1.26]",
				libre > 0 ? "text-fg-tertiary" : "text-warning-text",
			)}
		>
			{capacidad.cuentas.toLocaleString("es-GT")} de{" "}
			{capacidad.capacidad.toLocaleString("es-GT")} en B{bucket} ·{" "}
			{libre > 0
				? `capacidad para +${libre.toLocaleString("es-GT")}`
				: "sin capacidad disponible"}
		</p>
	);
}

function TituloSeccion({
	children,
	htmlFor,
}: {
	children: ReactNode;
	htmlFor?: string;
}) {
	// El texto va en un solo span: Label es flex y separaba «(obligatorio)».
	return htmlFor ? (
		<Label htmlFor={htmlFor} className="font-semibold text-[13px] text-fg">
			<span>{children}</span>
		</Label>
	) : (
		<p className="font-semibold text-[13px] text-fg leading-[1.26]">
			{children}
		</p>
	);
}

/** Enlace del crédito a su caso (o el id si no trae número SIFCO). */
function EnlaceCredito({
	sifco,
	creditoId,
}: {
	sifco?: string;
	creditoId: number;
}) {
	return sifco ? (
		<Link
			to="/cobros/$id"
			params={{ id: sifco }}
			search={{ tipo: "caso" }}
			className="shrink-0 rounded-sm font-semibold text-[13px] text-brand leading-[1.26] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
		>
			{sifco}
		</Link>
	) : (
		<span className="font-semibold text-[13px] text-fg leading-[1.26]">
			{creditoId}
		</span>
	);
}

/** Caja de aviso (peligro / alerta) de la revisión. */
function Aviso({
	tono,
	titulo,
	descripcion,
	children,
}: {
	tono: "danger" | "warning";
	titulo: ReactNode;
	descripcion?: ReactNode;
	children?: ReactNode;
}) {
	return (
		<div
			role={tono === "danger" ? "alert" : undefined}
			className={cn(
				"flex flex-col gap-2 rounded-xl p-3.5",
				tono === "danger" ? "bg-danger-subtle" : "bg-warning-subtle",
			)}
		>
			<div className="flex gap-2">
				<TriangleAlert
					aria-hidden
					className={cn(
						"mt-0.5 size-4 shrink-0",
						tono === "danger" ? "text-danger-solid" : "text-warning-solid",
					)}
				/>
				<div className="flex min-w-0 flex-col gap-0.5">
					<p
						className={cn(
							"font-semibold text-[13px] leading-[1.26]",
							tono === "danger" ? "text-danger-text" : "text-warning-text",
						)}
					>
						{titulo}
					</p>
					{descripcion ? (
						<p className="text-fg-secondary text-xs leading-[1.3]">
							{descripcion}
						</p>
					) : null}
				</div>
			</div>
			{children}
		</div>
	);
}

/** Botón de un desplegable («Ver N créditos»). */
function DisparadorDesplegable({ children }: { children: ReactNode }) {
	return (
		<CollapsibleTrigger className="group/desp flex w-fit cursor-pointer items-center gap-1 rounded-md font-semibold text-[13px] text-brand leading-[1.26] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
			{children}
			<ChevronDown
				aria-hidden
				className="size-3.5 transition-transform duration-150 group-data-[state=open]/desp:rotate-180"
			/>
		</CollapsibleTrigger>
	);
}

/** Fila de receptor: «Carlos Ramírez · B2 — 20 → 26 +6» (Figma 3360:4254). */
function FilaReceptor({
	nombre,
	bucket,
	cuentas,
	compromisos,
	carga,
}: {
	nombre: string;
	bucket: number | null;
	cuentas: number;
	compromisos: number;
	carga: { antes: number; despues: number; capacidad: number } | undefined;
}) {
	const b = aBucket(bucket);
	const sobrecarga = !!carga && carga.despues > carga.capacidad;
	return (
		<li className="flex items-center gap-2.5 py-2.5">
			<AvatarMini nombre={nombre} />
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<div className="flex min-w-0 items-center gap-2">
					<span className="truncate font-medium text-[13px] text-fg leading-[1.26]">
						{nombre}
					</span>
					{b ? (
						<BucketBadge bucket={b} className="px-1 py-0.5" />
					) : (
						<CrmPill tone="neutral" kind="chip" dot={false} className="px-2">
							Sin bucket operativo
						</CrmPill>
					)}
				</div>
				<span
					className={cn(
						"text-[11px] leading-[1.26]",
						sobrecarga ? "text-danger-text" : "text-fg-tertiary",
					)}
				>
					{compromisos > 0
						? `${plural(compromisos, "con compromiso", "con compromiso")}`
						: "Sin compromisos"}
					{carga
						? ` · capacidad ${carga.capacidad.toLocaleString("es-GT")}${sobrecarga ? " · sobrecarga" : ""}`
						: ""}
				</span>
			</div>
			<span className="shrink-0 text-fg-secondary text-xs tabular-nums leading-[1.26]">
				{carga ? `${carga.antes} → ${carga.despues}` : "—"}
			</span>
			<span
				className={cn(
					"shrink-0 rounded-full px-2 py-0.75 font-semibold text-[11px] tabular-nums leading-[1.26]",
					sobrecarga
						? "bg-danger-subtle text-danger-text"
						: "bg-success-subtle text-success-text",
				)}
			>
				+{cuentas.toLocaleString("es-GT")}
			</span>
		</li>
	);
}

/** Mini contador de la revisión (operativas · con compromiso · sin destino). */
function Contador({
	valor,
	etiqueta,
	tono = "neutral",
}: {
	valor: number;
	etiqueta: string;
	tono?: "neutral" | "danger";
}) {
	return (
		<div className="flex min-w-0 flex-col gap-0.5 rounded-xl bg-canvas px-3 py-2.5">
			<span
				className={cn(
					"font-bold text-lg tabular-nums leading-[1.26]",
					tono === "danger" && valor > 0 ? "text-danger-text" : "text-fg",
				)}
			>
				{valor.toLocaleString("es-GT")}
			</span>
			<span className="text-[11px] text-fg-secondary leading-[1.26]">
				{etiqueta}
			</span>
		</div>
	);
}

/* ── Paso 1 · Origen y forma de repartir ──────────────────────────────── */

function PasoFormulario(p: TrasladoVistaProps) {
	const [responsableAbierto, setResponsableAbierto] = useState(false);
	// Ids únicos por instancia (el showcase pinta varias a la vez): «…-origen»,
	// «…-modo-redistribucion», «…-destino-bucket-2», etc.
	const uid = useId();
	const id = (sufijo: string) => `traslado${uid}${sufijo}`;
	const mostrarResponsable =
		p.requiereDestinoEspecial ||
		!!p.destinoEspecial ||
		responsableAbierto ||
		// cartera-back rechaza la vista previa si el origen tiene cuentas fuera
		// del funnel y nadie las recibe: el campo queda a la vista para elegirlo.
		!!p.errorPrevisualizar;

	return (
		<>
			{/* Asesor de origen */}
			{p.origenInfo ? (
				<ResumenOrigen
					info={p.origenInfo}
					cargando={p.cargandoBucketsOrigen}
					ocupado={p.ocupado}
					onCambiar={() => p.onOrigen("")}
				/>
			) : (
				<div className="flex flex-col gap-2">
					<TituloSeccion htmlFor={id("-origen")}>
						Asesor de origen
					</TituloSeccion>
					<SelectorAsesor
						id={id("-origen")}
						value={p.origen}
						onChange={p.onOrigen}
						asesores={p.asesores}
						permitirInactivo
						disabled={p.ocupado}
					/>
				</div>
			)}

			{/* Forma de repartir */}
			<fieldset className="flex flex-col gap-2" disabled={p.ocupado}>
				<legend className="mb-2 font-semibold text-[13px] text-fg leading-[1.26]">
					Distribución
				</legend>
				<RadioGroup
					value={p.modo}
					onValueChange={(v) => p.onModo(v as ModoTraslado)}
					aria-label="Distribución"
					className="grid gap-2 sm:grid-cols-3"
				>
					{MODOS.map((m) => (
						<TarjetaModo
							key={m.valor}
							id={id(`-modo-${m.valor}`)}
							valor={m.valor}
							titulo={m.titulo}
							detalle={m.detalle}
							activo={p.modo === m.valor}
						/>
					))}
				</RadioGroup>
			</fieldset>

			{/* A un solo asesor: tarjetas con la capacidad de cada candidato */}
			{p.modo === "traslado_completo" ? (
				<fieldset
					className="flex flex-col gap-2"
					disabled={p.ocupado || p.cargandoBucketsOrigen}
				>
					<legend className="mb-2 font-semibold text-[13px] text-fg leading-[1.26]">
						Asignar a
					</legend>
					{p.cargandoBucketsOrigen ? (
						<p className="text-fg-secondary text-sm">
							Cargando buckets de la cartera…
						</p>
					) : p.destinos.length ? (
						<RadioGroup
							value={p.destino}
							onValueChange={p.onDestino}
							aria-label="Asesor de destino"
							className="-m-1 max-h-72 gap-2 overflow-y-auto p-1"
						>
							{p.destinos.map((d) => (
								<TarjetaDestino
									key={d.asesor.asesor_id}
									id={id(`-destino-${d.asesor.asesor_id}`)}
									asesor={d.asesor}
									capacidad={d.capacidad}
									buckets={p.bucketsOrigen}
									activo={p.destino === String(d.asesor.asesor_id)}
								/>
							))}
						</RadioGroup>
					) : (
						<FieldMessage variant="warning">
							{p.origen
								? `Ningún asesor activo atiende ${listaBuckets(p.bucketsOrigen) || "todos los buckets de esta cartera"}.`
								: "Seleccione un asesor de origen para ver quién puede recibir su cartera."}
						</FieldMessage>
					)}
				</fieldset>
			) : null}

			{/* Destino por bucket */}
			{p.modo === "destino_por_bucket" ? (
				<fieldset className="flex flex-col gap-2.5" disabled={p.ocupado}>
					<legend className="mb-2 font-semibold text-[13px] text-fg leading-[1.26]">
						Destino por bucket
					</legend>
					{p.cargandoBucketsOrigen ? (
						<p className="text-fg-secondary text-sm">
							Cargando buckets de la cartera…
						</p>
					) : p.bucketsOrigen.length ? (
						p.bucketsOrigen.map((bucket) => {
							const b = aBucket(bucket);
							const elegido = p.destinosPorBucket[bucket] ?? "";
							return (
								<div
									key={bucket}
									className="grid grid-cols-[2.75rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1"
								>
									<Label
										htmlFor={id(`-destino-bucket-${bucket}`)}
										className="mt-2.5"
									>
										{b ? <BucketBadge bucket={b} /> : `B${bucket}`}
										<span className="sr-only">Destino de B{bucket}</span>
									</Label>
									<div className="flex min-w-0 flex-col gap-1">
										<SelectorAsesor
											id={id(`-destino-bucket-${bucket}`)}
											value={elegido}
											onChange={(v) => p.onDestinoBucket(bucket, v)}
											asesores={p.candidatosPorBucket[bucket] ?? []}
										/>
										{elegido ? (
											<PistaCapacidad
												bucket={bucket}
												capacidad={p.capacidadEnBucket(Number(elegido), bucket)}
											/>
										) : null}
									</div>
								</div>
							);
						})
					) : (
						<p className="text-fg-secondary text-sm">
							Seleccione un asesor de origen para ver sus buckets.
						</p>
					)}
				</fieldset>
			) : null}

			{/* Motivo en chips */}
			<fieldset className="flex flex-col gap-2" disabled={p.ocupado}>
				<legend className="mb-2 font-semibold text-[13px] text-fg leading-[1.26]">
					Motivo
				</legend>
				<div className="flex flex-wrap gap-2">
					{CHIPS_MOTIVO.map((m) => (
						<Button
							key={m.valor}
							type="button"
							size="sm"
							variant={p.razon === m.valor ? "default" : "outline"}
							aria-pressed={p.razon === m.valor}
							className="h-8 rounded-full px-3.5 font-medium text-xs"
							onClick={() => p.onRazon(m.valor)}
						>
							{m.etiqueta}
						</Button>
					))}
				</div>
			</fieldset>

			<div className="flex flex-col gap-2">
				<TituloSeccion htmlFor={id("-detalle")}>
					Explicación{" "}
					<span className="font-normal text-fg-tertiary">
						{p.razon === "otro" ? "(obligatoria)" : "(opcional)"}
					</span>
				</TituloSeccion>
				<Textarea
					id={id("-detalle")}
					maxLength={900}
					rows={2}
					placeholder="Contexto del traslado para el historial…"
					value={p.detalle}
					disabled={p.ocupado}
					onChange={(e) => p.onDetalle(e.target.value)}
				/>
			</div>

			{/* Responsable de las cuentas sin bucket operativo (solo si aplica) */}
			{mostrarResponsable ? (
				<div className="flex flex-col gap-2">
					<TituloSeccion htmlFor={id("-destino-especial")}>
						Responsable de cuentas sin bucket operativo{" "}
						<span className="font-normal text-fg-tertiary">
							{p.requiereDestinoEspecial ? "(obligatorio)" : "(si aplica)"}
						</span>
					</TituloSeccion>
					<SelectorAsesor
						id={id("-destino-especial")}
						value={p.destinoEspecial}
						onChange={p.onDestinoEspecial}
						asesores={p.candidatosEspecial}
						disabled={p.ocupado}
					/>
					<p className="text-[11px] text-fg-tertiary leading-[1.35]">
						Incobrables, cancelados, pendientes de cancelación y caídos:
						conservan su estado y no reciben bucket; solo cambia el responsable.
						Si el origen tiene alguna, debe elegir a quién pasan.
					</p>
				</div>
			) : (
				<Button
					type="button"
					variant="text"
					size="sm"
					className="-ml-2 w-fit"
					disabled={p.ocupado}
					onClick={() => setResponsableAbierto(true)}
				>
					<Plus aria-hidden />
					Responsable de cuentas sin bucket operativo
				</Button>
			)}

			<div className="flex gap-2.5 rounded-xl bg-info-subtle p-3 text-info-text text-xs leading-[1.35]">
				<Info aria-hidden className="mt-px size-4 shrink-0" />
				<p>
					Los compromisos conservan sus condiciones. Antes de confirmar,
					revisará el reparto por asesor y bucket.
				</p>
			</div>

			{p.errorFormulario ? (
				<FieldMessage variant="help">{p.errorFormulario}</FieldMessage>
			) : null}
			{p.errorPrevisualizar ? (
				<FieldMessage role="alert">{p.errorPrevisualizar}</FieldMessage>
			) : null}
			{/* Un 409 al confirmar descarta la vista previa y vuelve aquí. */}
			{p.errorConfirmar && !p.preview ? (
				<FieldMessage role="alert">{p.errorConfirmar}</FieldMessage>
			) : null}

			<div className="grid grid-cols-2 gap-3">
				<Button variant="secondary" disabled={p.ocupado} onClick={p.onCancelar}>
					Cancelar
				</Button>
				<Button
					disabled={!!p.errorFormulario || p.ocupado}
					loading={p.previsualizando}
					onClick={p.onRevisar}
				>
					{p.previsualizando ? "Calculando…" : "Revisar reparto"}
				</Button>
			</div>
		</>
	);
}

/* ── Paso 2 · Revisión del reparto ────────────────────────────────────── */

function PasoRevision(p: TrasladoVistaProps & { preview: PreviewTraslado }) {
	const [todosReceptores, setTodosReceptores] = useState(false);
	const { preview } = p;
	const nombre = (id: number) => p.nombres[id] ?? String(id);
	const asignaciones = preview.asignaciones as AsignacionPreview[];
	const excluidos = preview.excluidos as ExcluidoPreview[];
	const operativas = asignaciones.filter((a) => !a.estadoEspecial);
	const especiales = asignaciones.filter((a) => a.estadoEspecial);
	const gruposEspeciales = agruparCuentasEspeciales(especiales);
	const resumen = resumirTraslado(operativas);
	const receptores = new Set(resumen.map((r) => r.asesorId)).size;
	const visibles = todosReceptores
		? resumen
		: resumen.slice(0, RECEPTORES_VISIBLES);
	const ocultos = resumen.length - visibles.length;
	const totalPaginas = Math.max(1, Math.ceil(operativas.length / POR_PAGINA));
	const vence = new Date(preview.venceEn).toLocaleTimeString("es-GT", {
		timeZone: "America/Guatemala",
	});

	return (
		<>
			<p className="-mt-2.5 text-fg-secondary text-xs leading-[1.3]">
				Cartera de {nombre(Number(p.origen))} ·{" "}
				{plural(preview.asignaciones.length, "cuenta", "cuentas")} →{" "}
				{plural(receptores, "asesor", "asesores")}
			</p>

			<div className="grid grid-cols-3 gap-2">
				<Contador valor={operativas.length} etiqueta="operativas" />
				<Contador
					valor={operativas.filter((a) => a.prioridad === 0).length}
					etiqueta="con compromiso vigente"
				/>
				<Contador
					valor={excluidos.length}
					etiqueta="sin destino"
					tono="danger"
				/>
			</div>

			{p.vencido ? (
				<Aviso
					tono="danger"
					titulo="La previsualización venció."
					descripcion="Calcule el reparto nuevamente para no aplicar una distribución desactualizada."
				>
					<Button
						size="sm"
						variant="outline"
						className="w-fit bg-surface"
						loading={p.previsualizando}
						disabled={p.ocupado}
						onClick={p.onRevisar}
					>
						Calcular de nuevo
					</Button>
				</Aviso>
			) : (
				<div className="flex gap-2.5 rounded-xl bg-info-subtle p-3 text-info-text text-xs leading-[1.35]">
					<Clock aria-hidden className="mt-px size-4 shrink-0" />
					<p>
						Puede confirmar este reparto hasta las{" "}
						<span className="font-semibold">{vence}</span> (Guatemala). Después
						deberá calcularlo de nuevo.
					</p>
				</div>
			)}

			{preview.bloqueos.length > 0 ? (
				<Aviso
					tono="danger"
					titulo={`No se puede confirmar: ${plural(preview.bloqueos.length, "cuenta", "cuentas")} sin destino válido.`}
				>
					<ul className="flex max-h-36 flex-col gap-1 overflow-y-auto pl-6 text-fg-secondary text-xs leading-[1.3]">
						{preview.bloqueos.map((b) => (
							<li key={b.creditoId}>
								Crédito {b.creditoId} · B{b.bucket}:{" "}
								{b.razon === "destino_no_elegible"
									? "El destino no cubre este bucket"
									: b.razon === "destino_no_configurado"
										? "No se eligió destino para este bucket"
										: "No hay otro asesor elegible"}
							</li>
						))}
					</ul>
				</Aviso>
			) : null}

			{excluidos.length > 0 ? (
				<Aviso
					tono="danger"
					titulo="Créditos sin destino"
					descripcion="No se trasladan ni se puede confirmar hasta asignar bucket operativo a estas cuentas."
				>
					<ul className="flex max-h-48 flex-col divide-y divide-danger-solid/15 overflow-y-auto pl-6">
						{excluidos.map((e) => (
							<li
								key={e.creditoId}
								className="flex items-center justify-between gap-3 py-1.5"
							>
								<span className="flex min-w-0 flex-col gap-0.5">
									<EnlaceCredito
										sifco={e.numeroCreditoSifco}
										creditoId={e.creditoId}
									/>
									<span className="truncate text-[11px] text-fg-secondary leading-[1.26]">
										{e.cliente ?? "Cliente sin nombre"}
									</span>
								</span>
								<span className="shrink-0 text-[11px] text-fg-secondary leading-[1.26]">
									{etiquetaEstado(e.estado)}
								</span>
							</li>
						))}
					</ul>
				</Aviso>
			) : null}

			{especiales.length > 0 ? (
				<Aviso
					tono="warning"
					titulo="Cuentas sin bucket operativo"
					descripcion="Cambian de responsable, conservan su estado y no suman a la carga ni a la capacidad."
				>
					<ul className="flex flex-col gap-1.5 pl-6">
						{gruposEspeciales.map((g) => (
							<li
								key={`${g.estado}:${g.asesorId}`}
								className="flex flex-col gap-0.5"
							>
								<span className="text-[13px] text-fg leading-[1.26]">
									<span className="font-semibold">
										{etiquetaEstado(g.estado)}
									</span>{" "}
									· {plural(g.cuentas, "cuenta", "cuentas")}{" "}
									<ArrowRight
										aria-label="pasan a"
										className="inline size-3 text-fg-tertiary"
									/>{" "}
									{nombre(g.asesorId)}
								</span>
								<span className="text-[11px] text-fg-secondary leading-[1.26]">
									{descripcionEstadoEspecial(g.estado)}
								</span>
							</li>
						))}
					</ul>
					<Collapsible className="pl-6">
						<DisparadorDesplegable>
							Ver {plural(especiales.length, "crédito", "créditos")}
						</DisparadorDesplegable>
						<CollapsibleContent>
							<ul className="mt-2 flex max-h-60 flex-col divide-y divide-warning-solid/20 overflow-y-auto rounded-lg bg-surface px-3">
								{especiales.map((c) => (
									<li
										key={c.creditoId}
										className="flex items-center justify-between gap-3 py-2"
									>
										<span className="flex min-w-0 flex-col gap-0.5">
											<EnlaceCredito
												sifco={c.numeroCreditoSifco}
												creditoId={c.creditoId}
											/>
											<span className="truncate text-[11px] text-fg-tertiary leading-[1.26]">
												{c.cliente ?? "Cliente sin nombre"} ·{" "}
												{etiquetaEstado(c.estadoEspecial)}
											</span>
										</span>
										<span className="shrink-0 text-[11px] text-fg-secondary leading-[1.26]">
											{nombre(c.asesorNuevoId)}
										</span>
									</li>
								))}
							</ul>
						</CollapsibleContent>
					</Collapsible>
				</Aviso>
			) : null}

			{/* Receptores: antes → después +N */}
			{asignaciones.length === 0 ? (
				<p className="text-fg-secondary text-sm">
					No hay cuentas disponibles para trasladar.
				</p>
			) : resumen.length > 0 ? (
				<div className="flex flex-col">
					<ul className="flex flex-col divide-y divide-divider">
						{visibles.map((r) => (
							<FilaReceptor
								key={`${r.bucket}:${r.asesorId}`}
								nombre={nombre(r.asesorId)}
								bucket={r.bucket}
								cuentas={r.cuentas}
								compromisos={r.compromisos}
								carga={preview.carga.find(
									(c) => c.bucket === r.bucket && c.asesorId === r.asesorId,
								)}
							/>
						))}
					</ul>
					{ocultos > 0 || todosReceptores ? (
						<button
							type="button"
							onClick={() => setTodosReceptores((v) => !v)}
							className="w-fit cursor-pointer rounded-sm text-[11px] text-fg-tertiary leading-[1.26] outline-none hover:text-fg-secondary hover:underline focus-visible:ring-2 focus-visible:ring-ring"
						>
							{todosReceptores
								? "Ver menos"
								: `y ${plural(ocultos, "fila", "filas")} más…`}
						</button>
					) : null}
				</div>
			) : null}

			{/* Detalle por crédito (paginado de 25 en 25) */}
			{operativas.length > 0 ? (
				<Collapsible className="flex flex-col gap-2">
					<DisparadorDesplegable>
						Ver detalle por crédito ({operativas.length.toLocaleString("es-GT")}
						)
					</DisparadorDesplegable>
					<CollapsibleContent className="flex flex-col gap-2">
						<ul className="flex max-h-80 flex-col divide-y divide-divider overflow-y-auto rounded-xl border border-line-subtle px-3">
							{operativas
								.slice((p.pagina - 1) * POR_PAGINA, p.pagina * POR_PAGINA)
								.map((a) => {
									const b = aBucket(a.bucket);
									return (
										<li
											key={a.creditoId}
											className="flex items-center justify-between gap-3 py-2"
										>
											<span className="flex min-w-0 flex-col gap-0.5">
												<span className="flex min-w-0 items-baseline gap-2">
													<EnlaceCredito
														sifco={a.numeroCreditoSifco}
														creditoId={a.creditoId}
													/>
													<span className="truncate text-[11px] text-fg-tertiary leading-[1.26]">
														{a.cliente ?? "Cliente sin nombre"}
													</span>
												</span>
												<span className="truncate text-[11px] text-fg-secondary leading-[1.26]">
													{a.asesorAnteriorId
														? nombre(a.asesorAnteriorId)
														: "Sin asesor"}{" "}
													→{" "}
													<span className="font-semibold text-fg">
														{nombre(a.asesorNuevoId)}
													</span>
												</span>
											</span>
											<span className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-1.5">
												{a.prioridad === 0 ? (
													<CrmPill
														tone="brand"
														kind="chip"
														className="px-2 py-0.5 text-[11px]"
													>
														Compromiso
													</CrmPill>
												) : null}
												{b ? (
													<BucketBadge bucket={b} className="px-1 py-0.5" />
												) : (
													<span className="text-[11px] text-fg-tertiary">
														Sin bucket operativo
													</span>
												)}
											</span>
										</li>
									);
								})}
						</ul>
						{totalPaginas > 1 ? (
							<Pagination
								page={p.pagina}
								pageCount={totalPaginas}
								onPageChange={p.onPagina}
								totalItems={operativas.length}
								pageSize={POR_PAGINA}
								className="px-3 py-2"
							/>
						) : null}
					</CollapsibleContent>
				</Collapsible>
			) : null}

			{p.errorConfirmar ? (
				<FieldMessage role="alert">{p.errorConfirmar}</FieldMessage>
			) : null}

			<div className="grid grid-cols-2 gap-3">
				<Button variant="secondary" disabled={p.ocupado} onClick={p.onAtras}>
					Atrás
				</Button>
				<Button disabled={!p.puedeConfirmar} onClick={p.onConfirmar}>
					Confirmar {preview.asignaciones.length.toLocaleString("es-GT")}{" "}
					{preview.asignaciones.length === 1 ? "cuenta" : "cuentas"}
				</Button>
			</div>
		</>
	);
}

/* ── Paso 3 · Resultado ───────────────────────────────────────────────── */

function PasoResultado({
	resultado,
	nombreOrigen,
	onListo,
}: {
	resultado: { cuentas: number; operacionId: string };
	nombreOrigen: string | null;
	onListo: () => void;
}) {
	return (
		<output className="flex min-w-0 flex-col items-center gap-3.5 py-2 text-center">
			<span className="flex size-16 items-center justify-center rounded-full bg-success-subtle text-success-solid">
				<Check aria-hidden className="size-8" strokeWidth={3} />
			</span>
			<h2 className={cn(dialogTitleClassName, "text-xl")}>
				Traslado confirmado
			</h2>
			<p className="text-fg-secondary text-sm leading-[1.35]">
				{plural(resultado.cuentas, "cuenta trasladada", "cuentas trasladadas")}
				{nombreOrigen ? ` de la cartera de ${nombreOrigen}` : ""}.
			</p>
			<p className="max-w-full rounded-lg bg-brand-subtle px-3.5 py-2.5 font-medium text-brand text-xs leading-[1.35]">
				Operación <span className="break-all">{resultado.operacionId}</span> ·
				queda en el historial de traslados.
			</p>
			<Button className="mt-1 min-w-28" onClick={onListo}>
				Listo
			</Button>
		</output>
	);
}

/* ── Vista ──────────────────────────────────────────────────────────── */

/** Contenido del modal (sin el Dialog: así el showcase lo pinta en línea). */
export function TrasladoVista(p: TrasladoVistaProps) {
	if (p.paso === "resultado" && p.resultado) {
		return (
			<PasoResultado
				resultado={p.resultado}
				nombreOrigen={p.origenInfo?.nombre ?? null}
				onListo={p.onListo}
			/>
		);
	}
	const revision = p.paso === "revision" && p.preview;
	// min-w-0: DialogContent es un grid y, sin esto, el ancho mínimo de las
	// filas sin salto de línea (detalle por crédito) ensanchaba el modal.
	return (
		<div className="flex min-w-0 flex-col gap-4">
			<h2 className={cn(dialogTitleClassName, "pr-10")}>
				{revision ? "Revisión del reparto" : "Trasladar cartera"}
			</h2>
			{p.cargando || p.errorCarga ? (
				<EstadoConsulta error={p.errorCarga} retry={p.onReintentar} />
			) : revision && p.preview ? (
				<PasoRevision {...p} preview={p.preview} />
			) : (
				<PasoFormulario {...p} />
			)}
		</div>
	);
}
