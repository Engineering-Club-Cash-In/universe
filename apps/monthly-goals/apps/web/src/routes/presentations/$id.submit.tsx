import { createFileRoute } from "@tanstack/react-router";
import { orpc } from "@/utils/orpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/error-handler";

export const Route = createFileRoute("/presentations/$id/submit")({
	component: SubmitPresentationPage,
});

function SubmitPresentationPage() {
	const { id } = Route.useParams();
	const navigate = Route.useNavigate();
	const queryClient = useQueryClient();
	const [submissions, setSubmissions] = useState<any[]>([]);

	// Queries
	const presentation = useQuery(
		orpc.presentations.get.queryOptions({
			input: { id }
		})
	);

	const availableGoals = useQuery(
		orpc.presentations.availableGoals.queryOptions({
			input: {
				month: presentation.data?.month || new Date().getMonth() + 1,
				year: presentation.data?.year || new Date().getFullYear(),
			}
		}),
	);

	// Mutations
	const submitGoalsMutation = useMutation(
		orpc.presentations.submitGoals.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.presentations.get.key(),
				});
				// Mark presentation as ready
				updatePresentationMutation.mutate({
					id,
					data: { status: "ready" }
				});
				toast.success("Datos cargados exitosamente");
				
				// Navigate to view presentation
				navigate({
					to: "/presentations/$id/view",
					params: { id },
				});
			},
			onError: (error) => {
				toast.error(getErrorMessage(error, "Error al cargar datos"));
			},
		})
	);

	const updatePresentationMutation = useMutation(
		orpc.presentations.update.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.presentations.list.key(),
				});
			},
			onError: (error) => {
				toast.error(getErrorMessage(error, "Error al actualizar presentación"));
			},
		})
	);

	const handleSubmissionChange = (goalId: string, field: string, value: string) => {
		setSubmissions(prev => {
			const existing = prev.find(s => s.monthlyGoalId === goalId);
			if (existing) {
				return prev.map(s => 
					s.monthlyGoalId === goalId 
						? { ...s, [field]: value }
						: s
				);
			} else {
				return [...prev, { 
					monthlyGoalId: goalId, 
					[field]: value,
					submittedValue: field === 'submittedValue' ? value : '',
					notes: field === 'notes' ? value : '',
				}];
			}
		});
	};

	const handleSubmitAll = () => {
		if (!availableGoals.data || availableGoals.data.length === 0) {
			toast.error("No hay metas disponibles para enviar");
			return;
		}

		// Crear submissions para todas las metas disponibles
		const allSubmissions = availableGoals.data.map((goal: any) => {
			const existingSubmission = submissions.find(s => s.monthlyGoalId === goal.id);
			return {
				monthlyGoalId: goal.id,
				submittedValue: existingSubmission?.submittedValue || goal.achievedValue || '0',
				notes: existingSubmission?.notes || '',
			};
		});

		// Filtrar solo las que tienen un valor válido
		const validSubmissions = allSubmissions.filter(s => 
			s.submittedValue && s.submittedValue.trim() !== '' && s.submittedValue !== '0'
		);

		if (validSubmissions.length === 0) {
			toast.error("No hay valores válidos para enviar. Asegúrate de que las metas tengan valores mayores a 0.");
			return;
		}

		submitGoalsMutation.mutate({
			presentationId: id,
			submissions: validSubmissions,
		});
	};

	const getSubmissionValue = (goalId: string, field: string) => {
		const submission = submissions.find(s => s.monthlyGoalId === goalId);
		return submission ? submission[field] || '' : '';
	};

	const getProgressPercentage = (target: string, achieved: string) => {
		const targetNum = parseFloat(target);
		const achievedNum = parseFloat(achieved);
		return targetNum > 0 ? (achievedNum / targetNum) * 100 : 0;
	};

	const getStatusBadge = (percentage: number) => {
		if (percentage >= 80) {
			return <Badge className="bg-green-100 text-green-800">Exitoso</Badge>;
		} else if (percentage >= 50) {
			return <Badge className="bg-yellow-100 text-yellow-800">En Progreso</Badge>;
		} else {
			return <Badge className="bg-red-100 text-red-800">Necesita Atención</Badge>;
		}
	};

	if (presentation.isLoading) {
		return <div>Cargando presentación...</div>;
	}

	if (!presentation.data) {
		return <div>Presentación no encontrada</div>;
	}

	const months = [
		"", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
		"Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
	];

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-semibold">Cargar Datos de Presentación</h1>
					<p className="text-gray-600">
						{presentation.data.name} - {months[presentation.data.month]} {presentation.data.year}
					</p>
				</div>
				
				<div className="flex items-center gap-2">
					<Button
						onClick={handleSubmitAll}
						disabled={submitGoalsMutation.isPending || (availableGoals.data?.length === 0)}
					>
						{submitGoalsMutation.isPending ? "Enviando..." : "Enviar Todos los Datos"}
					</Button>
				</div>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Metas Disponibles para Cargar</CardTitle>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Empleado</TableHead>
								<TableHead>Área</TableHead>
								<TableHead>Meta</TableHead>
								<TableHead>Objetivo</TableHead>
								<TableHead>Valor Logrado</TableHead>
								<TableHead>Progreso</TableHead>
								<TableHead>Estado</TableHead>
								<TableHead>Notas</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{availableGoals.isLoading ? (
								<TableRow>
									<TableCell colSpan={8} className="text-center py-4">
										Cargando metas disponibles...
									</TableCell>
								</TableRow>
							) : availableGoals.data?.length === 0 ? (
								<TableRow>
									<TableCell colSpan={8} className="text-center py-4">
										No hay metas disponibles para este período
									</TableCell>
								</TableRow>
							) : availableGoals.data?.map((goal: any) => {
								const submittedValue = getSubmissionValue(goal.id, 'submittedValue') || goal.achievedValue;
								const percentage = getProgressPercentage(goal.targetValue, submittedValue);

								return (
									<TableRow key={goal.id}>
										<TableCell>
											<div>
												<div className="font-medium">{goal.userName}</div>
												<div className="text-sm text-gray-500">{goal.userEmail}</div>
											</div>
										</TableCell>
										<TableCell>{goal.areaName}</TableCell>
										<TableCell>
											<div>
												<div className="font-medium">{goal.goalTemplateName}</div>
												{goal.goalTemplateUnit && (
													<div className="text-sm text-gray-500">({goal.goalTemplateUnit})</div>
												)}
											</div>
										</TableCell>
										<TableCell>{goal.targetValue}</TableCell>
										<TableCell>
											<Input
												type="number"
												step="0.01"
												value={submittedValue}
												onChange={(e) => handleSubmissionChange(goal.id, 'submittedValue', e.target.value)}
												placeholder={goal.achievedValue}
												className="w-24"
											/>
										</TableCell>
										<TableCell className="w-32">
											<div className="flex items-center space-x-2">
												<Progress value={Math.min(percentage, 100)} className="flex-1" />
												<span className="text-sm font-medium">{Math.round(percentage)}%</span>
											</div>
										</TableCell>
										<TableCell>
											{getStatusBadge(percentage)}
										</TableCell>
										<TableCell>
											<Textarea
												value={getSubmissionValue(goal.id, 'notes')}
												onChange={(e) => handleSubmissionChange(goal.id, 'notes', e.target.value)}
												placeholder="Notas opcionales..."
												className="min-h-[60px] w-48"
											/>
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