import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import {
	draggable,
	dropTargetForElements,
	monitorForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { autoScrollForElements } from "@atlaskit/pragmatic-drag-and-drop-auto-scroll/element";
import { DropIndicator } from "@atlaskit/pragmatic-drag-and-drop-react-drop-indicator/box";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	Building,
	Calendar,
	Clock,
	DollarSign,
	FileText,
	Filter,
	History,
	Mail,
	Plus,
	Target,
	Trash2,
	TrendingUp,
	Upload,
	Users,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import invariant from "tiny-invariant";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
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
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { authClient } from "@/lib/auth-client";
import { formatGuatemalaDate, getStatusLabel } from "@/lib/crm-formatters";
import { client, orpc } from "@/utils/orpc";
import { PERMISSIONS } from "server/src/types/roles";

// Simple draggable opportunity card component
function DraggableOpportunityCard({
	opportunity,
	getStatusBadgeColor,
	onOpportunityClick,
}: {
	opportunity: any;
	getStatusBadgeColor: (status: string) => string;
	onOpportunityClick: (opportunity: any) => void;
}) {
	const ref = useRef<HTMLDivElement | null>(null);
	const [isDragging, setIsDragging] = useState(false);

	useEffect(() => {
		const element = ref.current;
		invariant(element);

		return draggable({
			element,
			getInitialData: () => ({
				type: "opportunity",
				opportunityId: opportunity.id,
				currentStageId: opportunity.stage?.id,
			}),
			onDragStart: () => setIsDragging(true),
			onDrop: () => setIsDragging(false),
		});
	}, [opportunity.id, opportunity.stage?.id]);

	return (
		<Card
			ref={ref}
			className={`cursor-pointer p-3 transition-shadow hover:shadow-md ${
				isDragging ? "opacity-50" : ""
			}`}
			onClick={() => onOpportunityClick(opportunity)}
		>
			<div className="space-y-2">
				<div className="flex items-start justify-between gap-2">
					<h4 className="min-w-0 flex-1 font-medium text-sm leading-tight">
						{opportunity.title}
					</h4>
					<Badge
						className={`${getStatusBadgeColor(opportunity.status)} flex-shrink-0`}
						variant="outline"
					>
						{getStatusLabel(opportunity.status)}
					</Badge>
				</div>

				{opportunity.lead && (
					<div className="flex items-center gap-1 text-muted-foreground text-xs">
						<Users className="h-3 w-3" />
						{opportunity.lead.firstName} {opportunity.lead.lastName}
					</div>
				)}

				{opportunity.value && (
					<div className="flex items-center gap-1 font-medium text-green-600 text-xs">
						<DollarSign className="h-3 w-3" />$
						{Number.parseFloat(opportunity.value).toLocaleString()}
					</div>
				)}

				{opportunity.expectedCloseDate && (
					<div className="flex items-center gap-1 text-muted-foreground text-xs">
						<Calendar className="h-3 w-3" />
						{formatGuatemalaDate(opportunity.expectedCloseDate)}
					</div>
				)}

				<div className="flex items-center justify-between pt-1">
					<span className="text-muted-foreground text-xs">
						{opportunity.probability ||
							opportunity.stage?.closurePercentage ||
							0}
						% probabilidad
					</span>
					<span className="text-muted-foreground text-xs">
						{formatGuatemalaDate(opportunity.createdAt)}
					</span>
				</div>

				{opportunity.value && (
					<div className="border-t pt-1">
						<div className="flex justify-between text-xs">
							<span className="text-muted-foreground">Ponderado:</span>
							<span className="font-medium text-blue-600">
								$
								{(
									(Number.parseFloat(opportunity.value) *
										(opportunity.probability ||
											opportunity.stage?.closurePercentage ||
											0)) /
									100
								).toLocaleString()}
							</span>
						</div>
					</div>
				)}
			</div>
		</Card>
	);
}

// Simple droppable stage column component
function DroppableStageColumn({
	stage,
	opportunities,
	totalValue,
	count,
	getStatusBadgeColor,
	onDropOpportunity,
	onOpportunityClick,
}: {
	stage: any;
	opportunities: any[];
	totalValue: number;
	count: number;
	getStatusBadgeColor: (status: string) => string;
	onDropOpportunity: (opportunityId: string, newStageId: string) => void;
	onOpportunityClick: (opportunity: any) => void;
}) {
	const ref = useRef<HTMLDivElement | null>(null);
	const [isDraggedOver, setIsDraggedOver] = useState(false);

	useEffect(() => {
		const element = ref.current;
		invariant(element);

		return dropTargetForElements({
			element,
			getData: () => ({ type: "stage", stageId: stage.id }),
			canDrop: ({ source }) => source.data.type === "opportunity",
			onDragEnter: () => setIsDraggedOver(true),
			onDragLeave: () => setIsDraggedOver(false),
			onDrop: ({ source }) => {
				setIsDraggedOver(false);
				const opportunityId = source.data.opportunityId as string;
				const currentStageId = source.data.currentStageId as string;

				if (opportunityId && currentStageId !== stage.id) {
					onDropOpportunity(opportunityId, stage.id);
				}
			},
		});
	}, [stage.id, onDropOpportunity]);

	const stageWeightedValue = opportunities.reduce((sum, opp) => {
		const value = Number.parseFloat(opp.value || "0") || 0;
		const probability = opp.probability || stage.closurePercentage || 0;
		return sum + (value * probability) / 100;
	}, 0);

	const stageAvgDeal = count > 0 ? totalValue / count : 0;

	return (
		<Card
			className={`h-fit min-w-80 flex-shrink-0 ${
				isDraggedOver ? "ring-2 ring-blue-500" : ""
			}`}
		>
			<CardHeader className="pb-3">
				<div className="flex items-center justify-between">
					<Badge
						style={{ backgroundColor: stage.color, color: "white" }}
						className="text-xs"
					>
						{stage.closurePercentage}%
					</Badge>
					<span className="text-muted-foreground text-xs">
						{count} negocios
					</span>
				</div>
				<CardTitle className="font-medium text-sm">{stage.name}</CardTitle>
				<div className="space-y-1">
					<CardDescription className="text-xs">
						${totalValue.toLocaleString()} valor total
					</CardDescription>
					<CardDescription className="text-blue-600 text-xs">
						${stageWeightedValue.toLocaleString()} ponderado
					</CardDescription>
					<CardDescription className="text-muted-foreground text-xs">
						${stageAvgDeal.toLocaleString()} promedio/negocio
					</CardDescription>
				</div>
			</CardHeader>
			<CardContent className="space-y-3" ref={ref}>
				{opportunities.length === 0 ? (
					<div className="py-8 text-center text-muted-foreground">
						<Target className="mx-auto mb-2 h-8 w-8 opacity-50" />
						<p className="text-sm">No hay oportunidades</p>
					</div>
				) : (
					opportunities.map((opportunity) => (
						<DraggableOpportunityCard
							key={opportunity.id}
							opportunity={opportunity}
							getStatusBadgeColor={getStatusBadgeColor}
							onOpportunityClick={onOpportunityClick}
						/>
					))
				)}
			</CardContent>
		</Card>
	);
}

export const Route = createFileRoute("/crm/opportunities")({
	component: RouteComponent,
});

function RouteComponent() {
	const { data: session, isPending } = authClient.useSession();
	const navigate = Route.useNavigate();
	const queryClient = useQueryClient();
	const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
	const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false);
	const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
	const [isChangeStageDialogOpen, setIsChangeStageDialogOpen] = useState(false);
	const [selectedOpportunity, setSelectedOpportunity] = useState<any>(null);
	const [selectedStage, setSelectedStage] = useState<string>("");
	const [stageFilter, setStageFilter] = useState<string>("all");
	const [opportunityHistory, setOpportunityHistory] = useState<any[]>([]);
	const [isLoadingHistory, setIsLoadingHistory] = useState(false);
	const [stageChangeReason, setStageChangeReason] = useState<string>("");

	const handleDropOpportunity = (opportunityId: string, newStageId: string) => {
		updateOpportunityMutation.mutate({
			id: opportunityId,
			stageId: newStageId,
		});
	};

	const handleOpportunityClick = async (opportunity: any) => {
		setSelectedOpportunity(opportunity);
		setIsDetailsDialogOpen(true);
		
		// Load opportunity history
		setIsLoadingHistory(true);
		try {
			const history = await client.getOpportunityHistory({ opportunityId: opportunity.id });
			setOpportunityHistory(history);
		} catch (error) {
			console.error("Error loading opportunity history:", error);
			setOpportunityHistory([]);
		} finally {
			setIsLoadingHistory(false);
		}
	};

	const handleEditOpportunity = () => {
		if (selectedOpportunity) {
			// Populate the edit form with the selected opportunity data
			editOpportunityForm.setFieldValue(
				"title",
				selectedOpportunity.title || "",
			);
			editOpportunityForm.setFieldValue(
				"leadId",
				selectedOpportunity.lead?.id || "none",
			);
			editOpportunityForm.setFieldValue(
				"value",
				selectedOpportunity.value || "",
			);
			editOpportunityForm.setFieldValue(
				"stageId",
				selectedOpportunity.stage?.id || "",
			);
			editOpportunityForm.setFieldValue(
				"probability",
				selectedOpportunity.probability || 0,
			);
			editOpportunityForm.setFieldValue(
				"expectedCloseDate",
				selectedOpportunity.expectedCloseDate
					? new Date(selectedOpportunity.expectedCloseDate)
							.toISOString()
							.split("T")[0]
					: "",
			);
			editOpportunityForm.setFieldValue(
				"notes",
				selectedOpportunity.notes || "",
			);
		}
		setIsDetailsDialogOpen(false);
		setIsEditDialogOpen(true);
	};

	const handleChangeStage = () => {
		setIsDetailsDialogOpen(false);
		setIsChangeStageDialogOpen(true);
	};

	const userProfile = useQuery(orpc.getUserProfile.queryOptions());
	const opportunitiesQuery = useQuery({
		...orpc.getOpportunities.queryOptions(),
		enabled:
			!!userProfile.data?.role &&
			PERMISSIONS.canAccessCRM(userProfile.data.role) &&
			!!session?.user?.id,
		queryKey: ["getOpportunities", session?.user?.id, userProfile.data?.role],
	});
	const salesStagesQuery = useQuery({
		...orpc.getSalesStages.queryOptions(),
		enabled:
			!!userProfile.data?.role &&
			PERMISSIONS.canAccessCRM(userProfile.data.role) &&
			!!session?.user?.id,
		queryKey: ["getSalesStages", session?.user?.id, userProfile.data?.role],
	});
	const leadsQuery = useQuery({
		...orpc.getLeads.queryOptions(),
		enabled:
			!!userProfile.data?.role &&
			PERMISSIONS.canAccessCRM(userProfile.data.role) &&
			!!session?.user?.id,
		queryKey: ["getLeads", session?.user?.id, userProfile.data?.role],
	});

	const createOpportunityForm = useForm({
		defaultValues: {
			title: "",
			leadId: "none",
			value: "",
			stageId: "",
			probability: 0,
			expectedCloseDate: "",
			notes: "",
		},
		validators: {
			onChange: ({ value }) => {
				if (!value.title || value.title.trim() === "") {
					return { form: "El título es requerido" };
				}
				if (!value.stageId || value.stageId === "") {
					return { form: "La etapa es requerida" };
				}
				return undefined;
			},
		},
		onSubmit: async ({ value }) => {
			const firstStage = salesStagesQuery.data?.[0];
			createOpportunityMutation.mutate({
				...value,
				stageId: value.stageId || firstStage?.id || "",
				leadId:
					value.leadId && value.leadId !== "none" ? value.leadId : undefined,
				value: value.value || undefined,
				expectedCloseDate: value.expectedCloseDate || undefined,
				notes: value.notes || undefined,
				probability: value.probability || undefined,
			});
		},
	});

	const editOpportunityForm = useForm({
		defaultValues: {
			title: "",
			leadId: "none",
			value: "",
			stageId: "",
			probability: 0,
			expectedCloseDate: "",
			notes: "",
		},
		validators: {
			onChange: ({ value }) => {
				if (!value.title || value.title.trim() === "") {
					return { form: "El título es requerido" };
				}
				if (!value.stageId || value.stageId === "") {
					return { form: "La etapa es requerida" };
				}
				return undefined;
			},
		},
		onSubmit: async ({ value }) => {
			if (selectedOpportunity) {
				updateOpportunityMutation.mutate({
					id: selectedOpportunity.id,
					...value,
					leadId:
						value.leadId && value.leadId !== "none" ? value.leadId : undefined,
					value: value.value || undefined,
					expectedCloseDate: value.expectedCloseDate || undefined,
					notes: value.notes || undefined,
					probability: value.probability || undefined,
				});
			}
		},
	});

	const createOpportunityMutation = useMutation({
		mutationFn: (input: {
			title: string;
			leadId?: string;
			companyId?: string;
			value?: string;
			stageId: string;
			probability?: number;
			expectedCloseDate?: string;
			assignedTo?: string;
			notes?: string;
		}) => client.createOpportunity(input),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: [
					"getOpportunities",
					session?.user?.id,
					userProfile.data?.role,
				],
			});
			toast.success("Oportunidad creada exitosamente");
			setIsCreateDialogOpen(false);
			createOpportunityForm.reset();
		},
		onError: (error: any) => {
			toast.error(error.message || "Error al crear la oportunidad");
		},
	});

	const updateOpportunityMutation = useMutation({
		mutationFn: (input: {
			id: string;
			title?: string;
			leadId?: string;
			value?: string;
			stageId?: string;
			probability?: number;
			expectedCloseDate?: string;
			notes?: string;
			stageChangeReason?: string;
		}) => client.updateOpportunity(input),
		onMutate: async (variables) => {
			const opportunitiesQueryKey = [
				"getOpportunities",
				session?.user?.id,
				userProfile.data?.role,
			];
			const salesStagesQueryKey = [
				"getSalesStages",
				session?.user?.id,
				userProfile.data?.role,
			];
			// Cancel any outgoing refetches
			await queryClient.cancelQueries({ queryKey: opportunitiesQueryKey });

			// Snapshot the previous value
			const previousOpportunities = queryClient.getQueryData(
				opportunitiesQueryKey,
			);

			// Get the current sales stages data
			const salesStages =
				(queryClient.getQueryData(salesStagesQueryKey) as any[]) || [];

			// Optimistically update to the new value
			queryClient.setQueryData(
				opportunitiesQueryKey,
				(old: any[] | undefined) => {
					if (!old) return old;

					return old.map((opportunity: any) => {
						if (opportunity.id === variables.id) {
							// Find the new stage to update the opportunity
							const newStage = variables.stageId
								? salesStages.find((stage) => stage.id === variables.stageId)
								: opportunity.stage;

							return {
								...opportunity,
								...variables,
								stage: newStage,
							};
						}
						return opportunity;
					});
				},
			);

			// Return a context object with the snapshotted value
			return { previousOpportunities };
		},
		onSuccess: async (data, variables) => {
			toast.success("Oportunidad actualizada exitosamente");
			setIsEditDialogOpen(false);
			setIsChangeStageDialogOpen(false);
			
			// Reload history if we're viewing this opportunity and stage changed
			if (selectedOpportunity?.id === variables.id && variables.stageId) {
				try {
					const history = await client.getOpportunityHistory({ opportunityId: variables.id });
					setOpportunityHistory(history);
				} catch (error) {
					console.error("Error reloading history:", error);
				}
			}
		},
		onError: (error: any, variables, context) => {
			// If the mutation fails, use the context returned from onMutate to roll back
			if (context?.previousOpportunities) {
				queryClient.setQueryData(
					["getOpportunities", session?.user?.id, userProfile.data?.role],
					context.previousOpportunities,
				);
			}
			toast.error(error.message || "Error al actualizar la oportunidad");
		},
		onSettled: () => {
			// Always refetch after error or success to ensure we have correct data
			queryClient.invalidateQueries({
				queryKey: [
					"getOpportunities",
					session?.user?.id,
					userProfile.data?.role,
				],
			});
		},
	});

	useEffect(() => {
		if (!session && !isPending) {
			navigate({ to: "/login" });
		} else if (
			session &&
			userProfile.data?.role &&
			!PERMISSIONS.canAccessCRM(userProfile.data.role)
		) {
			navigate({ to: "/dashboard" });
			toast.error("Acceso denegado: Se requiere acceso al CRM");
		}
	}, [session, isPending, userProfile.data?.role]);

	if (isPending || userProfile.isPending) {
		return <div>Cargando...</div>;
	}

	if (
		!userProfile.data?.role ||
		!PERMISSIONS.canAccessCRM(userProfile.data.role)
	) {
		return null;
	}

	const getStatusBadgeColor = (status: string) => {
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
	};

	// Group opportunities by stage
	const opportunitiesByStage =
		salesStagesQuery.data?.map((stage) => {
			const stageOpportunities =
				opportunitiesQuery.data?.filter(
					(opp) =>
						opp.stage?.id === stage.id &&
						(stageFilter === "all" || opp.status === stageFilter),
				) || [];

			const totalValue = stageOpportunities.reduce(
				(sum, opp) => sum + (Number.parseFloat(opp.value || "0") || 0),
				0,
			);

			return {
				stage,
				opportunities: stageOpportunities,
				totalValue,
				count: stageOpportunities.length,
			};
		}) || [];

	// Calculate comprehensive opportunities metrics
	const totalOpportunities = opportunitiesQuery.data?.length || 0;
	const totalValue =
		opportunitiesQuery.data?.reduce(
			(sum, opp) => sum + (Number.parseFloat(opp.value || "0") || 0),
			0,
		) || 0;
	const wonOpportunities =
		opportunitiesQuery.data?.filter((opp) => opp.status === "won").length || 0;
	const lostOpportunities =
		opportunitiesQuery.data?.filter((opp) => opp.status === "lost").length || 0;
	const openOpportunities =
		opportunitiesQuery.data?.filter((opp) => opp.status === "open").length || 0;

	// Calculate win rate from closed deals only
	const closedOpportunities = wonOpportunities + lostOpportunities;
	const winRate =
		closedOpportunities > 0
			? Math.round((wonOpportunities / closedOpportunities) * 100)
			: 0;

	// Calculate weighted opportunities value (value * probability / 100)
	const weightedValue =
		opportunitiesQuery.data?.reduce((sum, opp) => {
			const value = Number.parseFloat(opp.value || "0") || 0;
			const probability = opp.probability || opp.stage?.closurePercentage || 0;
			return sum + (value * probability) / 100;
		}, 0) || 0;

	// Calculate average deal size
	const avgDealSize =
		totalOpportunities > 0 ? totalValue / totalOpportunities : 0;

	// Calculate conversion rate by stage
	const stageConversions =
		salesStagesQuery.data?.map((stage) => {
			const stageOpportunities =
				opportunitiesQuery.data?.filter((opp) => opp.stage?.id === stage.id) ||
				[];
			const nextStageOpportunities = salesStagesQuery.data?.find(
				(s) => s.order === stage.order + 1,
			);
			const nextStageCount = nextStageOpportunities
				? opportunitiesQuery.data?.filter(
						(opp) =>
							opp.stage?.order &&
							opp.stage.order >= nextStageOpportunities.order,
					).length || 0
				: wonOpportunities;

			const conversionRate =
				stageOpportunities.length > 0
					? Math.round((nextStageCount / stageOpportunities.length) * 100)
					: 0;

			return {
				stage: stage.name,
				conversionRate,
				count: stageOpportunities.length,
			};
		}) || [];

	return (
		<div className="container mx-auto space-y-6 p-6">
			<div>
				<h1 className="font-bold text-3xl">Oportunidades</h1>
				<p className="text-muted-foreground">
					Rastrea las oportunidades a través de tu proceso de ventas
				</p>
			</div>

			{/* Enhanced Stats Cards */}
			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">
							Valor de Oportunidades
						</CardTitle>
						<DollarSign className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl">
							${totalValue.toLocaleString()}
						</div>
						<p className="text-muted-foreground text-xs">
							{totalOpportunities} oportunidades
						</p>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">
							Valor Ponderado
						</CardTitle>
						<DollarSign className="h-4 w-4 text-blue-500" />
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl">
							${weightedValue.toLocaleString()}
						</div>
						<p className="text-muted-foreground text-xs">
							Ajustado por probabilidad
						</p>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">Tasa de Éxito</CardTitle>
						<TrendingUp className="h-4 w-4 text-green-500" />
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl">{winRate}%</div>
						<p className="text-muted-foreground text-xs">
							{wonOpportunities}/{closedOpportunities} negocios cerrados
						</p>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">
							Valor Promedio
						</CardTitle>
						<Target className="h-4 w-4 text-purple-500" />
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl">
							${avgDealSize.toLocaleString()}
						</div>
						<p className="text-muted-foreground text-xs">Por oportunidad</p>
					</CardContent>
				</Card>
			</div>

			{/* Conversion Metrics */}
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<TrendingUp className="h-5 w-5" />
						Análisis de Conversión por Etapa
					</CardTitle>
					<CardDescription>
						Rastrea cómo se mueven las oportunidades a través de tu proceso de
						ventas
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
						{stageConversions.map((conversion, index) => (
							<div
								key={index}
								className="flex items-center justify-between rounded-lg border p-3"
							>
								<div>
									<p className="font-medium text-sm">{conversion.stage}</p>
									<p className="text-muted-foreground text-xs">
										{conversion.count} oportunidades
									</p>
								</div>
								<div className="text-right">
									<Badge
										variant="outline"
										className={
											conversion.conversionRate >= 70
												? "bg-green-100 text-green-800"
												: conversion.conversionRate >= 40
													? "bg-yellow-100 text-yellow-800"
													: "bg-red-100 text-red-800"
										}
									>
										{conversion.conversionRate}%
									</Badge>
									<p className="mt-1 text-muted-foreground text-xs">
										conversión
									</p>
								</div>
							</div>
						))}
					</div>
				</CardContent>
			</Card>

			{/* Actions Bar */}
			<div className="flex items-center justify-between">
				<div className="flex gap-4">
					<Select value={stageFilter} onValueChange={setStageFilter}>
						<SelectTrigger className="w-[180px]">
							<Filter className="mr-2 h-4 w-4" />
							<SelectValue placeholder="Filtrar por estado" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">Todos los Estados</SelectItem>
							<SelectItem value="open">Abierto</SelectItem>
							<SelectItem value="won">Ganado</SelectItem>
							<SelectItem value="lost">Perdido</SelectItem>
							<SelectItem value="on_hold">En Espera</SelectItem>
						</SelectContent>
					</Select>
				</div>

				<Dialog
					open={isCreateDialogOpen}
					onOpenChange={(open) => {
						setIsCreateDialogOpen(open);
						if (!open) {
							createOpportunityForm.reset();
						}
					}}
				>
					<DialogTrigger asChild>
						<Button>
							<Plus className="mr-2 h-4 w-4" />
							Agregar Oportunidad
						</Button>
					</DialogTrigger>
					<DialogContent className="max-w-2xl">
						<DialogHeader>
							<DialogTitle>Crear Nueva Oportunidad</DialogTitle>
						</DialogHeader>
						<form
							onSubmit={(e) => {
								e.preventDefault();
								e.stopPropagation();
								void createOpportunityForm.handleSubmit();
							}}
							className="space-y-4"
						>
							<div>
								<createOpportunityForm.Field
									name="title"
									validators={{
										onChange: ({ value }) => {
											if (!value || value.trim() === "") {
												return "El título es requerido";
											}
											return undefined;
										},
									}}
								>
									{(field) => (
										<div className="space-y-2">
											<Label htmlFor={field.name}>
												Título de la Oportunidad{" "}
												<span className="text-red-500">*</span>
											</Label>
											<Input
												id={field.name}
												name={field.name}
												value={field.state.value}
												onBlur={field.handleBlur}
												onChange={(e) => field.handleChange(e.target.value)}
												placeholder="Ingresa el título de la oportunidad..."
												className={
													field.state.meta.errors.length > 0
														? "border-red-500"
														: ""
												}
											/>
											{field.state.meta.errors.map((error) => (
												<p key={String(error)} className="text-red-500 text-sm">
													{String(error)}
												</p>
											))}
										</div>
									)}
								</createOpportunityForm.Field>
							</div>

							<div className="grid grid-cols-2 gap-4">
								<div>
									<createOpportunityForm.Field name="leadId">
										{(field) => (
											<div className="space-y-2">
												<Label htmlFor={field.name}>Lead</Label>
												<Select
													value={field.state.value}
													onValueChange={(value) => field.handleChange(value)}
												>
													<SelectTrigger className="w-full">
														<SelectValue placeholder="Seleccionar lead" />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="none">Sin lead</SelectItem>
														{leadsQuery.data?.map((lead) => (
															<SelectItem key={lead.id} value={lead.id}>
																{lead.firstName} {lead.lastName}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											</div>
										)}
									</createOpportunityForm.Field>
								</div>
								<div>
									<createOpportunityForm.Field name="value">
										{(field) => (
											<div className="space-y-2">
												<Label htmlFor={field.name}>Valor del Negocio</Label>
												<Input
													id={field.name}
													name={field.name}
													type="number"
													value={field.state.value}
													onBlur={field.handleBlur}
													onChange={(e) => field.handleChange(e.target.value)}
													placeholder="0.00"
												/>
											</div>
										)}
									</createOpportunityForm.Field>
								</div>
							</div>

							<div className="grid grid-cols-2 gap-4">
								<div>
									<createOpportunityForm.Field
										name="stageId"
										validators={{
											onChange: ({ value }) => {
												if (!value || value === "") {
													return "La etapa es requerida";
												}
												return undefined;
											},
										}}
									>
										{(field) => (
											<div className="space-y-2">
												<Label htmlFor={field.name}>
													Etapa Inicial <span className="text-red-500">*</span>
												</Label>
												<Select
													value={field.state.value}
													onValueChange={(value) => field.handleChange(value)}
												>
													<SelectTrigger
														className={
															field.state.meta.errors.length > 0
																? "w-full border-red-500"
																: "w-full"
														}
													>
														<SelectValue placeholder="Seleccionar etapa" />
													</SelectTrigger>
													<SelectContent>
														{salesStagesQuery.data?.map((stage) => (
															<SelectItem key={stage.id} value={stage.id}>
																{stage.name} ({stage.closurePercentage}%)
															</SelectItem>
														))}
													</SelectContent>
												</Select>
												{field.state.meta.errors.map((error) => (
													<p
														key={String(error)}
														className="text-red-500 text-sm"
													>
														{String(error)}
													</p>
												))}
											</div>
										)}
									</createOpportunityForm.Field>
								</div>
								<div>
									<createOpportunityForm.Field name="expectedCloseDate">
										{(field) => (
											<div className="space-y-2">
												<Label htmlFor={field.name}>
													Fecha de Cierre Esperada
												</Label>
												<Input
													id={field.name}
													name={field.name}
													type="date"
													value={field.state.value}
													onBlur={field.handleBlur}
													onChange={(e) => field.handleChange(e.target.value)}
												/>
											</div>
										)}
									</createOpportunityForm.Field>
								</div>
							</div>

							<div>
								<createOpportunityForm.Field name="notes">
									{(field) => (
										<div className="space-y-2">
											<Label htmlFor={field.name}>Notas</Label>
											<Input
												id={field.name}
												name={field.name}
												value={field.state.value}
												onBlur={field.handleBlur}
												onChange={(e) => field.handleChange(e.target.value)}
												placeholder="Notas adicionales sobre esta oportunidad..."
											/>
										</div>
									)}
								</createOpportunityForm.Field>
							</div>

							<createOpportunityForm.Subscribe>
								{(state) => (
									<Button
										type="submit"
										className="w-full"
										disabled={
											!state.canSubmit ||
											state.isSubmitting ||
											createOpportunityMutation.isPending
										}
									>
										{state.isSubmitting || createOpportunityMutation.isPending
											? "Creando..."
											: "Crear Oportunidad"}
									</Button>
								)}
							</createOpportunityForm.Subscribe>
						</form>
					</DialogContent>
				</Dialog>

				{/* Opportunity Details Modal */}
				<Dialog
					open={isDetailsDialogOpen}
					onOpenChange={setIsDetailsDialogOpen}
				>
					<DialogContent className="max-h-[90vh] w-[90vw] min-w-[800px] max-w-5xl overflow-y-auto">
						<DialogHeader>
							<DialogTitle>Detalles de la Oportunidad</DialogTitle>
						</DialogHeader>
						{selectedOpportunity && (
							<Tabs defaultValue="details" className="w-full">
								<TabsList className="grid w-full grid-cols-3">
									<TabsTrigger value="details">Detalles</TabsTrigger>
									<TabsTrigger value="documents">Documentos</TabsTrigger>
									<TabsTrigger value="history">Historial</TabsTrigger>
								</TabsList>
								
								<TabsContent value="details" className="space-y-6 mt-6">
									{/* Header with title and status */}
									<div className="flex items-start justify-between">
										<div>
											<h3 className="font-semibold text-lg">
												{selectedOpportunity.title}
											</h3>
											<div className="mt-1 flex items-center gap-2">
												<Badge
													className={`${getStatusBadgeColor(selectedOpportunity.status)}`}
													variant="outline"
												>
													{getStatusLabel(selectedOpportunity.status)}
												</Badge>
												{selectedOpportunity.stage && (
													<Badge
														style={{
															backgroundColor: selectedOpportunity.stage.color,
															color: "white",
														}}
													>
														{selectedOpportunity.stage.name}
													</Badge>
												)}
											</div>
										</div>
										<div className="text-right">
											<div className="font-bold text-2xl text-green-600">
												$
												{Number.parseFloat(
													selectedOpportunity.value || "0",
												).toLocaleString()}
											</div>
											<div className="text-muted-foreground text-sm">
												{selectedOpportunity.probability ||
													selectedOpportunity.stage?.closurePercentage ||
													0}
												% probabilidad
											</div>
										</div>
									</div>

								{/* Details Grid */}
								<div className="grid grid-cols-2 gap-6">
									{/* Lead Information */}
									{selectedOpportunity.lead && (
										<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
											<Label className="font-semibold text-muted-foreground text-sm">
												Lead
											</Label>
											<div className="flex items-center gap-3">
												<Users className="h-5 w-5 text-muted-foreground" />
												<span className="font-medium">
													{selectedOpportunity.lead.firstName}{" "}
													{selectedOpportunity.lead.lastName}
												</span>
											</div>
											<div className="flex items-center gap-3 text-muted-foreground text-sm">
												<Mail className="h-5 w-5" />
												<span>{selectedOpportunity.lead.email}</span>
											</div>
										</div>
									)}

									{/* Company Information */}
									{selectedOpportunity.company && (
										<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
											<Label className="font-semibold text-muted-foreground text-sm">
												Empresa
											</Label>
											<div className="flex items-center gap-3">
												<Building className="h-5 w-5 text-muted-foreground" />
												<span className="font-medium">
													{selectedOpportunity.company.name}
												</span>
											</div>
										</div>
									)}

									{/* Expected Close Date */}
									{selectedOpportunity.expectedCloseDate && (
										<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
											<Label className="font-semibold text-muted-foreground text-sm">
												Fecha de Cierre Esperada
											</Label>
											<div className="flex items-center gap-3">
												<Calendar className="h-5 w-5 text-muted-foreground" />
												<span className="font-medium">
													{formatGuatemalaDate(
														selectedOpportunity.expectedCloseDate,
													)}
												</span>
											</div>
										</div>
									)}

									{/* Assigned To */}
									{selectedOpportunity.assignedUser && (
										<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
											<Label className="font-semibold text-muted-foreground text-sm">
												Asignado a
											</Label>
											<div className="flex items-center gap-3">
												<Users className="h-5 w-5 text-muted-foreground" />
												<span className="font-medium">
													{selectedOpportunity.assignedUser.name ||
														"Usuario sin nombre"}
												</span>
											</div>
										</div>
									)}
								</div>

								{/* Weighted Value */}
								<div className="rounded-lg border bg-muted/50 p-6">
									<div className="flex items-center justify-between">
										<span className="font-semibold text-base">
											Valor Ponderado
										</span>
										<span className="font-bold text-2xl text-blue-600">
											$
											{(
												(Number.parseFloat(selectedOpportunity.value || "0") *
													(selectedOpportunity.probability ||
														selectedOpportunity.stage?.closurePercentage ||
														0)) /
												100
											).toLocaleString()}
										</span>
									</div>
								</div>

								{/* Notes */}
								{selectedOpportunity.notes && (
									<div className="space-y-3">
										<Label className="font-semibold text-base text-muted-foreground">
											Notas
										</Label>
										<div className="rounded-lg border bg-muted/50 p-4">
											<p className="text-sm leading-relaxed">
												{selectedOpportunity.notes}
											</p>
										</div>
									</div>
								)}

								{/* Actions */}
								<div className="flex gap-3 border-t pt-6">
									<Button
										variant="outline"
										size="default"
										className="flex-1"
										onClick={handleEditOpportunity}
									>
										Editar
									</Button>
									<Button
										variant="outline"
										size="default"
										className="flex-1"
										onClick={handleChangeStage}
									>
										Cambiar Etapa
									</Button>
								</div>
								</TabsContent>
								
								<TabsContent value="history" className="space-y-4 mt-6">
									<div className="space-y-4">
										<div className="flex items-center gap-2 mb-4">
											<History className="h-5 w-5 text-muted-foreground" />
											<h3 className="font-semibold text-lg">Historial de Cambios</h3>
										</div>
										
										{isLoadingHistory ? (
											<div className="flex items-center justify-center py-8">
												<p className="text-muted-foreground">Cargando historial...</p>
											</div>
										) : opportunityHistory.length === 0 ? (
											<div className="rounded-lg border bg-muted/30 p-4 text-center">
												<p className="text-muted-foreground">No hay cambios registrados</p>
											</div>
										) : (
											<div className="space-y-3">
												{opportunityHistory.map((change) => (
													<div key={change.id} className="rounded-lg border bg-card p-4">
														<div className="flex items-start justify-between">
															<div className="flex-1 space-y-2">
																<div className="flex items-center gap-2">
																	{change.isOverride && (
																		<Badge variant="outline" className="bg-orange-100 border-orange-300 text-orange-700">
																			Override
																		</Badge>
																	)}
																	<span className="font-medium">
																		{change.fromStage?.name || "Inicio"} → {change.toStage?.name}
																	</span>
																</div>
																{change.reason && (
																	<p className="text-sm text-muted-foreground">{change.reason}</p>
																)}
																<div className="flex items-center gap-4 text-xs text-muted-foreground">
																	<div className="flex items-center gap-1">
																		<Clock className="h-3 w-3" />
																		{new Date(change.changedAt).toLocaleString()}
																	</div>
																	<div className="flex items-center gap-1">
																		<Users className="h-3 w-3" />
																		{change.changedBy?.name || "Usuario desconocido"}
																		{change.changedBy?.role && (
																			<Badge variant="outline" className="ml-1 text-xs">
																				{change.changedBy.role === "admin" ? "Admin" : 
																				 change.changedBy.role === "sales" ? "Ventas" : 
																				 change.changedBy.role === "analyst" ? "Analista" : 
																				 change.changedBy.role}
																			</Badge>
																		)}
																	</div>
																</div>
															</div>
														</div>
													</div>
												))}
											</div>
										)}
									</div>
								</TabsContent>
								
								<TabsContent value="documents" className="space-y-4 mt-6">
									<DocumentsManager opportunityId={selectedOpportunity.id} />
								</TabsContent>
							</Tabs>
						)}
					</DialogContent>
				</Dialog>

				{/* Edit Opportunity Dialog */}
				<Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
					<DialogContent className="min-w-[600px] max-w-4xl">
						<DialogHeader>
							<DialogTitle>Editar Oportunidad</DialogTitle>
						</DialogHeader>
						<form
							onSubmit={(e) => {
								e.preventDefault();
								e.stopPropagation();
								void editOpportunityForm.handleSubmit();
							}}
							className="space-y-6"
						>
							<div>
								<editOpportunityForm.Field
									name="title"
									validators={{
										onChange: ({ value }) => {
											if (!value || value.trim() === "") {
												return "El título es requerido";
											}
											return undefined;
										},
									}}
								>
									{(field) => (
										<div className="space-y-2">
											<Label htmlFor={field.name}>
												Título de la Oportunidad{" "}
												<span className="text-red-500">*</span>
											</Label>
											<Input
												id={field.name}
												name={field.name}
												value={field.state.value}
												onBlur={field.handleBlur}
												onChange={(e) => field.handleChange(e.target.value)}
												placeholder="Ingresa el título de la oportunidad..."
												className={
													field.state.meta.errors.length > 0
														? "border-red-500"
														: ""
												}
											/>
											{field.state.meta.errors.map((error) => (
												<p key={String(error)} className="text-red-500 text-sm">
													{String(error)}
												</p>
											))}
										</div>
									)}
								</editOpportunityForm.Field>
							</div>

							<div className="grid grid-cols-2 gap-4">
								<div>
									<editOpportunityForm.Field name="leadId">
										{(field) => (
											<div className="space-y-2">
												<Label htmlFor={field.name}>Lead</Label>
												<Select
													value={field.state.value}
													onValueChange={(value) => field.handleChange(value)}
												>
													<SelectTrigger className="w-full">
														<SelectValue placeholder="Seleccionar lead" />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="none">Sin lead</SelectItem>
														{leadsQuery.data?.map((lead) => (
															<SelectItem key={lead.id} value={lead.id}>
																{lead.firstName} {lead.lastName}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											</div>
										)}
									</editOpportunityForm.Field>
								</div>
								<div>
									<editOpportunityForm.Field name="value">
										{(field) => (
											<div className="space-y-2">
												<Label htmlFor={field.name}>Valor del Negocio</Label>
												<Input
													id={field.name}
													name={field.name}
													type="number"
													value={field.state.value}
													onBlur={field.handleBlur}
													onChange={(e) => field.handleChange(e.target.value)}
													placeholder="0.00"
												/>
											</div>
										)}
									</editOpportunityForm.Field>
								</div>
							</div>

							<div>
								<editOpportunityForm.Field name="stageId">
									{(field) => (
										<div className="space-y-2">
											<Label htmlFor={field.name}>Etapa</Label>
											<Select
												value={field.state.value}
												onValueChange={(value) => field.handleChange(value)}
											>
												<SelectTrigger className="w-full">
													<SelectValue placeholder="Seleccionar etapa" />
												</SelectTrigger>
												<SelectContent>
													{salesStagesQuery.data?.map((stage) => (
														<SelectItem key={stage.id} value={stage.id}>
															{stage.name} ({stage.closurePercentage}%)
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</div>
									)}
								</editOpportunityForm.Field>
							</div>

							<div className="grid grid-cols-2 gap-4">
								<div>
									<editOpportunityForm.Field name="probability">
										{(field) => (
											<div className="space-y-2">
												<Label htmlFor={field.name}>Probabilidad (%)</Label>
												<Input
													id={field.name}
													name={field.name}
													type="number"
													min="0"
													max="100"
													value={field.state.value}
													onBlur={field.handleBlur}
													onChange={(e) =>
														field.handleChange(Number(e.target.value))
													}
													placeholder="0"
												/>
											</div>
										)}
									</editOpportunityForm.Field>
								</div>
								<div>
									<editOpportunityForm.Field name="expectedCloseDate">
										{(field) => (
											<div className="space-y-2">
												<Label htmlFor={field.name}>Fecha de Cierre</Label>
												<Input
													id={field.name}
													name={field.name}
													type="date"
													value={field.state.value}
													onBlur={field.handleBlur}
													onChange={(e) => field.handleChange(e.target.value)}
												/>
											</div>
										)}
									</editOpportunityForm.Field>
								</div>
							</div>

							<div>
								<editOpportunityForm.Field name="notes">
									{(field) => (
										<div className="space-y-2">
											<Label htmlFor={field.name}>Notas</Label>
											<Input
												id={field.name}
												name={field.name}
												value={field.state.value}
												onBlur={field.handleBlur}
												onChange={(e) => field.handleChange(e.target.value)}
												placeholder="Notas adicionales sobre esta oportunidad..."
											/>
										</div>
									)}
								</editOpportunityForm.Field>
							</div>

							<editOpportunityForm.Subscribe>
								{(state) => (
									<div className="flex gap-3">
										<Button
											type="button"
											variant="outline"
											className="flex-1"
											onClick={() => setIsEditDialogOpen(false)}
										>
											Cancelar
										</Button>
										<Button
											type="submit"
											className="flex-1"
											disabled={
												!state.canSubmit ||
												state.isSubmitting ||
												updateOpportunityMutation.isPending
											}
										>
											{state.isSubmitting || updateOpportunityMutation.isPending
												? "Actualizando..."
												: "Actualizar Oportunidad"}
										</Button>
									</div>
								)}
							</editOpportunityForm.Subscribe>
						</form>
					</DialogContent>
				</Dialog>

				{/* Change Stage Dialog */}
				<Dialog
					open={isChangeStageDialogOpen}
					onOpenChange={setIsChangeStageDialogOpen}
				>
					<DialogContent className="max-w-md">
						<DialogHeader>
							<DialogTitle>Cambiar Etapa</DialogTitle>
						</DialogHeader>
						{selectedOpportunity && (
							<div className="space-y-6">
								<div className="space-y-2">
									<Label>Oportunidad</Label>
									<p className="text-muted-foreground text-sm">
										{selectedOpportunity.title}
									</p>
								</div>
								<div className="space-y-3">
									<Label>Etapa Actual</Label>
									{selectedOpportunity.stage && (
										<Badge
											style={{
												backgroundColor: selectedOpportunity.stage.color,
												color: "white",
											}}
											className="block w-fit"
										>
											{selectedOpportunity.stage.name}
										</Badge>
									)}
								</div>
								<div className="space-y-3">
									<Label>Nueva Etapa</Label>
									<Select
										value={selectedStage}
										onValueChange={setSelectedStage}
									>
										<SelectTrigger className="w-full">
											<SelectValue placeholder="Seleccionar nueva etapa" />
										</SelectTrigger>
										<SelectContent>
											{salesStagesQuery.data?.map((stage) => (
												<SelectItem key={stage.id} value={stage.id}>
													{stage.name} ({stage.closurePercentage}%)
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
								<div className="space-y-2">
									<Label htmlFor="stageChangeReason">Razón del cambio (opcional)</Label>
									<Textarea
										id="stageChangeReason"
										value={stageChangeReason}
										onChange={(e) => setStageChangeReason(e.target.value)}
										placeholder="Describe por qué se está cambiando la etapa..."
										rows={3}
									/>
								</div>
								<div className="flex gap-3 pt-4">
									<Button
										type="button"
										variant="outline"
										className="flex-1"
										onClick={() => {
											setIsChangeStageDialogOpen(false);
											setStageChangeReason("");
										}}
									>
										Cancelar
									</Button>
									<Button
										className="flex-1"
										onClick={() => {
											if (selectedStage && selectedOpportunity) {
												updateOpportunityMutation.mutate({
													id: selectedOpportunity.id,
													stageId: selectedStage,
													stageChangeReason: stageChangeReason || undefined,
												});
												setIsChangeStageDialogOpen(false);
												setStageChangeReason("");
											}
										}}
										disabled={
											!selectedStage || updateOpportunityMutation.isPending
										}
									>
										{updateOpportunityMutation.isPending
											? "Actualizando..."
											: "Cambiar Etapa"}
									</Button>
								</div>
							</div>
						)}
					</DialogContent>
				</Dialog>
			</div>

			{/* Enhanced Opportunities Kanban View */}
			<div className="flex gap-6 overflow-x-auto pb-4">
				{opportunitiesByStage.map(
					({ stage, opportunities, totalValue, count }) => (
						<DroppableStageColumn
							key={stage.id}
							stage={stage}
							opportunities={opportunities}
							totalValue={totalValue}
							count={count}
							getStatusBadgeColor={getStatusBadgeColor}
							onDropOpportunity={handleDropOpportunity}
							onOpportunityClick={handleOpportunityClick}
						/>
					),
				)}
			</div>
		</div>
	);
}

// Documents Manager Component
function DocumentsManager({ opportunityId }: { opportunityId: string }) {
	const [selectedFile, setSelectedFile] = useState<File | null>(null);
	const [description, setDescription] = useState("");
	const [documentType, setDocumentType] = useState<string>("identification");
	const fileInputRef = useRef<HTMLInputElement>(null);
	const { data: session } = authClient.useSession();
	const userProfile = useQuery(orpc.getUserProfile.queryOptions());
	const queryClient = useQueryClient();

	// Query for documents
	const documentsQuery = useQuery({
		...orpc.getOpportunityDocuments.queryOptions({ input: { opportunityId } }),
		enabled: !!opportunityId,
	});

	// Upload mutation
	const uploadMutation = useMutation({
		mutationFn: async () => {
			if (!selectedFile) return;

			const formData = new FormData();
			formData.append("file", selectedFile);
			formData.append("opportunityId", opportunityId);
			formData.append("documentType", documentType);
			if (description) {
				formData.append("description", description);
			}

			// Use fetch directly for file upload
			const response = await fetch(`${import.meta.env.VITE_SERVER_URL}/api/upload-opportunity-document`, {
				method: "POST",
				body: formData,
				credentials: "include",
			});

			if (!response.ok) {
				const error = await response.json();
				throw new Error(error.message || "Error al subir el archivo");
			}

			return response.json();
		},
		onSuccess: () => {
			toast.success("Documento subido exitosamente");
			setSelectedFile(null);
			setDescription("");
			setDocumentType("identification");
			if (fileInputRef.current) {
				fileInputRef.current.value = "";
			}
			queryClient.invalidateQueries({ queryKey: ["getOpportunityDocuments", opportunityId] });
		},
		onError: (error: any) => {
			toast.error(error.message || "Error al subir el documento");
		},
	});

	// Delete mutation
	const deleteMutation = useMutation({
		mutationFn: (documentId: string) => 
			client.deleteOpportunityDocument({ documentId }),
		onSuccess: () => {
			toast.success("Documento eliminado exitosamente");
			queryClient.invalidateQueries({ queryKey: ["getOpportunityDocuments", opportunityId] });
		},
		onError: (error: any) => {
			toast.error(error.message || "Error al eliminar el documento");
		},
	});

	const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (file) {
			// Validate file
			const allowedTypes = [
				'application/pdf',
				'image/jpeg',
				'image/jpg',
				'image/png',
				'image/webp',
				'application/msword',
				'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			];

			if (!allowedTypes.includes(file.type)) {
				toast.error("Tipo de archivo no permitido. Solo se permiten PDF, imágenes y documentos Word.");
				return;
			}

			const maxSize = 10 * 1024 * 1024; // 10MB
			if (file.size > maxSize) {
				toast.error("El archivo es demasiado grande. El tamaño máximo permitido es 10MB.");
				return;
			}

			setSelectedFile(file);
		}
	};

	const documentTypeOptions = [
		{ value: "identification", label: "Identificación (DPI/Pasaporte)" },
		{ value: "income_proof", label: "Comprobante de Ingresos" },
		{ value: "bank_statement", label: "Estado de Cuenta Bancario" },
		{ value: "business_license", label: "Patente de Comercio" },
		{ value: "property_deed", label: "Escrituras de Propiedad" },
		{ value: "vehicle_title", label: "Tarjeta de Circulación" },
		{ value: "credit_report", label: "Reporte Crediticio" },
		{ value: "other", label: "Otro" },
	];

	const getDocumentIcon = (mimeType: string) => {
		if (mimeType.includes("pdf")) return "📄";
		if (mimeType.includes("image")) return "🖼️";
		if (mimeType.includes("word")) return "📝";
		return "📎";
	};

	return (
		<div className="space-y-6">
			{/* Upload Section */}
			<Card>
				<CardHeader>
					<CardTitle className="text-lg flex items-center gap-2">
						<Upload className="h-5 w-5" />
						Subir Documento
					</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="documentType">Tipo de Documento</Label>
						<Select value={documentType} onValueChange={setDocumentType}>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{documentTypeOptions.map((type) => (
									<SelectItem key={type.value} value={type.value}>
										{type.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="space-y-2">
						<Label htmlFor="description">Descripción (opcional)</Label>
						<Input
							id="description"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="Descripción del documento..."
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="file">Archivo</Label>
						<Input
							ref={fileInputRef}
							id="file"
							type="file"
							onChange={handleFileSelect}
							accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"
						/>
						<p className="text-xs text-muted-foreground">
							Formatos permitidos: PDF, JPG, PNG, WebP, DOC, DOCX. Tamaño máximo: 10MB
						</p>
					</div>

					{selectedFile && (
						<div className="bg-muted rounded-lg p-3 flex items-center justify-between">
							<div className="flex items-center gap-2">
								<FileText className="h-4 w-4 text-muted-foreground" />
								<span className="text-sm">{selectedFile.name}</span>
								<span className="text-xs text-muted-foreground">
									({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)
								</span>
							</div>
							<Button
								size="sm"
								variant="ghost"
								onClick={() => {
									setSelectedFile(null);
									if (fileInputRef.current) {
										fileInputRef.current.value = "";
									}
								}}
							>
								<Trash2 className="h-4 w-4" />
							</Button>
						</div>
					)}

					<Button
						className="w-full"
						disabled={!selectedFile || uploadMutation.isPending}
						onClick={() => uploadMutation.mutate()}
					>
						{uploadMutation.isPending ? "Subiendo..." : "Subir Documento"}
					</Button>
				</CardContent>
			</Card>

			{/* Documents List */}
			<Card>
				<CardHeader>
					<CardTitle className="text-lg flex items-center gap-2">
						<FileText className="h-5 w-5" />
						Documentos Subidos
					</CardTitle>
				</CardHeader>
				<CardContent>
					{documentsQuery.isLoading ? (
						<p className="text-center text-muted-foreground py-4">Cargando documentos...</p>
					) : documentsQuery.data?.length === 0 ? (
						<p className="text-center text-muted-foreground py-4">No hay documentos subidos</p>
					) : (
						<div className="space-y-3">
							{documentsQuery.data?.map((doc) => (
								<div key={doc.id} className="flex items-center justify-between p-3 border rounded-lg">
									<div className="flex items-center gap-3 flex-1">
										<span className="text-2xl">{getDocumentIcon(doc.mimeType)}</span>
										<div className="flex-1">
											<div className="flex items-center gap-2">
												<span className="font-medium text-sm">{doc.originalName}</span>
												<Badge variant="outline" className="text-xs">
													{documentTypeOptions.find(t => t.value === doc.documentType)?.label || doc.documentType}
												</Badge>
											</div>
											{doc.description && (
												<p className="text-xs text-muted-foreground mt-1">{doc.description}</p>
											)}
											<div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
												<span>{(doc.size / 1024 / 1024).toFixed(2)} MB</span>
												<span>Subido por {doc.uploadedBy?.name || "Usuario desconocido"}</span>
												<span>{new Date(doc.uploadedAt).toLocaleString()}</span>
											</div>
										</div>
									</div>
									<div className="flex items-center gap-2">
										<Button
											size="sm"
											variant="outline"
											onClick={() => window.open(doc.url, "_blank")}
										>
											Ver
										</Button>
										{(userProfile.data?.role === "admin" || doc.uploadedBy?.id === session?.user?.id) && (
											<Button
												size="sm"
												variant="ghost"
												onClick={() => deleteMutation.mutate(doc.id)}
												disabled={deleteMutation.isPending}
											>
												<Trash2 className="h-4 w-4" />
											</Button>
										)}
									</div>
								</div>
							))}
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
