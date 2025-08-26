import { createFileRoute } from "@tanstack/react-router";
import { orpc } from "@/utils/orpc";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { useState } from "react";

export const Route = createFileRoute("/goals/")({
	component: GoalsIndexPage,
});

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

	const getProgressColor = (percentage: number, successThreshold: string, warningThreshold: string) => {
		const success = parseFloat(successThreshold || "80");
		const warning = parseFloat(warningThreshold || "50");

		if (percentage >= success) return "bg-green-500";
		if (percentage >= warning) return "bg-yellow-500";
		return "bg-red-500";
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

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-semibold">Metas Mensuales</h1>
				
				<div className="flex items-end gap-6">
					<div className="flex flex-col gap-2">
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

					<div className="flex flex-col gap-2">
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
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Empleado</TableHead>
								<TableHead>Departamento</TableHead>
								<TableHead>Área</TableHead>
								<TableHead>Meta</TableHead>
								<TableHead>Objetivo</TableHead>
								<TableHead>Logrado</TableHead>
								<TableHead>Progreso</TableHead>
								<TableHead>Estado</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{monthlyGoals.isLoading ? (
								<TableRow>
									<TableCell colSpan={8} className="text-center py-4">
										Cargando metas...
									</TableCell>
								</TableRow>
							) : monthlyGoals.data?.length === 0 ? (
								<TableRow>
									<TableCell colSpan={8} className="text-center py-4">
										No hay metas configuradas para este período
									</TableCell>
								</TableRow>
							) : monthlyGoals.data?.map((goal: any) => {
								const target = parseFloat(goal.targetValue);
								const achieved = parseFloat(goal.achievedValue);
								const percentage = target > 0 ? (achieved / target) * 100 : 0;

								return (
									<TableRow key={goal.id}>
										<TableCell className="font-medium">{goal.userName}</TableCell>
										<TableCell>{goal.departmentName}</TableCell>
										<TableCell>{goal.areaName}</TableCell>
										<TableCell>
											{goal.goalTemplateName}
											{goal.goalTemplateUnit && (
												<span className="text-gray-500 ml-1">({goal.goalTemplateUnit})</span>
											)}
										</TableCell>
										<TableCell>{goal.targetValue}</TableCell>
										<TableCell>{goal.achievedValue}</TableCell>
										<TableCell className="w-32">
											<div className="flex items-center space-x-2">
												<Progress 
													value={Math.min(percentage, 100)} 
													className="flex-1"
												/>
												<span className="text-sm font-medium">{Math.round(percentage)}%</span>
											</div>
										</TableCell>
										<TableCell>
											{getStatusBadge(percentage, goal.successThreshold, goal.warningThreshold)}
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				</CardContent>
			</Card>
		</div>
	);
}