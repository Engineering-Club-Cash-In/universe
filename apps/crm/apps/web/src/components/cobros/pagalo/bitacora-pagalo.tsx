/**
 * CB-127 · Bitácora de un grupo Págalo: timeline de pagaloPaymentEvents,
 * más reciente primero. El payload crudo (JSON) solo lo ve el supervisor —
 * mismo gate que AuditoriaPopover (historial/fila-historial.tsx) — el resto
 * ve la línea legible sin el detalle técnico.
 */
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { getPagaloLinkStatusInfo } from "@/lib/cobros/pagalo-link-display";
import {
	etiquetaEvento,
	etiquetaFuente,
	fechaHora,
	getEstadoGrupoInfo,
} from "./formato-pagalo";

export type EventoPagalo = {
	id: number;
	linkId: string | null;
	eventType: string;
	source: string;
	actorUserId: string | null;
	actorNombre: string | null;
	fromStatus: string | null;
	toStatus: string | null;
	payload: unknown;
	occurredAt: string;
};

function tienePayload(payload: unknown): boolean {
	return (
		!!payload &&
		typeof payload === "object" &&
		Object.keys(payload as Record<string, unknown>).length > 0
	);
}

function FilaEvento({
	evento,
	esSupervisor,
}: {
	evento: EventoPagalo;
	esSupervisor: boolean;
}) {
	const [abierto, setAbierto] = useState(false);
	const actor = evento.actorNombre ?? etiquetaFuente(evento.source);
	// Un evento de LINK (CREATING→ACTIVE, ACTIVE→EXPIRED, etc) usaba el
	// catálogo de estados de GRUPO — sin match ahí, se mostraba el código
	// crudo en vez de la etiqueta en español (hallazgo de code review).
	const etiquetaEstado = (status: string) =>
		evento.linkId
			? getPagaloLinkStatusInfo(status).label
			: getEstadoGrupoInfo(status).label;
	const transicion =
		evento.fromStatus && evento.toStatus
			? `${etiquetaEstado(evento.fromStatus)} → ${etiquetaEstado(evento.toStatus)}`
			: evento.toStatus
				? `→ ${etiquetaEstado(evento.toStatus)}`
				: null;

	return (
		<div className="flex items-start justify-between gap-2 border-b py-2 text-sm last:border-0">
			<div className="min-w-0">
				<p className="font-medium">{etiquetaEvento(evento.eventType)}</p>
				{transicion && (
					<p className="text-muted-foreground text-xs">{transicion}</p>
				)}
				<p className="text-muted-foreground text-xs">
					{actor} · {fechaHora(evento.occurredAt)}
				</p>
			</div>
			{esSupervisor && tienePayload(evento.payload) && (
				<Popover open={abierto} onOpenChange={setAbierto}>
					<PopoverTrigger asChild>
						<button
							type="button"
							className="shrink-0 text-muted-foreground text-xs underline underline-offset-2"
						>
							Detalle
						</button>
					</PopoverTrigger>
					<PopoverContent className="w-80" align="end">
						<pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-muted-foreground text-xs">
							{JSON.stringify(evento.payload, null, 1)}
						</pre>
					</PopoverContent>
				</Popover>
			)}
		</div>
	);
}

export function BitacoraPagalo({
	eventos,
	esSupervisor,
	abiertoPorDefecto = false,
}: {
	eventos: EventoPagalo[];
	esSupervisor: boolean;
	abiertoPorDefecto?: boolean;
}) {
	const [expandido, setExpandido] = useState(abiertoPorDefecto);
	if (eventos.length === 0) return null;

	const ordenados = [...eventos].sort(
		(a, b) =>
			new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
	);

	return (
		<div className="rounded-md border">
			<button
				type="button"
				className="flex w-full items-center justify-between px-3 py-2 text-left text-muted-foreground text-xs"
				onClick={() => setExpandido((v) => !v)}
			>
				<span>Bitácora ({ordenados.length} eventos)</span>
				<ChevronDown
					className={`h-3.5 w-3.5 transition-transform ${expandido ? "rotate-180" : ""}`}
				/>
			</button>
			{expandido && (
				<div className="border-t px-3">
					{ordenados.map((evento) => (
						<FilaEvento
							key={evento.id}
							evento={evento}
							esSupervisor={esSupervisor}
						/>
					))}
				</div>
			)}
		</div>
	);
}
