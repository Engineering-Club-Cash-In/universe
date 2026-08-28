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
	Copy,
	CreditCard,
	XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { agruparPorCuota } from "@/lib/cobros/pagalo-allocations-view";
import {
	copyPagaloLink,
	getPagaloGroupSummary,
	getPagaloLinkStatusInfo,
} from "@/lib/cobros/pagalo-link-display";
import { facturableSinOtrosGTQ } from "@/lib/cobros/pagalo-otros";
import { client, orpc } from "@/utils/orpc";
import { AccionesSupervisorPagalo } from "./pagalo/acciones-supervisor-pagalo";
import { BitacoraPagalo, type EventoPagalo } from "./pagalo/bitacora-pagalo";
import {
	antiguedadLink,
	estadoGrupoInfo,
	etiquetaMotivoRevision,
	fechaHora,
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

function LinkPagalo({ link, monto }: { link: Link; monto: string }) {
	const estado = getPagaloLinkStatusInfo(link.status);
	const puedeCopiar = estado.canCopy && Boolean(link.paymentUrl);
	const antiguedad = antiguedadLink(link.activatedAt ?? link.createdAt);
	const motivoFalla =
		link.status === "ERROR"
			? (link.errorMessage ?? link.errorCode)
			: link.pollAttempts > 0
				? link.lastPollError
				: null;

	const copiar = async () => {
		if (!link.paymentUrl) return;
		try {
			await copyPagaloLink(link.paymentUrl);
			toast.success("Link copiado");
		} catch {
			toast.error("No se pudo copiar el link. Intentá de nuevo.");
		}
	};

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
							? `Págalo lo dio por ${link.status === "EXPIRED" ? "vencido" : "cancelado"} — ${antiguedad.etiqueta}`
							: `Antigüedad: ${antiguedad.etiqueta}`}
					</p>
				)}
			{puedeCopiar && (
				<Button
					className="mt-3"
					onClick={copiar}
					size="sm"
					type="button"
					variant="outline"
				>
					<Copy className="mr-2 h-3.5 w-3.5" />
					Copiar link de pago
				</Button>
			)}
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

function GrupoPagalo({
	grupo,
	casoCobroId,
	creditoId,
}: {
	grupo: Grupo;
	casoCobroId: string;
	creditoId: number;
}) {
	const estadoInfo = estadoGrupoInfo(grupo.status);
	const resumenLinks = getPagaloGroupSummary(grupo.links);
	const moraEIntereses = facturableSinOtrosGTQ(
		grupo.facturableTotal,
		grupo.otrosTotal,
	);
	const motivoRevision = etiquetaMotivoRevision(grupo.lastDispatchError);

	return (
		<div className="space-y-3 rounded-lg border p-4">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<CreditCard className="h-4 w-4 text-violet-600" />
					<span className="font-medium">
						Crédito {grupo.createdAt ? fechaHora(grupo.createdAt) : ""}
					</span>
					<Badge className={estadoInfo.className}>{estadoInfo.label}</Badge>
				</div>
				<span className="text-muted-foreground text-sm">
					{q(grupo.totalAmount)}
				</span>
			</div>
			<div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground text-sm sm:grid-cols-4">
				<span>Capital: {q(grupo.capitalTotal)}</span>
				<span>Mora e intereses: {q(moraEIntereses)}</span>
				<span>Otros: {q(grupo.otrosTotal)}</span>
				<span>
					Origen: {grupo.origen === "ASESOR" ? "Asesor" : "Bot WhatsApp"}
				</span>
				<span>Creado por: {grupo.creadoPor ?? "—"}</span>
				{grupo.dispatchAttemptCount > 0 && (
					<span>
						Intentos de aplicación: {grupo.dispatchAttemptCount}
						{grupo.nextDispatchAt &&
							` (próximo: ${fechaHora(grupo.nextDispatchAt)})`}
					</span>
				)}
			</div>
			{grupo.carteraImportId && grupo.status === "COMPLETED" && (
				<p className="text-green-700 text-sm">
					<CheckCircle2 className="mr-1 inline h-4 w-4" />
					Pago validado y aplicado en cartera (importación #
					{grupo.carteraImportId}); la factura sale después
				</p>
			)}
			{grupo.carteraImportId && grupo.status !== "COMPLETED" && (
				<p className="text-muted-foreground text-sm">
					Importación en cartera #{grupo.carteraImportId} (revisión, no
					aplicado)
				</p>
			)}
			{motivoRevision && grupo.status !== "COMPLETED" && (
				<p className="text-red-700 text-sm">
					<XCircle className="mr-1 inline h-4 w-4" />
					{motivoRevision}
				</p>
			)}
			{resumenLinks && (
				<p className="text-muted-foreground text-sm">{resumenLinks}</p>
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
						/>
					))}
				</div>
			)}
			<Collapsible>
				<CollapsibleTrigger asChild>
					<button
						type="button"
						className="text-muted-foreground text-xs hover:text-foreground"
					>
						Links por cuota
					</button>
				</CollapsibleTrigger>
				<CollapsibleContent className="mt-2">
					<LinksPorCuota casoCobroId={casoCobroId} groupId={grupo.id} />
				</CollapsibleContent>
			</Collapsible>
			<AccionesSupervisorPagalo
				casoCobroId={casoCobroId}
				creditoId={creditoId}
				groupId={grupo.id}
				status={grupo.status}
			/>
			<BitacoraPagalo eventos={grupo.eventos} abiertoPorDefecto={false} />
		</div>
	);
}

const POR_PAGINA = 5;

export function PagaloHistorial({
	casoCobroId,
	creditoId,
}: {
	casoCobroId: string;
	creditoId: number;
}) {
	const [expandido, setExpandido] = useState(true);
	const [pagina, setPagina] = useState(1);
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
		placeholderData: (anterior: unknown) => (casoCambio ? undefined : anterior),
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
		<div className="space-y-3">
			<button
				type="button"
				className="flex w-full items-center justify-between text-left"
				onClick={() => setExpandido((v) => !v)}
			>
				<div>
					<h3 className="flex items-center gap-2 font-medium text-sm">
						<CreditCard className="h-4 w-4" />
						Historial Links de Pagos
					</h3>
					<p className="text-muted-foreground text-xs">
						Todos los links Págalo generados para este crédito
					</p>
				</div>
				<span className="text-muted-foreground text-xs">
					{historial.isLoading ? "…" : `${total} grupo(s)`}
				</span>
			</button>
			{expandido &&
				(historial.isLoading ? (
					<div className="py-4 text-center text-muted-foreground text-sm">
						Cargando historial Págalo…
					</div>
				) : grupos.length === 0 ? (
					// El asesor tiene que poder distinguir "no se generó ninguno"
					// de "se rompió algo"; antes la sección desaparecía y quedaba
					// una tarjeta vacía en la ficha.
					<div className="py-6 text-center text-muted-foreground text-sm">
						Sin links de pago generados para este crédito
					</div>
				) : (
					<div className="space-y-3">
						{grupos.map((grupo) => (
							<GrupoPagalo
								key={grupo.id}
								grupo={grupo}
								casoCobroId={casoCobroId}
								creditoId={creditoId}
							/>
						))}
						{totalPaginas > 1 && (
							<div className="flex items-center justify-between border-t pt-3">
								<p className="text-muted-foreground text-xs">
									Mostrando {(pagina - 1) * POR_PAGINA + 1} -{" "}
									{Math.min(pagina * POR_PAGINA, total)} de {total}
								</p>
								<div className="flex items-center gap-2">
									<Button
										disabled={pagina === 1}
										onClick={() => setPagina((p) => Math.max(1, p - 1))}
										size="sm"
										type="button"
										variant="outline"
									>
										<ChevronLeft className="h-4 w-4" />
									</Button>
									<span className="text-xs">
										Página {pagina} de {totalPaginas}
									</span>
									<Button
										disabled={pagina >= totalPaginas}
										onClick={() =>
											setPagina((p) => Math.min(totalPaginas, p + 1))
										}
										size="sm"
										type="button"
										variant="outline"
									>
										<ChevronRight className="h-4 w-4" />
									</Button>
								</div>
							</div>
						)}
					</div>
				))}
		</div>
	);
}
