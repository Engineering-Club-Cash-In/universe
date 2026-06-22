import type { ColumnDef } from "@tanstack/react-table";
import { ArrowUpDown, Calendar, Car, User } from "lucide-react";
import { WhatsappLogBadge } from "@/components/crm/WhatsappLogBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	formatDate,
	formatGuatemalaDate,
	formatGuatemalaDateTime,
	getLeadSourceBadgeClass,
	getSourceLabel,
	getStatusLabel,
} from "@/lib/crm-formatters";
import type { client } from "@/utils/orpc";

// Tipo inferido directamente del cliente ORPC - fuente única de verdad
export type Opportunity = Awaited<
	ReturnType<typeof client.getOpportunities>
>[number];

function getStatusBadgeColor(status: string): string {
	switch (status) {
		case "open":
			return "bg-blue-100 text-blue-800";
		case "won":
			return "bg-green-100 text-green-800";
		case "lost":
			return "bg-red-100 text-red-800";
		case "on_hold":
			return "bg-yellow-100 text-yellow-800";
		default:
			return "bg-gray-100 text-gray-800";
	}
}

function getStageBadgeStyle(closurePercentage: number): string {
	if (closurePercentage >= 80) return "bg-green-100 text-green-800";
	if (closurePercentage >= 50) return "bg-blue-100 text-blue-800";
	if (closurePercentage >= 30) return "bg-yellow-100 text-yellow-800";
	return "bg-gray-100 text-gray-800";
}

export const opportunitiesColumns: ColumnDef<Opportunity>[] = [
	{
		accessorKey: "title",
		header: ({ column }) => (
			<Button
				variant="ghost"
				onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
				aria-label="Ordenar por título"
			>
				Título
				<ArrowUpDown className="ml-2 h-4 w-4" aria-hidden="true" />
			</Button>
		),
		cell: ({ row }) => {
			const title = row.getValue("title") as string;
			const analysisStatus = row.original.analysisStatus;
			const closurePercentage = row.original.stage?.closurePercentage ?? 0;
			const leadId = row.original.lead?.id;

			return (
				<div className="flex flex-col gap-1">
					<span className="font-medium">{title}</span>
					{analysisStatus === "rejected" && (
						<Badge variant="destructive" className="w-fit text-xs">
							Análisis Rechazado
						</Badge>
					)}
					{analysisStatus === "resubmitted" && (
						<Badge
							variant="outline"
							className="w-fit border-blue-300 bg-blue-50 text-blue-700 text-xs"
						>
							Reenviado a Análisis
						</Badge>
					)}
					{closurePercentage === 85 && leadId && (
						<WhatsappLogBadge opportunityId={row.original.id} leadId={leadId} />
					)}
				</div>
			);
		},
	},
	{
		accessorKey: "lead",
		header: ({ column }) => (
			<Button
				variant="ghost"
				onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
				aria-label="Ordenar por cliente"
			>
				<User className="mr-2 h-4 w-4" aria-hidden="true" />
				Cliente
				<ArrowUpDown className="ml-2 h-4 w-4" aria-hidden="true" />
			</Button>
		),
		cell: ({ row }) => {
			const lead = row.original.lead;
			return lead ? (
				<span>
					{lead.firstName} {lead.lastName}
				</span>
			) : (
				<span className="text-muted-foreground">Sin cliente</span>
			);
		},
		sortingFn: (rowA, rowB) => {
			const a = rowA.original.lead;
			const b = rowB.original.lead;
			if (!a && !b) return 0;
			if (!a) return 1;
			if (!b) return -1;
			return `${a.firstName} ${a.lastName}`.localeCompare(
				`${b.firstName} ${b.lastName}`,
			);
		},
	},
	{
		accessorKey: "stage",
		header: ({ column }) => (
			<Button
				variant="ghost"
				onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
				aria-label="Ordenar por etapa"
			>
				Etapa
				<ArrowUpDown className="ml-2 h-4 w-4" aria-hidden="true" />
			</Button>
		),
		cell: ({ row }) => {
			const stage = row.original.stage;
			return stage ? (
				<Badge className={getStageBadgeStyle(stage.closurePercentage)}>
					{stage.closurePercentage}% - {stage.name}
				</Badge>
			) : (
				<span className="text-muted-foreground">Sin etapa</span>
			);
		},
		sortingFn: (rowA, rowB) => {
			const a = rowA.original.stage?.closurePercentage ?? 0;
			const b = rowB.original.stage?.closurePercentage ?? 0;
			return a - b;
		},
	},
	{
		accessorKey: "source",
		header: "Canal",
		cell: ({ row }) => {
			const source = row.original.source;
			if (!source) return <span className="text-muted-foreground">—</span>;
			return (
				<Badge className={getLeadSourceBadgeClass(source)} variant="outline">
					{getSourceLabel(source)}
				</Badge>
			);
		},
	},
	{
		accessorKey: "creditType",
		header: "Tipo de Crédito",
		cell: ({ row }) => {
			const creditType = row.original.creditType;
			const label =
				creditType === "sobre_vehiculo" ? "Sobre Vehículo" : "Autocompra";
			const className =
				creditType === "sobre_vehiculo"
					? "bg-purple-100 text-purple-800"
					: "bg-sky-100 text-sky-800";
			return (
				<Badge className={className} variant="outline">
					{label}
				</Badge>
			);
		},
	},
	{
		accessorKey: "value",
		header: ({ column }) => (
			<Button
				variant="ghost"
				onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
				aria-label="Ordenar por valor"
			>
				Valor
				<ArrowUpDown className="ml-2 h-4 w-4" aria-hidden="true" />
			</Button>
		),
		cell: ({ row }) => {
			const value = row.getValue("value") as string | null;
			const numericValue = value ? Number.parseFloat(value) : null;
			return numericValue !== null ? (
				<span className="font-medium text-green-600 tabular-nums">
					Q
					{numericValue.toLocaleString("es-GT", {
						minimumFractionDigits: 2,
						maximumFractionDigits: 2,
					})}
				</span>
			) : (
				<span className="text-muted-foreground">—</span>
			);
		},
		sortingFn: (rowA, rowB) => {
			const a = Number.parseFloat(rowA.getValue("value") ?? "0") || 0;
			const b = Number.parseFloat(rowB.getValue("value") ?? "0") || 0;
			return a - b;
		},
	},
	{
		accessorKey: "vehicle",
		header: () => (
			<span className="flex items-center gap-2">
				<Car className="h-4 w-4" aria-hidden="true" />
				Vehículo
			</span>
		),
		cell: ({ row }) => {
			const vehicle = row.original.vehicle;
			return vehicle ? (
				<span className="text-sm">
					{vehicle.year} {vehicle.make} {vehicle.model}
				</span>
			) : (
				<span className="text-muted-foreground">Sin vehículo</span>
			);
		},
	},
	{
		accessorKey: "status",
		header: "Estado",
		cell: ({ row }) => {
			const status = row.getValue("status") as string;
			return (
				<Badge className={getStatusBadgeColor(status)} variant="outline">
					{getStatusLabel(status)}
				</Badge>
			);
		},
		filterFn: (row, id, value) => {
			return value === "all" || row.getValue(id) === value;
		},
	},
	{
		accessorKey: "probability",
		header: ({ column }) => (
			<Button
				variant="ghost"
				onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
				aria-label="Ordenar por probabilidad"
			>
				Prob.
				<ArrowUpDown className="ml-2 h-4 w-4" aria-hidden="true" />
			</Button>
		),
		cell: ({ row }) => {
			const probability = row.getValue("probability") as number | null;
			const stage = row.original.stage;
			const displayValue = probability ?? stage?.closurePercentage ?? 0;
			return <span className="tabular-nums">{displayValue}%</span>;
		},
	},
	{
		accessorKey: "assignedUser",
		header: "Asignado a",
		cell: ({ row }) => {
			const user = row.original.assignedUser;
			return user ? (
				<span className="text-sm">{user.name}</span>
			) : (
				<span className="text-muted-foreground">Sin asignar</span>
			);
		},
	},
	{
		accessorKey: "expectedCloseDate",
		header: ({ column }) => (
			<Button
				variant="ghost"
				onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
				aria-label="Ordenar por fecha estimada de cierre"
			>
				<Calendar className="mr-2 h-4 w-4" aria-hidden="true" />
				Cierre Est.
				<ArrowUpDown className="ml-2 h-4 w-4" aria-hidden="true" />
			</Button>
		),
		cell: ({ row }) => {
			const date = row.getValue("expectedCloseDate") as Date | string | null;
			return date ? (
				<span className="text-sm">{formatDate(date)}</span>
			) : (
				<span className="text-muted-foreground">—</span>
			);
		},
	},
	{
		accessorKey: "createdAt",
		header: ({ column }) => (
			<Button
				variant="ghost"
				onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
				aria-label="Ordenar por fecha de creación"
			>
				Creada
				<ArrowUpDown className="ml-2 h-4 w-4" aria-hidden="true" />
			</Button>
		),
		cell: ({ row }) => {
			const date = row.getValue("createdAt") as Date | string;
			return <span className="text-sm">{formatGuatemalaDateTime(date)}</span>;
		},
	},
];
