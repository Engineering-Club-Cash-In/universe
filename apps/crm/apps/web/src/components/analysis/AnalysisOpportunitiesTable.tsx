import { CheckCircle, FileText, RefreshCw, XCircle } from "lucide-react";
import type * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { client } from "@/utils/orpc";

/**
 * Tabla «Oportunidades Pendientes de Análisis» (/crm/analysis, tab Análisis).
 *
 * Solo presentación: la ruta trae los datos, abre los modales y decide si se
 * puede aprobar (`OpportunityActions` consulta documentos y checklist y pinta
 * `OpportunityActionsView`).
 *
 * Sin scroll horizontal: desde `xl` es una tabla de ancho fijo
 * (`table-fixed`) con columnas agrupadas —título con su ID, lead con su
 * correo, valor con la empresa— y textos que hacen salto de línea o se cortan
 * con elipsis y tooltip. Por debajo de `xl` cada oportunidad es una tarjeta.
 */

export type OpportunityForAnalysis = Awaited<
	ReturnType<typeof client.getOpportunitiesForAnalysis>
>["data"][0];

type Layout = "compact" | "full";

const formatoValor = (value: string | number) =>
	`Q${Number(value).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Texto de una línea: se corta con elipsis y el tooltip muestra el texto completo. */
function TextoRecortado({
	children,
	className,
}: {
	children: string;
	className?: string;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span className={cn("block min-w-0 truncate", className)}>
					{children}
				</span>
			</TooltipTrigger>
			<TooltipContent className="max-w-xs break-all">{children}</TooltipContent>
		</Tooltip>
	);
}

function EstadoAnalisis({
	opportunity,
}: {
	opportunity: OpportunityForAnalysis;
}) {
	return opportunity.analysisStatus === "resubmitted" ? (
		<Badge variant="warning">
			<RefreshCw />
			Reenviado ({opportunity.analysisRejectionCount}x)
		</Badge>
	) : (
		<Badge variant="success">Nueva</Badge>
	);
}

function TituloOportunidad({
	opportunity,
	onOpen,
}: {
	opportunity: OpportunityForAnalysis;
	onOpen: () => void;
}) {
	return (
		<div className="min-w-0 space-y-0.5">
			<button
				type="button"
				className="wrap-break-word cursor-pointer text-left font-semibold text-brand hover:underline"
				onClick={onOpen}
			>
				{opportunity.title}
			</button>
			<p className="font-mono text-[10px] text-fg-tertiary">
				ID: {opportunity.id.slice(0, 8)}
			</p>
		</div>
	);
}

function LeadOportunidad({
	opportunity,
	onOpen,
}: {
	opportunity: OpportunityForAnalysis;
	onOpen: () => void;
}) {
	if (!opportunity.lead) {
		return <span className="text-fg-tertiary">Sin lead</span>;
	}
	return (
		<div className="min-w-0 space-y-0.5">
			<button
				type="button"
				className="wrap-break-word cursor-pointer text-left font-medium text-brand hover:underline"
				onClick={onOpen}
			>
				{opportunity.lead.firstName} {opportunity.lead.lastName}
			</button>
			{opportunity.lead.email && (
				<TextoRecortado className="text-fg-secondary text-xs">
					{opportunity.lead.email}
				</TextoRecortado>
			)}
		</div>
	);
}

/** Valor como dato principal y la empresa como subtítulo. */
function ValorEmpresa({
	opportunity,
}: {
	opportunity: OpportunityForAnalysis;
}) {
	return (
		<div className="min-w-0 space-y-0.5">
			{opportunity.value ? (
				<p className="font-semibold tabular-nums">
					{formatoValor(opportunity.value)}
				</p>
			) : (
				<p className="text-fg-tertiary">Sin valor</p>
			)}
			{opportunity.company?.name ? (
				<TextoRecortado className="text-fg-secondary text-xs">
					{opportunity.company.name}
				</TextoRecortado>
			) : (
				<p className="text-fg-tertiary text-xs">Sin empresa</p>
			)}
		</div>
	);
}

function FechaEsperada({
	opportunity,
}: {
	opportunity: OpportunityForAnalysis;
}) {
	return opportunity.expectedCloseDate ? (
		<span className="tabular-nums">
			{new Date(opportunity.expectedCloseDate).toLocaleDateString("es-GT")}
		</span>
	) : (
		<span className="text-fg-tertiary">Sin fecha</span>
	);
}

/**
 * Botones de una oportunidad. «Ver Documentos» es la acción principal;
 * Aprobar y Rechazar son del mismo nivel y van con el mismo estilo.
 *   compact → tabla: Aprobar y Rechazar como íconos con tooltip.
 *   full    → tarjeta: los tres con texto.
 * Aprobar deshabilitado muestra en el tooltip por qué (`disabledReason`).
 */
export function OpportunityActionsView({
	canApprove,
	isLoading,
	disabledReason,
	onApprove,
	onReject,
	onViewDocuments,
	layout = "compact",
}: {
	canApprove: boolean;
	isLoading: boolean;
	disabledReason?: string;
	onApprove: () => void;
	onReject: () => void;
	onViewDocuments: () => void;
	layout?: Layout;
}) {
	const compacto = layout === "compact";
	const motivoVisible = !canApprove && !isLoading;

	return (
		<div
			className={cn(
				"flex items-center gap-2",
				compacto ? "justify-end" : "flex-wrap",
			)}
		>
			<Button
				size="sm"
				variant="default"
				onClick={onViewDocuments}
				className={cn(!compacto && "w-full sm:w-auto sm:flex-1")}
			>
				<FileText />
				Ver Documentos
			</Button>
			<Tooltip>
				<TooltipTrigger asChild>
					<span className={cn("inline-flex", !compacto && "flex-1")}>
						<Button
							size={compacto ? "icon-sm" : "sm"}
							variant="outline"
							onClick={onApprove}
							disabled={!canApprove || isLoading}
							aria-label="Aprobar"
							className={cn(!compacto && "w-full")}
						>
							<CheckCircle className="text-success-solid" />
							{!compacto && "Aprobar"}
						</Button>
					</span>
				</TooltipTrigger>
				{motivoVisible ? (
					<TooltipContent className="max-w-xs whitespace-pre-line">
						<p className="mb-1 font-semibold">No se puede aprobar:</p>
						<p className="text-sm">{disabledReason}</p>
					</TooltipContent>
				) : (
					compacto && <TooltipContent>Aprobar</TooltipContent>
				)}
			</Tooltip>
			<Tooltip>
				<TooltipTrigger asChild>
					<span className={cn("inline-flex", !compacto && "flex-1")}>
						<Button
							size={compacto ? "icon-sm" : "sm"}
							variant="outline"
							onClick={onReject}
							aria-label="Rechazar"
							className={cn(!compacto && "w-full")}
						>
							<XCircle className="text-danger-solid" />
							{!compacto && "Rechazar"}
						</Button>
					</span>
				</TooltipTrigger>
				{compacto && <TooltipContent>Rechazar</TooltipContent>}
			</Tooltip>
		</div>
	);
}

export function AnalysisOpportunitiesTable({
	opportunities,
	onOpenOpportunity,
	onOpenLead,
	renderActions,
}: {
	opportunities: OpportunityForAnalysis[];
	onOpenOpportunity: (opportunity: OpportunityForAnalysis) => void;
	onOpenLead: (opportunity: OpportunityForAnalysis) => void;
	renderActions: (
		opportunity: OpportunityForAnalysis,
		layout: Layout,
	) => React.ReactNode;
}) {
	return (
		<>
			{/* Escritorio: tabla de ancho fijo, sin scroll horizontal. */}
			<div className="hidden overflow-hidden rounded-xl border border-line-subtle xl:block">
				<Table className="table-fixed">
					<TableHeader>
						<TableRow>
							<TableHead>Título</TableHead>
							<TableHead className="w-36">Estado</TableHead>
							<TableHead className="w-[22%]">Lead</TableHead>
							<TableHead className="w-40">Valor / Empresa</TableHead>
							<TableHead className="w-28">Fecha Esperada</TableHead>
							<TableHead className="w-72 text-right">Acciones</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{opportunities.map((opportunity) => (
							<TableRow key={opportunity.id}>
								<TableCell className="whitespace-normal py-3">
									<TituloOportunidad
										opportunity={opportunity}
										onOpen={() => onOpenOpportunity(opportunity)}
									/>
								</TableCell>
								<TableCell className="whitespace-normal">
									<EstadoAnalisis opportunity={opportunity} />
								</TableCell>
								<TableCell className="whitespace-normal py-3">
									<LeadOportunidad
										opportunity={opportunity}
										onOpen={() => onOpenLead(opportunity)}
									/>
								</TableCell>
								<TableCell className="whitespace-normal py-3">
									<ValorEmpresa opportunity={opportunity} />
								</TableCell>
								<TableCell>
									<FechaEsperada opportunity={opportunity} />
								</TableCell>
								<TableCell>{renderActions(opportunity, "compact")}</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>

			{/* Tablet y celular: una tarjeta por oportunidad. */}
			<ul className="grid gap-3 md:grid-cols-2 xl:hidden">
				{opportunities.map((opportunity) => (
					<li
						key={opportunity.id}
						className="flex min-w-0 flex-col gap-3 rounded-xl border border-line-subtle bg-surface p-4 text-[13px]"
					>
						<div className="flex items-start justify-between gap-3">
							<TituloOportunidad
								opportunity={opportunity}
								onOpen={() => onOpenOpportunity(opportunity)}
							/>
							<EstadoAnalisis opportunity={opportunity} />
						</div>
						<dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
							<div className="col-span-2 min-w-0">
								<dt className="type-label-sm text-fg-tertiary uppercase">
									Lead
								</dt>
								<dd className="mt-0.5 min-w-0">
									<LeadOportunidad
										opportunity={opportunity}
										onOpen={() => onOpenLead(opportunity)}
									/>
								</dd>
							</div>
							<div className="min-w-0">
								<dt className="type-label-sm text-fg-tertiary uppercase">
									Valor / Empresa
								</dt>
								<dd className="mt-0.5 min-w-0">
									<ValorEmpresa opportunity={opportunity} />
								</dd>
							</div>
							<div className="min-w-0">
								<dt className="type-label-sm text-fg-tertiary uppercase">
									Fecha Esperada
								</dt>
								<dd className="mt-0.5">
									<FechaEsperada opportunity={opportunity} />
								</dd>
							</div>
						</dl>
						<div className="border-line-subtle border-t pt-3">
							{renderActions(opportunity, "full")}
						</div>
					</li>
				))}
			</ul>
		</>
	);
}
