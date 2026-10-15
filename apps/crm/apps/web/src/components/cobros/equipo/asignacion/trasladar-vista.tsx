import { Link } from "@tanstack/react-router";
import {
	ArrowRight,
	ChevronDown,
	Clock,
	Info,
	TriangleAlert,
} from "lucide-react";
import { type ReactNode, useId } from "react";
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
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { Label } from "@/components/ui/label";
import { Pagination } from "@/components/ui/pagination";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { partirCarteraPorPool, resumirTraslado } from "@/lib/cobros/traslados";
import { cn } from "@/lib/utils";
import type { client } from "@/utils/orpc";
import { etiquetaNivel, nivelAsesor } from "../estado-asesor";
import {
	ExitoModal,
	type FilaReparto,
	Flecha,
	ListaReparto,
	NotaModal,
	plural,
	TarjetaOpcion,
} from "./piezas-modal";
import {
	type AsesorTraslado,
	EstadoConsulta,
	SelectorAsesor,
} from "./selector-asesor";

/**
 * «Trasladar cartera» — presentación del modal, por pasos, con el estándar de
 * «Marcar ausente» y el Figma «09 · Disponibilidad y redistribución»
 * («Redistribución de cartera» 3360:4254: lista «antes → después +N»;
 * «Cartera redistribuida» 3360:4312) y las tarjetas de «Reasignar» (3631:5567:
 * radio con barra de capacidad).
 *
 *   1. formulario → de quién es la cartera, motivo (y nota), cómo se reparte,
 *                   quién la recibe y, solo si el asesor los tiene (o si se
 *                   va de la empresa), quién queda a cargo de sus créditos
 *                   fuera de cobranza. Los créditos «sueltos» (en buckets que
 *                   el origen no atiende: el motor los subió de bucket y
 *                   siguen a su nombre) se muestran aparte; «A un solo
 *                   asesor» se elige por el pool del origen y avisa que esos
 *                   créditos solo se mueven si quien recibe atiende su bucket
 *                   (si no, cartera-back los bloquea y no se puede confirmar).
 *   2. revision   → el resultado de `previsualizarTraslado`: una fila por
 *                   asesor que recibe, hasta cuándo vale, lo que impide
 *                   confirmar, los créditos fuera de cobranza y el detalle por
 *                   crédito.
 *   3. resultado  → «Cartera redistribuida».
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
	{ valor: "redistribucion", etiqueta: "Redistribución operativa" },
	{ valor: "despido", etiqueta: "Despido" },
	{ valor: "renuncia", etiqueta: "Renuncia" },
	{ valor: "otro", etiqueta: "Otro" },
];

const MODOS: { valor: ModoTraslado; titulo: string; detalle: string }[] = [
	{
		valor: "redistribucion",
		titulo: "Entre el equipo",
		detalle: "Cada crédito va al asesor de su bucket con menos créditos.",
	},
	{
		valor: "traslado_completo",
		titulo: "A un solo asesor",
		detalle: "Recibe toda la cartera; debe atender todos sus buckets.",
	},
	{
		valor: "destino_por_bucket",
		titulo: "Un asesor por bucket",
		detalle: "Usted elige quién recibe cada bucket.",
	},
];

/** Créditos fuera de cobranza: qué es cada estado (desplegable del paso 1). */
const ESTADOS_FUERA: { estado: string; descripcion: string }[] = [
	{
		estado: "Cancelado",
		descripcion: "Crédito cerrado; se conserva para consulta e historial.",
	},
	{
		estado: "Pendiente de cancelación",
		descripcion: "El cierre administrativo aún está en proceso.",
	},
	{ estado: "Caído", descripcion: "Dado de baja de la cobranza activa." },
];

/** Cuentas y capacidad base de un asesor en uno o varios buckets. */
export type CapacidadDestino = { cuentas: number; capacidad: number };

export type OrigenTraslado = {
	nombre: string;
	activo: boolean;
	/** Buckets del pool (definen el nivel). */
	buckets: number[];
	/** Créditos de su cartera por bucket; `null` mientras carga. */
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
	destinos: {
		asesor: AsesorTraslado;
		capacidad: CapacidadDestino | null;
		/** Buckets de créditos sueltos que este destino no atiende. */
		noCubre?: number[];
	}[];
	/** Los buckets de la cartera del origen todavía se están cargando. */
	cargandoBucketsOrigen: boolean;
	/** Buckets en los que el origen tiene créditos (sueltos incluidos). */
	bucketsOrigen: number[];
	/**
	 * Buckets que debe atender quien reciba toda la cartera: los del pool del
	 * origen (sin los sueltos). Por defecto, `bucketsOrigen`.
	 */
	bucketsDestinoUnico?: number[];
	/** Pasa a «Un asesor por bucket» con el destino único en sus buckets. */
	onUsarPorBucket?: () => void;
	destinosPorBucket: Record<number, string>;
	onDestinoBucket: (bucket: number, asesorId: string) => void;
	candidatosPorBucket: Record<number, AsesorTraslado[]>;
	/** Carga de un asesor en un bucket (para la pista bajo cada destino). */
	capacidadEnBucket: (
		asesorId: number,
		bucket: number,
	) => CapacidadDestino | null;
	/** Responsable de los créditos fuera de cobranza (`asesorDestinoEspecialId`). */
	destinoEspecial: string;
	onDestinoEspecial: (asesorId: string) => void;
	candidatosEspecial: AsesorTraslado[];
	/** Despido o renuncia: el responsable de los créditos fuera de cobranza es obligatorio. */
	requiereDestinoEspecial: boolean;
	/**
	 * El origen tiene créditos fuera de cobranza (lo dijo la vista previa): la
	 * pregunta se muestra. `cuantos` es null si no se sabe el número.
	 */
	especialesOrigen?: { cuantos: number | null } | null;
	/** La vista previa se rechazó porque falta quién quede a cargo de ellos. */
	faltaResponsableEspecial?: boolean;
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
	/** Abre la confirmación final. */
	onConfirmar: () => void;

	/* Paso 3 */
	resultado: {
		cuentas: number;
		operacionId: string;
		/** Asesores que recibieron créditos. */
		receptores?: number;
	} | null;
	onListo: () => void;
};

/* ── Utilidades ─────────────────────────────────────────────────────────── */

const POR_PAGINA = 25;

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

function descripcionEstadoEspecial(estado: string) {
	return (
		{
			INCOBRABLE: "Marcado como no recuperable.",
			CANCELADO: "Crédito cerrado; se conserva para consulta e historial.",
			PENDIENTE_CANCELACION: "El cierre administrativo aún está en proceso.",
			CAIDO: "Dado de baja de la cobranza activa.",
		}[estado] ?? "Sin bucket de cobranza."
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

/** Razón de un bloqueo de la vista previa, en lenguaje de supervisor. */
function razonBloqueo(razon: string, bucket: number) {
	return razon === "destino_no_elegible"
		? `El asesor elegido no atiende B${bucket}`
		: razon === "destino_no_configurado"
			? `Falta elegir quién recibe B${bucket}`
			: `Ningún otro asesor activo atiende B${bucket}`;
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

/** Asesor de origen: avatar, nivel, créditos y su reparto por bucket. */
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
	const { propios, sueltos } = partirCarteraPorPool(
		info.porBucket ?? [],
		info.buckets,
	);
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
							? ` · ${plural(total, "crédito", "créditos")} por trasladar`
							: ""}
				</p>
				{!cargando && propios.length ? (
					<ComposicionCartera porBucket={propios} />
				) : null}
				{!cargando && sueltos.length ? (
					<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
						<span className="inline-flex items-center gap-1 font-medium text-[11px] text-warning-text leading-[1.26]">
							Fuera de su pool:
							<InfoTooltip label="Qué son los créditos fuera de su pool">
								Créditos que pasaron a un bucket que {info.nombre} no atiende y
								siguen a su nombre.
							</InfoTooltip>
						</span>
						<ComposicionCartera porBucket={sueltos} />
					</div>
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

/** «Quién la recibe»: tarjeta de radio con la barra de capacidad (Figma 3631:5567). */
function TarjetaDestino({
	id,
	asesor,
	capacidad,
	buckets,
	noCubre = [],
	activo,
}: {
	id: string;
	asesor: AsesorTraslado;
	capacidad: CapacidadDestino | null;
	buckets: number[];
	/** Buckets de créditos sueltos que no atiende. */
	noCubre?: number[];
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
				"flex min-w-0 cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 transition-colors duration-150 has-disabled:cursor-not-allowed has-disabled:opacity-60",
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
						{plural(capacidad.cuentas, "crédito", "créditos")} en{" "}
						{listaBuckets(buckets)} ·{" "}
						{libre > 0
							? `espacio para ${libre.toLocaleString("es-GT")} más`
							: "ya está en su capacidad"}
					</span>
				) : (
					<span className="text-fg-tertiary text-xs leading-[1.26]">
						Atiende {listaBuckets(asesor.buckets)}
					</span>
				)}
				{noCubre.length ? (
					<span className="text-[11px] text-warning-text leading-[1.26]">
						No atiende {listaBuckets(noCubre)}
					</span>
				) : null}
			</span>
			{capacidad ? (
				<Progress
					value={Math.min(pct, 100)}
					size="sm"
					tone={libre !== null && libre <= 0 ? "warning" : "success"}
					aria-label={`Carga de ${asesor.nombre} frente a su capacidad`}
					className="w-16 shrink-0 sm:w-22"
				/>
			) : null}
		</label>
	);
}

/** Pista bajo el destino de un bucket: «20 de 30 en B2 · espacio para 10 más». */
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
			{capacidad.capacidad.toLocaleString("es-GT")} créditos en B{bucket} ·{" "}
			{libre > 0
				? `espacio para ${libre.toLocaleString("es-GT")} más`
				: "ya está en su capacidad"}
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

/** Caja de aviso (peligro / alerta / neutra) de la revisión, con contenido debajo. */
function Aviso({
	tono,
	titulo,
	descripcion,
	children,
}: {
	tono: "danger" | "warning" | "neutral";
	titulo: ReactNode;
	descripcion?: ReactNode;
	children?: ReactNode;
}) {
	return (
		<div
			role={tono === "danger" ? "alert" : undefined}
			className={cn(
				"flex flex-col gap-2 rounded-xl p-3.5",
				tono === "danger"
					? "bg-danger-subtle"
					: tono === "warning"
						? "bg-warning-subtle"
						: "bg-canvas",
			)}
		>
			<div className="flex gap-2">
				<TriangleAlert
					aria-hidden
					className={cn(
						"mt-0.5 size-4 shrink-0",
						tono === "danger"
							? "text-danger-solid"
							: tono === "warning"
								? "text-warning-solid"
								: "text-fg-tertiary",
					)}
				/>
				<div className="flex min-w-0 flex-col gap-0.5">
					<p
						className={cn(
							"font-semibold text-[13px] leading-[1.26]",
							tono === "danger"
								? "text-danger-text"
								: tono === "warning"
									? "text-warning-text"
									: "text-fg",
						)}
					>
						{titulo}
					</p>
					{descripcion ? (
						<p className="text-fg-secondary text-xs leading-[1.35]">
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

/* ── Paso 1 · De quién, por qué y cómo ────────────────────────────────── */

/** «Créditos fuera de cobranza (N): ¿quién queda a cargo?» */
function ResponsableFueraDeCobranza({
	id,
	p,
}: {
	id: string;
	p: TrasladoVistaProps;
}) {
	const cuantos = p.especialesOrigen?.cuantos ?? null;
	const nombre = p.origenInfo?.nombre ?? "El asesor";
	return (
		<div
			className={cn(
				"flex flex-col gap-2 rounded-xl border p-3.5",
				p.faltaResponsableEspecial && !p.destinoEspecial
					? "border-warning-solid bg-warning-subtle/50"
					: "border-line-subtle",
			)}
		>
			<TituloSeccion htmlFor={id}>
				Créditos fuera de cobranza
				{cuantos ? ` (${cuantos.toLocaleString("es-GT")})` : ""}: ¿quién queda a
				cargo?{" "}
				<span className="font-normal text-fg-tertiary">
					{p.requiereDestinoEspecial ? "(obligatorio)" : ""}
				</span>
			</TituloSeccion>
			<p className="text-fg-secondary text-xs leading-[1.4]">
				{p.requiereDestinoEspecial
					? `${nombre} deja la empresa: sus créditos cancelados, caídos o pendientes de cancelación no pueden quedar a su nombre.`
					: `${nombre} tiene créditos cancelados, caídos o pendientes de cancelación.`}{" "}
				Como ya no se cobran ni tienen bucket, no entran en el reparto:
				conservan su estado y solo cambia quién queda a cargo.
			</p>
			<SelectorAsesor
				id={id}
				value={p.destinoEspecial}
				onChange={p.onDestinoEspecial}
				asesores={p.candidatosEspecial}
				disabled={p.ocupado}
			/>
			{p.faltaResponsableEspecial && !p.destinoEspecial ? (
				<FieldMessage role="alert" variant="warning">
					Elija quién queda a cargo para poder ver el reparto.
				</FieldMessage>
			) : null}
			<Collapsible>
				<DisparadorDesplegable>¿Qué créditos son estos?</DisparadorDesplegable>
				<CollapsibleContent>
					<ul className="mt-2 flex flex-col gap-1.5 text-xs leading-[1.35]">
						{ESTADOS_FUERA.map((e) => (
							<li key={e.estado}>
								<span className="font-semibold text-fg">{e.estado}:</span>{" "}
								<span className="text-fg-secondary">{e.descripcion}</span>
							</li>
						))}
					</ul>
				</CollapsibleContent>
			</Collapsible>
		</div>
	);
}

function PasoFormulario(p: TrasladoVistaProps) {
	// Ids únicos por instancia (el showcase pinta varias a la vez): «…-origen»,
	// «…-modo-redistribucion», «…-destino-bucket-2», etc.
	const uid = useId();
	const id = (sufijo: string) => `traslado${uid}${sufijo}`;
	// Solo si aplica: si el asesor se va de la empresa (obligatorio), si la
	// vista previa dijo que tiene créditos fuera de cobranza o si ya se eligió.
	const mostrarResponsable =
		p.requiereDestinoEspecial ||
		!!p.destinoEspecial ||
		!!p.especialesOrigen ||
		!!p.faltaResponsableEspecial;
	// Créditos sueltos: en buckets que el origen no atiende (fuera de su pool).
	const nombreOrigen = p.origenInfo?.nombre ?? "el asesor";
	const { sueltos } = partirCarteraPorPool(
		p.origenInfo?.porBucket ?? [],
		p.origenInfo?.buckets ?? [],
	);
	const bucketsSueltos = sueltos.map((d) => d.bucket);
	const creditosSueltos = sueltos.reduce((t, d) => t + d.cuentas, 0);
	const bucketsUnico = p.bucketsDestinoUnico ?? p.bucketsOrigen;
	const destinoElegido = p.destinos.find(
		(d) => String(d.asesor.asesor_id) === p.destino,
	);
	const sueltosSinDestino = destinoElegido?.noCubre ?? [];

	return (
		<>
			{/* De quién es la cartera */}
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
						Asesor que entrega la cartera
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

			{/* Motivo y nota */}
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
					Nota para el historial{" "}
					<span className="font-normal text-fg-tertiary">
						{p.razon === "otro" ? "(obligatoria)" : "(opcional)"}
					</span>
				</TituloSeccion>
				<Textarea
					id={id("-detalle")}
					maxLength={900}
					rows={2}
					placeholder={
						p.razon === "otro"
							? "Explique el motivo del traslado…"
							: "Contexto para el historial de traslados…"
					}
					value={p.detalle}
					disabled={p.ocupado}
					onChange={(e) => p.onDetalle(e.target.value)}
				/>
			</div>

			{/* Cómo se reparte */}
			<fieldset className="flex flex-col gap-2" disabled={p.ocupado}>
				<legend className="mb-2 font-semibold text-[13px] text-fg leading-[1.26]">
					¿Cómo se reparte?
				</legend>
				<RadioGroup
					value={p.modo}
					onValueChange={(v) => p.onModo(v as ModoTraslado)}
					aria-label="Cómo se reparte"
					className="grid gap-2 sm:grid-cols-3"
				>
					{MODOS.map((m) => (
						<TarjetaOpcion
							key={m.valor}
							id={id(`-modo-${m.valor}`)}
							valor={m.valor}
							titulo={m.titulo}
							detalle={m.detalle}
							activo={p.modo === m.valor}
							className="px-3 py-2.5 sm:flex-col sm:gap-1.5"
						/>
					))}
				</RadioGroup>
			</fieldset>

			{/* Créditos sueltos: qué les pasa en cada forma de repartir. En «A un
			    solo asesor», una vez elegido el destino manda el aviso de su tarjeta. */}
			{sueltos.length &&
			!p.cargandoBucketsOrigen &&
			!(p.modo === "traslado_completo" && destinoElegido) ? (
				<NotaModal
					tono={p.modo === "traslado_completo" ? "warning" : "info"}
					icono={p.modo === "traslado_completo" ? <TriangleAlert /> : <Info />}
				>
					{plural(creditosSueltos, "crédito está", "créditos están")} en{" "}
					{listaBuckets(bucketsSueltos)}, que {nombreOrigen} no atiende.{" "}
					{p.modo === "redistribucion"
						? "Se reparten entre quienes sí atienden esos buckets."
						: p.modo === "traslado_completo"
							? "Solo se mueven si quien recibe atiende esos buckets; si no, el traslado no se puede confirmar."
							: "Elija también quién los recibe."}
				</NotaModal>
			) : null}

			{/* A un solo asesor: tarjetas con la capacidad de cada candidato */}
			{p.modo === "traslado_completo" ? (
				<fieldset
					className="flex flex-col gap-2"
					disabled={p.ocupado || p.cargandoBucketsOrigen}
				>
					<legend className="mb-2 font-semibold text-[13px] text-fg leading-[1.26]">
						¿Quién la recibe?
					</legend>
					{p.cargandoBucketsOrigen ? (
						<p className="text-fg-secondary text-sm">
							Cargando los buckets de su cartera…
						</p>
					) : p.destinos.length ? (
						<RadioGroup
							value={p.destino}
							onValueChange={p.onDestino}
							aria-label="Asesor que recibe la cartera"
							className="-m-1 max-h-72 gap-2 overflow-y-auto p-1"
						>
							{p.destinos.map((d) => (
								<TarjetaDestino
									key={d.asesor.asesor_id}
									id={id(`-destino-${d.asesor.asesor_id}`)}
									asesor={d.asesor}
									capacidad={d.capacidad}
									buckets={bucketsUnico}
									noCubre={d.noCubre}
									activo={p.destino === String(d.asesor.asesor_id)}
								/>
							))}
						</RadioGroup>
					) : (
						<FieldMessage variant="warning">
							{p.origen
								? `Ningún asesor activo atiende ${listaBuckets(bucketsUnico) || "todos los buckets de esta cartera"}. Pruebe «Entre el equipo» o «Un asesor por bucket».`
								: "Seleccione primero de quién es la cartera para ver quién puede recibirla."}
						</FieldMessage>
					)}
					{destinoElegido && sueltosSinDestino.length ? (
						<div className="flex flex-col items-start gap-1.5">
							<FieldMessage variant="warning">
								{destinoElegido.asesor.nombre} no atiende{" "}
								{listaBuckets(sueltosSinDestino)}: esos créditos no se pueden
								mover en este modo y el traslado no se podrá confirmar.
							</FieldMessage>
							{p.onUsarPorBucket ? (
								<Button
									type="button"
									variant="text"
									size="sm"
									className="-ml-2"
									onClick={p.onUsarPorBucket}
								>
									Elegir quién recibe cada bucket
								</Button>
							) : null}
						</div>
					) : null}
				</fieldset>
			) : null}

			{/* Un asesor por bucket */}
			{p.modo === "destino_por_bucket" ? (
				<fieldset className="flex flex-col gap-2.5" disabled={p.ocupado}>
					<legend className="mb-2 font-semibold text-[13px] text-fg leading-[1.26]">
						¿Quién recibe cada bucket?
					</legend>
					{p.cargandoBucketsOrigen ? (
						<p className="text-fg-secondary text-sm">
							Cargando los buckets de su cartera…
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
										<span className="sr-only">Quién recibe B{bucket}</span>
									</Label>
									<div className="flex min-w-0 flex-col gap-1">
										<SelectorAsesor
											id={id(`-destino-bucket-${bucket}`)}
											value={elegido}
											onChange={(v) => p.onDestinoBucket(bucket, v)}
											asesores={p.candidatosPorBucket[bucket] ?? []}
										/>
										{bucketsSueltos.includes(bucket) ? (
											<p className="text-[11px] text-warning-text leading-[1.26]">
												Fuera del pool de {nombreOrigen} ·{" "}
												{plural(
													sueltos.find((d) => d.bucket === bucket)?.cuentas ??
														0,
													"crédito suelto",
													"créditos sueltos",
												)}
											</p>
										) : null}
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
							Seleccione primero de quién es la cartera para ver sus buckets.
						</p>
					)}
				</fieldset>
			) : null}

			{/* Créditos fuera de cobranza (solo si aplica) */}
			{mostrarResponsable ? (
				<ResponsableFueraDeCobranza id={id("-destino-especial")} p={p} />
			) : null}

			<NotaModal tono="info" icono={<Info />}>
				Las promesas de pago vigentes pasan con sus condiciones. Antes de
				confirmar verá cómo queda el reparto.
			</NotaModal>

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
					{p.previsualizando ? "Calculando…" : "Ver reparto"}
				</Button>
			</div>
		</>
	);
}

/* ── Paso 2 · Redistribución de cartera ───────────────────────────────── */

/** Una fila por asesor que recibe: «Carlos Ramírez · 28 → 43 · +15». */
function filasPorAsesor(
	preview: PreviewTraslado,
	operativas: AsignacionPreview[],
	nombre: (id: number) => string,
): FilaReparto[] {
	const porAsesor = new Map<
		number,
		{
			cuentas: number;
			compromisos: number;
			buckets: { bucket: number | null; cuentas: number }[];
		}
	>();
	for (const r of resumirTraslado(operativas)) {
		const fila = porAsesor.get(r.asesorId) ?? {
			cuentas: 0,
			compromisos: 0,
			buckets: [],
		};
		fila.cuentas += r.cuentas;
		fila.compromisos += r.compromisos;
		fila.buckets.push({ bucket: r.bucket, cuentas: r.cuentas });
		porAsesor.set(r.asesorId, fila);
	}
	return [...porAsesor]
		.map(([asesorId, f]) => {
			const carga = preview.carga.filter((c) => c.asesorId === asesorId);
			const recibe = new Set(f.buckets.map((b) => b.bucket));
			const excedidos = carga.filter(
				(c) => recibe.has(c.bucket) && c.despues > c.capacidad,
			);
			const antes = carga.reduce((t, c) => t + c.antes, 0);
			const despues = carga.length
				? carga.reduce((t, c) => t + c.despues, 0)
				: f.cuentas;
			const partes = [
				f.buckets
					.map((b) =>
						b.bucket === null
							? `sin bucket +${b.cuentas}`
							: `B${b.bucket} +${b.cuentas}`,
					)
					.join(" · "),
				f.compromisos > 0
					? plural(f.compromisos, "con promesa de pago", "con promesa de pago")
					: null,
				excedidos.length
					? `supera su capacidad en ${listaBuckets(excedidos.map((c) => c.bucket))}`
					: null,
			].filter(Boolean);
			return {
				clave: asesorId,
				nombre: nombre(asesorId),
				antes: carga.length ? antes : 0,
				despues,
				detalle: partes.join(" · "),
				alerta: excedidos.length > 0,
			};
		})
		.sort((a, b) => b.despues - b.antes - (a.despues - a.antes));
}

function PasoRevision(p: TrasladoVistaProps & { preview: PreviewTraslado }) {
	const { preview } = p;
	const nombre = (id: number) => p.nombres[id] ?? String(id);
	const asignaciones = preview.asignaciones as AsignacionPreview[];
	const excluidos = preview.excluidos as ExcluidoPreview[];
	const operativas = asignaciones.filter((a) => !a.estadoEspecial);
	const especiales = asignaciones.filter((a) => a.estadoEspecial);
	const gruposEspeciales = agruparCuentasEspeciales(especiales);
	const filas = filasPorAsesor(preview, operativas, nombre);
	const receptores = new Set(asignaciones.map((a) => a.asesorNuevoId)).size;
	const promesas = operativas.filter((a) => a.prioridad === 0).length;
	const totalPaginas = Math.max(1, Math.ceil(operativas.length / POR_PAGINA));
	const vence = new Date(preview.venceEn).toLocaleTimeString("es-GT", {
		timeZone: "America/Guatemala",
		hour: "2-digit",
		minute: "2-digit",
	});
	const responsablesEspeciales = [
		...new Set(especiales.map((c) => c.asesorNuevoId)),
	];
	// «A un solo asesor» con créditos en buckets que el destino no atiende
	// (p. ej. los sueltos del origen): cartera-back los bloquea todos.
	const bucketsBloqueados = [
		...new Set(preview.bloqueos.map((b) => b.bucket)),
	].sort((a, b) => a - b);
	const destinoNoCubre =
		p.modo === "traslado_completo" &&
		preview.bloqueos.length > 0 &&
		preview.bloqueos.every((b) => b.razon === "destino_no_elegible");

	return (
		<>
			<p className="-mt-2 text-fg-secondary text-sm leading-[1.3]">
				Cartera de {nombre(Number(p.origen))} ·{" "}
				{plural(asignaciones.length, "crédito", "créditos")} <Flecha />
				<span className="sr-only">entre</span>{" "}
				{plural(receptores, "asesor", "asesores")}
			</p>

			{p.vencido ? (
				<Aviso
					tono="danger"
					titulo="Este reparto ya no vale"
					descripcion="Pasaron más de 10 minutos desde que se calculó y la cartera pudo cambiar. Calcúlelo de nuevo para confirmar."
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
				<NotaModal tono="info" icono={<Clock />}>
					{promesas > 0
						? `${plural(promesas, "crédito tiene", "créditos tienen")} promesa de pago vigente: pasan con sus condiciones. `
						: ""}
					Puede confirmar este reparto hasta las{" "}
					<span className="font-semibold">{vence}</span> (hora de Guatemala).
				</NotaModal>
			)}

			{preview.bloqueos.length > 0 ? (
				<Aviso
					tono="danger"
					titulo={`No se puede confirmar: ${plural(preview.bloqueos.length, "crédito no tiene quién lo reciba", "créditos no tienen quién los reciba")}`}
					descripcion={
						destinoNoCubre
							? `Están en ${listaBuckets(bucketsBloqueados)}, que ${nombre(Number(p.destino))} no atiende. En «A un solo asesor» no se pueden mover, y mientras tanto no se puede confirmar. Elija quién recibe esos buckets; ${nombre(Number(p.destino))} se queda con el resto.`
							: p.modo === "redistribucion"
								? "Ningún otro asesor activo atiende ese bucket. Agregue a alguien a ese bucket y vuelva a calcular el reparto."
								: "Vuelva atrás y elija otro destino para esos buckets."
					}
				>
					<ul className="flex max-h-36 flex-col gap-1 overflow-y-auto pl-6 text-fg-secondary text-xs leading-[1.3]">
						{preview.bloqueos.map((b) => (
							<li key={b.creditoId}>
								Crédito {b.creditoId} · {razonBloqueo(b.razon, b.bucket)}
							</li>
						))}
					</ul>
					{destinoNoCubre && p.onUsarPorBucket ? (
						<Button
							size="sm"
							variant="outline"
							className="w-fit bg-surface"
							disabled={p.ocupado}
							onClick={p.onUsarPorBucket}
						>
							Elegir quién recibe cada bucket
						</Button>
					) : null}
				</Aviso>
			) : null}

			{excluidos.length > 0 ? (
				<Aviso
					tono="danger"
					titulo={`No se puede confirmar: ${plural(excluidos.length, "crédito no tiene", "créditos no tienen")} bucket`}
					descripcion="Están en convenio u otro estado sin bucket, y este traslado no los puede mover. Mientras sigan en esta cartera no se puede confirmar."
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

			{/* Quién recibe: antes → después +N */}
			{asignaciones.length === 0 ? (
				<p className="text-fg-secondary text-sm">
					Esta cartera no tiene créditos para trasladar.
				</p>
			) : filas.length > 0 ? (
				<ListaReparto filas={filas} />
			) : null}

			{especiales.length > 0 ? (
				<Aviso
					tono="neutral"
					titulo={
						<span className="inline-flex flex-wrap items-center gap-x-1.5">
							Créditos fuera de cobranza ({especiales.length})
							<ArrowRight
								aria-label="quedan a cargo de"
								className="inline size-3.5 text-fg-tertiary"
							/>
							{responsablesEspeciales.map(nombre).join(", ")}
							<InfoTooltip label="Qué son los créditos fuera de cobranza">
								Cancelados, caídos o pendientes de cancelación. Ya no se cobran
								ni tienen bucket: no cuentan en la carga ni en la capacidad.
							</InfoTooltip>
						</span>
					}
					descripcion="Conservan su estado; solo cambia quién queda a cargo."
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
									· {plural(g.cuentas, "crédito", "créditos")}
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
							<ul className="mt-2 flex max-h-60 flex-col divide-y divide-divider overflow-y-auto rounded-lg bg-surface px-3">
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
													<Flecha className="size-3" />{" "}
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
														Promesa de pago
													</CrmPill>
												) : null}
												{b ? (
													<BucketBadge bucket={b} className="px-1 py-0.5" />
												) : (
													<span className="text-[11px] text-fg-tertiary">
														Sin bucket
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
					Confirmar traslado
				</Button>
			</div>
		</>
	);
}

/* ── Paso 3 · Resultado ───────────────────────────────────────────────── */

function PasoResultado({
	resultado,
	modo,
	nombreOrigen,
	onListo,
}: {
	resultado: NonNullable<TrasladoVistaProps["resultado"]>;
	modo: ModoTraslado;
	nombreOrigen: string | null;
	onListo: () => void;
}) {
	return (
		<ExitoModal
			titulo={
				modo === "traslado_completo"
					? "Cartera trasladada"
					: "Cartera redistribuida"
			}
			onListo={onListo}
			nota="Queda en el historial de traslados."
		>
			<p>
				{resultado.cuentas === 1
					? "Se trasladó 1 crédito"
					: `Se trasladaron ${resultado.cuentas.toLocaleString("es-GT")} créditos`}
				{nombreOrigen ? ` de la cartera de ${nombreOrigen}` : ""}
				{resultado.receptores
					? ` a ${plural(resultado.receptores, "asesor", "asesores")}`
					: ""}
				.
			</p>
			<p className="mt-1 break-all text-fg-tertiary text-xs">
				Operación {resultado.operacionId}
			</p>
		</ExitoModal>
	);
}

/* ── Vista ──────────────────────────────────────────────────────────── */

/** Contenido del modal (sin el Dialog: así el showcase lo pinta en línea). */
export function TrasladoVista(p: TrasladoVistaProps) {
	if (p.paso === "resultado" && p.resultado) {
		return (
			<PasoResultado
				resultado={p.resultado}
				modo={p.modo}
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
				{revision ? "Redistribución de cartera" : "Trasladar cartera"}
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
