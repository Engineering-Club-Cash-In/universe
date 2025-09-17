import { createFileRoute } from "@tanstack/react-router";
import { orpc } from "@/utils/orpc";
import { authClient } from "@/lib/auth-client";
import { usePermissions } from "@/lib/permissions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, createSortableHeader, createFilterableHeader, createActionsColumn } from "@/components/ui/data-table";
import { Edit } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/error-handler";

export const Route = createFileRoute("/goals/my-goals")({
	component: MyGoalsPage,
});

function MyGoalsPage() {
	const { data: session } = authClient.useSession();
	const { canEditGoals } = usePermissions();
	const queryClient = useQueryClient();
	const currentDate = new Date();
	const [selectedMonth, setSelectedMonth] = useState(currentDate.getMonth() + 1);
	const [selectedYear, setSelectedYear] = useState(currentDate.getFullYear());
	const [isUpdateDialogOpen, setIsUpdateDialogOpen] = useState(false);
	const [updatingGoal, setUpdatingGoal] = useState<any>(null);

	// Queries - Get goals filtered by role on server side
	const myGoals = useQuery(
		orpc.monthlyGoals.my.queryOptions({
			input: {
				month: selectedMonth,
				year: selectedYear,
			}
		})
	);

	// Mutations
	const updateMutation = useMutation(
		orpc.monthlyGoals.update.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.monthlyGoals.my.key(),
				});
				queryClient.invalidateQueries({
					queryKey: orpc.monthlyGoals.list.key(),
				});
				setIsUpdateDialogOpen(false);
				setUpdatingGoal(null);
				toast.success("Meta actualizada exitosamente");
			},
			onError: (error) => {
				toast.error(getErrorMessage(error, "Error al actualizar meta"));
			},
		})
	);

	const handleUpdateSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const formData = new FormData(e.currentTarget);
		const data = {
			achievedValue: formData.get("achievedValue") as string,
			description: formData.get("description") as string,
			status: formData.get("status") as "pending" | "in_progress" | "completed",
		};
		updateMutation.mutate({
			id: updatingGoal.id,
			data,
		});
	};

	const handleUpdate = (goal: any) => {
		setUpdatingGoal(goal);
		setIsUpdateDialogOpen(true);
	};

	const getStatusBadge = (percentage: number, successThreshold: string, warningThreshold: string) => {
		const success = parseFloat(successThreshold || "80");
		const warning = parseFloat(warningThreshold || "50");

		if (percentage >= success) {
			return <Badge className="bg-green-100 text-green-800">Exitoso</Badge>;
		} else if (percentage >= warning) {
			return <Badge className="bg-yellow-100 text-yellow-800">En Progreso</Badge>;
		} else {
			return <Badge className="bg-red-100 text-red-800">Necesita Atención</Badge>;
		}
	};

	const getStatusText = (percentage: number, successThreshold: string, warningThreshold: string) => {
		const success = parseFloat(successThreshold || "80");
		const warning = parseFloat(warningThreshold || "50");
		
		if (percentage >= success) return "exitoso";
		else if (percentage >= warning) return "en_progreso";
		else return "necesita_atencion";
	};

	// Definir columnas para TanStack Table
	const columns = useMemo<ColumnDef<any>[]>(() => [
		{
			accessorKey: "userName",
			header: createSortableHeader("Empleado"),
			cell: ({ row }) => (
				<div>
					<div className="font-medium">{row.getValue("userName")}</div>
					<div className="text-sm text-gray-500">
						{row.original.areaName} - {row.original.departmentName}
					</div>
				</div>
			),
		},
		{
			accessorKey: "goalTemplateName",
			header: createSortableHeader("Meta"),
			cell: ({ row }) => (
				<div>
					<div className="font-medium">{row.getValue("goalTemplateName")}</div>
					{row.original.goalTemplateUnit && (
						<div className="text-sm text-gray-500">{row.original.goalTemplateUnit}</div>
					)}
				</div>
			),
		},
		{
			accessorKey: "targetValue",
			header: createSortableHeader("Objetivo"),
			cell: ({ row }) => parseFloat(row.getValue("targetValue")).toLocaleString(),
		},
		{
			accessorKey: "achievedValue", 
			header: createSortableHeader("Logrado"),
			cell: ({ row }) => parseFloat(row.getValue("achievedValue")).toLocaleString(),
		},
		{
			id: "progress",
			header: "Progreso",
			cell: ({ row }) => {
				const target = parseFloat(row.original.targetValue);
				const achieved = parseFloat(row.original.achievedValue);
				const percentage = target > 0 ? (achieved / target) * 100 : 0;
				
				return (
					<div className="space-y-2">
						<Progress value={Math.min(percentage, 100)} className="w-[60px]" />
						<span className="text-sm font-medium">{Math.round(percentage)}%</span>
					</div>
				);
			},
		},
		{
			id: "status",
			header: createFilterableHeader("Estado", [
				{ label: "Exitoso", value: "exitoso" },
				{ label: "En Progreso", value: "en_progreso" },
				{ label: "Necesita Atención", value: "necesita_atencion" },
			]),
			cell: ({ row }) => {
				const target = parseFloat(row.original.targetValue);
				const achieved = parseFloat(row.original.achievedValue);
				const percentage = target > 0 ? (achieved / target) * 100 : 0;
				
				return getStatusBadge(percentage, row.original.successThreshold, row.original.warningThreshold);
			},
			filterFn: (row, id, value) => {
				if (!value || value.length === 0) return true;
				
				const target = parseFloat(row.original.targetValue);
				const achieved = parseFloat(row.original.achievedValue);
				const percentage = target > 0 ? (achieved / target) * 100 : 0;
				const status = getStatusText(percentage, row.original.successThreshold, row.original.warningThreshold);
				
				return value.includes(status);
			},
		},
		createActionsColumn<any>([
			{
				label: "Actualizar",
				icon: Edit,
				onClick: handleUpdate,
				show: (goal) => {
					return canEditGoals && (
						["super_admin", "department_manager", "area_lead"].includes(session?.user?.role || "") ||
						goal.userEmail === session?.user?.email
					);
				},
			},
		]),
	], [canEditGoals, session]);

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

	// Goals are already filtered by role on the server side
	const userGoals = myGoals.data || [];

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-semibold">Mis Metas</h1>
				
				<div className="flex items-end gap-4">
					<div className="space-y-2">
						<Label className="text-sm font-medium text-gray-700">Mes</Label>
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

					<div className="space-y-2">
						<Label className="text-sm font-medium text-gray-700">Año</Label>
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
			</div>

			<Card>
				<CardHeader>
					<CardTitle>
						Metas para {months.find(m => m.value === selectedMonth)?.label} {selectedYear}
					</CardTitle>
				</CardHeader>
				<CardContent>
					<DataTable
						columns={columns}
						data={userGoals}
						isLoading={myGoals.isLoading}
						searchPlaceholder="Buscar metas..."
						emptyMessage="No tienes metas configuradas para este período"
					/>
				</CardContent>
			</Card>

			{/* Update Goal Dialog */}
			<Dialog open={isUpdateDialogOpen} onOpenChange={setIsUpdateDialogOpen}>
				<DialogContent className="space-y-6">
					<DialogHeader>
						<DialogTitle>Actualizar Meta: {updatingGoal?.goalTemplateName}</DialogTitle>
					</DialogHeader>
					<form onSubmit={handleUpdateSubmit} className="space-y-6">
						<div className="bg-gray-50 p-4 rounded-md">
							<div className="text-sm text-gray-600">
								<strong>Objetivo:</strong> {updatingGoal?.targetValue} {updatingGoal?.goalTemplateUnit || "unidades"}
							</div>
							<div className="text-sm text-gray-600">
								<strong>Actual:</strong> {updatingGoal?.achievedValue} {updatingGoal?.goalTemplateUnit || "unidades"}
							</div>
						</div>
						
						<div className="space-y-2">
							<Label htmlFor="achievedValue">Valor Logrado</Label>
							<Input
								id="achievedValue"
								name="achievedValue"
								type="number"
								step="0.01"
								defaultValue={updatingGoal?.achievedValue}
								required
							/>
						</div>
						
						<div className="space-y-2">
							<Label htmlFor="status">Estado</Label>
							<Select name="status" defaultValue={updatingGoal?.status}>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="pending">Pendiente</SelectItem>
									<SelectItem value="in_progress">En Progreso</SelectItem>
									<SelectItem value="completed">Completado</SelectItem>
								</SelectContent>
							</Select>
						</div>
						
						<div className="space-y-2">
							<Label htmlFor="description">Notas (Opcional)</Label>
							<Textarea
								id="description"
								name="description"
								defaultValue={updatingGoal?.description}
								placeholder="Agrega notas sobre el progreso..."
							/>
						</div>
						
						<Button type="submit" disabled={updateMutation.isPending}>
							{updateMutation.isPending ? "Actualizando..." : "Actualizar Meta"}
						</Button>
					</form>
				</DialogContent>
			</Dialog>
		</div>
	);
}