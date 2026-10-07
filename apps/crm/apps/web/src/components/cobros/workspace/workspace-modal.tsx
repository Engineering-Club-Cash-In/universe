/**
 * Workspace de cobros · el modal «Espacio de trabajo».
 *
 * Caja de dos paneles que se abre al hacer clic en un caso del Dashboard del
 * asesor o de Mi Cartera, para gestionar los casos uno tras otro sin salir de
 * la tabla:
 * - Izquierda, «Contexto del caso» (`ContextoCaso`): la Ficha 360 reducida.
 * - Derecha, «Gestión» (`GestionPanel`): el flujo de la gestión.
 *
 * Navega sobre una lista fija de casos (`casos`, en el orden de la tabla) con
 * «‹ Caso 3 de 20 ›» y Alt+← / Alt+→. El guardián pide confirmación antes de
 * cerrar o cambiar de caso si hay una gestión a medias (`onEnCursoChange` del
 * panel de gestión).
 *
 * En pantallas angostas (<lg) los paneles no caben lado a lado: un segmentado
 * «Contexto | Gestión» los alterna (por defecto, Gestión).
 */
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, TriangleAlert, XIcon } from "lucide-react";
import * as React from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogIcon,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
	overlayCloseButtonClassName,
} from "@/components/ui/dialog";
import { PeriodSelector } from "@/components/ui/period-selector";
import { PopoverPortalContext } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { orpc } from "@/utils/orpc";
import { ContextoCaso } from "./contexto-caso";
import { GestionPanel } from "./gestion-panel";
import { useCasoWorkspace } from "./use-caso-workspace";

/** Un caso de la lista navegable (mismo id y tipo que `destinoFicha`). */
export type CasoNavegable = {
	/** SIFCO o contrato, como en /cobros/$id. */
	id: string;
	tipo: "caso" | "contrato";
	/** Nombre del cliente (lectores de pantalla mientras carga el caso). */
	nombre?: string;
};

export type WorkspaceModalProps = {
	casos: CasoNavegable[];
	/** Posición del caso abierto en `casos`; null = cerrado. */
	indice: number | null;
	onIndiceChange: (indice: number | null) => void;
};

type PanelMovil = "contexto" | "gestion";

/** Rótulo del panel: misma clase que «Contexto del caso» (`contexto-caso.tsx`). */
const ROTULO_PANEL = "text-[13px] text-fg-tertiary leading-[1.26]";

const OPCIONES_PANEL = [
	{ value: "contexto", label: "Contexto" },
	{ value: "gestion", label: "Gestión" },
] as const;

/** Alt+flecha no se intercepta mientras se escribe (en macOS mueve por palabra). */
function esCampoDeTexto(el: EventTarget | null) {
	if (!(el instanceof HTMLElement)) return false;
	return (
		el.isContentEditable ||
		el.tagName === "INPUT" ||
		el.tagName === "TEXTAREA" ||
		el.tagName === "SELECT"
	);
}

/** Un clic en un toast (sonner) no cuenta como «clic fuera» del modal. */
function esToast(el: EventTarget | null) {
	return el instanceof Element && !!el.closest("[data-sonner-toaster]");
}

export function WorkspaceModal({
	casos,
	indice,
	onIndiceChange,
}: WorkspaceModalProps) {
	const abierto = indice !== null && casos.length > 0;
	// Durante la animación de cierre se sigue pintando el último caso.
	const ultimoIndice = React.useRef(0);
	if (indice !== null) ultimoIndice.current = indice;
	const posicion = Math.min(
		Math.max(indice ?? ultimoIndice.current, 0),
		Math.max(casos.length - 1, 0),
	);

	// Hay una gestión a medias en el panel derecho (lo avisa GestionPanel).
	const [enCurso, setEnCurso] = React.useState(false);
	// Acción que espera la confirmación del guardián.
	const [pendiente, setPendiente] = React.useState<(() => void) | null>(null);
	// Los popovers (combobox, calendarios) se montan en la caja del modal y no
	// dentro de los formularios embebidos (ver PopoverPortalContext).
	const [cajaModal, setCajaModal] = React.useState<HTMLDivElement | null>(null);

	/** Ejecuta `accion`, o primero pregunta si hay una gestión a medias. */
	const conGuardian = (accion: () => void) => {
		if (enCurso) setPendiente(() => accion);
		else accion();
	};

	const cerrar = () => {
		setEnCurso(false);
		onIndiceChange(null);
	};
	const irA = (i: number) => {
		if (i < 0 || i >= casos.length || i === posicion) return;
		setEnCurso(false);
		onIndiceChange(i);
	};

	const navigate = useNavigate();
	// La Ficha 360 también saca del Workspace: pasa por el guardián.
	const abrirFicha = () =>
		conGuardian(() => {
			const caso = casos[posicion];
			cerrar();
			if (!caso) return;
			navigate({
				to: "/cobros/$id",
				params: { id: caso.id },
				search: { tipo: caso.tipo },
			});
		});

	const descartarYContinuar = () => {
		const accion = pendiente;
		setPendiente(null);
		accion?.();
	};

	return (
		<>
			<Dialog
				open={abierto}
				onOpenChange={(open) => {
					if (!open) conGuardian(cerrar);
				}}
			>
				<DialogContent
					ref={setCajaModal}
					showCloseButton={false}
					className="flex h-[min(840px,calc(100dvh-2rem))] w-[min(1200px,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
					// Con una gestión a medias, Esc y el clic fuera pasan por el guardián
					// (onOpenChange no se llama si se previene el evento).
					onEscapeKeyDown={(e) => {
						if (enCurso) {
							e.preventDefault();
							setPendiente(() => cerrar);
						}
					}}
					onPointerDownOutside={(e) => {
						if (esToast(e.target)) {
							e.preventDefault();
							return;
						}
						if (enCurso) {
							e.preventDefault();
							setPendiente(() => cerrar);
						}
					}}
					onInteractOutside={(e) => {
						if (esToast(e.target) || enCurso) e.preventDefault();
					}}
				>
					<PopoverPortalContext.Provider value={cajaModal}>
						{casos.length > 0 ? (
							<ContenidoWorkspace
								casos={casos}
								posicion={posicion}
								onAnterior={() => conGuardian(() => irA(posicion - 1))}
								onSiguiente={() => conGuardian(() => irA(posicion + 1))}
								onCerrar={() => conGuardian(cerrar)}
								onAbrirFicha={abrirFicha}
								onEnCursoChange={setEnCurso}
							/>
						) : null}
					</PopoverPortalContext.Provider>
				</DialogContent>
			</Dialog>

			<AlertDialog
				open={pendiente !== null}
				onOpenChange={(open) => {
					if (!open) setPendiente(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogIcon variant="warning" />
						<AlertDialogTitle>¿Descartar la gestión en curso?</AlertDialogTitle>
						<AlertDialogDescription>
							La gestión que está registrando no se ha guardado. Si continúa, se
							perderán los datos ingresados.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Seguir registrando</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={descartarYContinuar}
						>
							Descartar y continuar
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

/**
 * Lo de adentro del modal. Solo se monta con el modal abierto: así las
 * consultas del caso no corren mientras el asesor está en la tabla.
 */
function ContenidoWorkspace({
	casos,
	posicion,
	onAnterior,
	onSiguiente,
	onCerrar,
	onAbrirFicha,
	onEnCursoChange,
}: {
	casos: CasoNavegable[];
	posicion: number;
	onAnterior: () => void;
	onSiguiente: () => void;
	onCerrar: () => void;
	onAbrirFicha: () => void;
	onEnCursoChange: (enCurso: boolean) => void;
}) {
	const queryClient = useQueryClient();
	const actual = casos[posicion] as CasoNavegable;
	const caso = useCasoWorkspace(actual.id);

	const hayAnterior = posicion > 0;
	const hayMas = posicion < casos.length - 1;
	const siguiente = casos[posicion + 1];

	const [panelMovil, setPanelMovil] = React.useState<PanelMovil>("gestion");
	const contextoRef = React.useRef<HTMLDivElement>(null);
	const gestionRef = React.useRef<HTMLDivElement>(null);

	// Otro caso: de vuelta a «Gestión» en móvil y los paneles arriba.
	// biome-ignore lint/correctness/useExhaustiveDependencies: se dispara al cambiar de caso
	React.useEffect(() => {
		setPanelMovil("gestion");
		contextoRef.current?.scrollTo({ top: 0 });
		gestionRef.current?.scrollTo({ top: 0 });
	}, [actual.id]);

	// Deja listo el detalle del siguiente caso (misma llave que el hook).
	React.useEffect(() => {
		if (!siguiente) return;
		void queryClient.prefetchQuery(
			orpc.getDetallesCreditoCarteraBack.queryOptions({
				input: { creditoId: siguiente.id },
			}),
		);
	}, [siguiente, queryClient]);

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
		if (esCampoDeTexto(e.target)) return;
		if (e.key === "ArrowLeft" && hayAnterior) {
			e.preventDefault();
			onAnterior();
		} else if (e.key === "ArrowRight" && hayMas) {
			e.preventDefault();
			onSiguiente();
		}
	};

	const nombre =
		caso.detalle && !caso.cargando
			? caso.identidad.nombre
			: (actual.nombre ?? "Cargando caso…");
	// Sin caso = terminó de cargar y no hay detalle (error o no existe). Un
	// refetch fallido con datos previos NO cuenta: desmontaría el panel de
	// gestión con un formulario a medias (`caso.error && !caso.detalle`).
	const sinCaso = !caso.cargando && !caso.detalle;

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: atajos de teclado del modal (Alt+← / Alt+→)
		<div className="flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown}>
			{/* Cabecera: título, navegación entre casos y cerrar */}
			<header className="flex shrink-0 items-center justify-between gap-3 border-line-subtle border-b px-5 py-3.5 sm:px-6">
				<div className="flex min-w-0 flex-col">
					{/* En móvil envuelve en vez de truncarse a «Esp…». */}
					<DialogTitle className="wrap-break-word font-semibold leading-tight">
						Espacio de trabajo
					</DialogTitle>
					<DialogDescription className="sr-only">
						Gestión del caso de {nombre}
					</DialogDescription>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					{casos.length > 1 ? (
						<nav
							aria-label="Navegación entre casos"
							className="flex items-center gap-0.5 sm:gap-1"
						>
							<Button
								variant="ghost"
								size="icon-sm"
								onClick={onAnterior}
								disabled={!hayAnterior}
								aria-label="Caso anterior"
								title="Caso anterior (Alt+←)"
							>
								<ChevronLeft />
							</Button>
							<span
								className="min-w-[2.75rem] text-center font-medium text-[13px] text-fg-secondary tabular-nums sm:min-w-[6.5rem]"
								aria-live="polite"
							>
								{/* Compacto en móvil: «3/20». */}
								<span className="sm:hidden" aria-hidden>
									{posicion + 1}/{casos.length}
								</span>
								<span className="sr-only sm:not-sr-only">
									Caso {posicion + 1} de {casos.length}
								</span>
							</span>
							<Button
								variant="ghost"
								size="icon-sm"
								onClick={onSiguiente}
								disabled={!hayMas}
								aria-label="Caso siguiente"
								title="Caso siguiente (Alt+→)"
							>
								<ChevronRight />
							</Button>
						</nav>
					) : null}
					<button
						type="button"
						onClick={onCerrar}
						className={cn(overlayCloseButtonClassName, "h-8")}
					>
						<XIcon />
						<span className="sr-only">Cerrar</span>
					</button>
				</div>
			</header>

			{/* Móvil: un panel a la vez */}
			<div className="flex shrink-0 justify-center border-line-subtle border-b px-4 py-2 lg:hidden">
				<PeriodSelector
					aria-label="Panel del espacio de trabajo"
					value={panelMovil}
					onChange={setPanelMovil}
					options={OPCIONES_PANEL}
				/>
			</div>

			{/* Cuerpo: dos paneles con scroll propio */}
			<div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.12fr)]">
				<div
					ref={contextoRef}
					className={cn(
						"min-h-0 min-w-0 overflow-y-auto overflow-x-hidden border-line-subtle bg-canvas lg:block lg:border-r",
						panelMovil === "contexto" ? "block" : "hidden",
					)}
				>
					<ContextoCaso
						caso={caso}
						onAbrirFicha={onAbrirFicha}
						className="h-full bg-canvas"
					/>
				</div>
				<div
					ref={gestionRef}
					className={cn(
						"min-h-0 min-w-0 overflow-y-auto overflow-x-hidden bg-surface lg:block",
						panelMovil === "gestion" ? "block" : "hidden",
					)}
				>
					{caso.cargando ? (
						<GestionCargando />
					) : sinCaso ? (
						<GestionSinCaso
							mensaje={
								caso.error
									? caso.error.message || "No se pudo cargar el caso."
									: "No se encontró el caso de cobranza."
							}
							onAbrirFicha={onAbrirFicha}
							onSiguienteCaso={hayMas ? onSiguiente : undefined}
						/>
					) : (
						<GestionPanel
							key={caso.id}
							caso={caso}
							onSiguienteCaso={hayMas ? onSiguiente : undefined}
							onEnCursoChange={onEnCursoChange}
							onAbrirFicha={onAbrirFicha}
							className="h-full"
						/>
					)}
				</div>
			</div>
		</div>
	);
}

/** Esqueleto del panel de gestión mientras llega el caso. */
function GestionCargando() {
	return (
		<section
			aria-label="Gestión"
			aria-busy
			className="flex h-full min-h-0 flex-col gap-3 px-5 pt-4 pb-5"
		>
			<span className={ROTULO_PANEL}>Gestión</span>
			<Skeleton className="h-36 w-full rounded-2xl" />
			<Skeleton className="h-3 w-32 rounded" />
			<Skeleton className="h-16 w-full rounded-xl" />
			<Skeleton className="h-16 w-full rounded-xl" />
			<Skeleton className="h-16 w-full rounded-xl" />
		</section>
	);
}

/**
 * El caso no cargó (error o no existe). Mismo estado vacío que el panel de
 * gestión (caja punteada, ícono en círculo, texto centrado y botones en el
 * pie), replicado con tokens para no depender de `gestion/*`.
 *
 * «Abrir Ficha 360» ya está en el pie del panel izquierdo: aquí solo se
 * muestra en pantallas angostas, donde se ve un panel a la vez.
 */
function GestionSinCaso({
	mensaje,
	onAbrirFicha,
	onSiguienteCaso,
}: {
	mensaje: string;
	onAbrirFicha: () => void;
	onSiguienteCaso?: () => void;
}) {
	return (
		<section aria-label="Gestión" className="flex h-full min-h-0 flex-col">
			<div className="shrink-0 px-5 pt-4 pb-3">
				<span className={ROTULO_PANEL}>Gestión</span>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
				<div className="flex flex-col items-center gap-2 rounded-xl border border-line border-dashed bg-muted/40 px-6 py-7 text-center">
					<span
						aria-hidden
						className="mb-1 flex size-11 items-center justify-center rounded-full bg-warning-subtle text-warning-solid"
					>
						<TriangleAlert className="size-5" />
					</span>
					<span className="font-semibold text-base text-fg leading-[1.26]">
						No se puede gestionar este caso aquí
					</span>
					<span className="wrap-break-word max-w-[42ch] text-fg-secondary text-sm leading-snug">
						{mensaje}{" "}
						{onSiguienteCaso
							? "Abra la Ficha 360 para revisarlo o continúe con el siguiente caso."
							: "Abra la Ficha 360 para revisarlo."}
					</span>
				</div>
			</div>
			<footer
				className={cn(
					"flex shrink-0 flex-col gap-2 border-line-subtle border-t px-5 py-3",
					!onSiguienteCaso && "lg:hidden",
				)}
			>
				{onSiguienteCaso ? (
					<Button type="button" className="w-full" onClick={onSiguienteCaso}>
						Siguiente caso
						<ChevronRight aria-hidden />
					</Button>
				) : null}
				<Button
					type="button"
					variant="secondary"
					className="w-full lg:hidden"
					onClick={onAbrirFicha}
				>
					Abrir Ficha 360
				</Button>
			</footer>
		</section>
	);
}

/**
 * Estado del Workspace para una pantalla con tabla: guarda una COPIA de la
 * lista al abrir (los refetch de la tabla no mueven el caso abierto) y avisa
 * al cerrar para refrescar la tabla.
 */
export function useWorkspaceCasos(opciones?: { alCerrar?: () => void }) {
	const [estado, setEstado] = React.useState<{
		casos: CasoNavegable[];
		indice: number | null;
	}>({ casos: [], indice: null });
	const alCerrar = opciones?.alCerrar;

	const abrir = React.useCallback((casos: CasoNavegable[], indice: number) => {
		if (indice < 0 || indice >= casos.length) return;
		setEstado({ casos, indice });
	}, []);

	const onIndiceChange = React.useCallback(
		(indice: number | null) => {
			setEstado((e) => ({ ...e, indice }));
			if (indice === null) alCerrar?.();
		},
		[alCerrar],
	);

	return {
		abrir,
		/** Id del caso abierto (para resaltar su fila), o null. */
		idAbierto:
			estado.indice !== null ? (estado.casos[estado.indice]?.id ?? null) : null,
		modal: {
			casos: estado.casos,
			indice: estado.indice,
			onIndiceChange,
		} satisfies WorkspaceModalProps,
	};
}
