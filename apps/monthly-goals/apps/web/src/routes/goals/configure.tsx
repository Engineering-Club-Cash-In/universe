import { createFileRoute } from "@tanstack/react-router";
import { orpc } from "@/utils/orpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useState } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/error-handler";

export const Route = createFileRoute("/goals/configure")({
	component: GoalsConfigurePage,
});

function GoalsConfigurePage() {
	const queryClient = useQueryClient();
	const currentDate = new Date();
	const [selectedMonth, setSelectedMonth] = useState(currentDate.getMonth() + 1);
	const [selectedYear, setSelectedYear] = useState(currentDate.getFullYear());
	const [bulkGoals, setBulkGoals] = useState<any[]>([]);

	// Queries
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
				teamMemberId: "",
				goalTemplateId: "",
				targetValue: "",
				description: "",
			},
		]);
	};

	const updateGoalInList = (id: string, field: string, value: string) => {
		setBulkGoals(bulkGoals.map(goal =>
			goal.id === id ? { ...goal, [field]: value } : goal
		));
	};

	const removeGoalFromList = (id: string) => {
		setBulkGoals(bulkGoals.filter(goal => goal.id !== id));
	};

	const handleBulkSubmit = () => {
		const validGoals = bulkGoals.filter(goal =>
			goal.teamMemberId && goal.goalTemplateId && goal.targetValue
		);

		if (validGoals.length === 0) {
			toast.error("Agrega al menos una meta válida");
			return;
		}

		bulkCreateMutation.mutate({
			month: selectedMonth,
			year: selectedYear,
			goals: validGoals.map(({ id, ...goal }) => goal),
		});
	};

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-semibold">Configurar Metas Mensuales</h1>
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
						<CardTitle>Configurar Metas para {months.find(m => m.value === selectedMonth)?.label} {selectedYear}</CardTitle>
						<Button onClick={addGoalToList}>Agregar Meta</Button>
					</div>
				</CardHeader>
				<CardContent>
					{bulkGoals.length === 0 ? (
						<p className="text-gray-500 text-center py-8">
							No hay metas configuradas. Haz clic en "Agregar Meta" para empezar.
						</p>
					) : (
						<div className="space-y-4">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Empleado</TableHead>
										<TableHead>Template de Meta</TableHead>
										<TableHead>Objetivo</TableHead>
										<TableHead>Descripción</TableHead>
										<TableHead>Acciones</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{bulkGoals.map((goal) => (
										<TableRow key={goal.id}>
											<TableCell>
												<Select
													value={goal.teamMemberId}
													onValueChange={(value) => updateGoalInList(goal.id, "teamMemberId", value)}
												>
													<SelectTrigger>
														<SelectValue placeholder="Seleccionar empleado" />
													</SelectTrigger>
													<SelectContent>
														{teamMembers.isLoading ? (
															<SelectItem value="" disabled>
																Cargando empleados...
															</SelectItem>
														) : teamMembers.data?.map((member: any) => (
															<SelectItem key={member.id} value={member.id}>
																{member.userName} - {member.areaName}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											</TableCell>
											<TableCell>
												<Select
													value={goal.goalTemplateId}
													onValueChange={(value) => updateGoalInList(goal.id, "goalTemplateId", value)}
												>
													<SelectTrigger>
														<SelectValue placeholder="Seleccionar template" />
													</SelectTrigger>
													<SelectContent>
														{goalTemplates.isLoading ? (
															<SelectItem value="" disabled>
																Cargando templates...
															</SelectItem>
														) : goalTemplates.data?.map((template: any) => (
															<SelectItem key={template.id} value={template.id}>
																{template.name} ({template.unit || "unidades"})
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											</TableCell>
											<TableCell>
												<Input
													type="number"
													step="0.01"
													value={goal.targetValue}
													onChange={(e) => updateGoalInList(goal.id, "targetValue", e.target.value)}
													placeholder="Objetivo"
												/>
											</TableCell>
											<TableCell>
												<Textarea
													value={goal.description}
													onChange={(e) => updateGoalInList(goal.id, "description", e.target.value)}
													placeholder="Descripción opcional"
													className="min-h-[60px]"
												/>
											</TableCell>
											<TableCell>
												<Button
													variant="outline"
													size="sm"
													onClick={() => removeGoalFromList(goal.id)}
												>
													Eliminar
												</Button>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>

							<div className="flex justify-end">
								<Button
									onClick={handleBulkSubmit}
									disabled={bulkCreateMutation.isPending || bulkGoals.length === 0}
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
