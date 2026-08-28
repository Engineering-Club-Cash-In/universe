/**
 * CB-127 · Timeline de eventos de un grupo Págalo (pagaloPaymentEvents),
 * más reciente primero. El payload crudo queda gateado a supervisor detrás
 * de un popover — los eventos ya vienen en el payload de getPagaloHistorial,
 * sin query lazy (a diferencia de AuditoriaPopover, que sí pagina bajo
 * demanda para no traer historial completo de todos los contactos).
 */
import { ChevronDown, Code2 } from "lucide-react";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { authClient } from "@/lib/auth-client";
import { PERMISSIONS } from "@/lib/roles";
import { etiquetaEvento, etiquetaFuente, fechaHora } from "./formato-pagalo";

export type EventoPagalo = {
	id: string;
	eventType: string;
	source: string;
	actorUserId: string | null;
	actorNombre: string | null;
	fromStatus: string | null;
	toStatus: string | null;
	payload: unknown;
	occurredAt: string;
};

function FilaEvento({
	evento,
	esSupervisor,
}: {
	evento: EventoPagalo;
	esSupervisor: boolean;
}) {
	const actor = evento.actorNombre ?? etiquetaFuente(evento.source);
	const transicion =
		evento.fromStatus && evento.toStatus
			? `${evento.fromStatus} → ${evento.toStatus}`
			: evento.toStatus
				? `→ ${evento.toStatus}`
				: null;

	return (
		<div className="flex items-start justify-between gap-2 border-b py-2 text-sm last:border-b-0">
			<div className="min-w-0 flex-1">
				<p className="font-medium">{etiquetaEvento(evento.eventType)}</p>
				<p className="text-muted-foreground text-xs">
					{actor}
					{transicion ? ` · ${transicion}` : ""}
				</p>
			</div>
			<div className="flex shrink-0 items-center gap-2">
				<span className="text-muted-foreground text-xs">
					{fechaHora(evento.occurredAt)}
				</span>
				{esSupervisor && (
					<Popover>
						<PopoverTrigger asChild>
							<button
								type="button"
								className="text-muted-foreground hover:text-foreground"
								title="Ver payload crudo"
							>
								<Code2 className="h-3.5 w-3.5" />
							</button>
						</PopoverTrigger>
						<PopoverContent className="w-96" align="end">
							<pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-muted-foreground text-xs">
								{JSON.stringify(evento.payload, null, 2)}
							</pre>
						</PopoverContent>
					</Popover>
				)}
			</div>
		</div>
	);
}

export function BitacoraPagalo({
	eventos,
	abiertoPorDefecto,
}: {
	eventos: EventoPagalo[];
	abiertoPorDefecto: boolean;
}) {
	const { data: session, isPending } = authClient.useSession();
	// Mientras isPending, userRole es undefined — no gatear a supervisor con
	// ese estado transitorio como si fuera "no autorizado" (mismo bug ya
	// documentado en historial-agendas.tsx).
	const esSupervisor =
		!isPending && PERMISSIONS.canAssignCobros(session?.user?.role ?? "");
	const ordenados = [...eventos].sort(
		(a, b) =>
			new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
	);

	if (ordenados.length === 0) return null;

	return (
		<Collapsible defaultOpen={abiertoPorDefecto}>
			<CollapsibleTrigger asChild>
				<button
					type="button"
					className="flex w-full items-center justify-between text-left text-muted-foreground text-xs hover:text-foreground"
				>
					<span>Bitácora ({ordenados.length} evento(s))</span>
					<ChevronDown className="h-3.5 w-3.5" />
				</button>
			</CollapsibleTrigger>
			<CollapsibleContent className="mt-2">
				{ordenados.map((evento) => (
					<FilaEvento
						key={evento.id}
						evento={evento}
						esSupervisor={esSupervisor}
					/>
				))}
			</CollapsibleContent>
		</Collapsible>
	);
}
