import { createFileRoute } from "@tanstack/react-router";
import { orpc } from "@/utils/orpc";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, createSortableHeader, createFilterableHeader } from "@/components/ui/data-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { useState, useMemo } from "react";

export const Route = createFileRoute("/goals/reports")({
	component: GoalsIndexPage,
});

type MonthlyGoal = {
	id: string;
	userName: string | null;
	departmentName: string | null;
	areaName: string | null;
	goalTemplateName: string | null;
	goalTemplateUnit?: string | null;
	targetValue: string;
	achievedValue: string;
	isInverse: boolean | null;
	successThreshold: string | null;
	warningThreshold: string | null;
};

function GoalsIndexPage() {
	const currentDate = new Date();
	const [selectedMonth, setSelectedMonth] = useState(currentDate.getMonth() + 1);
	const [selectedYear, setSelectedYear] = useState(currentDate.getFullYear());

	// Queries
	const monthlyGoals = useQuery(
		orpc.monthlyGoals.list.queryOptions({
			input: {
				month: selectedMonth,
				year: selectedYear,
			}
		})
	);

	const calculatePercentage = (target: number, achieved: number, isInverse: boolean | null): number => {
		if (target <= 0) return 0;

		if (isInverse) {
			// Para metas inversas: menor o igual = 100%
			if (achieved <= target) {
				return 100;
			} else {
				return Math.max((target / achieved) * 100, 0);
			}
		} else {
			// Para metas normales: mayor es mejor
			return (achieved / target) * 100;
		}
	};

	const getStatusBadge = (percentage: number, successThreshold: string | null, warningThreshold: string | null) => {
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

	const getProgressColor = (percentage: number, successThreshold: string | null, warningThreshold: string | null) => {
		const success = parseFloat(successThreshold || "80");
		const warning = parseFloat(warningThreshold || "50");

		if (percentage >= success) return "bg-green-500";
		if (percentage >= warning) return "bg-yellow-500";
		return "bg-red-500";
	};

	const getStatusText = (percentage: number, successThreshold: string | null, warningThreshold: string | null) => {
		const success = parseFloat(successThreshold || "80");
		const warning = parseFloat(warningThreshold || "50");
		
		if (percentage >= success) return "exitoso";
		else if (percentage >= warning) return "en_progreso";
		else return "necesita_atencion";
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

	const years = Array.from({ length: 5 }, (_, i) => currentDate.getFullYear() - 2 + i);

	// Generar opciones de área dinámicamente desde los datos
	const areaOptions = useMemo(() => {
		if (!monthlyGoals.data) return [];
		const uniqueAreas = new Set(monthlyGoals.data.map((goal) => goal.areaName).filter(Boolean));
		return Array.from(uniqueAreas).sort().map((area) => ({
			label: area as string,
			value: area as string,
		}));
	}, [monthlyGoals.data]);

	// Definir columnas para TanStack Table
	const columns = useMemo<ColumnDef<MonthlyGoal>[]>(() => [
		{
			accessorKey: "userName",
			header: createSortableHeader("Empleado"),
			cell: ({ row }) => (
				<div className="font-medium">{row.getValue("userName") || "—"}</div>
			),
		},
		{
			accessorKey: "departmentName",
			header: createSortableHeader("Departamento"),
			cell: ({ row }) => row.getValue("departmentName") || "—",
		},
		{
			accessorKey: "areaName",
			header: createFilterableHeader("Área", areaOptions),
			cell: ({ row }) => row.getValue("areaName") || "—",
			filterFn: (row, id, value) => {
				if (!value || value.length === 0) return true;
				const areaName = row.getValue("areaName") as string;
				return value.includes(areaName);
			},
		},
		{
			accessorKey: "goalTemplateName",
			header: createSortableHeader("Meta"),
			cell: ({ row }) => (
				<div>
					{row.getValue("goalTemplateName") || "—"}
					{row.original.goalTemplateUnit && (
						<span className="text-gray-500 ml-1">({row.original.goalTemplateUnit})</span>
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
				const percentage = calculatePercentage(target, achieved, row.original.isInverse);

				return (
					<div className="flex items-center space-x-2 w-32">
						<Progress
							value={Math.min(percentage, 100)}
							className="flex-1"
						/>
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
				const percentage = calculatePercentage(target, achieved, row.original.isInverse);

				return getStatusBadge(percentage, row.original.successThreshold, row.original.warningThreshold);
			},
			filterFn: (row, id, value) => {
				if (!value || value.length === 0) return true;

				const target = parseFloat(row.original.targetValue);
				const achieved = parseFloat(row.original.achievedValue);
				const percentage = calculatePercentage(target, achieved, row.original.isInverse);
				const status = getStatusText(percentage, row.original.successThreshold, row.original.warningThreshold);

				return value.includes(status);
			},
		},
	], [areaOptions]);

	return (
		<div className="space-y-6">
			<div className="space-y-2">
				<h1 className="text-2xl font-semibold">Dashboard de Metas</h1>
				<p className="text-gray-600 dark:text-gray-400">
					Vista general de todas las metas mensuales asignadas en la organización. Filtra por período para ver el progreso de cada empleado.
				</p>
			</div>

			<div className="flex items-center justify-end">
				<div className="flex items-end gap-4">
					<div className="space-y-2">
						<Label className="text-sm font-medium text-gray-700 dark:text-gray-300">Mes</Label>
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
						<Label className="text-sm font-medium text-gray-700 dark:text-gray-300">Año</Label>
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
						data={monthlyGoals.data || []}
						isLoading={monthlyGoals.isLoading}
						searchPlaceholder="Buscar metas..."
						emptyMessage="No hay metas configuradas para este período"
					/>
				</CardContent>
			</Card>
		</div>
	);
}