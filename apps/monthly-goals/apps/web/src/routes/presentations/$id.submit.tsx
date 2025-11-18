import { createFileRoute } from "@tanstack/react-router";
import { orpc } from "@/utils/orpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DataTable } from "@/components/ui/data-table";
import type { ColumnDef } from "@tanstack/react-table";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useState, useMemo } from "react";
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

const getProgressPercentage = (target: string, achieved: string, isInverse?: boolean) => {
  const targetNum = parseFloat(target);
  const achievedNum = parseFloat(achieved);

  if (isNaN(targetNum) || isNaN(achievedNum) || targetNum <= 0) {
    return 0; // valores inválidos
  }

  if (isInverse) {
    // Para metas inversas: menor o igual = 100%
    if (achievedNum <= targetNum) {
      return 100;
    } else {
      return Math.max((targetNum / achievedNum) * 100, 0);
    }
  } else {
    // Para metas normales: mayor es mejor
    return Math.min((achievedNum / targetNum) * 100, 100);
  }
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

	// Tipo inferido de los datos
	type GoalData = NonNullable<typeof availableGoals.data>[0];

	// Definir columnas para TanStack Table
	const columns = useMemo<ColumnDef<GoalData>[]>(() => [
		{
			accessorKey: "userName",
			header: "Empleado",
			cell: ({ row }) => (
				<div>
					<div className="font-medium">{row.original.userName}</div>
					<div className="text-sm text-gray-500">{row.original.userEmail}</div>
				</div>
			),
		},
		{
			accessorKey: "areaName",
			header: "Área",
		},
		{
			accessorKey: "goalTemplateName",
			header: "Meta",
			cell: ({ row }) => (
				<div>
					<div className="font-medium">{row.original.goalTemplateName}</div>
					{row.original.goalTemplateUnit && (
						<div className="text-sm text-gray-500">({row.original.goalTemplateUnit})</div>
					)}
				</div>
			),
		},
		{
			accessorKey: "targetValue",
			header: "Objetivo",
		},
		{
			id: "achievedValue",
			header: "Valor Logrado",
			cell: ({ row }) => {
				const submittedValue = getSubmissionValue(row.original.id, 'submittedValue') || row.original.achievedValue;
				return (
					<Input
						type="number"
						step="0.01"
						value={submittedValue}
						onChange={(e) => handleSubmissionChange(row.original.id, 'submittedValue', e.target.value)}
						placeholder={row.original.achievedValue}
						className="w-24"
					/>
				);
			},
		},
		{
			id: "progress",
			header: "Progreso",
			cell: ({ row }) => {
				const submittedValue = getSubmissionValue(row.original.id, 'submittedValue') || row.original.achievedValue;
				const percentage = getProgressPercentage(row.original.targetValue, submittedValue, row.original.isInverse ?? false);
				return (
					<div className="flex items-center space-x-2 w-32">
						<Progress value={Math.min(percentage, 100)} className="flex-1" />
						<span className="text-sm font-medium">{Math.round(percentage)}%</span>
					</div>
				);
			},
		},
		{
			id: "status",
			header: "Estado",
			cell: ({ row }) => {
				const submittedValue = getSubmissionValue(row.original.id, 'submittedValue') || row.original.achievedValue;
				const percentage = getProgressPercentage(row.original.targetValue, submittedValue, row.original.isInverse ?? false);
				return getStatusBadge(percentage);
			},
		},
		{
			id: "notes",
			header: "Notas",
			cell: ({ row }) => (
				<Textarea
					value={getSubmissionValue(row.original.id, 'notes')}
					onChange={(e) => handleSubmissionChange(row.original.id, 'notes', e.target.value)}
					placeholder="Notas opcionales..."
					className="min-h-[60px] w-48"
				/>
			),
		},
	], [submissions]);

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
					<DataTable
						columns={columns}
						data={availableGoals.data || []}
						isLoading={availableGoals.isLoading}
						searchPlaceholder="Buscar metas..."
						emptyMessage="No hay metas disponibles para este período"
					/>
				</CardContent>
			</Card>
		</div>
	);
}