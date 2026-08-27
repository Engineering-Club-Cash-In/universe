/**
 * Rastro completo de Págalo (CB-028) para el caso: todos los grupos creados
 * a lo largo del tiempo (puede haber más de uno — un grupo completado o
 * cancelado libera el slot y permite crear otro nuevo para el mismo
 * crédito), más reciente primero, cada uno con su timeline de eventos
 * append-only (pagaloPaymentEvents) y los links generados.
 */
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Copy, CreditCard, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	copyPagaloLink,
	getPagaloGroupSummary,
	getPagaloLinkStatusInfo,
} from "@/lib/cobros/pagalo-link-display";
import { facturableSinOtrosGTQ } from "@/lib/cobros/pagalo-otros";
import { orpc } from "@/utils/orpc";

const q = (value: unknown) =>
	new Intl.NumberFormat("es-GT", { style: "currency", currency: "GTQ" }).format(
		Number(value ?? 0),
	);

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
	PENDING_PAYMENT: {
		label: "Esperando pago",
		color: "bg-amber-50 text-amber-700",
	},
	PARTIALLY_PAID: {
		label: "Pago parcial",
		color: "bg-amber-50 text-amber-700",
	},
	READY_TO_APPLY: {
		label: "Listo para aplicar",
		color: "bg-blue-50 text-blue-700",
	},
	APPLYING: { label: "Aplicando", color: "bg-blue-50 text-blue-700" },
	COMPLETED: { label: "Completado", color: "bg-green-50 text-green-700" },
	APPLICATION_FAILED: {
		label: "Falló al aplicar",
		color: "bg-red-50 text-red-700",
	},
	REVIEW_REQUIRED: {
		label: "Requiere revisión",
		color: "bg-red-50 text-red-700",
	},
	CANCELLED: { label: "Cancelado", color: "bg-muted text-muted-foreground" },
};

type Link = {
	id: string;
	linkType: "CAPITAL" | "MORA_INTERES";
	status: string;
	paymentUrl: string | null;
	voucherUrl: string | null;
	paidAt: string | null;
	isApplicationSource: boolean;
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
	lastDispatchError: string | null;
	createdAt: string;
	readyToApplyAt: string | null;
	completedAt: string | null;
	creadoPor: string | null;
	links: Link[];
};

function LinkPagalo({ link, monto }: { link: Link; monto: string }) {
	const estado = getPagaloLinkStatusInfo(link.status);
	const puedeCopiar = estado.canCopy && Boolean(link.paymentUrl);

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
					<p className="text-muted-foreground text-sm">{q(monto)}</p>
				</div>
				<Badge className={estado.className}>{estado.label}</Badge>
			</div>
			{link.status === "PAID" && (
				<p className="mt-2 text-green-700 text-sm">
					Pagado: {fechaHora(link.paidAt)}
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

function GrupoPagalo({ grupo }: { grupo: Grupo }) {
	const estadoInfo = ESTADO_INFO[grupo.status] ?? {
		label: grupo.status,
		color: "bg-muted",
	};
	const resumenLinks = getPagaloGroupSummary(grupo.links);
	const moraEIntereses = facturableSinOtrosGTQ(
		grupo.facturableTotal,
		grupo.otrosTotal,
	);
	return (
		<div className="space-y-3 rounded-lg border p-4">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<CreditCard className="h-4 w-4 text-violet-600" />
					<span className="font-medium">
						Crédito {grupo.createdAt ? fechaHora(grupo.createdAt) : ""}
					</span>
					<Badge className={estadoInfo.color}>{estadoInfo.label}</Badge>
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
			{grupo.lastDispatchError && grupo.status !== "COMPLETED" && (
				<p className="text-red-700 text-sm">
					<XCircle className="mr-1 inline h-4 w-4" />
					{grupo.lastDispatchError}
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
					Historial Links de Pagos
				</h3>
				<span className="text-muted-foreground text-xs">
					{grupos.length} grupo(s)
				</span>
			</button>
			{expandido &&
				(historial.isLoading ? (
					<div className="py-4 text-center text-muted-foreground text-sm">
						Cargando historial Págalo…
					</div>
				) : (
					<div className="space-y-3">
						{grupos.map((grupo) => (
							<GrupoPagalo key={grupo.id} grupo={grupo} />
						))}
					</div>
				))}
		</div>
	);
}
