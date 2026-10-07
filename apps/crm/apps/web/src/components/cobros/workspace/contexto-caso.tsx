/**
 * Workspace de cobros · panel izquierdo, «Contexto del caso».
 *
 * La Ficha 360 reducida (Figma «CRM Ventas» › Workspace, `ctx/*`): identidad,
 * intentos sin contacto, bucket y mora, y las pestañas Resumen · Historial ·
 * Estado de cuenta · Asistente IA · «Más» (Documentos, Referencias,
 * Ubicaciones). El cuerpo tiene scroll propio y el pie fijo lleva «Abrir Ficha
 * 360».
 *
 * Dos piezas:
 *  - `ContextoCasoVista`: solo presentación (props ya formateadas). La usa el
 *    showcase de /design-system con datos de ejemplo.
 *  - `ContextoCaso`: el contenedor. Recibe el `CasoWorkspace` de
 *    `useCasoWorkspace`, arma las props y maneja el envío del estado de cuenta.
 *
 * El panel mide 520–640px aunque la pantalla sea ancha: todo es una columna y
 * los componentes de la ficha que reutiliza usan container queries.
 */
import { useMutation } from "@tanstack/react-query";
import {
	Briefcase,
	Car,
	CheckCheck,
	ChevronDown,
	Clock,
	FileText,
	HandCoins,
	Home,
	Lock,
	Mail,
	MapPin,
	MessageCircle,
	MessageSquare,
	Phone,
	TriangleAlert,
} from "lucide-react";
import * as React from "react";
import { etiquetaMetodoContacto } from "server/src/lib/gestion-temprana-b1";
import {
	RESULTADO_VISITA_LABEL,
	type ResultadoVisita,
} from "server/src/lib/visitas-cobros";
import { toast } from "sonner";
import {
	AsistenteIA,
	CuotaPlanFila,
	type DocumentoFila,
	DocumentosFicha,
	type EstadoCuota,
	HistorialGestiones,
	HistoricoCredito,
	type ItemGestion,
	PendienteBackend,
	ResumenCuentaCard,
	RotuloSeccion,
	type TonoGestion,
} from "@/components/cobros/ficha/ficha-pestanas";
import { CardEstadoCobro } from "@/components/cobros/ficha/ficha-resumen";
import {
	estadoReferencia,
	etiquetaOrigen,
} from "@/components/cobros/ReferenciasView";
import {
	type Bucket,
	BucketBadge,
	type Mora,
	MoraBadge,
	PromesaBadge,
} from "@/components/ds/badges";
import { CardCobro } from "@/components/ds/cards-cobranza";
import {
	CrmCard,
	CrmPill,
	type CrmTone,
	crmText,
	inicialesDe,
} from "@/components/ds/cards-credito";
import { SinContacto } from "@/components/ds/indicadores";
import { SegmentedNav } from "@/components/ds/ubicaciones";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { inicioDelDiaGT } from "@/lib/cobros/promesa-activa";
import {
	abreviarCreditosCrm,
	creditoCorto,
	esCuotaDelPlan,
	fechaLargaGT,
	formatoQuetzales as fmtQ,
	hrefTelefono,
} from "@/lib/cobros/reglas-caso";
import { cn } from "@/lib/utils";
import { client } from "@/utils/orpc";
import { correoDeRelleno, telefonoDeRelleno } from "./gestion/contacto-valido";
import { ChipPronto } from "./gestion/piezas";
import type {
	CasoWorkspace,
	CuotaPlan,
	GestionCaso,
} from "./use-caso-workspace";

/* ── Tipos de la vista ──────────────────────────────────────────────────────── */

export type TabContexto =
	| "resumen"
	| "historial"
	| "estado-cuenta"
	| "asistente"
	| "documentos"
	| "referencias"
	| "ubicaciones";

const TABS_PRINCIPALES: Array<{ value: TabContexto; label: string }> = [
	{ value: "resumen", label: "Resumen" },
	{ value: "historial", label: "Historial" },
	{ value: "estado-cuenta", label: "Estado de cuenta" },
	{ value: "asistente", label: "Asistente IA" },
];

const TABS_MAS: Array<{ value: TabContexto; label: string }> = [
	{ value: "documentos", label: "Documentos" },
	{ value: "referencias", label: "Referencias" },
	{ value: "ubicaciones", label: "Ubicaciones" },
];

/**
 * Por debajo de este ancho del panel (móvil) las cuatro pestañas y «Más» no
 * caben: «Asistente IA» pasa al menú «Más». Se mide en JS y no con container
 * queries porque el menú se pinta en un portal, fuera del contenedor.
 */
const ANCHO_PESTANAS_COMPLETAS = 448;
const TAB_ASISTENTE = TABS_PRINCIPALES[3] as {
	value: TabContexto;
	label: string;
};

/** true mientras el elemento mide menos de `ancho` px. */
function useMasAngostoQue(
	ref: React.RefObject<HTMLElement | null>,
	ancho: number,
) {
	const [angosto, setAngosto] = React.useState(false);
	React.useEffect(() => {
		const el = ref.current;
		if (!el || typeof ResizeObserver === "undefined") return;
		const medir = () => setAngosto(el.clientWidth < ancho);
		medir();
		const ro = new ResizeObserver(medir);
		ro.observe(el);
		return () => ro.disconnect();
	}, [ref, ancho]);
	return angosto;
}

export type AlertaContexto = {
	id: string;
	tono: "danger" | "warning" | "info";
	titulo: string;
	detalle?: string | null;
};

export type ResumenContexto = {
	estadoCobro: {
		estado: { etiqueta: string; tone: CrmTone };
		diasMora: number;
		/** "bucket B2". */
		bucket?: string;
		filas: Array<{ label: string; valor: string }>;
	};
	/** Promesa vigente; null = «Sin acuerdo activo». */
	promesa: { monto: string; fecha: string; responsable?: string | null } | null;
	/** «Cobro de hoy»; null si no hay nada vencido. */
	cobroHoy: {
		subtitulo?: string | null;
		conceptos: Array<{ label: string; detalle?: string | null; monto: string }>;
		total: string;
	} | null;
	/**
	 * Avisos operativos que el asesor tiene que ver (recuperación en B5,
	 * convenio incumplido, apagado o trámite pendiente…): bandas arriba.
	 */
	alertas: AlertaContexto[];
	/**
	 * Alertas del caso (`getAlertasCaso`: «Caso sin contacto reciente»,
	 * «Cliente subió de bucket»…): van en un desplegable CERRADO por defecto.
	 */
	alertasCaso?: AlertaContexto[];
	/** Reemplaza el pie del desplegable de alertas («Ver alertas leídas · Pronto»). */
	pieAlertasCaso?: React.ReactNode;
	contacto: {
		/** `href` null = dato de relleno («00000000»): sin enlace, «Dato no válido». */
		telefonos: Array<{ texto: string; href: string | null }>;
		correo: string | null;
		/** El correo es de relleno («sin-email@example.com»). */
		correoNoValido?: boolean;
		direccion: string | null;
		/** "2 números nuevos sin guardar · 3 referencias con teléfono". */
		aviso?: string | null;
	};
	/** Solo en B4 / en recuperación (Figma 3788-7794). */
	vehiculoRecuperar: {
		vehiculo: string;
		detalle: string;
		gps: { tone: CrmTone; texto: string };
	} | null;
};

export type CuotaContexto = {
	id: string;
	titulo: string;
	estado: EstadoCuota;
	monto: string;
	montoDetalle?: string;
	lineas: string[];
	chips?: string[];
};

export type ReferenciaContexto = {
	id: string;
	nombre: string;
	/** "Hermana · 5555-0001". */
	detalle: string;
	estado: { etiqueta: string; tone: CrmTone };
};

export type UbicacionContexto = {
	clave: string;
	/** "Residencia" / "Trabajo". */
	titulo: string;
	/** La dirección registrada (del caso o de la solicitud). */
	direccion: string | null;
	/** Última visita REALIZADA a esa dirección; null = sin verificar. */
	verificacion: {
		fecha: string;
		direccionVisitada: string;
		resultado?: string | null;
		responsable?: string | null;
		comentarios?: string | null;
	} | null;
};

type Estado = "ok" | "cargando" | "error" | "vacio";

export type ContextoCasoVistaProps = {
	nombre: string;
	iniciales?: string;
	/** Número de crédito SIFCO. */
	credito: string;
	vehiculo?: string | null;
	placa?: string | null;
	intentosSinContacto: number;
	/** Fecha ya formateada del último intento. */
	ultimoIntento?: string | null;
	bucket: Bucket | null;
	/** Tooltip del bucket ("B2 · Gestión Activa"). */
	bucketTitulo?: string;
	mora: { nivel: Mora; texto: string } | null;
	resumen: ResumenContexto;
	historial: {
		estado: Estado;
		total: number;
		items: ItemGestion[];
		onReintentar?: () => void;
	};
	/** Vida del crédito; null = pendiente de backend. */
	historico: Array<{ id: string; descripcion: string; fecha: string }> | null;
	estadoCuenta: {
		saldoTotal: string;
		filas: Array<{ label: string; valor: string; tono?: "danger" | "success" }>;
		cuotas: CuotaContexto[];
		estadoPlan: Estado;
		/** Sin handler, el botón «Enviar por WhatsApp» no se muestra. */
		onEnviar?: () => void;
		enviando?: boolean;
	};
	documentos: { enviar: DocumentoFila[]; solicitar: DocumentoFila[] };
	referencias: { estado: Estado; items: ReferenciaContexto[] };
	ubicaciones: UbicacionContexto[];
	resumenIA: { texto: string; etiquetas: string[]; generadoEn: string } | null;
	onAbrirFicha?: () => void;
	tabInicial?: TabContexto;
	historialInicial?: "actual" | "historico";
	className?: string;
};

/* ── Vista ──────────────────────────────────────────────────────────────────── */

const POR_PAGINA_HISTORIAL = 10;
const POR_PAGINA_CUOTAS = 12;

export function ContextoCasoVista({
	nombre,
	iniciales,
	credito,
	vehiculo,
	placa,
	intentosSinContacto,
	ultimoIntento,
	bucket,
	bucketTitulo,
	mora,
	resumen,
	historial,
	historico,
	estadoCuenta,
	documentos,
	referencias,
	ubicaciones,
	resumenIA,
	onAbrirFicha,
	tabInicial = "resumen",
	historialInicial = "actual",
	className,
}: ContextoCasoVistaProps) {
	const [tab, setTab] = React.useState<TabContexto>(tabInicial);
	const raizRef = React.useRef<HTMLElement>(null);
	const angosto = useMasAngostoQue(raizRef, ANCHO_PESTANAS_COMPLETAS);
	const principales = angosto
		? TABS_PRINCIPALES.filter((t) => t.value !== "asistente")
		: TABS_PRINCIPALES;
	const mas = angosto ? [TAB_ASISTENTE, ...TABS_MAS] : TABS_MAS;
	const tabMas = mas.find((t) => t.value === tab);
	const cuerpoRef = React.useRef<HTMLDivElement>(null);
	const corto = creditoCorto(credito);
	const cambiarTab = (t: TabContexto) => {
		setTab(t);
		cuerpoRef.current?.scrollTo({ top: 0 });
	};

	return (
		<section
			ref={raizRef}
			aria-label="Contexto del caso"
			className={cn(
				"@container flex h-full min-h-0 min-w-0 flex-col overflow-x-hidden bg-surface",
				className,
			)}
		>
			{/* Encabezado: identidad, intentos, bucket y mora */}
			<header className="flex flex-col gap-3 px-5 pt-4">
				<span className="text-[13px] text-fg-tertiary leading-[1.26]">
					Contexto del caso
				</span>
				<div className="flex min-w-0 items-center gap-3">
					<span
						aria-hidden
						className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-subtle font-bold text-[15px] text-brand"
					>
						{iniciales ?? inicialesDe(nombre)}
					</span>
					<div className="flex min-w-0 flex-col gap-0.5">
						<h2 className="wrap-break-word font-semibold text-fg text-lg leading-[1.26]">
							{nombre}
						</h2>
						<p className="wrap-break-word text-fg-secondary text-sm leading-[1.26]">
							<span title={corto !== credito ? credito : undefined}>
								Crédito #{corto}
							</span>
							{[vehiculo, placa]
								.filter(Boolean)
								.map((x) => ` · ${x}`)
								.join("")}
						</p>
					</div>
				</div>
				{intentosSinContacto > 0 ? (
					<SinContacto
						intentos={intentosSinContacto}
						ultimoIntento={ultimoIntento ?? undefined}
					/>
				) : null}
				{bucket || mora ? (
					<div className="flex flex-wrap items-center gap-2">
						{bucket ? (
							<BucketBadge bucket={bucket} title={bucketTitulo} />
						) : null}
						{mora ? (
							<MoraBadge mora={mora.nivel}>{mora.texto}</MoraBadge>
						) : null}
					</div>
				) : null}

				{/* Pestañas: las cuatro de Figma y «Más ▾» con el resto */}
				<Tabs value={tab} onValueChange={(v) => cambiarTab(v as TabContexto)}>
					{/* Sin barra visible: si aun así no cabe, se desliza en vez de
					    empujar el panel hacia los lados. */}
					<TabsList className="gap-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
						{principales.map((t) => (
							<TabsTrigger
								key={t.value}
								value={t.value}
								className={cn(
									"h-10 text-[13px]",
									angosto ? "px-1.5" : "@lg:px-3 px-2.5",
								)}
							>
								{t.label}
							</TabsTrigger>
						))}
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<button
									type="button"
									data-state={tabMas ? "active" : "inactive"}
									aria-label={
										angosto && tabMas ? `Más: ${tabMas.label}` : undefined
									}
									className={cn(
										"relative ml-auto inline-flex h-10 shrink-0 cursor-pointer items-center gap-1 rounded-md pb-0.5 font-medium text-[13px] text-fg-secondary outline-none transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
										"after:absolute after:inset-x-0 after:bottom-0 after:h-0.5",
										angosto ? "px-1.5" : "px-2.5",
										tabMas &&
											"font-semibold text-brand after:bg-brand hover:text-brand",
									)}
								>
									{/* Angosto: no cabe el nombre; el subrayado marca que la pestaña abierta está aquí. */}
									{angosto ? "Más" : (tabMas?.label ?? "Más")}
									<ChevronDown aria-hidden className="size-3.5" />
								</button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="w-44">
								{mas.map((t) => (
									<DropdownMenuItem
										key={t.value}
										className={cn(
											"cursor-pointer",
											t.value === tab && "font-semibold text-brand",
										)}
										onSelect={() => cambiarTab(t.value)}
									>
										{t.label}
									</DropdownMenuItem>
								))}
							</DropdownMenuContent>
						</DropdownMenu>
					</TabsList>
				</Tabs>
			</header>

			{/* Cuerpo con scroll propio */}
			<div
				ref={cuerpoRef}
				className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-5 pt-4 pb-5"
			>
				{tab === "resumen" && <PestanaResumen {...resumen} />}
				{tab === "historial" && (
					<PestanaHistorial
						historial={historial}
						historico={historico}
						inicial={historialInicial}
					/>
				)}
				{tab === "estado-cuenta" && <PestanaEstadoCuenta {...estadoCuenta} />}
				{tab === "asistente" && <AsistenteIA resumen={resumenIA} compacto />}
				{tab === "documentos" && (
					<DocumentosFicha
						enviar={documentos.enviar}
						solicitar={documentos.solicitar}
					/>
				)}
				{tab === "referencias" && <PestanaReferencias {...referencias} />}
				{tab === "ubicaciones" && (
					<PestanaUbicaciones ubicaciones={ubicaciones} />
				)}
			</div>

			{/* Pie fijo */}
			<footer className="border-line-subtle border-t px-5 py-3">
				<Button
					variant="secondary"
					className="w-full"
					onClick={onAbrirFicha}
					disabled={!onAbrirFicha}
				>
					Abrir Ficha 360
				</Button>
			</footer>
		</section>
	);
}

/* ── Resumen ────────────────────────────────────────────────────────────────── */

const ALERTA_TONO: Record<AlertaContexto["tono"], string> = {
	danger: "bg-danger-subtle text-danger-text",
	warning: "bg-warning-subtle text-warning-text",
	info: "bg-info-subtle text-info-text",
};

function PestanaResumen({
	estadoCobro,
	promesa,
	cobroHoy,
	alertas,
	alertasCaso = [],
	pieAlertasCaso,
	contacto,
	vehiculoRecuperar,
}: ResumenContexto) {
	return (
		<div className="flex flex-col gap-3">
			{alertas.length > 0 ? (
				<ul className="flex flex-col gap-2">
					{alertas.map((a) => (
						<li
							key={a.id}
							className={cn(
								"flex items-start gap-2 rounded-lg px-3 py-2",
								ALERTA_TONO[a.tono],
							)}
						>
							{a.tono === "info" ? (
								<Lock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
							) : (
								<TriangleAlert
									aria-hidden
									className="mt-0.5 size-3.5 shrink-0"
								/>
							)}
							<div className="flex min-w-0 flex-col gap-0.5">
								<span className="wrap-break-word font-semibold text-[13px] leading-[1.26]">
									{a.titulo}
								</span>
								{a.detalle ? (
									<span className="wrap-break-word text-xs leading-snug opacity-90">
										{a.detalle}
									</span>
								) : null}
							</div>
						</li>
					))}
				</ul>
			) : null}

			{alertasCaso.length > 0 ? (
				<AlertasCasoDesplegable alertas={alertasCaso} pie={pieAlertasCaso} />
			) : null}

			{vehiculoRecuperar ? (
				<CrmCard superficie="outline" className="gap-1.5 p-4">
					<span className="flex items-center gap-2 font-semibold text-fg text-sm">
						<Car aria-hidden className="size-4 text-danger-solid" />
						Vehículo a recuperar
					</span>
					<span className="wrap-break-word font-semibold text-base text-fg leading-[1.26]">
						{vehiculoRecuperar.vehiculo}
					</span>
					<span className="wrap-break-word text-fg-secondary text-sm">
						{vehiculoRecuperar.detalle}
					</span>
					<CrmPill
						kind="chip"
						tone={vehiculoRecuperar.gps.tone}
						className="mt-1 whitespace-normal"
					>
						{vehiculoRecuperar.gps.texto}
					</CrmPill>
				</CrmCard>
			) : null}

			<CardEstadoCobro
				estado={estadoCobro.estado}
				diasMora={estadoCobro.diasMora}
				bucket={estadoCobro.bucket}
				filas={estadoCobro.filas}
			/>

			<CrmCard superficie="outline" className="gap-2 p-4">
				<div className="flex flex-wrap items-center gap-2.5">
					<HandCoins
						aria-hidden
						className={cn(
							"size-4.5 shrink-0",
							promesa ? "text-success-solid" : "text-fg-tertiary",
						)}
					/>
					<h3 className={crmText.title}>
						{promesa ? "Promesa vigente" : "Sin acuerdo activo"}
					</h3>
					{promesa ? (
						<PromesaBadge promesa="Vigente" />
					) : (
						<CrmPill tone="neutral">Sin acuerdo</CrmPill>
					)}
				</div>
				{promesa ? (
					<>
						<p className="flex flex-wrap items-baseline gap-x-2">
							<span className="font-bold text-2xl text-success-text tabular-nums leading-[1.26]">
								{promesa.monto}
							</span>
							<span className="text-fg-secondary text-sm">
								· {promesa.fecha}
							</span>
						</p>
						{promesa.responsable ? (
							<span className={crmText.sub}>
								Registrada por {promesa.responsable}
							</span>
						) : null}
					</>
				) : (
					<p className={crmText.sub}>
						El cliente no tiene una promesa de pago vigente.
					</p>
				)}
			</CrmCard>

			{cobroHoy ? (
				<CardCobro
					className="gap-3 p-4"
					subtitulo={cobroHoy.subtitulo ?? null}
					conceptos={cobroHoy.conceptos.map((c) => ({
						label: c.label,
						detalle: c.detalle ?? undefined,
						monto: c.monto,
					}))}
					total={cobroHoy.total}
				/>
			) : null}

			<CrmCard superficie="outline" className="gap-2.5 p-4">
				<h3 className={crmText.title}>Contacto</h3>
				<dl className="flex flex-col gap-2">
					<FilaContacto icono={<Phone aria-hidden />} label="Teléfonos">
						{contacto.telefonos.length === 0 ? (
							<span className="text-fg-tertiary">—</span>
						) : (
							contacto.telefonos.map((t) =>
								t.href ? (
									<a
										key={t.texto}
										href={t.href}
										className="min-w-0 break-all font-medium text-brand hover:underline"
									>
										{t.texto}
									</a>
								) : (
									<DatoNoValido key={t.texto} texto={t.texto} />
								),
							)
						)}
					</FilaContacto>
					<FilaContacto icono={<Mail aria-hidden />} label="Correo">
						{contacto.correo && contacto.correoNoValido ? (
							<DatoNoValido texto={contacto.correo} />
						) : contacto.correo ? (
							<a
								href={`mailto:${contacto.correo}`}
								className="min-w-0 break-all font-medium text-brand hover:underline"
							>
								{contacto.correo}
							</a>
						) : (
							<span className="text-fg-tertiary">—</span>
						)}
					</FilaContacto>
					<FilaContacto icono={<Home aria-hidden />} label="Residencia">
						<span
							className={cn(
								"wrap-break-word min-w-0",
								contacto.direccion ? "font-medium text-fg" : "text-fg-tertiary",
							)}
						>
							{contacto.direccion ?? "—"}
						</span>
					</FilaContacto>
				</dl>
				{contacto.aviso ? (
					<p className="rounded-lg bg-muted px-3 py-2 text-fg-secondary text-xs">
						{contacto.aviso}
					</p>
				) : null}
			</CrmCard>
		</div>
	);
}

/**
 * Las alertas del caso en UNA fila compacta, cerrada por defecto
 * («⚠ Alertas del caso · 3 ▾»). No están en el Figma: abiertas tapaban el
 * resumen. Al abrirla muestra la lista y, al pie, «Ver alertas leídas» (W5, «Pronto») o `pie` si se pasa.
 */
function AlertasCasoDesplegable({
	alertas,
	pie,
}: {
	alertas: AlertaContexto[];
	pie?: React.ReactNode;
}) {
	const [abierto, setAbierto] = React.useState(false);
	const listaId = React.useId();
	return (
		<div className="flex flex-col overflow-hidden rounded-lg border border-line-subtle bg-surface">
			<button
				type="button"
				aria-expanded={abierto}
				aria-controls={listaId}
				onClick={() => setAbierto((v) => !v)}
				className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
			>
				<TriangleAlert
					aria-hidden
					className="size-3.5 shrink-0 text-warning-solid"
				/>
				<span className="font-medium text-[13px] text-fg leading-[1.26]">
					Alertas del caso
				</span>
				<CrmPill
					kind="chip"
					tone="warning"
					dot={false}
					className="px-2 py-0.5 text-[11px]"
				>
					{alertas.length}
				</CrmPill>
				<ChevronDown
					aria-hidden
					className={cn(
						"ml-auto size-4 shrink-0 text-fg-tertiary transition-transform",
						abierto && "rotate-180",
					)}
				/>
			</button>
			{abierto ? (
				<div id={listaId} className="flex flex-col border-line-subtle border-t">
					<ul className="flex flex-col divide-y divide-line-subtle">
						{alertas.map((a) => (
							<li key={a.id} className="flex items-start gap-2 px-3 py-2">
								<div className="flex min-w-0 flex-1 flex-col gap-0.5">
									<span className="wrap-break-word font-semibold text-[13px] text-fg leading-[1.26]">
										{a.titulo}
									</span>
									{a.detalle ? (
										<span className="wrap-break-word text-fg-secondary text-xs leading-snug">
											{a.detalle}
										</span>
									) : null}
								</div>
								{/* TODO(José) · tarea W5: marcar como leído el grupo de esta
								    alerta (docs/features/cobros-02/16-workspace-backend.md). */}
								<Button
									type="button"
									variant="ghost"
									size="icon"
									disabled
									title="Marcar como leída · Pronto"
									aria-label={`Marcar como leída: ${a.titulo} (pronto)`}
									className="size-7 shrink-0 text-fg-tertiary"
								>
									<CheckCheck className="size-3.5" />
								</Button>
							</li>
						))}
					</ul>
					<div className="flex items-center gap-2 border-line-subtle border-t px-3 py-2">
						{pie ?? (
							// TODO(José) · tarea W5: alertas leídas del caso.
							<>
								<Button
									type="button"
									variant="text"
									size="sm"
									disabled
									className="h-auto px-0"
								>
									Ver alertas leídas
								</Button>
								<ChipPronto />
							</>
						)}
					</div>
				</div>
			) : null}
		</div>
	);
}

/** Dato de contacto de relleno: se muestra sin enlace, para no usarlo. */
function DatoNoValido({ texto }: { texto: string }) {
	return (
		<span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-fg-tertiary">
			<span className="break-all line-through decoration-fg-tertiary/60">
				{texto}
			</span>
			<span className="text-xs">Dato no válido</span>
		</span>
	);
}

function FilaContacto({
	icono,
	label,
	children,
}: {
	icono: React.ReactNode;
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex items-start gap-2.5">
			<span className="mt-0.5 flex shrink-0 text-fg-tertiary [&_svg]:size-3.5">
				{icono}
			</span>
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<dt className={crmText.label}>{label}</dt>
				<dd className="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 text-[13px] leading-[1.26]">
					{children}
				</dd>
			</div>
		</div>
	);
}

/* ── Historial ──────────────────────────────────────────────────────────────── */

function PestanaHistorial({
	historial,
	historico,
	inicial,
}: {
	historial: ContextoCasoVistaProps["historial"];
	historico: ContextoCasoVistaProps["historico"];
	inicial: "actual" | "historico";
}) {
	const [seg, setSeg] = React.useState(inicial);
	const [visibles, setVisibles] = React.useState(POR_PAGINA_HISTORIAL);
	return (
		<div className="flex flex-col gap-4">
			<SegmentedNav
				className="self-start"
				value={seg}
				onValueChange={(v) => setSeg(v as "actual" | "historico")}
				opciones={[
					{ value: "actual", label: "Historial actual" },
					{ value: "historico", label: "Histórico" },
				]}
			/>
			{seg === "actual" ? (
				<div className="flex flex-col gap-3">
					<RotuloSeccion>
						Historial del crédito · {historial.total}{" "}
						{historial.total === 1 ? "gestión" : "gestiones"}
					</RotuloSeccion>
					{historial.estado === "cargando" ? (
						<p className="text-fg-tertiary text-sm">Cargando…</p>
					) : historial.estado === "error" ? (
						<div className="flex flex-wrap items-center gap-3">
							<p className="text-fg-secondary text-sm">
								No se pudo cargar el historial.
							</p>
							{historial.onReintentar ? (
								<Button
									variant="outline"
									size="sm"
									onClick={historial.onReintentar}
								>
									Reintentar
								</Button>
							) : null}
						</div>
					) : historial.estado === "vacio" || historial.items.length === 0 ? (
						<p className="text-fg-tertiary text-sm">
							No hay gestiones registradas para este caso.
						</p>
					) : (
						<>
							<HistorialGestiones items={historial.items.slice(0, visibles)} />
							{historial.items.length > visibles ? (
								<Button
									variant="ghost"
									size="sm"
									className="self-center"
									onClick={() => setVisibles((v) => v + POR_PAGINA_HISTORIAL)}
								>
									Ver más ({historial.items.length - visibles})
								</Button>
							) : null}
						</>
					)}
				</div>
			) : (
				<div className="flex flex-col gap-3">
					<RotuloSeccion>Vida completa del crédito</RotuloSeccion>
					{historico ? (
						historico.length > 0 ? (
							<HistoricoCredito hitos={historico} />
						) : (
							<p className="text-fg-tertiary text-sm">Sin hitos registrados.</p>
						)
					) : (
						<PendienteBackend titulo="Pronto">
							Las entradas y salidas de bucket, reestructuras y convenios del
							crédito se mostrarán aquí. Pendiente de backend (tarea F4).
						</PendienteBackend>
					)}
				</div>
			)}
		</div>
	);
}

/* ── Estado de cuenta ───────────────────────────────────────────────────────── */

function PestanaEstadoCuenta({
	saldoTotal,
	filas,
	cuotas,
	estadoPlan,
	onEnviar,
	enviando,
}: ContextoCasoVistaProps["estadoCuenta"]) {
	const [visibles, setVisibles] = React.useState(POR_PAGINA_CUOTAS);
	return (
		<div className="flex flex-col gap-4">
			{onEnviar ? (
				<Button
					className="w-full"
					disabled={enviando}
					loading={enviando}
					onClick={onEnviar}
				>
					<MessageCircle aria-hidden />
					{enviando ? "Enviando estado de cuenta…" : "Enviar por WhatsApp"}
				</Button>
			) : null}
			<ResumenCuentaCard saldoTotal={saldoTotal} filas={filas} />
			<div className="flex flex-col">
				<RotuloSeccion>Plan de pagos</RotuloSeccion>
				{estadoPlan === "cargando" ? (
					<p className="py-4 text-fg-tertiary text-sm">Cargando…</p>
				) : estadoPlan === "error" ? (
					<p className="py-4 text-fg-secondary text-sm">
						No se pudo cargar el plan de pagos.
					</p>
				) : cuotas.length === 0 ? (
					<p className="py-4 text-fg-tertiary text-sm">
						No hay historial de cuotas disponible.
					</p>
				) : (
					<>
						{cuotas.slice(0, visibles).map((c) => (
							<CuotaPlanFila
								key={c.id}
								titulo={c.titulo}
								estado={c.estado}
								monto={c.monto}
								montoDetalle={c.montoDetalle}
								lineas={c.lineas}
								chips={
									c.chips?.length
										? c.chips.map((chip) => (
												<CrmPill
													key={chip}
													kind="chip"
													tone="warning"
													dot={false}
													className="px-2 py-0.5 text-[11px]"
												>
													{chip}
												</CrmPill>
											))
										: undefined
								}
							/>
						))}
						{cuotas.length > visibles ? (
							<Button
								variant="ghost"
								size="sm"
								className="mt-2 self-center"
								onClick={() => setVisibles((v) => v + POR_PAGINA_CUOTAS)}
							>
								Ver más cuotas ({cuotas.length - visibles})
							</Button>
						) : null}
					</>
				)}
			</div>
		</div>
	);
}

/* ── Referencias (solo lectura) ─────────────────────────────────────────────── */

function PestanaReferencias({
	estado,
	items,
}: ContextoCasoVistaProps["referencias"]) {
	return (
		<div className="flex flex-col gap-3">
			<RotuloSeccion>
				Referencias del crédito{items.length > 0 ? ` · ${items.length}` : ""}
			</RotuloSeccion>
			{estado === "cargando" ? (
				<p className="text-fg-tertiary text-sm">Cargando…</p>
			) : estado === "error" ? (
				<p className="text-fg-secondary text-sm">
					No se pudieron cargar las referencias.
				</p>
			) : items.length === 0 ? (
				<p className="text-fg-tertiary text-sm">
					Este crédito no tiene referencias registradas.
				</p>
			) : (
				<ul className="flex flex-col gap-2">
					{items.map((r) => (
						<li key={r.id}>
							<CrmCard
								superficie="outline"
								className="flex-row items-center gap-3 px-4 py-3"
							>
								<span
									aria-hidden
									className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-subtle font-semibold text-[13px] text-brand"
								>
									{inicialesDe(r.nombre)}
								</span>
								<div className="flex min-w-0 flex-1 flex-col gap-0.5">
									<span className="wrap-break-word font-semibold text-fg text-sm leading-[1.26]">
										{r.nombre}
									</span>
									<span className="wrap-break-word text-fg-secondary text-xs leading-[1.26]">
										{r.detalle}
									</span>
								</div>
								<CrmPill tone={r.estado.tone} kind="chip">
									{r.estado.etiqueta}
								</CrmPill>
							</CrmCard>
						</li>
					))}
				</ul>
			)}
			<p className="text-fg-tertiary text-xs">
				Para registrar una gestión a una referencia, use «Contactar referencias»
				en el panel de gestión o la Ficha 360.
			</p>
		</div>
	);
}

/* ── Ubicaciones (resumen de verificadas) ───────────────────────────────────── */

function PestanaUbicaciones({
	ubicaciones,
}: {
	ubicaciones: UbicacionContexto[];
}) {
	return (
		<div className="flex flex-col gap-3">
			<RotuloSeccion>Ubicaciones verificadas</RotuloSeccion>
			{ubicaciones.map((u) => (
				<CrmCard key={u.clave} superficie="outline" className="gap-2 p-4">
					<div className="flex flex-wrap items-center gap-2">
						{u.clave === "trabajo" ? (
							<Briefcase aria-hidden className="size-4 text-fg-tertiary" />
						) : (
							<Home aria-hidden className="size-4 text-fg-tertiary" />
						)}
						<h3 className={crmText.title}>{u.titulo}</h3>
						{u.verificacion ? (
							<CrmPill tone="success">Verificada</CrmPill>
						) : (
							<CrmPill tone="neutral">Sin verificar</CrmPill>
						)}
					</div>
					<p
						className={cn(
							"wrap-break-word text-sm",
							u.direccion ? "text-fg" : "text-fg-tertiary",
						)}
					>
						{u.direccion ?? "Sin dirección registrada."}
					</p>
					{u.verificacion ? (
						<div className="flex flex-col gap-1 rounded-lg bg-muted px-3 py-2 text-xs">
							<span className="flex items-center gap-1.5 font-medium text-fg">
								<MapPin aria-hidden className="size-3.5 shrink-0" />
								<span className="wrap-break-word min-w-0">
									Visitada el {u.verificacion.fecha}
									{u.verificacion.responsable
										? ` · ${u.verificacion.responsable}`
										: ""}
								</span>
							</span>
							{u.verificacion.direccionVisitada &&
							u.verificacion.direccionVisitada !== u.direccion ? (
								<span className="wrap-break-word text-fg-secondary">
									Dirección visitada: {u.verificacion.direccionVisitada}
								</span>
							) : null}
							{u.verificacion.resultado ? (
								<span className="text-fg-secondary">
									Resultado: {u.verificacion.resultado}
								</span>
							) : null}
							{u.verificacion.comentarios ? (
								<span className="wrap-break-word line-clamp-3 text-fg-secondary">
									{u.verificacion.comentarios}
								</span>
							) : null}
						</div>
					) : null}
				</CrmCard>
			))}
			<p className="text-fg-tertiary text-xs">
				El mapa, las fotos de la visita y la ubicación del vehículo (GPS) se
				consultan en la Ficha 360.
			</p>
		</div>
	);
}

/* ── Contenedor ─────────────────────────────────────────────────────────────── */

const horaGT = (d: Date | string) =>
	new Date(d).toLocaleTimeString("es-GT", {
		timeZone: "America/Guatemala",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});

/** Etiqueta y color de cada resultado de gestión (tokens del DS). */
const ESTADO_GESTION: Record<string, { label: string; tone: CrmTone }> = {
	contactado: { label: "Contactado", tone: "success" },
	promesa_pago: { label: "Promesa de pago", tone: "brand" },
	no_contesta: { label: "No contesta", tone: "warning" },
	mensaje_enviado: { label: "Mensaje enviado", tone: "info" },
	acuerdo_parcial: { label: "Acuerdo parcial", tone: "brand" },
	rechaza_pagar: { label: "Rechaza pagar", tone: "danger" },
	numero_equivocado: { label: "Número equivocado", tone: "neutral" },
	link_pago_generado: { label: "Link de pago generado", tone: "brand" },
	pago_registrado: { label: "Pago registrado", tone: "success" },
};

function iconoMetodo(metodo: string | null | undefined) {
	switch (metodo) {
		case "whatsapp":
			return <MessageCircle aria-hidden className="size-3.5" />;
		case "sms":
			return <MessageSquare aria-hidden className="size-3.5" />;
		case "email":
			return <Mail aria-hidden className="size-3.5" />;
		case "visita_domicilio":
			return <Home aria-hidden className="size-3.5" />;
		case "visita_trabajo":
			return <Briefcase aria-hidden className="size-3.5" />;
		case "carta_notarial":
			return <FileText aria-hidden className="size-3.5" />;
		default:
			return <Phone aria-hidden className="size-3.5" />;
	}
}

/** Una gestión del historial → fila de la línea de tiempo (mismo criterio que la ficha). */
function itemDeGestion(g: GestionCaso): ItemGestion {
	const estado = ESTADO_GESTION[g.estadoContacto ?? ""] ?? {
		label: g.estadoContacto ?? "—",
		tone: "neutral" as const,
	};
	const tono: TonoGestion = [
		"contactado",
		"acuerdo_parcial",
		"pago_registrado",
	].includes(g.estadoContacto ?? "")
		? "logrado"
		: ["no_contesta", "numero_equivocado", "mensaje_enviado"].includes(
					g.estadoContacto ?? "",
				)
			? "sin-contacto"
			: g.estadoContacto === "rechaza_pagar"
				? "fallido"
				: "neutro";
	const fechaGT = (v: string | Date) => fechaLargaGT(v);
	const detalles = [
		g.acuerdosAlcanzados && { label: "Acuerdos", valor: g.acuerdosAlcanzados },
		g.compromisosPago && { label: "Compromisos", valor: g.compromisosPago },
		g.fechaProximoContacto && {
			label:
				g.estadoContacto === "promesa_pago"
					? "Fecha prometida"
					: "Seguimiento programado",
			valor: fechaGT(g.fechaProximoContacto),
		},
		g.proximoPaso && { label: "Próximo paso", valor: g.proximoPaso },
		g.duracionLlamada && {
			label: "Duración",
			valor: `${Math.floor(g.duracionLlamada / 60)}:${(g.duracionLlamada % 60).toString().padStart(2, "0")} min`,
		},
	].filter(Boolean) as Array<{ label: string; valor: string }>;
	return {
		id: g.id,
		cuando: g.fechaContacto
			? `${fechaGT(g.fechaContacto)} · ${horaGT(g.fechaContacto)}`
			: "Sin fecha",
		titulo: (
			<span className="inline-flex items-center gap-1.5">
				{iconoMetodo(g.metodoContacto)}
				{etiquetaMetodoContacto(g.metodoContacto ?? "")}
			</span>
		),
		badge: (
			<CrmPill
				kind="chip"
				tone={estado.tone}
				className="px-2 py-0.5 text-[11px]"
			>
				{estado.label}
			</CrmPill>
		),
		derecha:
			g.estadoContacto === "promesa_pago" && g.montoComprometido != null
				? fmtQ(g.montoComprometido)
				: undefined,
		subtitulo: `Por: ${g.realizadoPor || "Sin asignar"}`,
		tono,
		nota: g.comentarios,
		detalles,
	};
}

/** Una cuota del plan → fila compacta (mismo criterio que la ficha, sin el desglose). */
function cuotaDelPlan(
	cuota: CuotaPlan,
	totalCuotas: number,
	hoyInicio: Date,
): CuotaContexto {
	const esPagada = cuota.estadoMora === "pagado";
	const enValidacion = cuota.estadoMora === "en_validacion";
	const vencida =
		!esPagada &&
		!enValidacion &&
		!!cuota.fechaVencimiento &&
		new Date(cuota.fechaVencimiento) < hoyInicio;
	const tieneMora = Number(cuota.montoMora) > 0;
	const abonado = esPagada
		? 0
		: (cuota.pagos ?? []).reduce(
				(suma, pago) => suma + Number(pago.montoAplicado ?? 0),
				0,
			);
	const saldoCuota = Math.max(Number(cuota.montoCuota) - abonado, 0);
	const estado: EstadoCuota = esPagada
		? "pagada"
		: enValidacion
			? "validacion"
			: vencida
				? "vencida"
				: "pendiente";
	const fecha = fechaLargaGT(cuota.fechaVencimiento) || "sin fecha";
	return {
		id: String(cuota.id ?? cuota.numeroCuota),
		titulo: `Cuota ${cuota.numeroCuota} de ${totalCuotas}`,
		estado,
		monto: fmtQ(cuota.montoCuota),
		montoDetalle: tieneMora ? `+${fmtQ(cuota.montoMora)} mora` : undefined,
		lineas: [
			`${vencida ? "Venció" : "Vence"} ${fecha}`,
			...(esPagada
				? [
						`Pagó ${fechaLargaGT(cuota.fechaPago) || "sin fecha"} · ${fmtQ(cuota.montoPagado || 0)}`,
					]
				: enValidacion
					? ["Pago recibido, en validación"]
					: []),
		],
		chips: [
			...(esPagada && tieneMora ? ["Pagado con mora"] : []),
			...(!esPagada && !enValidacion && abonado > 0
				? [`Abonado ${fmtQ(abonado)} · Falta ${fmtQ(saldoCuota)}`]
				: []),
		],
	};
}

/**
 * Plan de pagos del panel (sin la cuota 0), con lo relevante arriba porque
 * solo se ven 12 antes de «Ver más»:
 *  1. vencidas, en validación y la próxima, de la más vieja a la más nueva;
 *  2. pagadas, de la más reciente a la más vieja;
 *  3. futuras, en orden.
 * La Ficha 360 conserva su propio orden.
 */
function ordenarPlanPanel(
	plan: CuotaPlan[],
	totalCuotas: number,
	numeroProxima: number | null,
	hoyInicio: Date,
): CuotaContexto[] {
	const grupo = (c: CuotaPlan, estado: EstadoCuota) =>
		estado === "pagada"
			? 1
			: estado === "pendiente" && Number(c.numeroCuota) !== numeroProxima
				? 2
				: 0;
	return plan
		.map((c) => {
			const fila = cuotaDelPlan(c, totalCuotas, hoyInicio);
			return { n: Number(c.numeroCuota), g: grupo(c, fila.estado), fila };
		})
		.sort((a, b) => a.g - b.g || (a.g === 1 ? b.n - a.n : a.n - b.n))
		.map((x) => x.fila);
}

/** Arma las props de la vista a partir del caso (puro). */
export function propsContextoDeCaso(
	caso: CasoWorkspace,
	acciones: {
		onEnviarEstadoCuenta?: () => void;
		enviandoEstadoCuenta?: boolean;
		onCartaNotarial?: () => void;
		onAbrirFicha?: () => void;
	} = {},
): ContextoCasoVistaProps {
	const { identidad, bucket, mora, cuotas, cobroHoy, saldo } = caso;
	// Mismo corte que la ficha: una cuota vence al pasar la medianoche GT.
	const hoyInicio = inicioDelDiaGT();
	const mesDe = (fecha: string | null) => {
		const f = fechaLargaGT(fecha);
		return f ? f.replace(/^\d+\s/, "") : "—";
	};

	// ── Alertas importantes, compactas ──────────────────────────────────────
	const alertas: AlertaContexto[] = [];
	if (mora.recuperacionEnB5) {
		alertas.push({
			id: "recuperacion-b5",
			tono: "danger",
			titulo: `Crédito en recuperación que llegó a ${bucket.prefijo ?? "B5"}`,
			detalle:
				"Pasó a jurídico por acumular 5 cuotas atrasadas. Solo se levanta con el pago total de la deuda.",
		});
	}
	if (caso.convenio.incumplido && caso.convenio.alerta) {
		const a = caso.convenio.alerta;
		alertas.push({
			id: "convenio-incumplido",
			tono: "danger",
			titulo: "Convenio incumplido",
			detalle: `${a.cuotas_vencidas > 1 ? `${a.cuotas_vencidas} cuotas del convenio vencidas` : "Una cuota del convenio vencida"} · debe ${fmtQ(a.monto_vencido)}`,
		});
	}
	if (caso.recuperacion.solicitudPendiente) {
		alertas.push({
			id: "recuperacion-pendiente",
			tono: "warning",
			titulo: "Recuperación del vehículo por aprobar",
			detalle: "La solicitud espera la decisión de un supervisor.",
		});
	} else if (mora.enRecuperacion && !mora.recuperacionEnB5) {
		alertas.push({
			id: "en-recuperacion",
			tono: "warning",
			titulo: "Vehículo en recuperación",
			detalle: caso.recuperacion.porRecibir
				? "Falta confirmar la recepción de la unidad."
				: null,
		});
	}
	if (caso.apagado.pasoPendiente) {
		const p = caso.apagado.pasoPendiente;
		alertas.push({
			id: "inmovilizacion",
			tono: "info",
			titulo: `Unidad (${p.accion === "apagado" ? "apagado" : "reactivación"}): ${p.titulo}`,
			detalle: p.instruccion,
		});
	} else if (caso.apagado.estadoUnidad === "inmovilizada") {
		alertas.push({
			id: "unidad-apagada",
			tono: "info",
			titulo: "La unidad está apagada",
		});
	}
	// Alertas del caso: al desplegable (cerrado). Los "CRM-<uuid>" del texto
	// se acortan para que no rompan el renglón.
	const alertasCaso: AlertaContexto[] = caso.alertas.map((a) => ({
		id: `alerta-${a.id}`,
		tono: "warning",
		titulo: abreviarCreditosCrm(a.titulo),
		detalle: a.descripcion ? abreviarCreditosCrm(a.descripcion) : null,
	}));

	// ── Cobro de hoy ────────────────────────────────────────────────────────
	const cobro: ResumenContexto["cobroHoy"] =
		cuotas.cuotaConvenio != null
			? {
					subtitulo: "Cuota del convenio más la cuota del mes",
					conceptos: [
						{ label: "Cuota del convenio", monto: fmtQ(cuotas.cuotaConvenio) },
						{ label: "Cuota mensual", monto: fmtQ(cuotas.cuotaMensual) },
					],
					total: fmtQ(cuotas.cuotaConvenio + cuotas.cuotaMensual),
				}
			: cobroHoy.mora > 0 || cobroHoy.cuotasVencidas > 0
				? {
						conceptos: [
							{
								label: `${cobroHoy.cuotasVencidas} ${cobroHoy.cuotasVencidas === 1 ? "cuota vencida" : "cuotas vencidas"}`,
								detalle: `${fmtQ(cuotas.cuotaMensual)} c/u`,
								monto: fmtQ(cobroHoy.montoCuotas),
							},
							{
								label: "Mora acumulada",
								detalle: cobroHoy.avisoCrecimientoMora,
								monto: fmtQ(cobroHoy.mora),
							},
						],
						total: fmtQ(cobroHoy.totalMoraCuotas),
					}
				: null;

	// ── Vehículo a recuperar (B4 / en recuperación) ─────────────────────────
	const vehiculoRecuperar: ResumenContexto["vehiculoRecuperar"] =
		bucket.enB4 || mora.enRecuperacion
			? {
					vehiculo: identidad.vehiculo ?? "Vehículo sin datos",
					detalle:
						[
							identidad.placa ? `Placa ${identidad.placa}` : null,
							identidad.motor ? `Motor ${identidad.motor}` : null,
						]
							.filter(Boolean)
							.join(" · ") || "Sin placa registrada",
					gps:
						caso.apagado.tieneGps === null
							? { tone: "neutral", texto: "Consultando el GPS de la unidad…" }
							: caso.apagado.tieneGps
								? {
										tone:
											caso.apagado.estadoUnidad === "inmovilizada"
												? "warning"
												: "success",
										texto: `GPS vinculado · unidad ${caso.apagado.estadoUnidad === "inmovilizada" ? "apagada" : "activa"}`,
									}
								: { tone: "warning", texto: "Sin GPS vinculado" },
				}
			: null;

	const avisoContacto = [
		caso.contacto.telefonosNuevos.length > 0 &&
			`${caso.contacto.telefonosNuevos.length} ${caso.contacto.telefonosNuevos.length === 1 ? "número nuevo" : "números nuevos"} sin guardar`,
		caso.contacto.textoReferencias,
	]
		.filter(Boolean)
		.join(" · ");

	// ── Referencias ─────────────────────────────────────────────────────────
	const refs = caso.referencias?.referencias ?? [];

	// ── Ubicaciones: la última visita REALIZADA a cada dirección ────────────
	const verificacion = (tipo: "residencia" | "trabajo") => {
		const v = caso.visita.lista.find(
			(x) => x.tipo === tipo && x.estado === "realizada",
		);
		if (!v) return null;
		return {
			fecha: v.fechaVisita ? fechaLargaGT(v.fechaVisita) : "—",
			direccionVisitada: v.direccion,
			resultado: v.resultado
				? (RESULTADO_VISITA_LABEL[v.resultado as ResultadoVisita] ??
					v.resultado)
				: null,
			responsable: v.responsable,
			comentarios: v.comentarios,
		};
	};
	const trabajo = caso.contacto.trabajo;

	const comp = caso.complementos;

	return {
		nombre: identidad.nombre,
		iniciales: identidad.iniciales,
		credito: identidad.numeroSifco ?? "—",
		vehiculo: identidad.vehiculo,
		placa: identidad.placa,
		intentosSinContacto: caso.seguimiento.intentosSinContacto,
		ultimoIntento: caso.seguimiento.ultimoIntentoEn
			? fechaLargaGT(caso.seguimiento.ultimoIntentoEn)
			: null,
		bucket: bucket.badge,
		bucketTitulo:
			bucket.prefijo && bucket.etiqueta
				? `${bucket.prefijo} · ${bucket.etiqueta}`
				: undefined,
		mora:
			mora.nivel && (mora.dias > 0 || mora.monto > 0)
				? {
						nivel: mora.nivel,
						texto: mora.monto > 0 ? `Mora ${fmtQ(mora.monto)}` : "Al día",
					}
				: null,
		resumen: {
			estadoCobro: {
				estado: mora.estadoCobro,
				diasMora: mora.dias,
				bucket: bucket.prefijo ? `bucket ${bucket.prefijo}` : undefined,
				filas: [
					{
						label: "Cuotas pagadas",
						valor: `${cuotas.pagadas} / ${cuotas.total}`,
					},
					{
						label: "Último mes pagado",
						valor: mesDe(cuotas.ultimaPagadaVence),
					},
					{ label: "Fecha de pago", valor: `${cuotas.diaPago} de cada mes` },
					{ label: "Cuota mensual", valor: fmtQ(cuotas.cuotaMensual) },
				],
			},
			promesa: caso.promesaVigente
				? {
						monto:
							caso.promesaVigente.montoComprometido != null
								? fmtQ(caso.promesaVigente.montoComprometido)
								: "—",
						fecha: caso.promesaVigente.fechaProximoContacto
							? fechaLargaGT(caso.promesaVigente.fechaProximoContacto)
							: "—",
						responsable: caso.promesaVigente.realizadoPor,
					}
				: null,
			cobroHoy: cobro,
			alertas,
			alertasCaso,
			contacto: {
				telefonos: caso.contacto.telefonos.map((t) => ({
					texto: t,
					href: telefonoDeRelleno(t) ? null : hrefTelefono(t),
				})),
				correo: caso.contacto.email,
				correoNoValido:
					!!caso.contacto.email && correoDeRelleno(caso.contacto.email),
				direccion: caso.contacto.direccion,
				aviso: avisoContacto || null,
			},
			vehiculoRecuperar,
		},
		historial: {
			estado: caso.cargandoHistorial
				? "cargando"
				: caso.gestiones.length === 0
					? "vacio"
					: "ok",
			total: caso.gestiones.length,
			items: caso.gestiones.map(itemDeGestion),
		},
		historico: comp?.historico
			? comp.historico.map((h) => ({
					id: h.id,
					descripcion: h.descripcion,
					fecha: fechaLargaGT(h.fecha),
				}))
			: null,
		estadoCuenta: {
			saldoTotal:
				saldo.deudaTotal != null
					? fmtQ(saldo.deudaTotal)
					: saldo.montoFinanciado != null
						? fmtQ(saldo.montoFinanciado)
						: "—",
			filas: [
				{
					label: "Saldo vencido",
					valor: fmtQ(saldo.deudaVencida),
					tono: saldo.deudaVencida > 0 ? "danger" : undefined,
				},
				{
					label: "Cuotas restantes",
					valor:
						cuotas.restantes != null
							? `${cuotas.restantes} de ${caso.detalle?.numeroCuotas ?? cuotas.total}`
							: "—",
				},
				{
					label: "Próximo pago",
					valor: fechaLargaGT(cuotas.proxima?.fechaVencimiento) || "—",
				},
			],
			cuotas: ordenarPlanPanel(
				cuotas.plan.filter(esCuotaDelPlan),
				cuotas.total,
				cuotas.proxima?.numeroCuota ?? null,
				hoyInicio,
			),
			estadoPlan: cuotas.cargandoPlan ? "cargando" : "ok",
			onEnviar: identidad.casoCobroId
				? acciones.onEnviarEstadoCuenta
				: undefined,
			enviando: acciones.enviandoEstadoCuenta,
		},
		documentos: {
			enviar: [
				{
					clave: "tarjeta-circulacion",
					nombre: "Tarjeta de circulación",
					descripcion: "Documento vehicular",
					motivoDeshabilitado: "Pendiente de backend (tarea F6).",
				},
				{
					clave: "seguro",
					nombre: "Información de seguro",
					descripcion: "Póliza vigente",
					motivoDeshabilitado: "Pendiente de backend (tarea F6).",
				},
				{
					clave: "estado-cuenta",
					nombre: "Estado de cuenta",
					descripcion: "Resumen del crédito, por WhatsApp",
					onClick: identidad.casoCobroId
						? acciones.onEnviarEstadoCuenta
						: undefined,
					cargando: acciones.enviandoEstadoCuenta,
				},
				{
					clave: "carta-notarial",
					nombre: "Carta notarial",
					descripcion: "Registrar el envío de la carta",
					onClick: identidad.casoCobroId ? acciones.onCartaNotarial : undefined,
					motivoDeshabilitado: acciones.onCartaNotarial
						? undefined
						: "Regístrela desde la Ficha 360.",
				},
			],
			solicitar: [
				["contrato", "Contrato de crédito", "PDF · Documento legal"],
				["carta-poder", "Carta poder", "Requiere firma del titular"],
				["cambio-placas", "Cambio de placas", "Trámite vehicular"],
				["expertaje", "Expertaje", "Avalúo del vehículo"],
			].map(([clave, nombre, descripcion]) => ({
				clave,
				nombre,
				descripcion,
				motivoDeshabilitado: "Pendiente de backend (tarea F6).",
			})),
		},
		referencias: {
			estado:
				caso.referencias === null && identidad.casoCobroId ? "cargando" : "ok",
			items: refs.map((r) => {
				const e = estadoReferencia(r.ultimoContacto?.resultado);
				return {
					id: r.key,
					nombre: r.nombre,
					detalle: [
						etiquetaOrigen(r, r.origen),
						r.telefonos.map((t) => t.telefono).join(", ") || "Sin teléfono",
					]
						.filter(Boolean)
						.join(" · "),
					estado: { etiqueta: e.etiqueta, tone: e.tone },
				};
			}),
		},
		ubicaciones: [
			{
				clave: "residencia",
				titulo: "Residencia",
				direccion: caso.contacto.direccion,
				verificacion: verificacion("residencia"),
			},
			{
				clave: "trabajo",
				titulo: trabajo?.empresa ? `Trabajo · ${trabajo.empresa}` : "Trabajo",
				direccion: trabajo?.direccion ?? null,
				verificacion: verificacion("trabajo"),
			},
		],
		resumenIA: comp?.resumenIA ?? null,
		onAbrirFicha: acciones.onAbrirFicha,
	};
}

/**
 * El panel izquierdo conectado: arma la vista desde el caso y envía el estado
 * de cuenta (mismo procedimiento y confirmación que la ficha).
 */
export function ContextoCaso({
	caso,
	onAbrirFicha,
	onCartaNotarial,
	tabInicial,
	className,
}: {
	caso: CasoWorkspace;
	onAbrirFicha: () => void;
	/** Abre el registro de la carta notarial (lo maneja el Workspace). */
	onCartaNotarial?: () => void;
	tabInicial?: TabContexto;
	className?: string;
}) {
	const [confirmarEstadoCuenta, setConfirmarEstadoCuenta] =
		React.useState(false);
	const enviarEstadoCuenta = useMutation({
		mutationFn: () =>
			client.enviarEstadoCuentaWhatsapp({
				casoCobroId: caso.identidad.casoCobroId ?? "",
			}),
		onSuccess: (r) => {
			toast.success(`Estado de cuenta enviado a ${r.telefono}`);
		},
		onError: (error: Error) => {
			toast.error(error.message || "No se pudo enviar el estado de cuenta");
		},
	});

	// Un refetch fallido con datos previos NO desmonta la vista: el error solo
	// cuenta si no hay detalle (`caso.error && !caso.detalle`).
	if (caso.cargando || !caso.detalle) {
		return (
			<section
				aria-label="Contexto del caso"
				className={cn("flex h-full min-h-0 flex-col bg-surface", className)}
			>
				<div className="flex flex-1 flex-col gap-3 px-5 pt-4">
					<span className="text-[13px] text-fg-tertiary">
						Contexto del caso
					</span>
					{caso.cargando ? (
						<div className="flex animate-pulse flex-col gap-3">
							<div className="h-11 w-2/3 rounded-lg bg-muted" />
							<div className="h-4 w-1/2 rounded bg-muted" />
							<div className="h-40 rounded-xl bg-muted" />
							<div className="h-24 rounded-xl bg-muted" />
						</div>
					) : (
						<div className="flex items-start gap-2 rounded-lg bg-danger-subtle px-3 py-2 text-danger-text text-sm">
							<Clock aria-hidden className="mt-0.5 size-4 shrink-0" />
							<span className="wrap-break-word min-w-0">
								{caso.error
									? caso.error.message || "No se pudo cargar el caso."
									: "No se encontró el caso de cobranza."}
							</span>
						</div>
					)}
				</div>
				<footer className="border-line-subtle border-t px-5 py-3">
					<Button variant="secondary" className="w-full" onClick={onAbrirFicha}>
						Abrir Ficha 360
					</Button>
				</footer>
			</section>
		);
	}

	const props = propsContextoDeCaso(caso, {
		onEnviarEstadoCuenta: () => setConfirmarEstadoCuenta(true),
		enviandoEstadoCuenta: enviarEstadoCuenta.isPending,
		onCartaNotarial,
		onAbrirFicha,
	});

	return (
		<>
			<ContextoCasoVista
				// Otro caso = pestañas y «Ver más» desde cero.
				key={caso.id}
				{...props}
				tabInicial={tabInicial}
				className={className}
			/>
			<AlertDialog
				open={confirmarEstadoCuenta}
				onOpenChange={setConfirmarEstadoCuenta}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>¿Enviar estado de cuenta?</AlertDialogTitle>
						<AlertDialogDescription>
							Se generará el estado de cuenta actualizado del crédito y se
							enviará por WhatsApp al teléfono registrado del cliente.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancelar</AlertDialogCancel>
						<AlertDialogAction onClick={() => enviarEstadoCuenta.mutate()}>
							Enviar
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
