import { createFileRoute } from "@tanstack/react-router";
import { orpc } from "@/utils/orpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, createSortableHeader, createFilterableHeader, createActionsColumn } from "@/components/ui/data-table";
import { Eye, Edit, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/error-handler";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/presentations/")({
	component: PresentationsIndexPage,
});

type Presentation = {
	id: string;
	name: string;
	startMonth: number;
	startYear: number;
	endMonth: number;
	endYear: number;
	status: string;
	createdByName: string | null;
	createdAt: Date;
};

type PresentationApiItem = {
	id: string;
	name: string;
	status: string;
	createdByName: string | null;
	createdAt: Date;
	startMonth?: number;
	startYear?: number;
	endMonth?: number;
	endYear?: number;
	month?: number;
	year?: number;
};

const months = [
	{ value: 1, label: "Enero" },
	{ value: 2, label: "Febrero" },
	{ value: 3, label: "Marzo" },
	{ value: 4, label: "Abril" },
	{ value: 5, label: "Mayo" },
	{ value: 6, label: "Junio" },
	{ value: 7, label: "Julio" },
	{ value: 8, label: "Agosto" },
	{ value: 9, label: "Septiembre" },
	{ value: 10, label: "Octubre" },
	{ value: 11, label: "Noviembre" },
	{ value: 12, label: "Diciembre" },
];

function getMonthLabel(month: number) {
	return months.find((m) => m.value === month)?.label ?? `Mes ${month}`;
}

function formatPresentationPeriodLabel(presentation: Presentation) {
	const startLabel = `${getMonthLabel(presentation.startMonth)} ${presentation.startYear}`;
	const endLabel = `${getMonthLabel(presentation.endMonth)} ${presentation.endYear}`;

	if (
		presentation.startMonth === presentation.endMonth &&
		presentation.startYear === presentation.endYear
	) {
		return startLabel;
	}

	return `${startLabel} - ${endLabel}`;
}

function normalizePresentation(presentation: PresentationApiItem): Presentation {
	if (
		presentation.startMonth == null ||
		presentation.startYear == null ||
		presentation.endMonth == null ||
		presentation.endYear == null
	) {
		throw new Error("Presentation API response is missing range fields");
	}

	return {
		id: presentation.id,
		name: presentation.name,
		startMonth: presentation.startMonth,
		startYear: presentation.startYear,
		endMonth: presentation.endMonth,
		endYear: presentation.endYear,
		status: presentation.status,
		createdByName: presentation.createdByName,
		createdAt: presentation.createdAt,
	};
}

function PresentationsIndexPage() {
	const queryClient = useQueryClient();
	const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
	const currentYear = new Date().getFullYear();
	const [startMonth, setStartMonth] = useState(String(new Date().getMonth() + 1));
	const [startYear, setStartYear] = useState(String(currentYear));
	const [endMonth, setEndMonth] = useState(String(new Date().getMonth() + 1));
	const [endYear, setEndYear] = useState(String(currentYear));

	// Queries
	const presentations = useQuery(orpc.presentations.list.queryOptions());

	// Mutations
	const createMutation = useMutation(
		orpc.presentations.create.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.presentations.list.key(),
				});
				setIsCreateDialogOpen(false);
				toast.success("Presentación creada exitosamente");
			},
			onError: (error) => {
				toast.error(getErrorMessage(error, "Error al crear presentación"));
			},
		})
	);

	const deleteMutation = useMutation(
		orpc.presentations.delete.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.presentations.list.key(),
				});
				toast.success("Presentación eliminada exitosamente");
			},
			onError: (error) => {
				toast.error(getErrorMessage(error, "Error al eliminar presentación"));
			},
		})
	);

	const handleCreateSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const formData = new FormData(e.currentTarget);
		const parsedStartMonth = parseInt(formData.get("startMonth") as string);
		const parsedStartYear = parseInt(formData.get("startYear") as string);
		const parsedEndMonth = parseInt(formData.get("endMonth") as string);
		const parsedEndYear = parseInt(formData.get("endYear") as string);
		const startPeriodValue = parsedStartYear * 12 + parsedStartMonth;
		const endPeriodValue = parsedEndYear * 12 + parsedEndMonth;

		if (endPeriodValue < startPeriodValue) {
			return;
		}

		const data = {
			name: formData.get("name") as string,
			startMonth: parsedStartMonth,
			startYear: parsedStartYear,
			endMonth: parsedEndMonth,
			endYear: parsedEndYear,
		};
		createMutation.mutate(data as never);
	};

	const handleDelete = (presentation: Presentation) => {
		if (confirm("¿Estás seguro de que quieres eliminar esta presentación?")) {
			deleteMutation.mutate({ id: presentation.id });
		}
	};

	const handleLoadData = (presentation: Presentation) => {
		window.location.href = `/presentations/${presentation.id}/submit`;
	};

	const handleViewPresentation = (presentation: Presentation) => {
		window.location.href = `/presentations/${presentation.id}/view`;
	};

	const getStatusBadge = (status: string) => {
		switch (status) {
			case "draft":
				return <Badge className="bg-gray-100 text-gray-800">Borrador</Badge>;
			case "ready":
				return <Badge className="bg-blue-100 text-blue-800">Lista</Badge>;
			case "presented":
				return <Badge className="bg-green-100 text-green-800">Presentada</Badge>;
			default:
				return <Badge className="bg-gray-100 text-gray-800">{status}</Badge>;
		}
	};

	const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);
	const startPeriodValue = parseInt(startYear) * 12 + parseInt(startMonth);
	const endPeriodValue = parseInt(endYear) * 12 + parseInt(endMonth);
	const periodError =
		endPeriodValue < startPeriodValue
			? "La fecha final no puede ser anterior a la fecha inicial."
			: null;

	// Definir columnas para TanStack Table
	const columns = useMemo<ColumnDef<Presentation>[]>(() => [
		{
			accessorKey: "name",
			header: createSortableHeader("Nombre"),
			cell: ({ row }) => (
				<div className="font-medium">{row.getValue("name")}</div>
			),
		},
		{
			id: "period",
			header: "Período",
			cell: ({ row }) => formatPresentationPeriodLabel(row.original),
		},
		{
			accessorKey: "status",
			header: createFilterableHeader("Estado", [
				{ label: "Borrador", value: "draft" },
				{ label: "Lista", value: "ready" },
				{ label: "Presentada", value: "presented" },
			]),
			cell: ({ row }) => getStatusBadge(row.getValue("status")),
			filterFn: (row, id, value) => {
				if (!value || value.length === 0) return true;
				return value.includes(row.getValue(id));
			},
		},
		{
			accessorKey: "createdByName",
			header: createSortableHeader("Creado por"),
			cell: ({ row }) => row.getValue("createdByName") || "—",
		},
		{
			accessorKey: "createdAt",
			header: createSortableHeader("Fecha de Creación"),
			cell: ({ row }) => {
				return new Date(row.getValue("createdAt")).toLocaleDateString("es-ES");
			},
		},
		createActionsColumn<Presentation>([
			{
				label: "Cargar Datos",
				icon: Edit,
				onClick: handleLoadData,
				show: (presentation) => presentation.status === "draft",
			},
			{
				label: "Ver Presentación",
				icon: Eye,
				onClick: handleViewPresentation,
				show: (presentation) => presentation.status === "ready",
			},
			{
				label: "Eliminar",
				icon: Trash2,
				onClick: handleDelete,
				variant: "destructive",
			},
		]),
	], []);
	const presentationRows = useMemo(
		() => (presentations.data || []).map(normalizePresentation),
		[presentations.data]
	);

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-semibold">Gestión de Presentaciones</h1>
				<Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
					<DialogTrigger asChild>
						<Button>Crear Presentación</Button>
					</DialogTrigger>
					<DialogContent className="space-y-6">
						<DialogHeader>
							<DialogTitle>Crear Nueva Presentación</DialogTitle>
						</DialogHeader>
						<form onSubmit={handleCreateSubmit} className="space-y-6">
							<div className="space-y-2">
								<Label htmlFor="name">Nombre de la Presentación</Label>
								<Input
									id="name"
									name="name"
									placeholder="ej: Reunión Mensual Agosto 2025"
									required
								/>
							</div>
							
							<div className="space-y-4">
								<div className="grid grid-cols-2 gap-4">
									<div className="space-y-2">
										<Label htmlFor="startMonth">Mes inicial</Label>
										<Select
											name="startMonth"
											value={startMonth}
											onValueChange={setStartMonth}
										>
											<SelectTrigger>
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{months.map((month) => (
													<SelectItem key={month.value} value={month.value.toString()}>
														{month.label}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>

									<div className="space-y-2">
										<Label htmlFor="startYear">Año inicial</Label>
										<Select
											name="startYear"
											value={startYear}
											onValueChange={setStartYear}
										>
											<SelectTrigger>
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{years.map((year) => (
													<SelectItem key={year} value={year.toString()}>
														{year}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>
								</div>

								<div className="grid grid-cols-2 gap-4">
									<div className="space-y-2">
										<Label htmlFor="endMonth">Mes final</Label>
										<Select
											name="endMonth"
											value={endMonth}
											onValueChange={setEndMonth}
										>
											<SelectTrigger>
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{months.map((month) => (
													<SelectItem key={month.value} value={month.value.toString()}>
														{month.label}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>

									<div className="space-y-2">
										<Label htmlFor="endYear">Año final</Label>
										<Select
											name="endYear"
											value={endYear}
											onValueChange={setEndYear}
										>
											<SelectTrigger>
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{years.map((year) => (
													<SelectItem key={year} value={year.toString()}>
														{year}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>
								</div>

								{periodError ? (
									<p className="text-sm text-destructive">{periodError}</p>
								) : null}
							</div>

							<Button
								type="submit"
								disabled={createMutation.isPending || Boolean(periodError)}
							>
								{createMutation.isPending ? "Creando..." : "Crear Presentación"}
							</Button>
						</form>
					</DialogContent>
				</Dialog>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Todas las Presentaciones</CardTitle>
				</CardHeader>
				<CardContent>
					<DataTable
						columns={columns}
						data={presentationRows}
						isLoading={presentations.isLoading}
						searchPlaceholder="Buscar presentaciones..."
						emptyMessage="No hay presentaciones creadas"
					/>
				</CardContent>
			</Card>
		</div>
	);
}
