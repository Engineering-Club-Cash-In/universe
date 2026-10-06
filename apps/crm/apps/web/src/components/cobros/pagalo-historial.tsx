/**
 * Rastro completo de Págalo (CB-028/CB-127) del CRÉDITO: todos los grupos
 * creados a lo largo del tiempo (puede haber más de uno — un grupo completado
 * o cancelado libera el slot y permite crear otro nuevo), más reciente
 * primero, cada uno con su timeline de eventos append-only, badges de motivo
 * de falla/reintentos/antigüedad/generación, el detalle "Links por cuota" bajo
 * demanda, y las acciones de supervisor.
 *
 * Va por crédito y paginado, no por caso: un crédito puede acumular varios
 * casos de cobro y el asesor espera ver TODOS los links que se le generaron,
 * no solo los del caso vigente ni solo los que siguen pendientes de pago. El
 * crédito lo resuelve el servidor a partir del caso (getPagaloHistorial): un
 * id de crédito es numérico y enumerable, mandarlo desde acá sería pedirle al
 * cliente que elija qué links puede ver.
 */
import { useQuery } from "@tanstack/react-query";
import {
	CheckCircle2,
	ChevronLeft,
	ChevronRight,
	CreditCard,
	XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	HistorialGestiones,
	SeccionHistorial,
	type TonoGestion,
} from "@/components/cobros/ficha/ficha-pestanas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { authClient } from "@/lib/auth-client";
import { agruparPorCuota } from "@/lib/cobros/pagalo-allocations-view";
import {
	agruparLinksPorGeneracion,
	getPagaloGroupSummary,
	getPagaloLinkStatusInfo,
} from "@/lib/cobros/pagalo-link-display";
import { facturableSinOtrosGTQ } from "@/lib/cobros/pagalo-otros";
import { PERMISSIONS } from "@/lib/roles";
import { client, orpc } from "@/utils/orpc";
import { AccionesSupervisorPagalo } from "./pagalo/acciones-supervisor-pagalo";
import { BitacoraPagalo, type EventoPagalo } from "./pagalo/bitacora-pagalo";
import { AccionesLinkPagalo } from "./pagalo/chip-link-pagalo";
import {
	antiguedadLink,
	etiquetaMotivo,
	fechaHora,
	getEstadoGrupoInfo,
} from "./pagalo/formato-pagalo";

type Link = {
	id: string;
	linkType: "CAPITAL" | "MORA_INTERES";
	status: string;
	paymentUrl: string | null;
	voucherUrl: string | null;
	paidAt: string | null;
	isApplicationSource: boolean;
	generation: number;
	supersedesLinkId: string | null;
	errorCode: string | null;
	errorMessage: string | null;
	lastPollError: string | null;
	pollAttempts: number;
	activatedAt: string | null;
	createdAt: string;
	transactionAmount: string | null;
};

type Grupo = {
	id: string;
	status: string;
	origen: "ASESOR" | "BOT";
	capitalTotal: string;
	facturableTotal: string;
	otrosTotal: string;
	totalAmount: string;
	carteraImportId: number | null;
	carteraCreditoId: number;
	lastDispatchError: string | null;
	dispatchAttemptCount: number;
	nextDispatchAt: string | null;
	createdAt: string;
	readyToApplyAt: string | null;
	completedAt: string | null;
	cancelledAt: string | null;
	creadoPor: string | null;
	links: Link[];
	eventos: EventoPagalo[];
};

const q = (value: unknown) =>
	new Intl.NumberFormat("es-GT", { style: "currency", currency: "GTQ" }).format(
		Number(value ?? 0),
	);

function LinkPagalo({
	link,
	monto,
	casoCobroId,
	esSupervisor,
	esVigente,
	grupoStatus,
}: {
	link: Link;
	monto: string;
	casoCobroId: string;
	esSupervisor: boolean;
	esVigente: boolean;
	grupoStatus: string;
}) {
	const estado = getPagaloLinkStatusInfo(link.status);
	const antiguedad = antiguedadLink(link.activatedAt ?? link.createdAt);
	const motivoFalla =
		link.status === "ERROR"
			? (link.errorMessage ?? link.errorCode)
			: link.pollAttempts > 0
				? link.lastPollError
				: null;

	return (
		<div className="rounded-md border p-3">
			<div className="flex items-start justify-between gap-3">
				<div>
					<p className="font-medium">
						{link.linkType === "CAPITAL" ? "Capital" : "Mora e intereses"}
					</p>
					<p className="text-muted-foreground text-sm">
						{q(link.transactionAmount ?? monto)}
					</p>
				</div>
				<div className="flex flex-col items-end gap-1">
					<Badge className={estado.className}>{estado.label}</Badge>
					{link.generation > 1 && (
						<Badge
							variant="outline"
							className="text-xs"
							title={
								link.supersedesLinkId
									? `Reemplaza al link ${link.supersedesLinkId}`
									: undefined
							}
						>
							Generación {link.generation}
						</Badge>
					)}
				</div>
			</div>
			{link.status === "PAID" && (
				<p className="mt-2 text-green-700 text-sm">
					Pagado: {fechaHora(link.paidAt)}
				</p>
			)}
			{motivoFalla && (
				<p className="mt-2 text-red-700 text-sm">
					<XCircle className="mr-1 inline h-3.5 w-3.5" />
					{motivoFalla}
				</p>
			)}
			{link.pollAttempts > 0 && (
				<p className="text-muted-foreground text-xs">
					{link.pollAttempts} intento(s) de verificación
				</p>
			)}
			{antiguedad &&
				["CREATING", "ACTIVE", "REPLACED"].includes(link.status) && (
					<p
						className={`text-xs ${antiguedad.alerta ? "text-amber-700" : "text-muted-foreground"}`}
					>
						{["EXPIRED", "CANCELLED"].includes(link.status)
							? `Marcado como ${link.status === "EXPIRED" ? "vencido" : "cancelado"} por Págalo — ${antiguedad.etiqueta}`
							: `Antigüedad: ${antiguedad.etiqueta}`}
					</p>
				)}
			<AccionesLinkPagalo
				link={link}
				paymentUrl={link.paymentUrl}
				casoCobroId={casoCobroId}
				esSupervisor={esSupervisor}
				esVigente={esVigente}
				grupoStatus={grupoStatus}
			/>
		</div>
	);
}

function LinksPorCuota({
	groupId,
	casoCobroId,
}: {
	groupId: string;
	casoCobroId: string;
}) {
	const allocations = useQuery({
		queryKey: ["getPagaloAllocations", groupId, casoCobroId],
		// El caso desde el que se mira: el historial es del crédito y lista
		// grupos de casos anteriores, que el servidor autoriza contra ESTE caso
		// verificando que sean del mismo crédito.
		queryFn: () =>
			(client as any).getPagaloAllocations({ groupId, casoCobroId }),
	});
	const data = allocations.data as
		| {
				allocationsSnapshot: unknown;
				links: Array<{
					id: string;
					linkType: "CAPITAL" | "MORA_INTERES";
					status: string;
					generation: number;
				}>;
		  }
		| undefined;
	if (allocations.isLoading) {
		return (
			<p className="py-2 text-muted-foreground text-sm">Cargando cuotas…</p>
		);
	}
	if (!data) return null;
	const cuotas = agruparPorCuota(data.allocationsSnapshot, data.links);
	if (cuotas.length === 0) return null;

	return (
		<div className="space-y-2">
			{cuotas.map((cuota) => (
				<div
					key={cuota.numeroCuota ?? "mora"}
					className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-sm"
				>
					<span className="font-medium">
						{cuota.numeroCuota === null ? "Mora" : `Cuota ${cuota.numeroCuota}`}
					</span>
					<span className="text-muted-foreground text-xs">
						{cuota.rubros.map((r) => `${r.rubro}: ${q(r.amount)}`).join(" · ")}
					</span>
					<span className="text-muted-foreground text-xs">
						{cuota.linkTypes.join(", ")}
						{cuota.linksHistoricos.length > 0 &&
							` (${cuota.linksHistoricos.length} link(s) previo(s))`}
					</span>
				</div>
			))}
		</div>
	);
}

/** Detalle de un grupo (va plegado en la línea de tiempo). */
function GrupoPagaloDetalle({
	grupo,
	casoCobroId,
	esSupervisor,
}: {
	grupo: Grupo;
	casoCobroId: string;
	esSupervisor: boolean;
}) {
	const resumenLinks = getPagaloGroupSummary(grupo.links);
	const moraEIntereses = facturableSinOtrosGTQ(
		grupo.facturableTotal,
		grupo.otrosTotal,
	);
	// regenerarLinkIndividual (server) rechaza SIEMPRE una generación que no
	// sea la más alta de su tipo — sin este filtro, Ficha 360 ofrecía
	// "Regenerar" en un histórico y fallaba siempre después de que el
	// supervisor escribía el motivo (hallazgo de code review). Mismo
	// agrupamiento que ya usa la bandeja (agruparLinksPorGeneracion).
	const idsVigentes = new Set(
		agruparLinksPorGeneracion(grupo.links).map((g) => g.vigente.id),
	);

	return (
		<div className="space-y-3 text-sm">
			<div className="grid grid-cols-2 gap-x-4 gap-y-1 text-fg-secondary text-xs sm:grid-cols-4">
				<span>Capital: {q(grupo.capitalTotal)}</span>
				<span>Mora e intereses: {q(moraEIntereses)}</span>
				<span>Otros: {q(grupo.otrosTotal)}</span>
				{grupo.dispatchAttemptCount > 0 && (
					<span>
						Intentos de aplicación: {grupo.dispatchAttemptCount}
						{grupo.nextDispatchAt &&
							` (próximo: ${fechaHora(grupo.nextDispatchAt)})`}
					</span>
				)}
			</div>
			{grupo.carteraImportId && grupo.status !== "COMPLETED" && (
				<p className="text-fg-secondary text-xs">
					Importación en cartera #{grupo.carteraImportId} (revisión, no
					aplicado)
				</p>
			)}
			{resumenLinks && (
				<p className="text-fg-secondary text-xs">{resumenLinks}</p>
			)}
			{grupo.links.length > 0 && (
				<div className="grid gap-2 sm:grid-cols-2">
					{grupo.links.map((link) => (
						<LinkPagalo
							key={link.id}
							link={link}
							monto={
								link.linkType === "CAPITAL"
									? grupo.capitalTotal
									: grupo.facturableTotal
							}
							casoCobroId={casoCobroId}
							esSupervisor={esSupervisor}
							esVigente={idsVigentes.has(link.id)}
							grupoStatus={grupo.status}
						/>
					))}
				</div>
			)}
			<Collapsible>
				<CollapsibleTrigger asChild>
					<button
						type="button"
						className="font-medium text-brand text-xs hover:underline"
					>
						Links por cuota
					</button>
				</CollapsibleTrigger>
				<CollapsibleContent className="mt-2">
					<LinksPorCuota casoCobroId={casoCobroId} groupId={grupo.id} />
				</CollapsibleContent>
			</Collapsible>
			<BitacoraPagalo
				eventos={grupo.eventos}
				esSupervisor={esSupervisor}
				abiertoPorDefecto={false}
			/>
		</div>
	);
}

const POR_PAGINA = 5;

/** Punto de la línea de tiempo según el estado del grupo. */
function tonoGrupo(status: string): TonoGestion {
	if (status === "COMPLETED") return "logrado";
	if (status === "APPLICATION_FAILED" || status === "REVIEW_REQUIRED")
		return "fallido";
	if (status === "CANCELLED") return "neutro";
	return "sin-contacto";
}

export function PagaloHistorial({ casoCobroId }: { casoCobroId: string }) {
	const [pagina, setPagina] = useState(1);
	const { data: session } = authClient.useSession();
	const esSupervisor = PERMISSIONS.canAssignCobros(session?.user?.role ?? "");
	// El componente se reusa al navegar de un caso a otro (misma ruta): sin
	// esto, la página vieja viaja al caso nuevo y, si el crédito nuevo tiene
	// menos páginas, el servidor devuelve una página vacía con `total > 0` — se
	// veía "Sin links" y los controles de paginación escondidos, sin forma de
	// volver a la 1 salvo recargando (Codex, PR #1498).
	const casoRenderizado = useRef(casoCobroId);
	const casoCambio = casoRenderizado.current !== casoCobroId;
	useEffect(() => {
		casoRenderizado.current = casoCobroId;
		setPagina(1);
	}, [casoCobroId]);
	const historial = useQuery({
		...orpc.getPagaloHistorial.queryOptions({
			input: { casoCobroId, page: pagina, pageSize: POR_PAGINA },
		}),
		enabled: !!casoCobroId,
		// Sin esto la lista parpadea a vacío en cada cambio de página. Pero SOLO
		// entre páginas del mismo caso: al cambiar de caso, seguir pintando los
		// grupos anteriores mostraría —y dejaría copiar— links de pago del
		// cliente que se acaba de dejar atrás.
		placeholderData: (anterior) => (casoCambio ? undefined : anterior),
	});
	const data = historial.data as { grupos: Grupo[]; total: number } | undefined;
	const grupos = data?.grupos ?? [];
	const total = data?.total ?? 0;
	const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));
	// Red de seguridad del mismo problema: si el total encogió por cualquier
	// otra vía (un grupo borrado, un refetch), la página fuera de rango no puede
	// dejar la sección vacía y sin controles.
	useEffect(() => {
		if (!historial.isLoading && pagina > totalPaginas) setPagina(1);
	}, [historial.isLoading, pagina, totalPaginas]);

	return (
		<SeccionHistorial
			titulo="Links de pago"
			conteo={historial.isLoading ? "…" : total}
			icono={<CreditCard />}
			descripcion="Todos los links Págalo generados para este crédito"
			estado={
				historial.isLoading
					? "cargando"
					: historial.isError
						? "error"
						: grupos.length === 0
							? "vacio"
							: "ok"
			}
			onReintentar={() => historial.refetch()}
			// El asesor tiene que poder distinguir "no se generó ninguno" de "se
			// rompió algo".
			vacio="Sin links de pago generados para este crédito."
			derecha={
				totalPaginas > 1 ? (
					<div className="flex items-center gap-2">
						<Button
							disabled={pagina === 1}
							onClick={() => setPagina((p) => Math.max(1, p - 1))}
							size="icon-sm"
							type="button"
							variant="secondary"
							aria-label="Página anterior"
						>
							<ChevronLeft />
						</Button>
						<span className="text-fg-secondary text-xs">
							{pagina} de {totalPaginas}
						</span>
						<Button
							disabled={pagina >= totalPaginas}
							onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
							size="icon-sm"
							type="button"
							variant="secondary"
							aria-label="Página siguiente"
						>
							<ChevronRight />
						</Button>
					</div>
				) : undefined
			}
		>
			<HistorialGestiones
				items={grupos.map((grupo) => {
					const estadoInfo = getEstadoGrupoInfo(grupo.status);
					const motivoRevision = etiquetaMotivo(grupo.lastDispatchError);
					return {
						id: grupo.id,
						cuando: grupo.createdAt ? fechaHora(grupo.createdAt) : "Sin fecha",
						titulo: (
							<span className="inline-flex items-center gap-1.5">
								<CreditCard className="h-3.5 w-3.5 text-violet-600" />
								Links de pago
							</span>
						),
						badge: (
							<Badge className={estadoInfo.className}>{estadoInfo.label}</Badge>
						),
						derecha: q(grupo.totalAmount),
						// Los grupos del bot no tienen persona detrás: el servidor manda
						// `creadoPor` en null y acá se nombra al bot, en vez de
						// atribuirle los links a un asesor que nunca los generó.
						subtitulo:
							grupo.origen === "BOT"
								? "Por: Bot de WhatsApp"
								: `Por: ${grupo.creadoPor ?? "—"}`,
						tono: tonoGrupo(grupo.status),
						extra: (
							<div className="space-y-1.5">
								{grupo.carteraImportId && grupo.status === "COMPLETED" && (
									<p className="text-green-700 text-xs dark:text-green-400">
										<CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
										Pago validado y aplicado en cartera (importación #
										{grupo.carteraImportId}); la factura se emite después
									</p>
								)}
								{motivoRevision && grupo.status !== "COMPLETED" && (
									<p className="text-red-700 text-xs dark:text-red-400">
										<XCircle className="mr-1 inline h-3.5 w-3.5" />
										{motivoRevision}
									</p>
								)}
								{/* Las acciones de grupo (CB-127) quedan siempre a la vista:
								    un grupo pagado esperando al dispatcher se empuja desde acá.
								    El componente devuelve null si no hay nada que ofrecer.
								    `carteraCreditoId` puede venir null en grupos viejos: solo se
								    usa para invalidar la query del grupo activo. */}
								<AccionesSupervisorPagalo
									casoCobroId={casoCobroId}
									creditoId={grupo.carteraCreditoId ?? 0}
									groupId={grupo.id}
									status={grupo.status}
								/>
							</div>
						),
						detalleEtiqueta: `Ver ${grupo.links.length === 1 ? "el link" : `los ${grupo.links.length} links`}, cuotas y bitácora`,
						detalleNodo: (
							<GrupoPagaloDetalle
								grupo={grupo}
								casoCobroId={casoCobroId}
								esSupervisor={esSupervisor}
							/>
						),
					};
				})}
			/>
		</SeccionHistorial>
	);
}
