import { createFileRoute } from "@tanstack/react-router";
import { orpc } from "@/utils/orpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, createActionsColumn } from "@/components/ui/data-table";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	SearchableSelect,
	SearchableSelectTrigger,
	SearchableSelectContent,
	SearchableSelectValue,
	SearchableSelectItem,
} from "@/components/ui/searchable-select";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/error-handler";

export const Route = createFileRoute("/goals/configure")({
	component: GoalsConfigurePage,
});

type BulkGoal = {
	id: string;
	areaId: string;
	teamMemberId: string;
	goalTemplateId: string;
	targetValue: string;
	description: string;
};

function GoalsConfigurePage() {
	const queryClient = useQueryClient();
	const currentDate = new Date();
	const [selectedMonth, setSelectedMonth] = useState(currentDate.getMonth() + 1);
	const [selectedYear, setSelectedYear] = useState(currentDate.getFullYear());
	const [bulkGoals, setBulkGoals] = useState<BulkGoal[]>([]);

	// Queries
	const areas = useQuery(orpc.areas.list.queryOptions());
	const teamMembers = useQuery(orpc.teams.list.queryOptions());
	const goalTemplates = useQuery(orpc.goalTemplates.list.queryOptions());

	// Mutations
	const bulkCreateMutation = useMutation(
		orpc.monthlyGoals.bulkCreate.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.monthlyGoals.list.key(),
				});
				setBulkGoals([]);
				toast.success("Metas creadas exitosamente");
			},
			onError: (error) => {
				toast.error(getErrorMessage(error, "Error al crear metas"));
			},
		})
	);

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

	const years = Array.from({ length: 5 }, (_, i) => currentDate.getFullYear() - 2 + i);

	const addGoalToList = () => {
		setBulkGoals([
			...bulkGoals,
			{
				id: crypto.randomUUID(),
				areaId: "",
				teamMemberId: "",
				goalTemplateId: "",
				targetValue: "",
				description: "",
			},
		]);
	};
const updateGoalInList = (id: string, field: string, value: string) => {
  setBulkGoals(prevGoals =>
    prevGoals.map(goal =>
      goal.id === id ? { ...goal, [field]: value } : goal
    )
  );
};
	const removeGoalFromList = (id: string) => {
		setBulkGoals(bulkGoals.filter(goal => goal.id !== id));
	};

	const handleBulkSubmit = () => {
		const validGoals = bulkGoals.filter(goal =>
			goal.areaId && goal.teamMemberId && goal.goalTemplateId && goal.targetValue
		);

		if (validGoals.length === 0) {
			toast.error("Agrega al menos una meta válida");
			return;
		}

		bulkCreateMutation.mutate({
			month: selectedMonth,
			year: selectedYear,
			goals: validGoals.map(({ id, areaId, ...goal }) => goal),
		});
	};

	// Definir columnas para TanStack Table
	const columns = useMemo<ColumnDef<BulkGoal>[]>(() => [
		{
			accessorKey: "areaId",
			header: "Área",
			cell: ({ row }) => {
				const goal = row.original;
				return (
					<SearchableSelect
						value={goal.areaId}
						onValueChange={(value) => {
							updateGoalInList(goal.id, "areaId", value);
							// Reset team member when area changes
							updateGoalInList(goal.id, "teamMemberId", "");
						}}
					>
						<SearchableSelectTrigger className="w-[200px] h-auto min-h-9 whitespace-normal">
							<SearchableSelectValue placeholder="Seleccionar área" />
						</SearchableSelectTrigger>
						<SearchableSelectContent searchPlaceholder="Buscar área...">
							{areas.isLoading ? (
								<div className="py-6 text-center text-sm text-muted-foreground">
									Cargando áreas...
								</div>
							) : areas.data?.map((area: any) => (
								<SearchableSelectItem
									key={area.id}
									value={area.id}
									searchValue={area.name}
								>
									{area.name}
								</SearchableSelectItem>
							))}
						</SearchableSelectContent>
					</SearchableSelect>
				);
			},
		},
		{
			accessorKey: "teamMemberId",
			header: "Empleado",
			cell: ({ row }) => {
				const goal = row.original;
				// Filter team members by selected area
				const filteredMembers = goal.areaId
					? (teamMembers.data?.filter((member: any) => member.areaId === goal.areaId) || [])
					: [];

				return (
					<SearchableSelect
						value={goal.teamMemberId}
						onValueChange={(value) => updateGoalInList(goal.id, "teamMemberId", value)}
						disabled={!goal.areaId}
					>
						<SearchableSelectTrigger className="w-[200px] h-auto min-h-9 whitespace-normal">
							<SearchableSelectValue placeholder={
								!goal.areaId
									? "Primero selecciona área"
									: "Seleccionar empleado"
							} />
						</SearchableSelectTrigger>
						<SearchableSelectContent searchPlaceholder="Buscar empleado...">
							{teamMembers.isLoading ? (
								<div className="py-6 text-center text-sm text-muted-foreground">
									Cargando empleados...
								</div>
							) : filteredMembers.length === 0 ? (
								<div className="py-6 text-center text-sm text-muted-foreground">
									No hay empleados en esta área
								</div>
							) : filteredMembers.map((member: any) => (
								<SearchableSelectItem
									key={member.id}
									value={member.id}
									searchValue={member.userName}
								>
									{member.userName}
								</SearchableSelectItem>
							))}
						</SearchableSelectContent>
					</SearchableSelect>
				);
			},
		},
		{
			accessorKey: "goalTemplateId",
			header: "Template de Meta",
			cell: ({ row }) => {
				const goal = row.original;
				return (
					<SearchableSelect
						value={goal.goalTemplateId}
						onValueChange={(value) => {
							updateGoalInList(goal.id, "goalTemplateId", value);
							// Set default target if objective is empty
							const selectedTemplate = goalTemplates.data?.find((t: any) => t.id === value);
							if (selectedTemplate?.defaultTarget) {
								updateGoalInList(goal.id, "targetValue", selectedTemplate.defaultTarget);
							}
						}}
					>
						<SearchableSelectTrigger className="w-[250px] h-auto min-h-9 whitespace-normal">
							<SearchableSelectValue placeholder="Seleccionar template" />
						</SearchableSelectTrigger>
						<SearchableSelectContent searchPlaceholder="Buscar template...">
							{goalTemplates.isLoading ? (
								<div className="py-6 text-center text-sm text-muted-foreground">
									Cargando templates...
								</div>
							) : goalTemplates.data?.map((template: any) => (
								<SearchableSelectItem
									key={template.id}
									value={template.id}
									searchValue={`${template.name} ${template.unit || "unidades"}`}
								>
									{template.name} ({template.unit || "unidades"})
								</SearchableSelectItem>
							))}
						</SearchableSelectContent>
					</SearchableSelect>
				);
			},
		},
		{
			accessorKey: "targetValue",
			header: "Objetivo",
			cell: ({ row }) => {
				const goal = row.original;
				return (
					<Input
						type="number"
						step="0.01"
						value={goal.targetValue}
						onChange={(e) => updateGoalInList(goal.id, "targetValue", e.target.value)}
						onFocus={(e) => e.target.select()}
						placeholder="Objetivo"
					/>
				);
			},
		},
		{
			accessorKey: "description",
			header: "Descripción",
			cell: ({ row }) => {
				const goal = row.original;
				return (
					<Textarea
						value={goal.description}
						onChange={(e) => updateGoalInList(goal.id, "description", e.target.value)}
						placeholder="Descripción opcional"
						className="min-h-[60px]"
					/>
				);
			},
		},
		createActionsColumn<BulkGoal>([
			{
				label: "Eliminar",
				icon: Trash2,
				onClick: (goal) => removeGoalFromList(goal.id),
				variant: "destructive",
			},
		]),
	], [areas.data, teamMembers.data, goalTemplates.data]);

	return (
		<div className="space-y-6">
			<div className="space-y-2">
				<h1 className="text-2xl font-semibold">Asignar Metas Mensuales</h1>
				<p className="text-gray-600 dark:text-gray-400">
					Crea y asigna metas mensuales a los empleados. Selecciona el período, agrega las metas con sus objetivos y guárdalas todas de una vez.
				</p>
			</div>

			{/* Period Selection */}
			<Card>
				<CardHeader>
					<CardTitle>Seleccionar Período</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="flex items-center space-x-4">
						<div className="flex flex-col gap-4">
							<Label>Mes</Label>
							<Select
								value={selectedMonth.toString()}
								onValueChange={(value) => setSelectedMonth(parseInt(value))}
							>
								<SelectTrigger className="w-40">
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

						<div className="flex flex-col gap-4">
							<Label>Año</Label>
							<Select
								value={selectedYear.toString()}
								onValueChange={(value) => setSelectedYear(parseInt(value))}
							>
								<SelectTrigger className="w-24">
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
				</CardContent>
			</Card>

			{/* Bulk Goal Configuration */}
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle>Metas para {months.find(m => m.value === selectedMonth)?.label} {selectedYear}</CardTitle>
							<p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
								{bulkGoals.length === 0 ? "No hay metas agregadas" : `${bulkGoals.length} meta(s) configurada(s)`}
							</p>
						</div>
						<Button onClick={addGoalToList}>+ Agregar Meta</Button>
					</div>
				</CardHeader>
				<CardContent>
					{bulkGoals.length === 0 ? (
						<div className="text-center py-12 bg-gray-50 dark:bg-gray-900 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700">
							<p className="text-gray-500 dark:text-gray-400 mb-2">No hay metas agregadas</p>
							<p className="text-sm text-gray-400 dark:text-gray-500">Haz clic en "Agregar Meta" para comenzar</p>
						</div>
					) : (
						<div className="space-y-4">
							<DataTable
								columns={columns}
								data={bulkGoals}
								searchPlaceholder="Buscar metas configuradas..."
								emptyMessage="No hay metas configuradas"
							/>

							<div className="flex items-center justify-between pt-4 border-t dark:border-gray-700">
								<p className="text-sm text-gray-600 dark:text-gray-400">
									Se crearán {bulkGoals.filter(g => g.areaId && g.teamMemberId && g.goalTemplateId && g.targetValue).length} meta(s) válida(s)
								</p>
								<Button
									onClick={handleBulkSubmit}
									disabled={bulkCreateMutation.isPending || bulkGoals.length === 0}
									size="lg"
								>
									{bulkCreateMutation.isPending ? "Creando metas..." : "Crear Todas las Metas"}
								</Button>
							</div>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
