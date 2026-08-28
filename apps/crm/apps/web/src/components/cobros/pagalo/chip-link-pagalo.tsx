/**
 * CB-127 · Chip compacto por link en la columna "Links" de la bandeja de
 * supervisión, con menú contextual para acciones sobre ESE link individual.
 *
 * "Invalidar link" queda deshabilitado a propósito (visible, sin poder
 * presionarlo): la acción solo marca REPLACED en nuestra DB — Págalo no
 * tiene API para cancelar el link real, así que quedaría "invalidado" acá
 * pero vivo y cobrable allá, una desincronización que el equipo decidió no
 * exponer como acción disponible hasta que exista esa API (mismo criterio
 * que ya se aplicó al viejo botón "Cancelar en Págalo" del grupo — D-21,
 * docs/features/pagalo/DECISIONES.md). El backend (invalidarLinkEnTx,
 * pagalo-group-lifecycle.ts) queda listo para cuando se reactive.
 *
 * Regenerar un link: crea un link nuevo del mismo tipo DENTRO del mismo
 * grupo, con el mismo monto congelado — solo disponible cuando el link
 * viejo ya quedó cerrado sin pago (REPLACED/EXPIRED/CANCELLED/ERROR). Esta
 * sí solo actúa sobre datos locales sin fingir sincronía con Págalo.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Textarea } from "@/components/ui/textarea";
import { copyPagaloLink } from "@/lib/cobros/pagalo-link-display";
import {
	colorPuntoLink,
	etiquetaLinkCompacta,
	tituloLink,
} from "@/routes/cobros/-pagalo-columnas";
import { client, orpc } from "@/utils/orpc";

const MOTIVO_MIN = 10;
const ESTADOS_VIVOS = new Set(["CREATING", "ACTIVE"]);
const ESTADOS_REGENERABLES = new Set([
	"REPLACED",
	"EXPIRED",
	"CANCELLED",
	"ERROR",
]);

type AccionLink = "invalidar" | "regenerar";

function DialogoAccionLink({
	accion,
	linkId,
	casoCobroId,
	abierto,
	onCerrar,
}: {
	accion: AccionLink;
	linkId: string;
	casoCobroId: string | null;
	abierto: boolean;
	onCerrar: () => void;
}) {
	const [motivo, setMotivo] = useState("");
	const queryClient = useQueryClient();
	const label = accion === "invalidar" ? "Invalidar link" : "Regenerar link";

	const mutation = useMutation({
		mutationFn: async () => {
			if (accion === "invalidar")
				// biome-ignore lint/suspicious/noExplicitAny: TS7056
				return (client as any).invalidarLinkPagalo({ linkId, motivo });
			// biome-ignore lint/suspicious/noExplicitAny: TS7056
			return (client as any).regenerarLinkPagalo({ linkId, motivo });
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: orpc.getPagaloSupervision.key(),
			});
			if (casoCobroId) {
				queryClient.invalidateQueries(
					orpc.getPagaloHistorial.queryOptions({ input: { casoCobroId } }),
				);
			}
			onCerrar();
			setMotivo("");
			toast.success(
				accion === "invalidar"
					? "Link invalidado. El grupo queda en revisión."
					: "Link regenerado. Se emitió uno nuevo dentro del mismo grupo.",
			);
		},
		onError: (error: Error) =>
			toast.error(error.message || "No se pudo completar la acción."),
	});

	const motivoValido = motivo.trim().length >= MOTIVO_MIN;

	return (
		<AlertDialog
			open={abierto}
			onOpenChange={(next) => {
				if (!next) onCerrar();
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{label}</AlertDialogTitle>
					<AlertDialogDescription asChild>
						<div className="space-y-3 text-left">
							{accion === "invalidar" && (
								<Alert variant="destructive">
									<AlertDescription>
										El grupo queda en revisión (no se cancela) porque ya no hay
										certeza de que pueda completarse tal como está. El link real
										en Págalo sigue cobrable hasta cancelarlo a mano en su
										panel.
									</AlertDescription>
								</Alert>
							)}
							{accion === "regenerar" && (
								<>
									<p>
										Se creará un link nuevo del mismo tipo, dentro de este mismo
										grupo, con el mismo monto.
									</p>
									<Alert variant="destructive">
										<AlertDescription>
											El link anterior sigue existiendo en Págalo y puede seguir
											siendo cobrable — especialmente si quedó en ERROR, donde
											Págalo pudo haber procesado el pedido aunque la respuesta
											fallara. Cancelalo a mano en su panel si no querés que el
											cliente lo use.
										</AlertDescription>
									</Alert>
								</>
							)}
							<Textarea
								placeholder="Motivo (mínimo 10 caracteres)"
								value={motivo}
								onChange={(e) => setMotivo(e.target.value)}
							/>
						</div>
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={mutation.isPending}>
						Cancelar
					</AlertDialogCancel>
					<AlertDialogAction
						disabled={!motivoValido || mutation.isPending}
						onClick={(e) => {
							e.preventDefault();
							mutation.mutate();
						}}
					>
						{mutation.isPending && (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						)}
						Confirmar
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

// TODO(pagalo-cancel-api): reactivar cuando Págalo publique un endpoint para
// cancelar el link real. Hasta entonces, "Invalidar link" queda visible pero
// deshabilitado — la lógica (invalidarLinkEnTx, el diálogo, la mutación) ya
// existe y sigue intacta abajo, solo el trigger queda bloqueado para no
// dejar el link "invalidado" en nuestra DB mientras sigue vivo y cobrable en
// Págalo (misma razón que D-21 aplicó al botón de grupo).
const INVALIDAR_HABILITADO = false;

export function ChipLinkPagalo({
	link,
	estadoLabel,
	monto,
	motivoCierre,
	paymentUrl,
	casoCobroId,
	esSupervisor,
}: {
	link: {
		id: string;
		linkType: "CAPITAL" | "MORA_INTERES";
		generation: number;
		status: string;
		pollAttempts?: number;
		errorCode?: string | null;
		errorMessage?: string | null;
		lastPollError?: string | null;
		activatedAt?: string | Date | null;
		createdAt?: string | Date | null;
	};
	estadoLabel: string;
	monto?: string;
	/** Motivo del cierre (invalidación por supervisor o link cerrado por
	 * Págalo) — solo tiene sentido para un link que ya no está vivo. */
	motivoCierre?: string | null;
	paymentUrl: string | null;
	casoCobroId: string | null;
	esSupervisor: boolean;
}) {
	const [accionAbierta, setAccionAbierta] = useState<AccionLink | null>(null);
	// Diagnóstico por link: llegaba del server (pollAttempts, errorCode,
	// activatedAt) pero se descartaba sin mostrarse — el supervisor solo veía
	// la antigüedad del GRUPO, no de cada link (hallazgo de code review).
	// errorMessage/lastPollError dan el motivo legible, no solo el código —
	// sin ellos "motivo de falla" quedaba solo parcialmente cumplido
	// (hallazgo de code review, ronda siguiente).
	const diagnostico: string[] = [];
	if (link.errorMessage) diagnostico.push(link.errorMessage);
	else if (link.errorCode) diagnostico.push(`Error: ${link.errorCode}`);
	if (link.lastPollError) {
		diagnostico.push(`Último error de sincronización: ${link.lastPollError}`);
	}
	if (link.pollAttempts && link.pollAttempts > 0) {
		diagnostico.push(`${link.pollAttempts} reintento(s) de sincronización`);
	}
	if (link.activatedAt) {
		diagnostico.push(
			`Activo desde ${new Date(link.activatedAt).toLocaleDateString("es-GT")}`,
		);
	} else if (link.createdAt) {
		diagnostico.push(
			`Creado ${new Date(link.createdAt).toLocaleDateString("es-GT")}`,
		);
	}

	const puedeInvalidar = esSupervisor && ESTADOS_VIVOS.has(link.status);
	// El server SIEMPRE rechaza regenerar dos casos, aunque el status esté en
	// ESTADOS_REGENERABLES (regenerarLinkIndividual, pagalo-link-orchestrator.ts):
	// un ERROR con errorCode=PagaloRespuestaAmbigua (Págalo puede haber creado
	// el link real igual, regenerar duplicaría un link cobrable), o un
	// REPLACED/CANCELLED/EXPIRED sin activatedAt (se cerró mientras Págalo
	// todavía no confirmaba la creación — mismo riesgo de duplicado). Ambos
	// campos ya viajan en el payload de la bandeja; sin este chequeo el botón
	// se ofrecía igual y fallaba siempre después de que el supervisor
	// escribía el motivo (hallazgo de code review).
	const regeneracionSiempreRechazada =
		link.errorCode === "PagaloRespuestaAmbigua" ||
		(["REPLACED", "CANCELLED", "EXPIRED"].includes(link.status) &&
			!link.activatedAt);
	// El server también rechaza regenerar un link de un grupo sin caso
	// asociado (necesita resolver contacto del cliente vía casoCobroId). Sin
	// este chequeo el botón se ofrecía igual para grupos del bot y fallaba
	// siempre al confirmar (hallazgo de code review).
	const puedeRegenerar =
		esSupervisor &&
		!!casoCobroId &&
		ESTADOS_REGENERABLES.has(link.status) &&
		!regeneracionSiempreRechazada;
	// ESTADOS_VIVOS incluye CREATING, pero emitirUnLink preserva un link
	// justo en CREATING (sin pasar a ACTIVE) cuando detecta un pago-
	// predecesor sin reconciliar — persiste paymentUrl igual (para que el
	// poller lo siga) porque el link ya es real en Págalo, pero
	// deliberadamente NO lo confirma como seguro. Copiarlo con
	// ESTADOS_VIVOS ofrecía ese link a cualquier asesor común, exactamente
	// el caso que el backend decidió no confirmar (hallazgo de code
	// review). Solo ACTIVE es copiable con certeza.
	const puedeCopiar = !!paymentUrl && link.status === "ACTIVE";
	const tieneMenu = puedeInvalidar || puedeRegenerar || puedeCopiar;

	const copiar = async (e: Event) => {
		e.preventDefault();
		if (!paymentUrl) return;
		try {
			await copyPagaloLink(paymentUrl);
			toast.success("Link copiado");
		} catch {
			toast.error("No se pudo copiar el link.");
		}
	};

	const montoFormateado = monto
		? new Intl.NumberFormat("es-GT", {
				style: "currency",
				currency: "GTQ",
			}).format(Number(monto))
		: undefined;
	const base = tituloLink(link, estadoLabel, montoFormateado);
	const sufijos = [
		...(motivoCierre ? [`Motivo: ${motivoCierre}`] : []),
		...diagnostico,
	];
	const titulo = sufijos.length > 0 ? `${base} — ${sufijos.join(" · ")}` : base;

	const puntoColor = colorPuntoLink(link.status);
	const contenidoChip = (
		<>
			<span className={`h-1.5 w-1.5 shrink-0 rounded-full ${puntoColor}`} />
			{etiquetaLinkCompacta(link)}
		</>
	);

	// Sin acciones disponibles: pill de solo lectura, mismo look pero sin
	// borde interactivo ni cursor de click — nada que confundir con un botón.
	if (!tieneMenu) {
		return (
			<span
				className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs"
				title={titulo}
			>
				{contenidoChip}
			</span>
		);
	}

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
					<button
						type="button"
						title={titulo}
						className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs hover:bg-muted"
					>
						{contenidoChip}
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
					{montoFormateado && (
						<div className="px-2 py-1.5 text-muted-foreground text-xs">
							Monto: {montoFormateado}
						</div>
					)}
					{motivoCierre && (
						<div className="max-w-64 whitespace-normal break-words px-2 py-1.5 text-muted-foreground text-xs">
							Motivo: {motivoCierre}
						</div>
					)}
					{diagnostico.length > 0 && (
						<div className="max-w-64 whitespace-normal break-words px-2 py-1.5 text-muted-foreground text-xs">
							{diagnostico.join(" · ")}
						</div>
					)}
					{puedeCopiar && (
						<DropdownMenuItem onSelect={copiar}>
							<Copy className="mr-2 h-3.5 w-3.5" />
							Copiar link
						</DropdownMenuItem>
					)}
					{puedeRegenerar && (
						<DropdownMenuItem
							onSelect={(e) => {
								e.preventDefault();
								setAccionAbierta("regenerar");
							}}
						>
							Regenerar link
						</DropdownMenuItem>
					)}
					{puedeInvalidar && (
						<>
							<DropdownMenuItem
								disabled={!INVALIDAR_HABILITADO}
								onSelect={(e) => {
									e.preventDefault();
									if (!INVALIDAR_HABILITADO) return;
									setAccionAbierta("invalidar");
								}}
							>
								Invalidar link
							</DropdownMenuItem>
							{!INVALIDAR_HABILITADO && (
								// Texto SIEMPRE visible, no title en un item disabled — un
								// elemento disabled no garantiza recibir hover/foco (Radix
								// ni el navegador lo aseguran), así que un tooltip ahí podía
								// nunca mostrarse (hallazgo de code review).
								<div className="max-w-64 whitespace-normal break-words px-2 py-1.5 text-muted-foreground text-xs">
									Aún es solo en nuestra DB — en espera de integrar cancelación
									real con Págalo.
								</div>
							)}
						</>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
			{accionAbierta && (
				<DialogoAccionLink
					accion={accionAbierta}
					linkId={link.id}
					casoCobroId={casoCobroId}
					abierto={!!accionAbierta}
					onCerrar={() => setAccionAbierta(null)}
				/>
			)}
		</>
	);
}

/**
 * CB-127 · Copiar / Regenerar / Invalidar de un link, como botones sueltos
 * — para Ficha 360, donde cada link es una tarjeta grande (a diferencia de
 * `ChipLinkPagalo`, que las mismas acciones van en un dropdown por espacio
 * de fila). Misma lógica y mismos diálogos, solo cambia el trigger visual.
 */
export function AccionesLinkPagalo({
	link,
	paymentUrl,
	casoCobroId,
	esSupervisor,
	esVigente = true,
}: {
	link: {
		id: string;
		status: string;
		errorCode?: string | null;
		activatedAt?: string | Date | null;
	};
	paymentUrl: string | null;
	casoCobroId: string | null;
	esSupervisor: boolean;
	/** regenerarLinkIndividual (server) rechaza SIEMPRE una generación que
	 * no sea la más alta de su tipo dentro del grupo — regenerar una fila
	 * vieja cuando ya existe una más nueva dejaría el supersedesLinkId
	 * apuntando al link equivocado. Ficha 360 renderizaba TODAS las
	 * generaciones con el mismo menú de acciones, así que "Regenerar"
	 * aparecía igual en un histórico y fallaba siempre después de que el
	 * supervisor escribía el motivo (hallazgo de code review). Default
	 * true: ChipLinkPagalo/GrupoLinksPorTipo (bandeja) ya solo le pasan el
	 * vigente, así que ahí el default no cambia nada. */
	esVigente?: boolean;
}) {
	const [accionAbierta, setAccionAbierta] = useState<AccionLink | null>(null);

	const puedeInvalidar = esSupervisor && ESTADOS_VIVOS.has(link.status);
	// Mismo chequeo que ChipLinkPagalo: el server siempre rechaza regenerar
	// sin casoCobroId, o cuando el link quedó ambiguo/sin confirmar (hallazgo
	// de code review).
	const regeneracionSiempreRechazada =
		link.errorCode === "PagaloRespuestaAmbigua" ||
		(["REPLACED", "CANCELLED", "EXPIRED"].includes(link.status) &&
			!link.activatedAt);
	const puedeRegenerar =
		esSupervisor &&
		esVigente &&
		!!casoCobroId &&
		ESTADOS_REGENERABLES.has(link.status) &&
		!regeneracionSiempreRechazada;
	// Mismo chequeo que ChipLinkPagalo: solo ACTIVE es copiable con
	// certeza — CREATING puede ser un link real preservado sin confirmar
	// (pago-predecesor sin reconciliar, ver emitirUnLink), y ofrecerlo
	// igual dejaba mandar al cliente un link que el backend decidió no
	// confirmar (hallazgo de code review).
	const puedeCopiar = !!paymentUrl && link.status === "ACTIVE";
	if (!puedeInvalidar && !puedeRegenerar && !puedeCopiar) return null;

	const copiar = async () => {
		if (!paymentUrl) return;
		try {
			await copyPagaloLink(paymentUrl);
			toast.success("Link copiado");
		} catch {
			toast.error("No se pudo copiar el link.");
		}
	};

	return (
		<div className="mt-2 flex flex-wrap gap-2">
			{puedeCopiar && (
				<Button type="button" size="sm" variant="outline" onClick={copiar}>
					<Copy className="mr-2 h-3.5 w-3.5" />
					Copiar link
				</Button>
			)}
			{puedeRegenerar && (
				<Button
					type="button"
					size="sm"
					variant="outline"
					onClick={() => setAccionAbierta("regenerar")}
				>
					Regenerar link
				</Button>
			)}
			{puedeInvalidar && (
				<Button
					type="button"
					size="sm"
					variant="outline"
					disabled={!INVALIDAR_HABILITADO}
					title={
						INVALIDAR_HABILITADO
							? undefined
							: "Aún es solo en nuestra DB — en espera de integrar cancelación real con Págalo"
					}
					onClick={() => {
						if (!INVALIDAR_HABILITADO) return;
						setAccionAbierta("invalidar");
					}}
				>
					Invalidar link
				</Button>
			)}
			{accionAbierta && (
				<DialogoAccionLink
					accion={accionAbierta}
					linkId={link.id}
					casoCobroId={casoCobroId}
					abierto={!!accionAbierta}
					onCerrar={() => setAccionAbierta(null)}
				/>
			)}
		</div>
	);
}

type LinkParaHistorial = {
	id: string;
	linkType: "CAPITAL" | "MORA_INTERES";
	generation: number;
	status: string;
	motivoCierre?: string | null;
};

/**
 * CB-127 · Un link cerrado (generación vieja) dentro del historial
 * colapsado: solo lectura, sin menú de acciones — invalidar/regenerar
 * siempre operan sobre el vigente, nunca sobre un histórico.
 */
function ChipLinkHistorico({ link }: { link: LinkParaHistorial }) {
	const estadoLabel = link.status;
	const titulo = link.motivoCierre
		? `${tituloLink(link, estadoLabel)} — Motivo: ${link.motivoCierre}`
		: tituloLink(link, estadoLabel);
	return (
		<span
			className="inline-flex items-center gap-1.5 rounded-full border border-dashed px-2 py-0.5 text-muted-foreground text-xs"
			title={titulo}
		>
			<span
				className={`h-1.5 w-1.5 shrink-0 rounded-full ${colorPuntoLink(link.status)}`}
			/>
			{etiquetaLinkCompacta(link)}
		</span>
	);
}

/**
 * CB-127 · Un tipo de link (Capital o Mora/Int.) con su historial de
 * generaciones: el vigente se ve normal (con su menú de acciones); si hubo
 * generaciones anteriores (invalidadas por el supervisor o cerradas por
 * Págalo), quedan detrás de un "+N anterior(es)" colapsado — no se mezclan
 * con el vigente en la vista por defecto, pero siguen siendo del mismo
 * grupo y a un click de distancia. Mismo agrupamiento
 * (agruparLinksPorGeneracion) se reusa en Ficha 360.
 */
export function GrupoLinksPorTipo({
	vigente,
	historicos,
	estadoLabel,
	monto,
	motivoCierre,
	paymentUrl,
	casoCobroId,
	esSupervisor,
}: {
	vigente: {
		id: string;
		linkType: "CAPITAL" | "MORA_INTERES";
		generation: number;
		status: string;
		pollAttempts?: number;
		errorCode?: string | null;
		errorMessage?: string | null;
		lastPollError?: string | null;
		activatedAt?: string | Date | null;
		createdAt?: string | Date | null;
	};
	historicos: LinkParaHistorial[];
	estadoLabel: string;
	monto?: string;
	motivoCierre?: string | null;
	paymentUrl: string | null;
	casoCobroId: string | null;
	esSupervisor: boolean;
}) {
	const [expandido, setExpandido] = useState(false);
	return (
		<div className="inline-flex flex-wrap items-center gap-1.5">
			<ChipLinkPagalo
				link={vigente}
				estadoLabel={estadoLabel}
				monto={monto}
				motivoCierre={motivoCierre}
				paymentUrl={paymentUrl}
				casoCobroId={casoCobroId}
				esSupervisor={esSupervisor}
			/>
			{historicos.length > 0 && (
				<>
					<button
						type="button"
						onClick={() => setExpandido((v) => !v)}
						className="text-muted-foreground text-xs underline underline-offset-2 hover:text-foreground"
					>
						{expandido
							? "ocultar"
							: `+${historicos.length} anterior${historicos.length > 1 ? "es" : ""}`}
					</button>
					{expandido &&
						historicos.map((historico) => (
							<ChipLinkHistorico key={historico.id} link={historico} />
						))}
				</>
			)}
		</div>
	);
}
