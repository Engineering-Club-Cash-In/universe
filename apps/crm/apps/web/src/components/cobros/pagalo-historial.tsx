/**
 * Detalle de un grupo de links de Págalo (CB-028/CB-127): los links con su
 * estado, motivo de falla, reintentos, antigüedad y generación, el detalle
 * «Links por cuota» bajo demanda y la bitácora. Lo pinta la línea de tiempo
 * unificada del historial (Ficha 360 y Workspace), plegado en la fila del
 * grupo; las acciones de grupo del supervisor van a la vista en la fila.
 *
 * Los grupos los carga `useHistorialUnificado` por crédito (no por caso): un
 * crédito acumula varios casos de cobro y el asesor espera ver TODOS los links
 * que se le generaron. El crédito lo resuelve el servidor a partir del caso
 * (getPagaloHistorial): un id de crédito es numérico y enumerable.
 */
import { useQuery } from "@tanstack/react-query";
import { XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { agruparPorCuota } from "@/lib/cobros/pagalo-allocations-view";
import {
	agruparLinksPorGeneracion,
	getPagaloGroupSummary,
	getPagaloLinkStatusInfo,
} from "@/lib/cobros/pagalo-link-display";
import { facturableSinOtrosGTQ } from "@/lib/cobros/pagalo-otros";
import { client } from "@/utils/orpc";
import { BitacoraPagalo, type EventoPagalo } from "./pagalo/bitacora-pagalo";
import { AccionesLinkPagalo } from "./pagalo/chip-link-pagalo";
import { antiguedadLink, fechaHora } from "./pagalo/formato-pagalo";

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

export type GrupoPagalo = {
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
export function GrupoPagaloDetalle({
	grupo,
	casoCobroId,
	esSupervisor,
}: {
	grupo: GrupoPagalo;
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
