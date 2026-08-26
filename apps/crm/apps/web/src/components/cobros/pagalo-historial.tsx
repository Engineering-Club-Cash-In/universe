/**
 * Rastro completo de Págalo (CB-028) para el caso: todos los grupos creados
 * a lo largo del tiempo (puede haber más de uno — un grupo completado o
 * cancelado libera el slot y permite crear otro nuevo para el mismo
 * crédito), más reciente primero, cada uno con su timeline de eventos
 * append-only (pagaloPaymentEvents) y los links generados.
 */
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CreditCard, ExternalLink, XCircle } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { orpc } from "@/utils/orpc";

const q = (value: unknown) =>
	new Intl.NumberFormat("es-GT", { style: "currency", currency: "GTQ" }).format(Number(value ?? 0));

const fechaHora = (fecha: string | Date | null) =>
	fecha
		? new Date(fecha).toLocaleString("es-GT", {
				day: "numeric",
				month: "short",
				year: "numeric",
				hour: "2-digit",
				minute: "2-digit",
			})
		: "—";

const ESTADO_INFO: Record<string, { label: string; color: string }> = {
	DRAFT: { label: "Borrador", color: "bg-muted text-muted-foreground" },
	LINKS_PENDING: { label: "Creando links", color: "bg-blue-50 text-blue-700" },
	PENDING_PAYMENT: { label: "Esperando pago", color: "bg-amber-50 text-amber-700" },
	PARTIALLY_PAID: { label: "Pago parcial", color: "bg-amber-50 text-amber-700" },
	READY_TO_APPLY: { label: "Listo para aplicar", color: "bg-blue-50 text-blue-700" },
	APPLYING: { label: "Aplicando", color: "bg-blue-50 text-blue-700" },
	COMPLETED: { label: "Completado", color: "bg-green-50 text-green-700" },
	APPLICATION_FAILED: { label: "Falló al aplicar", color: "bg-red-50 text-red-700" },
	REVIEW_REQUIRED: { label: "Requiere revisión", color: "bg-red-50 text-red-700" },
	CANCELLED: { label: "Cancelado", color: "bg-muted text-muted-foreground" },
};

const EVENTO_LABEL: Record<string, string> = {
	GROUP_CREATED: "Grupo creado",
	LINK_ACTIVE: "Link activado",
	LINK_PAID: "Link pagado",
	GROUP_READY: "Listo para aplicar",
	GROUP_PARTIALLY_PAID: "Pago parcial",
	GROUP_COMPLETED: "Aplicado en cartera",
	GROUP_REVIEW_REQUIRED: "Enviado a revisión",
};

type Evento = {
	id: number;
	eventType: string;
	source: string;
	occurredAt: string;
};

type Link = {
	id: string;
	linkType: "CAPITAL" | "MORA_INTERES";
	status: string;
	paymentUrl: string | null;
	voucherUrl: string | null;
	paidAt: string | null;
};

type Grupo = {
	id: string;
	status: string;
	origen: "ASESOR" | "BOT";
	capitalTotal: string;
	facturableTotal: string;
	totalAmount: string;
	carteraImportId: number | null;
	lastDispatchError: string | null;
	createdAt: string;
	readyToApplyAt: string | null;
	completedAt: string | null;
	creadoPor: string | null;
	links: Link[];
	eventos: Evento[];
};

function FilaEvento({ evento }: { evento: Evento }) {
	const label = EVENTO_LABEL[evento.eventType] ?? evento.eventType;
	return (
		<div className="flex items-start gap-3 text-sm">
			<span className="w-32 shrink-0 tabular-nums text-muted-foreground">{fechaHora(evento.occurredAt)}</span>
			<span className="flex-1">{label}</span>
			<Badge variant="outline" className="text-xs">{evento.source}</Badge>
		</div>
	);
}

function GrupoPagalo({ grupo }: { grupo: Grupo }) {
	const estadoInfo = ESTADO_INFO[grupo.status] ?? { label: grupo.status, color: "bg-muted" };
	return (
		<div className="space-y-3 rounded-lg border p-4">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<CreditCard className="h-4 w-4 text-violet-600" />
					<span className="font-medium">Crédito {grupo.createdAt ? fechaHora(grupo.createdAt) : ""}</span>
					<Badge className={estadoInfo.color}>{estadoInfo.label}</Badge>
				</div>
				<span className="text-sm text-muted-foreground">{q(grupo.totalAmount)}</span>
			</div>
			<div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-muted-foreground sm:grid-cols-4">
				<span>Capital: {q(grupo.capitalTotal)}</span>
				<span>Mora e intereses: {q(grupo.facturableTotal)}</span>
				<span>Origen: {grupo.origen === "ASESOR" ? "Asesor" : "Bot WhatsApp"}</span>
				<span>Creado por: {grupo.creadoPor ?? "—"}</span>
			</div>
			{grupo.carteraImportId && grupo.status === "COMPLETED" && (
				<p className="text-sm text-green-700">
					<CheckCircle2 className="mr-1 inline h-4 w-4" />
					Registrado en cartera, pendiente de validación (importación #{grupo.carteraImportId})
				</p>
			)}
			{grupo.carteraImportId && grupo.status !== "COMPLETED" && (
				<p className="text-sm text-muted-foreground">
					Importación en cartera #{grupo.carteraImportId} (revisión, no aplicado)
				</p>
			)}
			{grupo.lastDispatchError && grupo.status !== "COMPLETED" && (
				<p className="text-sm text-red-700">
					<XCircle className="mr-1 inline h-4 w-4" />
					{grupo.lastDispatchError}
				</p>
			)}
			{grupo.links.length > 0 && (
				<div className="flex flex-wrap gap-2">
					{grupo.links.map((link) => (
						<div key={link.id} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
							<span>{link.linkType === "CAPITAL" ? "Capital" : "Mora e intereses"}</span>
							<Badge variant="outline" className="text-xs">{link.status}</Badge>
							{link.paymentUrl && (
								<a href={link.paymentUrl} target="_blank" rel="noreferrer" className="text-violet-600 hover:underline">
									<ExternalLink className="h-3.5 w-3.5" />
								</a>
							)}
							{/* Comprobante: fuera de alcance por ahora mostrarlo acá — el CRM
							    no tiene el dominio público del bucket de cartera-back, y
							    voucherUrl guarda solo la key plana, no una URL. Se revisa del
							    lado de cartera (boleta con su URL ya resuelta). */}
						</div>
					))}
				</div>
			)}
			{grupo.eventos.length > 0 && (
				<div className="space-y-1.5 border-t pt-3">
					{grupo.eventos.map((evento) => (
						<FilaEvento key={evento.id} evento={evento} />
					))}
				</div>
			)}
		</div>
	);
}

export function PagaloHistorial({ casoCobroId }: { casoCobroId: string }) {
	const [expandido, setExpandido] = useState(true);
	const historial = useQuery({
		...orpc.getPagaloHistorial.queryOptions({ input: { casoCobroId } }),
		enabled: !!casoCobroId,
	});
	const grupos = (historial.data as Grupo[] | undefined) ?? [];

	if (!historial.isLoading && grupos.length === 0) return null;

	return (
		<div className="space-y-3">
			<button
				type="button"
				className="flex w-full items-center justify-between text-left"
				onClick={() => setExpandido((v) => !v)}
			>
				<h3 className="flex items-center gap-2 font-medium text-sm">
					<CreditCard className="h-4 w-4" />
					Historial Págalo
				</h3>
				<span className="text-muted-foreground text-xs">{grupos.length} grupo(s)</span>
			</button>
			{expandido && (
				historial.isLoading ? (
					<div className="py-4 text-center text-muted-foreground text-sm">Cargando historial Págalo…</div>
				) : (
					<div className="space-y-3">
						{grupos.map((grupo) => (
							<GrupoPagalo key={grupo.id} grupo={grupo} />
						))}
					</div>
				)
			)}
		</div>
	);
}
